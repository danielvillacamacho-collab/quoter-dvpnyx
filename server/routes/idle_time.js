/**
 * Idle Time — SPEC-II-00.
 *
 * Endpoints:
 *   GET  /api/idle-time/users/:employee_id/periods/:yyyymm  — snapshot individual
 *   GET  /api/idle-time/aggregate?period=YYYY-MM&group_by=  — agregado para CFO
 *   POST /api/idle-time/calculate                            — admin: corre cron
 *   POST /api/idle-time/finalize                             — admin: marca como final
 *   GET  /api/idle-time/capacity-utilization?period=         — vista holística
 *
 * El motor puro vive en `utils/idle_time_engine.js`; este route hace
 * SOLO el I/O contra Postgres y orquestación.
 *
 * Cron real: NO hay (decisión de CTO). Finance/admin corre el cálculo
 * manualmente desde la UI o vía API el día 5 del mes. La idempotencia
 * está garantizada: re-correr no duplica filas (UPSERT).
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent } = require('../utils/events');
const { isValidUUID } = require('../utils/sanitize');
const { serverError, safeRollback } = require('../utils/http');
const {
  calculateIdleTime,
  parsePeriod,
  periodStart,
  periodEnd,
} = require('../utils/idle_time_engine');

router.use(auth);

const VALID_GROUP_BY = ['none', 'country', 'business_area', 'operations_owner'];

function isAdmin(user) {
  return ['admin', 'superadmin'].includes(user.role);
}
function hasGlobalView(user) {
  return isAdmin(user) || user.function === 'capacity' || user.function === 'finance';
}

/* ------------------------------------------------------------------ */
/* Helpers de carga: holidays/novelties/assignments/employee/rate     */
/* ------------------------------------------------------------------ */

async function loadEmployeeAndCountry(client, employee_id) {
  const { rows: empRows } = await client.query(
    `SELECT e.id, e.first_name, e.last_name, e.weekly_capacity_hours,
            e.start_date AS hire_date, e.end_date, e.country_id, e.country, e.level,
            (SELECT cost_usd FROM employee_costs
              WHERE employee_id = e.id AND cost_usd IS NOT NULL
              ORDER BY period DESC LIMIT 1) AS cost_usd
       FROM employees e
      WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [employee_id]
  );
  if (!empRows.length) return null;
  const emp = empRows[0];
  const countryId = emp.country_id || 'CO';
  const { rows: countryRows } = await client.query(
    `SELECT id, standard_workday_hours, standard_workdays_per_week
       FROM countries WHERE id = $1`, [countryId]
  );
  const country = countryRows[0] || { id: 'CO', standard_workday_hours: 8, standard_workdays_per_week: 5 };
  // tarifa horaria
  let hourly_rate_usd = null;
  if (emp.cost_usd != null && Number(emp.weekly_capacity_hours) > 0) {
    const monthlyHours = (Number(emp.weekly_capacity_hours) * 52) / 12;
    hourly_rate_usd = Math.round((Number(emp.cost_usd) / monthlyHours) * 10000) / 10000;
  }
  return {
    employee: emp,
    country,
    hourly_rate_usd,
  };
}

async function loadDataForPeriod(client, employee_id, yyyymm) {
  const start = periodStart(yyyymm);
  const end = periodEnd(yyyymm);
  const ctx = await loadEmployeeAndCountry(client, employee_id);
  if (!ctx) return null;
  const country_id = ctx.country.id;

  const [holidaysRes, noveltiesRes, contractsRes, internalsRes] = await Promise.all([
    client.query(
      `SELECT holiday_date, label FROM country_holidays
        WHERE country_id = $1 AND holiday_date BETWEEN $2 AND $3`,
      [country_id, start, end]
    ),
    client.query(
      `SELECT n.start_date, n.end_date, n.novelty_type_id, n.status,
              COALESCE(nt.counts_in_capacity, false) AS counts_in_capacity
         FROM employee_novelties n
         LEFT JOIN novelty_types nt ON nt.id = n.novelty_type_id
        WHERE n.employee_id = $1
          AND n.status = 'approved'
          AND n.end_date >= $2 AND n.start_date <= $3`,
      [employee_id, start, end]
    ),
    client.query(
      `SELECT a.start_date, a.end_date, a.weekly_hours, a.contract_id,
              c.name AS contract_name
         FROM assignments a
         LEFT JOIN contracts c ON c.id = a.contract_id
        WHERE a.employee_id = $1
          AND a.deleted_at IS NULL
          AND a.status IN ('planned','active','ended')
          AND COALESCE(a.end_date, '9999-12-31'::date) >= $2
          AND a.start_date <= $3`,
      [employee_id, start, end]
    ),
    client.query(
      `SELECT iia.start_date, iia.end_date, iia.weekly_hours, iia.internal_initiative_id,
              ii.name AS initiative_name, ii.initiative_code
         FROM internal_initiative_assignments iia
         LEFT JOIN internal_initiatives ii ON ii.id = iia.internal_initiative_id
        WHERE iia.employee_id = $1
          AND iia.deleted_at IS NULL
          AND iia.status IN ('planned','active','ended')
          AND COALESCE(iia.end_date, '9999-12-31'::date) >= $2
          AND iia.start_date <= $3`,
      [employee_id, start, end]
    ),
  ]);

  return {
    employee: ctx.employee,
    country: ctx.country,
    hourly_rate_usd: ctx.hourly_rate_usd,
    holidays: holidaysRes.rows,
    novelties: noveltiesRes.rows,
    contractAssignments: contractsRes.rows,
    internalAssignments: internalsRes.rows,
  };
}

/* ------------------------------------------------------------------ */
/* GET /users/:employee_id/periods/:yyyymm                             */
/* ------------------------------------------------------------------ */
router.get('/users/:employee_id/periods/:yyyymm', async (req, res) => {
  const { employee_id, yyyymm } = req.params;
  if (!isValidUUID(employee_id)) return res.status(400).json({ error: 'employee_id inválido' });
  if (!parsePeriod(yyyymm))      return res.status(400).json({ error: 'period inválido (YYYY-MM)' });

  // Scoping: admin/capacity/finance ve cualquiera; otros solo ven el propio
  // (vía employees.user_id = req.user.id) o lo que su lead vea.
  if (!hasGlobalView(req.user)) {
    const { rows } = await pool.query(
      `SELECT id, user_id, manager_user_id FROM employees WHERE id = $1`, [employee_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    const e = rows[0];
    const isOwn = e.user_id === req.user.id;
    const isLead = req.user.role === 'lead' && e.manager_user_id === req.user.id;
    if (!isOwn && !isLead) return res.status(403).json({ error: 'Sin permisos' });
  }

  try {
    // ¿Hay snapshot persistido?
    const { rows: snap } = await pool.query(
      `SELECT * FROM idle_time_calculations
        WHERE employee_id = $1 AND period_yyyymm = $2`,
      [employee_id, normalizePeriod(yyyymm)]
    );
    if (snap.length > 0) {
      return res.json({ ...snap[0], persisted: true });
    }

    // Calcular on-the-fly (preliminary, sin guardar).
    const data = await loadDataForPeriod(pool, employee_id, yyyymm);
    if (!data) return res.status(404).json({ error: 'Empleado no encontrado' });

    const result = calculateIdleTime({
      period_yyyymm: yyyymm,
      employee: data.employee,
      country: data.country,
      holidays: data.holidays,
      novelties: data.novelties,
      contractAssignments: data.contractAssignments,
      internalAssignments: data.internalAssignments,
      hourly_rate_usd: data.hourly_rate_usd,
    });
    res.json({ ...result, calculation_status: 'preliminary', persisted: false });
  } catch (err) {
    serverError(res, 'GET /idle-time/users/:employee_id/periods/:yyyymm', err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /calculate (admin) — corre el cálculo y persiste UPSERT        */
/* ------------------------------------------------------------------ */
router.post('/calculate', adminOnly, async (req, res) => {
  const body = req.body || {};
  const period_yyyymm = normalizePeriod(body.period_yyyymm);
  if (!parsePeriod(period_yyyymm)) {
    return res.status(400).json({ error: 'period_yyyymm requerido (YYYY-MM)' });
  }
  const targetEmployees = Array.isArray(body.employee_ids) ? body.employee_ids : null;

  try {
    let employees;
    if (targetEmployees && targetEmployees.length > 0) {
      const { rows } = await pool.query(
        `SELECT id FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [targetEmployees]
      );
      employees = rows.map((r) => r.id);
    } else {
      const { rows } = await pool.query(
        `SELECT id FROM employees
          WHERE deleted_at IS NULL
            AND status IN ('active','on_leave','bench')`
      );
      employees = rows.map((r) => r.id);
    }

    const results = { processed: 0, missing_rate: 0, errors: 0, skipped_final: 0 };

    for (const eid of employees) {
      try {
        const data = await loadDataForPeriod(pool, eid, period_yyyymm);
        if (!data) { results.errors += 1; continue; }
        const calc = calculateIdleTime({
          period_yyyymm,
          employee: data.employee,
          country: data.country,
          holidays: data.holidays,
          novelties: data.novelties,
          contractAssignments: data.contractAssignments,
          internalAssignments: data.internalAssignments,
          hourly_rate_usd: data.hourly_rate_usd,
        });
        if (calc.breakdown && calc.breakdown.flags && calc.breakdown.flags.missing_rate) {
          results.missing_rate += 1;
        }

        const { rows: existing } = await pool.query(
          `SELECT id, calculation_status FROM idle_time_calculations
            WHERE employee_id = $1 AND period_yyyymm = $2`,
          [eid, period_yyyymm]
        );
        if (existing.length && existing[0].calculation_status === 'final') {
          results.skipped_final += 1;
          continue;
        }

        await pool.query(
          `INSERT INTO idle_time_calculations
             (employee_id, period_yyyymm, total_capacity_hours, holiday_hours,
              novelty_hours, available_hours, assigned_hours_contract,
              assigned_hours_internal, assigned_hours_total, idle_hours, idle_pct,
              hourly_rate_usd_at_calc, idle_cost_usd, calculation_status, breakdown,
              calculated_at, calculated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   'preliminary', $14::jsonb, NOW(), $15)
           ON CONFLICT (employee_id, period_yyyymm) DO UPDATE SET
             total_capacity_hours    = EXCLUDED.total_capacity_hours,
             holiday_hours           = EXCLUDED.holiday_hours,
             novelty_hours           = EXCLUDED.novelty_hours,
             available_hours         = EXCLUDED.available_hours,
             assigned_hours_contract = EXCLUDED.assigned_hours_contract,
             assigned_hours_internal = EXCLUDED.assigned_hours_internal,
             assigned_hours_total    = EXCLUDED.assigned_hours_total,
             idle_hours              = EXCLUDED.idle_hours,
             idle_pct                = EXCLUDED.idle_pct,
             hourly_rate_usd_at_calc = EXCLUDED.hourly_rate_usd_at_calc,
             idle_cost_usd           = EXCLUDED.idle_cost_usd,
             breakdown               = EXCLUDED.breakdown,
             calculated_at           = NOW(),
             calculated_by           = EXCLUDED.calculated_by,
             updated_at              = NOW()`,
          [
            eid, period_yyyymm,
            calc.total_capacity_hours, calc.holiday_hours, calc.novelty_hours,
            calc.available_hours, calc.assigned_hours_contract,
            calc.assigned_hours_internal, calc.assigned_hours_total,
            calc.idle_hours, calc.idle_pct,
            calc.hourly_rate_usd_at_calc, calc.idle_cost_usd,
            JSON.stringify(calc.breakdown || {}),
            req.user.id,
          ]
        );
        results.processed += 1;
      } catch (loopErr) {
        // No rompemos el batch entero por un empleado.
        // eslint-disable-next-line no-console
        console.error(`idle-time calculate failed for employee ${eid}:`, loopErr.message);
        results.errors += 1;
      }
    }

    await emitEvent(pool, {
      event_type: 'idle_time.calculated',
      entity_type: 'idle_time_period',
      entity_id: '00000000-0000-0000-0000-000000000000',
      actor_user_id: req.user.id,
      payload: { period_yyyymm, employees_count: employees.length, ...results },
      req,
    });

    res.json({ period_yyyymm, employees_count: employees.length, ...results });
  } catch (err) {
    serverError(res, 'POST /idle-time/calculate', err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /finalize (admin) — marca todos los preliminary del período    */
/* ------------------------------------------------------------------ */
router.post('/finalize', adminOnly, async (req, res) => {
  const period_yyyymm = normalizePeriod((req.body || {}).period_yyyymm);
  if (!parsePeriod(period_yyyymm)) return res.status(400).json({ error: 'period_yyyymm inválido' });

  try {
    const { rowCount } = await pool.query(
      `UPDATE idle_time_calculations
          SET calculation_status = 'final', updated_at = NOW()
        WHERE period_yyyymm = $1 AND calculation_status = 'preliminary'`,
      [period_yyyymm]
    );
    await emitEvent(pool, {
      event_type: 'idle_time.finalized',
      entity_type: 'idle_time_period',
      entity_id: '00000000-0000-0000-0000-000000000000',
      actor_user_id: req.user.id,
      payload: { period_yyyymm, finalized_count: rowCount },
      req,
    });
    res.json({ period_yyyymm, finalized_count: rowCount });
  } catch (err) { serverError(res, 'POST /idle-time/finalize', err); }
});

/* ------------------------------------------------------------------ */
/* POST /recalculate (admin) — fuerza recálculo de finales             */
/* ------------------------------------------------------------------ */
router.post('/recalculate', adminOnly, async (req, res) => {
  const body = req.body || {};
  const period_yyyymm = normalizePeriod(body.period_yyyymm);
  if (!parsePeriod(period_yyyymm)) return res.status(400).json({ error: 'period_yyyymm inválido' });
  if (!body.reason || String(body.reason).trim().length < 10) {
    return res.status(400).json({ error: 'reason requerido (≥10 chars)' });
  }
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    // Bajar status a preliminary; el trigger NO bloquea cambio dirigido por
    // admin endpoint si la transición es controlada (en práctica, lo
    // bloquearía — usamos DELETE y reinserción para cumplir la constraint).
    await conn.query(
      `DELETE FROM idle_time_calculations WHERE period_yyyymm = $1`,
      [period_yyyymm]
    );
    await emitEvent(conn, {
      event_type: 'idle_time.recalculated',
      entity_type: 'idle_time_period',
      entity_id: '00000000-0000-0000-0000-000000000000',
      actor_user_id: req.user.id,
      payload: { period_yyyymm, reason: body.reason },
      req,
    });
    await conn.query('COMMIT');
    res.json({
      ok: true,
      period_yyyymm,
      message: 'Snapshots eliminados. Vuelve a correr POST /calculate para recalcular.',
    });
  } catch (err) {
    await safeRollback(conn, 'POST /idle-time/recalculate');
    serverError(res, 'POST /idle-time/recalculate', err);
  } finally { conn.release(); }
});

/* ------------------------------------------------------------------ */
/* GET /aggregate                                                      */
/* ------------------------------------------------------------------ */
router.get('/aggregate', async (req, res) => {
  if (!hasGlobalView(req.user) && req.user.role !== 'lead') {
    return res.status(403).json({ error: 'Sin permisos para ver agregados' });
  }
  const period_yyyymm = normalizePeriod(req.query.period);
  if (!parsePeriod(period_yyyymm)) return res.status(400).json({ error: 'period requerido (YYYY-MM)' });
  const group_by = req.query.group_by || 'none';
  if (!VALID_GROUP_BY.includes(group_by)) {
    return res.status(400).json({ error: `group_by inválido (válidos: ${VALID_GROUP_BY.join(',')})` });
  }

  try {
    const totalsQ = await pool.query(
      `SELECT
         COUNT(*)::int AS users_count,
         COALESCE(SUM(total_capacity_hours), 0)::numeric AS total_capacity_hours,
         COALESCE(SUM(holiday_hours), 0)::numeric AS holiday_hours,
         COALESCE(SUM(novelty_hours), 0)::numeric AS novelty_hours,
         COALESCE(SUM(available_hours), 0)::numeric AS available_hours,
         COALESCE(SUM(assigned_hours_contract), 0)::numeric AS assigned_hours_contract,
         COALESCE(SUM(assigned_hours_internal), 0)::numeric AS assigned_hours_internal,
         COALESCE(SUM(assigned_hours_total), 0)::numeric AS assigned_hours_total,
         COALESCE(SUM(idle_hours), 0)::numeric AS idle_hours,
         CASE WHEN COALESCE(SUM(available_hours), 0) > 0
              THEN COALESCE(SUM(idle_hours), 0)::numeric / NULLIF(SUM(available_hours), 0)
              ELSE 0 END AS average_idle_pct,
         COALESCE(SUM(idle_cost_usd), 0)::numeric AS total_idle_cost_usd
       FROM idle_time_calculations
       WHERE period_yyyymm = $1`,
      [period_yyyymm]
    );

    let groups = [];
    if (group_by === 'country') {
      const { rows } = await pool.query(
        `SELECT COALESCE(e.country_id, 'XX') AS country_id,
                COUNT(*)::int AS users_count,
                COALESCE(SUM(itc.idle_hours), 0)::numeric AS idle_hours,
                COALESCE(SUM(itc.available_hours), 0)::numeric AS available_hours,
                CASE WHEN COALESCE(SUM(itc.available_hours), 0) > 0
                     THEN COALESCE(SUM(itc.idle_hours), 0)::numeric / NULLIF(SUM(itc.available_hours), 0)
                     ELSE 0 END AS idle_pct,
                COALESCE(SUM(itc.idle_cost_usd), 0)::numeric AS idle_cost_usd
           FROM idle_time_calculations itc
           LEFT JOIN employees e ON e.id = itc.employee_id
          WHERE itc.period_yyyymm = $1
          GROUP BY e.country_id
          ORDER BY idle_cost_usd DESC`,
        [period_yyyymm]
      );
      groups = rows;
    }
    // Agrupaciones por business_area u operations_owner aplicarían a internal_assignments
    // — quedan fuera de MVP para no inflar el endpoint. Si llegan, devolvemos array vacío.

    res.json({ period_yyyymm, group_by, totals: totalsQ.rows[0], groups });
  } catch (err) { serverError(res, 'GET /idle-time/aggregate', err); }
});

/* ------------------------------------------------------------------ */
/* GET /capacity-utilization — vista holística para CFO                */
/* ------------------------------------------------------------------ */
router.get('/capacity-utilization', async (req, res) => {
  if (!hasGlobalView(req.user) && req.user.role !== 'lead') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  const period_yyyymm = normalizePeriod(req.query.period);
  if (!parsePeriod(period_yyyymm)) return res.status(400).json({ error: 'period requerido' });

  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS users_count,
         COALESCE(SUM(total_capacity_hours), 0)::numeric AS total_capacity_hours,
         COALESCE(SUM(holiday_hours), 0)::numeric AS holiday_hours,
         COALESCE(SUM(novelty_hours), 0)::numeric AS novelty_hours,
         COALESCE(SUM(assigned_hours_contract), 0)::numeric AS billable_hours,
         COALESCE(SUM(assigned_hours_internal), 0)::numeric AS internal_hours,
         COALESCE(SUM(idle_hours), 0)::numeric AS idle_hours,
         COALESCE(SUM(idle_cost_usd), 0)::numeric AS idle_cost_usd
       FROM idle_time_calculations
       WHERE period_yyyymm = $1`,
      [period_yyyymm]
    );
    const t = rows[0];
    const total = Number(t.total_capacity_hours) || 0;
    const pct = (n) => total > 0 ? Math.round((Number(n) / total) * 10000) / 10000 : 0;
    res.json({
      period_yyyymm,
      total_capacity_hours: total,
      breakdown: {
        billable_assignments: { hours: Number(t.billable_hours), pct: pct(t.billable_hours) },
        internal_initiatives: { hours: Number(t.internal_hours), pct: pct(t.internal_hours) },
        holidays: { hours: Number(t.holiday_hours), pct: pct(t.holiday_hours) },
        novelties: { hours: Number(t.novelty_hours), pct: pct(t.novelty_hours) },
        idle: { hours: Number(t.idle_hours), pct: pct(t.idle_hours), cost_usd: Number(t.idle_cost_usd) },
      },
      indicators: {
        utilization_rate_billable_pct: pct(t.billable_hours),
        internal_investment_pct: pct(t.internal_hours),
        true_idle_pct: pct(t.idle_hours),
      },
    });
  } catch (err) { serverError(res, 'GET /idle-time/capacity-utilization', err); }
});

/* ------------------------------------------------------------------ */
/* GET /reports/internal-initiatives/cost-summary                      */
/* ------------------------------------------------------------------ */
router.get('/initiative-cost-summary', async (req, res) => {
  if (!hasGlobalView(req.user)) {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  const period_yyyymm = normalizePeriod(req.query.period);
  if (!parsePeriod(period_yyyymm)) return res.status(400).json({ error: 'period requerido' });

  try {
    const start = periodStart(period_yyyymm);
    const end = periodEnd(period_yyyymm);
    const params = [start, end];

    const totalsRes = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM internal_initiatives WHERE deleted_at IS NULL AND status = 'active') AS active_initiatives,
         (SELECT COALESCE(SUM(budget_usd), 0)::numeric FROM internal_initiatives WHERE deleted_at IS NULL AND status = 'active') AS total_budget_usd,
         COALESCE(SUM(weekly_hours * COALESCE(hourly_rate_usd, 0) * GREATEST(0,
           (LEAST($2::date, COALESCE(end_date, $2::date)) - GREATEST(start_date, $1::date))::numeric / 7
         )), 0)::numeric AS total_consumed_usd_period,
         COALESCE(SUM(weekly_hours * GREATEST(0,
           (LEAST($2::date, COALESCE(end_date, $2::date)) - GREATEST(start_date, $1::date))::numeric / 7
         )), 0)::numeric AS total_hours_period
       FROM internal_initiative_assignments
       WHERE deleted_at IS NULL AND status IN ('planned','active','ended')
         AND COALESCE(end_date, '9999-12-31'::date) >= $1
         AND start_date <= $2`,
      params
    );

    const byAreaRes = await pool.query(
      `SELECT ii.business_area_id AS area,
              COALESCE(SUM(iia.weekly_hours * COALESCE(iia.hourly_rate_usd, 0) * GREATEST(0,
                (LEAST($2::date, COALESCE(iia.end_date, $2::date)) - GREATEST(iia.start_date, $1::date))::numeric / 7
              )), 0)::numeric AS consumed_usd,
              COALESCE(SUM(iia.weekly_hours * GREATEST(0,
                (LEAST($2::date, COALESCE(iia.end_date, $2::date)) - GREATEST(iia.start_date, $1::date))::numeric / 7
              )), 0)::numeric AS hours
         FROM internal_initiative_assignments iia
         INNER JOIN internal_initiatives ii ON ii.id = iia.internal_initiative_id
        WHERE iia.deleted_at IS NULL AND iia.status IN ('planned','active','ended')
          AND COALESCE(iia.end_date, '9999-12-31'::date) >= $1
          AND iia.start_date <= $2
        GROUP BY ii.business_area_id
        ORDER BY consumed_usd DESC`,
      params
    );

    res.json({
      period_yyyymm,
      totals: totalsRes.rows[0],
      by_business_area: byAreaRes.rows,
    });
  } catch (err) { serverError(res, 'GET /idle-time/initiative-cost-summary', err); }
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function normalizePeriod(p) {
  if (p == null) return p;
  const s = String(p).replace(/^([0-9]{4})([0-9]{2})$/, '$1-$2');
  return s;
}

module.exports = router;
