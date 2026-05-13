import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter, buildUpdatePayload } from '@shared/events/emitter';
import { createInitiativesRepository } from './initiatives.repository';
import { createNoveltiesRepository } from './novelties.repository';
import { createHolidaysRepository } from './holidays.repository';
import { INITIATIVE_EDITABLE_FIELDS } from './types';
import type { InitiativeFilters, InitiativeStatus, NoveltyFilters, HolidayFilters } from './types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idleEngine = require('./idle_time_engine');

const db = getPool();
const events = createEventEmitter();
const initiativesRepo = createInitiativesRepository(db);
const noveltiesRepo = createNoveltiesRepository(db);
const holidaysRepo = createHolidaysRepository(db);

const router = createRouter();

/* ==================================================================
 * INTERNAL INITIATIVES — /api/internal-initiatives/*
 * ================================================================== */

router.get('/api/internal-initiatives', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const filters: InitiativeFilters = {
    search: qs.search,
    status: qs.status,
    business_area: qs.business_area,
    operations_owner_id: qs.operations_owner_id,
  };
  return paginated(await initiativesRepo.findAll({ page, limit, offset, filters }));
});

router.get('/api/internal-initiatives/:id', async (event, _user) => {
  const initiative = await initiativesRepo.findById(event.pathParameters!.id!);
  if (!initiative) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Iniciativa no encontrada' }) };
  return ok(initiative);
});

router.post('/api/internal-initiatives', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const initiative = await initiativesRepo.create(body, user, conn);

    await events.emit(conn, {
      event_type: 'internal_initiative.created',
      entity_type: 'internal_initiative',
      entity_id: initiative.id,
      actor_user_id: user.id,
      payload: { name: initiative.name, business_area_id: initiative.business_area_id, budget_usd: initiative.budget_usd },
    });

    await conn.query('COMMIT');
    return created(initiative);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

router.put('/api/internal-initiatives/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  const id = event.pathParameters!.id!;

  const before = await initiativesRepo.findById(id);

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const after = await initiativesRepo.update(id, body, user, conn);

    await events.emit(conn, {
      event_type: 'internal_initiative.updated',
      entity_type: 'internal_initiative',
      entity_id: id,
      actor_user_id: user.id,
      payload: before ? buildUpdatePayload(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [...INITIATIVE_EDITABLE_FIELDS]) : {},
    });

    await conn.query('COMMIT');
    return ok(after);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

router.post('/api/internal-initiatives/:id/transitions', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const id = event.pathParameters!.id!;

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const result = await initiativesRepo.transition(id, body.to_status as InitiativeStatus, body.reason || null, user, conn);

    await events.emit(conn, {
      event_type: 'internal_initiative.status_changed',
      entity_type: 'internal_initiative',
      entity_id: id,
      actor_user_id: user.id,
      payload: { to: body.to_status, reason: body.reason || null },
    });

    await conn.query('COMMIT');
    return ok(result);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

router.delete('/api/internal-initiatives/:id', async (event, user) => {
  requireAdmin(user);
  const id = event.pathParameters!.id!;
  const body = JSON.parse(event.body || '{}');
  const reason = body.reason || null;

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    await initiativesRepo.softDelete(id, reason, user, conn);

    await events.emit(conn, {
      event_type: 'internal_initiative.deleted',
      entity_type: 'internal_initiative',
      entity_id: id,
      actor_user_id: user.id,
      payload: { reason },
    });

    await conn.query('COMMIT');
    return message('Iniciativa eliminada');
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

/* ==================================================================
 * NOVELTIES — /api/novelties/*
 * ================================================================== */

router.get('/api/novelties', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const filters: NoveltyFilters = {
    employee_id: qs.employee_id,
    status: qs.status,
    from: qs.from,
    to: qs.to,
  };
  return paginated(await noveltiesRepo.findAll({ page, limit, offset, filters, user }));
});

router.get('/api/novelties/:id', async (event, _user) => {
  const novelty = await noveltiesRepo.findById(event.pathParameters!.id!);
  if (!novelty) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Novedad no encontrada' }) };
  return ok(novelty);
});

router.post('/api/novelties', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  const novelty = await noveltiesRepo.create(body, user);

  await events.emit(db, {
    event_type: 'novelty.created',
    entity_type: 'employee_novelty',
    entity_id: novelty.id,
    actor_user_id: user.id,
    payload: { employee_id: novelty.employee_id, start_date: novelty.start_date, end_date: novelty.end_date },
  });

  return created(novelty);
});

router.put('/api/novelties/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  const novelty = await noveltiesRepo.update(event.pathParameters!.id!, body, user);

  await events.emit(db, {
    event_type: 'novelty.updated',
    entity_type: 'employee_novelty',
    entity_id: novelty.id,
    actor_user_id: user.id,
    payload: { start_date: novelty.start_date, end_date: novelty.end_date },
  });

  return ok(novelty);
});

router.delete('/api/novelties/:id', async (event, user) => {
  await noveltiesRepo.softDelete(event.pathParameters!.id!, user);

  await events.emit(db, {
    event_type: 'novelty.deleted',
    entity_type: 'employee_novelty',
    entity_id: event.pathParameters!.id!,
    actor_user_id: user.id,
    payload: {},
  });

  return message('Novedad eliminada');
});

/* ==================================================================
 * IDLE TIME — /api/idle-time
 * ================================================================== */

const { calculateIdleTime, parsePeriod: parseIdlePeriod, periodStart: idlePeriodStart, periodEnd: idlePeriodEnd } = idleEngine;

function normalizePeriod(p: string | undefined | null): string | null {
  if (p == null) return null;
  return String(p).replace(/^([0-9]{4})([0-9]{2})$/, '$1-$2');
}

async function loadDataForIdlePeriod(pool: typeof db, employee_id: string, yyyymm: string) {
  const start = idlePeriodStart(yyyymm);
  const end   = idlePeriodEnd(yyyymm);

  const { rows: empRows } = await pool.query(
    `SELECT e.id, e.first_name, e.last_name, e.weekly_capacity_hours,
            e.start_date AS hire_date, e.end_date, e.country_id, e.country, e.level,
            (SELECT cost_usd FROM employee_costs
              WHERE employee_id = e.id AND cost_usd IS NOT NULL
              ORDER BY period DESC LIMIT 1) AS cost_usd
       FROM employees e
      WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [employee_id],
  );
  if (!empRows.length) return null;
  const emp = empRows[0];

  const countryId = emp.country_id || 'CO';
  const { rows: countryRows } = await pool.query(
    `SELECT id, standard_workday_hours, standard_workdays_per_week FROM countries WHERE id = $1`,
    [countryId],
  );
  const country = countryRows[0] || { id: 'CO', standard_workday_hours: 8, standard_workdays_per_week: 5 };

  let hourly_rate_usd: number | null = null;
  const wch = Number(emp.weekly_capacity_hours);
  const cost = Number(emp.cost_usd);
  if (cost > 0 && wch > 0) {
    hourly_rate_usd = Math.round((cost / ((wch * 52) / 12)) * 10000) / 10000;
  }

  const [holidaysRes, noveltiesRes, contractsRes, internalsRes] = await Promise.all([
    pool.query(
      `SELECT holiday_date, label FROM country_holidays
        WHERE country_id = $1 AND holiday_date BETWEEN $2 AND $3`,
      [countryId, start, end],
    ),
    pool.query(
      `SELECT n.start_date, n.end_date, n.novelty_type_id, n.status,
              COALESCE(nt.counts_in_capacity, false) AS counts_in_capacity
         FROM employee_novelties n
         LEFT JOIN novelty_types nt ON nt.id = n.novelty_type_id
        WHERE n.employee_id = $1 AND n.status = 'approved'
          AND n.end_date >= $2 AND n.start_date <= $3`,
      [employee_id, start, end],
    ),
    pool.query(
      `SELECT a.start_date, a.end_date, a.weekly_hours, a.contract_id, c.name AS contract_name
         FROM assignments a
         LEFT JOIN contracts c ON c.id = a.contract_id
        WHERE a.employee_id = $1 AND a.deleted_at IS NULL
          AND a.status IN ('planned','active','ended')
          AND COALESCE(a.end_date, '9999-12-31'::date) >= $2 AND a.start_date <= $3`,
      [employee_id, start, end],
    ),
    pool.query(
      `SELECT iia.start_date, iia.end_date, iia.weekly_hours, iia.internal_initiative_id,
              ii.name AS initiative_name, ii.initiative_code
         FROM internal_initiative_assignments iia
         LEFT JOIN internal_initiatives ii ON ii.id = iia.internal_initiative_id
        WHERE iia.employee_id = $1 AND iia.deleted_at IS NULL
          AND iia.status IN ('planned','active','ended')
          AND COALESCE(iia.end_date, '9999-12-31'::date) >= $2 AND iia.start_date <= $3`,
      [employee_id, start, end],
    ),
  ]);

  return {
    employee: emp,
    country,
    hourly_rate_usd,
    holidays: holidaysRes.rows,
    novelties: noveltiesRes.rows,
    contractAssignments: contractsRes.rows,
    internalAssignments: internalsRes.rows,
  };
}

router.get('/api/idle-time', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const period = qs.period;
  if (!period) return ok({ data: [], message: 'Parámetro period requerido (YYYY-MM)' });

  const { rows } = await db.query(
    `SELECT itc.*, (e.first_name || ' ' || e.last_name) AS employee_name
       FROM idle_time_calculations itc
       LEFT JOIN employees e ON e.id = itc.employee_id
      WHERE itc.period_yyyymm = $1
      ORDER BY itc.idle_pct DESC`,
    [period],
  );
  return ok({ data: rows });
});

router.get('/api/idle-time/capacity-utilization', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const period_yyyymm = normalizePeriod(qs.period);
  if (!parseIdlePeriod(period_yyyymm)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'period requerido (YYYY-MM)' }) };

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS users_count,
            COALESCE(SUM(total_capacity_hours), 0)::numeric AS total_capacity_hours,
            COALESCE(SUM(holiday_hours), 0)::numeric AS holiday_hours,
            COALESCE(SUM(novelty_hours), 0)::numeric AS novelty_hours,
            COALESCE(SUM(assigned_hours_contract), 0)::numeric AS billable_hours,
            COALESCE(SUM(assigned_hours_internal), 0)::numeric AS internal_hours,
            COALESCE(SUM(idle_hours), 0)::numeric AS idle_hours,
            COALESCE(SUM(idle_cost_usd), 0)::numeric AS idle_cost_usd
       FROM idle_time_calculations
      WHERE period_yyyymm = $1`,
    [period_yyyymm],
  );
  const t = rows[0];
  const total = Number(t.total_capacity_hours) || 0;
  const pct = (n: unknown) => total > 0 ? Math.round((Number(n) / total) * 10000) / 10000 : 0;
  return ok({
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
});

router.get('/api/idle-time/aggregate', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const period_yyyymm = normalizePeriod(qs.period);
  if (!parseIdlePeriod(period_yyyymm)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'period requerido (YYYY-MM)' }) };
  const group_by = qs.group_by || 'none';

  const totalsRes = await db.query(
    `SELECT COUNT(*)::int AS users_count,
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
    [period_yyyymm],
  );

  let groups: unknown[] = [];
  if (group_by === 'country') {
    const { rows } = await db.query(
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
      [period_yyyymm],
    );
    groups = rows;
  }

  return ok({ period_yyyymm, group_by, totals: totalsRes.rows[0], groups });
});

router.post('/api/idle-time/calculate', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const period_yyyymm = normalizePeriod(body.period_yyyymm);
  if (!parseIdlePeriod(period_yyyymm)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'period_yyyymm requerido (YYYY-MM)' }) };

  const targetEmployees: string[] | null = Array.isArray(body.employee_ids) ? body.employee_ids : null;

  let employeeIds: string[];
  if (targetEmployees && targetEmployees.length > 0) {
    const { rows } = await db.query(
      `SELECT id FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [targetEmployees],
    );
    employeeIds = rows.map((r: Record<string, unknown>) => r.id as string);
  } else {
    const { rows } = await db.query(
      `SELECT id FROM employees WHERE deleted_at IS NULL AND status IN ('active','on_leave','bench')`,
    );
    employeeIds = rows.map((r: Record<string, unknown>) => r.id as string);
  }

  const results = { processed: 0, missing_rate: 0, errors: 0, skipped_final: 0 };

  for (const eid of employeeIds) {
    try {
      const data = await loadDataForIdlePeriod(db, eid, period_yyyymm!);
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

      if (calc.breakdown?.flags?.missing_rate) results.missing_rate += 1;

      const { rows: existing } = await db.query(
        `SELECT id, calculation_status FROM idle_time_calculations WHERE employee_id = $1 AND period_yyyymm = $2`,
        [eid, period_yyyymm],
      );
      if (existing.length && existing[0].calculation_status === 'final') {
        results.skipped_final += 1;
        continue;
      }

      await db.query(
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
          user.id,
        ],
      );
      results.processed += 1;
    } catch {
      results.errors += 1;
    }
  }

  return ok({ period_yyyymm, employees_count: employeeIds.length, ...results });
});

router.post('/api/idle-time/finalize', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const period_yyyymm = normalizePeriod(body.period_yyyymm);
  if (!parseIdlePeriod(period_yyyymm)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'period_yyyymm requerido (YYYY-MM)' }) };

  const { rowCount } = await db.query(
    `UPDATE idle_time_calculations
        SET calculation_status = 'final', updated_at = NOW()
      WHERE period_yyyymm = $1 AND calculation_status = 'preliminary'`,
    [period_yyyymm],
  );
  return ok({ period_yyyymm, finalized_count: rowCount });
});

/* ==================================================================
 * HOLIDAYS — /api/holidays/*
 * ================================================================== */

router.get('/api/holidays/_meta/countries', async (_event, _user) => {
  const { rows } = await db.query(
    `SELECT id, label_es, label_en FROM countries WHERE is_active = true ORDER BY label_es`,
  );
  return ok({ data: rows });
});

router.get('/api/holidays', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const filters: HolidayFilters = {
    country: qs.country, year: qs.year, from: qs.from, to: qs.to,
  };
  return ok(await holidaysRepo.findAll(filters));
});

router.post('/api/holidays', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const holiday = await holidaysRepo.create(body, user.id);

  await events.emit(db, {
    event_type: 'holiday.created',
    entity_type: 'country_holiday',
    entity_id: holiday.id,
    actor_user_id: user.id,
    payload: { country_id: holiday.country_id, holiday_date: holiday.holiday_date, label: holiday.label },
  });

  return created(holiday);
});

router.put('/api/holidays/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const holiday = await holidaysRepo.update(event.pathParameters!.id!, body);

  await events.emit(db, {
    event_type: 'holiday.updated',
    entity_type: 'country_holiday',
    entity_id: holiday.id,
    actor_user_id: user.id,
    payload: body,
  });

  return ok(holiday);
});

router.delete('/api/holidays/:id', async (event, user) => {
  requireAdmin(user);
  await holidaysRepo.hardDelete(event.pathParameters!.id!);

  await events.emit(db, {
    event_type: 'holiday.deleted',
    entity_type: 'country_holiday',
    entity_id: event.pathParameters!.id!,
    actor_user_id: user.id,
    payload: {},
  });

  return message('Festivo eliminado');
});

/* ==================================================================
 * HANDLER
 * ================================================================== */

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
