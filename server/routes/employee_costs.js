/**
 * Employee Costs — Costo empresa mensual por empleado.
 *
 * Spec: spec_costos_empleado.docx (Abril 28 2026, prioridad ALTA).
 *
 * Acceso: admin/superadmin SIEMPRE. Lead/member/viewer NO ven nada
 * (datos PII salariales).
 *
 * Endpoints (ver docs/API_REFERENCE.md sección Employee Costs):
 *
 *   GET    /api/employee-costs                          ?period=YYYYMM (mass view)
 *   GET    /api/employee-costs/employee/:employeeId     histórico de un empleado
 *   GET    /api/employee-costs/employee/:employeeId/:period
 *   GET    /api/employee-costs/summary/:period
 *
 *   POST   /api/employee-costs                          upsert por (employee_id, period)
 *   PUT    /api/employee-costs/:id                      update por id
 *   DELETE /api/employee-costs/:id                      borrar (admin si abierto, superadmin si locked)
 *
 *   POST   /api/employee-costs/bulk/preview             dry-run de un payload masivo
 *   POST   /api/employee-costs/bulk/commit              upsert masivo en transacción
 *   POST   /api/employee-costs/copy-from-previous       copia rows del período N-1 al N (sin lockear)
 *   POST   /api/employee-costs/project-to-future        proyecta el último período conocido N meses adelante (con growth opcional)
 *
 *   POST   /api/employee-costs/lock/:period             marca todos los rows del período como locked
 *   POST   /api/employee-costs/unlock/:period           SUPERADMIN — revierte un lock
 *   POST   /api/employee-costs/recalculate-usd/:period  recalcula cost_usd de rows abiertos del período
 *
 * Eventos emitidos: employee_cost.created / .updated / .deleted /
 * .locked / .unlocked / .recalculated_after_fx_change /
 * .bulk_committed / .copied_from_previous.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly, superadminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { isValidUUID } = require('../utils/sanitize');
const { serverError, safeRollback } = require('../utils/http');
const {
  validatePeriod, validateCurrency, convertToUsd,
  validateEmployeePeriod, deltaVsTheoretical, previousPeriod, currentPeriod,
  addMonths, periodsForward, periodLessOrEqual,
} = require('../utils/cost_calc');

// Acceso restringido a admin/superadmin a NIVEL DE ROUTER. Más conservador
// que aplicar adminOnly por handler — datos salariales son PII alta.
router.use(auth, adminOnly);

const EDITABLE_FIELDS = ['currency', 'gross_cost', 'notes'];

/**
 * Carga la tasa USD para (period, currency) desde exchange_rates.
 * Si currency='USD' devuelve 1 sin query. Si no encuentra, intenta el
 * período anterior más cercano (fallback). Devuelve { rate, fallback_period }
 * o { rate: null, fallback_period: null } si no hay tasa nunca.
 */
async function loadFxRate(conn, period, currency) {
  if (currency === 'USD') return { rate: 1, fallback_period: null };
  const direct = await conn.query(
    `SELECT usd_rate FROM exchange_rates WHERE yyyymm = $1 AND currency = $2`,
    [period, currency]
  );
  if (direct.rows.length) return { rate: Number(direct.rows[0].usd_rate), fallback_period: null };
  // Fallback: tasa más reciente <= period.
  const fb = await conn.query(
    `SELECT yyyymm, usd_rate FROM exchange_rates
      WHERE currency = $1 AND yyyymm <= $2
      ORDER BY yyyymm DESC LIMIT 1`,
    [currency, period]
  );
  if (fb.rows.length) {
    return { rate: Number(fb.rows[0].usd_rate), fallback_period: fb.rows[0].yyyymm };
  }
  return { rate: null, fallback_period: null };
}

/**
 * Carga costo teórico por nivel desde la tabla `parameters` (categoría
 * 'cost_per_level' u otras conocidas — el sistema histórico tiene varias
 * categorías de costo según el cotizador). Devuelve un Map level→cost_usd
 * o null si no hay datos.
 *
 * El "costo teórico" es referencia para el delta — si parameters está vacía
 * para un nivel, deltaVsTheoretical devuelve 'no_baseline'.
 */
async function loadTheoreticalCostsByLevel(conn) {
  const { rows } = await conn.query(
    `SELECT key, value FROM parameters
       WHERE category IN ('cost_per_level', 'level_costs')
       ORDER BY key`
  );
  const map = new Map();
  for (const r of rows) {
    // key esperado: 'L1', 'L2', ..., 'L11' o '1', '2', ... — normalizamos a 'Lx'.
    let lvl = String(r.key).trim().toUpperCase();
    if (/^[0-9]+$/.test(lvl)) lvl = `L${lvl}`;
    map.set(lvl, Number(r.value));
  }
  return map;
}

/* ============================================================
 * GET /api/employee-costs?period=YYYYMM
 * Mass view: todos los empleados activos en el período + su costo
 * (si existe), con delta vs teórico, status del lock, etc.
 * ============================================================ */
router.get('/', async (req, res) => {
  try {
    const v = validatePeriod(req.query.period || currentPeriod());
    if (!v.ok) return res.status(400).json({ error: v.error });
    const period = v.period;

    // Empleados activos durante ese período (start <= último día del mes
    // Y (end IS NULL OR end >= primer día del mes) Y status != 'terminated').
    const periodFirstDay = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;
    const periodLastDay  = `(DATE '${periodFirstDay}' + INTERVAL '1 month - 1 day')::date`;

    const { rows: employees } = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.country, e.status,
              e.start_date, e.end_date,
              a.name AS area_name
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
        WHERE e.deleted_at IS NULL
          AND e.start_date <= ${periodLastDay}
          AND (e.end_date IS NULL OR e.end_date >= DATE '${periodFirstDay}')
          AND e.status IN ('active','on_leave','bench')
        ORDER BY e.first_name, e.last_name`
    );

    const { rows: costs } = await pool.query(
      `SELECT * FROM employee_costs WHERE period = $1`,
      [period]
    );
    const costsByEmp = new Map(costs.map((c) => [c.employee_id, c]));

    const theoretical = await loadTheoreticalCostsByLevel(pool);

    const data = employees.map((emp) => {
      const cost = costsByEmp.get(emp.id) || null;
      const theoreticalUsd = theoretical.get(emp.level) || null;
      const delta = cost && cost.cost_usd != null
        ? deltaVsTheoretical(Number(cost.cost_usd), theoreticalUsd)
        : { delta: null, deltaPct: null, zone: 'no_data' };
      return {
        employee: {
          id: emp.id, first_name: emp.first_name, last_name: emp.last_name,
          level: emp.level, country: emp.country, area_name: emp.area_name,
          status: emp.status, start_date: emp.start_date, end_date: emp.end_date,
        },
        cost,
        theoretical_cost_usd: theoreticalUsd,
        delta,
        is_new: emp.start_date && emp.start_date.toISOString
          ? emp.start_date.toISOString().slice(0, 7).replace('-', '') === period
          : false,
      };
    });

    // Summary indicators.
    const summary = {
      period,
      total_employees: data.length,
      with_cost: data.filter((d) => d.cost).length,
      without_cost: data.filter((d) => !d.cost).length,
      total_cost_usd: data.reduce((s, d) => s + (d.cost?.cost_usd ? Number(d.cost.cost_usd) : 0), 0),
      avg_cost_usd: 0,
      locked_count: data.filter((d) => d.cost?.locked).length,
    };
    if (summary.with_cost > 0) {
      summary.avg_cost_usd = Math.round((summary.total_cost_usd / summary.with_cost) * 100) / 100;
    }

    res.json({ period, data, summary });
  } catch (err) { serverError(res, 'GET /employee-costs', err); }
});

/* ============================================================
 * GET /api/employee-costs/employee/:employeeId
 * Histórico de un empleado, ordenado DESC por período.
 * ============================================================ */
router.get('/employee/:employeeId', async (req, res) => {
  try {
    if (!isValidUUID(req.params.employeeId)) {
      return res.status(400).json({ error: 'employeeId no es UUID válido' });
    }
    const { rows: empRows } = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.level
         FROM employees e WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [req.params.employeeId]
    );
    if (!empRows.length) return res.status(404).json({ error: 'Empleado no encontrado' });

    const { rows } = await pool.query(
      `SELECT ec.*, u_created.name AS created_by_name, u_updated.name AS updated_by_name
         FROM employee_costs ec
         LEFT JOIN users u_created ON u_created.id = ec.created_by
         LEFT JOIN users u_updated ON u_updated.id = ec.updated_by
        WHERE ec.employee_id = $1
        ORDER BY ec.period DESC`,
      [req.params.employeeId]
    );
    res.json({ employee: empRows[0], history: rows });
  } catch (err) { serverError(res, 'GET /employee-costs/employee/:id', err); }
});

/* ============================================================
 * GET /api/employee-costs/employee/:employeeId/:period
 * ============================================================ */
router.get('/employee/:employeeId/:period', async (req, res) => {
  try {
    if (!isValidUUID(req.params.employeeId)) {
      return res.status(400).json({ error: 'employeeId no es UUID válido' });
    }
    const v = validatePeriod(req.params.period);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { rows } = await pool.query(
      `SELECT * FROM employee_costs WHERE employee_id = $1 AND period = $2`,
      [req.params.employeeId, v.period]
    );
    if (!rows.length) return res.status(404).json({ error: 'No hay costo registrado para ese empleado/período' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /employee-costs/employee/:id/:period', err); }
});

/* ============================================================
 * GET /api/employee-costs/summary/:period
 * ============================================================ */
router.get('/summary/:period', async (req, res) => {
  try {
    const v = validatePeriod(req.params.period);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const period = v.period;

    const { rows: [empRow] } = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM employees
        WHERE deleted_at IS NULL AND status IN ('active','on_leave','bench')`
    );
    const { rows: [costRow] } = await pool.query(
      `SELECT
         COUNT(*)::int                         AS with_cost,
         SUM(cost_usd)::numeric                AS total_cost_usd,
         AVG(cost_usd)::numeric                AS avg_cost_usd,
         COUNT(*) FILTER (WHERE locked = true) AS locked_count
       FROM employee_costs WHERE period = $1`,
      [period]
    );
    const total = empRow.total;
    const withCost = costRow.with_cost || 0;
    res.json({
      period,
      total_employees: total,
      with_cost: withCost,
      without_cost: Math.max(total - withCost, 0),
      total_cost_usd: Number(costRow.total_cost_usd || 0),
      avg_cost_usd: Number(costRow.avg_cost_usd || 0),
      locked_count: Number(costRow.locked_count || 0),
    });
  } catch (err) { serverError(res, 'GET /employee-costs/summary/:period', err); }
});

/* ============================================================
 * POST /api/employee-costs
 * Upsert por (employee_id, period). Body:
 *   { employee_id, period, currency, gross_cost, notes? }
 * Si la row existe + locked → 403. Si existe + abierta → UPDATE.
 * ============================================================ */
router.post('/', async (req, res) => {
  const conn = await pool.connect();
  try {
    const body = req.body || {};
    if (!isValidUUID(body.employee_id)) {
      conn.release();
      return res.status(400).json({ error: 'employee_id es requerido (UUID)' });
    }
    const periodCheck = validatePeriod(body.period);
    if (!periodCheck.ok) { conn.release(); return res.status(400).json({ error: periodCheck.error }); }
    const period = periodCheck.period;

    const ccyCheck = validateCurrency(body.currency);
    if (!ccyCheck.ok) { conn.release(); return res.status(400).json({ error: ccyCheck.error }); }
    const currency = ccyCheck.currency;

    const grossCost = Number(body.gross_cost);
    if (!Number.isFinite(grossCost) || grossCost < 0) {
      conn.release();
      return res.status(400).json({ error: 'gross_cost debe ser un número >= 0' });
    }

    // Validar empleado existe y período es válido para él.
    const { rows: empRows } = await conn.query(
      `SELECT id, start_date, end_date, status FROM employees
        WHERE id = $1 AND deleted_at IS NULL`,
      [body.employee_id]
    );
    if (!empRows.length) { conn.release(); return res.status(404).json({ error: 'Empleado no encontrado' }); }
    const emp = empRows[0];
    const empPeriodCheck = validateEmployeePeriod(emp, period);
    if (!empPeriodCheck.ok) {
      conn.release();
      return res.status(400).json({ error: empPeriodCheck.error, code: empPeriodCheck.code });
    }

    // Si existe row LOCKED → 403.
    const { rows: existingRows } = await conn.query(
      `SELECT * FROM employee_costs WHERE employee_id = $1 AND period = $2`,
      [body.employee_id, period]
    );
    const existing = existingRows[0] || null;
    if (existing && existing.locked && req.user.role !== 'superadmin') {
      conn.release();
      return res.status(403).json({
        error: 'Este costo está en un período cerrado. Solo superadmin puede editarlo.',
        code: 'period_locked',
      });
    }

    // FX lookup.
    const fx = await loadFxRate(conn, period, currency);
    const conv = convertToUsd(grossCost, currency, fx.rate);
    const warnings = [];
    if (currency !== 'USD' && fx.fallback_period) {
      warnings.push({
        code: 'fx_fallback_used',
        message: `No hay tasa para ${currency} en ${period}. Se usó la tasa de ${fx.fallback_period} (${fx.rate}).`,
        fallback_period: fx.fallback_period,
      });
    }
    if (currency !== 'USD' && fx.rate == null) {
      warnings.push({
        code: 'fx_missing',
        message: `No hay tasa de cambio registrada para ${currency}. cost_usd queda NULL hasta que se registre la tasa.`,
      });
    }

    let row;
    if (existing) {
      // UPDATE
      const { rows } = await conn.query(
        `UPDATE employee_costs
            SET currency = $1, gross_cost = $2, cost_usd = $3, exchange_rate_used = $4,
                notes = $5, updated_by = $6, source = 'manual', updated_at = NOW()
          WHERE id = $7
          RETURNING *`,
        [currency, grossCost, conv.cost_usd, conv.exchange_rate_used,
         body.notes ?? existing.notes, req.user.id, existing.id]
      );
      row = rows[0];
      await emitEvent(pool, {
        event_type: 'employee_cost.updated',
        entity_type: 'employee_cost', entity_id: row.id,
        actor_user_id: req.user.id,
        payload: {
          employee_id: row.employee_id, period: row.period,
          changes: buildUpdatePayload(existing, row, EDITABLE_FIELDS),
        },
        req,
      });
    } else {
      const { rows } = await conn.query(
        `INSERT INTO employee_costs
           (employee_id, period, currency, gross_cost, cost_usd, exchange_rate_used,
            notes, source, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8, $8)
         RETURNING *`,
        [body.employee_id, period, currency, grossCost, conv.cost_usd, conv.exchange_rate_used,
         body.notes || null, req.user.id]
      );
      row = rows[0];
      await emitEvent(pool, {
        event_type: 'employee_cost.created',
        entity_type: 'employee_cost', entity_id: row.id,
        actor_user_id: req.user.id,
        payload: { employee_id: row.employee_id, period: row.period, currency, has_cost: true },
        req,
      });
    }

    res.status(existing ? 200 : 201).json({ row, warnings });
  } catch (err) { serverError(res, 'POST /employee-costs', err); }
  finally { conn.release(); }
});

/* ============================================================
 * PUT /api/employee-costs/:id
 * Editar por id. Si row.locked && rol no es superadmin → 403.
 * ============================================================ */
router.put('/:id', async (req, res) => {
  const conn = await pool.connect();
  try {
    if (!isValidUUID(req.params.id)) { conn.release(); return res.status(400).json({ error: 'id no es UUID válido' }); }
    const { rows: existingRows } = await conn.query(
      `SELECT * FROM employee_costs WHERE id = $1`, [req.params.id]
    );
    const existing = existingRows[0];
    if (!existing) { conn.release(); return res.status(404).json({ error: 'Costo no encontrado' }); }
    if (existing.locked && req.user.role !== 'superadmin') {
      conn.release();
      return res.status(403).json({
        error: 'Este costo está en un período cerrado. Solo superadmin puede editarlo.',
        code: 'period_locked',
      });
    }

    const body = req.body || {};
    const newCurrency = body.currency != null ? validateCurrency(body.currency) : { ok: true, currency: existing.currency };
    if (body.currency != null && !newCurrency.ok) {
      conn.release(); return res.status(400).json({ error: newCurrency.error });
    }
    const currency = newCurrency.currency;
    const grossCost = body.gross_cost != null ? Number(body.gross_cost) : Number(existing.gross_cost);
    if (!Number.isFinite(grossCost) || grossCost < 0) {
      conn.release(); return res.status(400).json({ error: 'gross_cost debe ser >= 0' });
    }

    // Recalcular FX si cambió moneda o gross.
    const recalc = (currency !== existing.currency) || (grossCost !== Number(existing.gross_cost));
    let cost_usd = Number(existing.cost_usd);
    let exchange_rate_used = existing.exchange_rate_used != null ? Number(existing.exchange_rate_used) : null;
    const warnings = [];
    if (recalc) {
      const fx = await loadFxRate(conn, existing.period, currency);
      const conv = convertToUsd(grossCost, currency, fx.rate);
      cost_usd = conv.cost_usd;
      exchange_rate_used = conv.exchange_rate_used;
      if (currency !== 'USD' && fx.fallback_period) {
        warnings.push({ code: 'fx_fallback_used', fallback_period: fx.fallback_period });
      }
    }

    const { rows } = await conn.query(
      `UPDATE employee_costs
          SET currency = $1, gross_cost = $2, cost_usd = $3, exchange_rate_used = $4,
              notes = $5, updated_by = $6, updated_at = NOW()
        WHERE id = $7
        RETURNING *`,
      [currency, grossCost, cost_usd, exchange_rate_used,
       body.notes !== undefined ? body.notes : existing.notes, req.user.id, existing.id]
    );
    const row = rows[0];

    await emitEvent(pool, {
      event_type: 'employee_cost.updated',
      entity_type: 'employee_cost', entity_id: row.id,
      actor_user_id: req.user.id,
      payload: {
        employee_id: row.employee_id, period: row.period,
        changes: buildUpdatePayload(existing, row, EDITABLE_FIELDS),
      },
      req,
    });

    res.json({ row, warnings });
  } catch (err) { serverError(res, 'PUT /employee-costs/:id', err); }
  finally { conn.release(); }
});

/* ============================================================
 * DELETE /api/employee-costs/:id
 * Borrar (admin si row abierta; superadmin siempre).
 * No es soft delete — el row se va. Para casos de carga errada.
 * ============================================================ */
router.delete('/:id', async (req, res) => {
  try {
    if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id no es UUID válido' });
    const { rows: existingRows } = await pool.query(
      `SELECT * FROM employee_costs WHERE id = $1`, [req.params.id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Costo no encontrado' });
    if (existing.locked && req.user.role !== 'superadmin') {
      return res.status(403).json({
        error: 'Este costo está en un período cerrado. Solo superadmin puede eliminarlo.',
        code: 'period_locked',
      });
    }

    await pool.query(`DELETE FROM employee_costs WHERE id = $1`, [req.params.id]);
    await emitEvent(pool, {
      event_type: 'employee_cost.deleted',
      entity_type: 'employee_cost', entity_id: existing.id,
      actor_user_id: req.user.id,
      payload: { employee_id: existing.employee_id, period: existing.period, was_locked: existing.locked },
      req,
    });
    res.json({ message: 'Costo eliminado', deleted_id: existing.id });
  } catch (err) { serverError(res, 'DELETE /employee-costs/:id', err); }
});

/* ============================================================
 * POST /api/employee-costs/bulk/preview
 * Body: { period, items: [{ employee_id, currency, gross_cost, notes? }] }
 * Dry-run: valida cada item, muestra qué pasaría sin escribir.
 * ============================================================ */
router.post('/bulk/preview', async (req, res) => {
  try {
    const body = req.body || {};
    const periodCheck = validatePeriod(body.period);
    if (!periodCheck.ok) return res.status(400).json({ error: periodCheck.error });
    const period = periodCheck.period;
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) return res.status(400).json({ error: 'items[] es requerido' });
    if (items.length > 5000) return res.status(413).json({ error: 'Máximo 5000 items por preview' });

    const result = await processBulk(pool, period, items, req.user, { dryRun: true });
    res.json(result);
  } catch (err) { serverError(res, 'POST /employee-costs/bulk/preview', err); }
});

/* ============================================================
 * POST /api/employee-costs/bulk/commit
 * Mismo body que preview. Aplica en transacción.
 * Si CUALQUIER item es invalid → todo se aborta (atomicidad).
 * ============================================================ */
router.post('/bulk/commit', async (req, res) => {
  const conn = await pool.connect();
  try {
    const body = req.body || {};
    const periodCheck = validatePeriod(body.period);
    if (!periodCheck.ok) { conn.release(); return res.status(400).json({ error: periodCheck.error }); }
    const period = periodCheck.period;
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) { conn.release(); return res.status(400).json({ error: 'items[] es requerido' }); }
    if (items.length > 5000) { conn.release(); return res.status(413).json({ error: 'Máximo 5000 items' }); }

    await conn.query('BEGIN');
    const result = await processBulk(conn, period, items, req.user, { dryRun: false });
    if (result.errors.length > 0) {
      await safeRollback(conn, 'POST /employee-costs/bulk/commit');
      return res.status(400).json({
        error: 'Hay errores en el payload — ningún cambio fue aplicado.',
        ...result,
      });
    }
    await conn.query('COMMIT');

    await emitEvent(pool, {
      event_type: 'employee_cost.bulk_committed',
      entity_type: 'employee_cost', entity_id: null,
      actor_user_id: req.user.id,
      payload: {
        period, applied: result.applied.length,
        created: result.applied.filter((a) => a.action === 'created').length,
        updated: result.applied.filter((a) => a.action === 'updated').length,
      },
      req,
    });
    res.json(result);
  } catch (err) {
    await safeRollback(conn, 'POST /employee-costs/bulk/commit');
    serverError(res, 'POST /employee-costs/bulk/commit', err);
  } finally { conn.release(); }
});

/**
 * Lógica compartida entre preview y commit. Estructura en 2 fases:
 *   1) Validar TODOS los items (sin tocar DB de mutación).
 *   2) Si pasa la validación AND no es dryRun, aplicar UPSERTs.
 *
 * Esto garantiza atomicidad: si hay errores en cualquier item, NINGÚN
 * row se modifica (clave para que el commit handler haga ROLLBACK
 * sobre una transacción virgen).
 *
 * El conn pasado puede ser pool (preview) o un client en transacción (commit).
 */
async function processBulk(conn, period, items, user, { dryRun }) {
  // Cargar todos los empleados involucrados de una vez.
  const empIds = [...new Set(items.map((i) => i.employee_id).filter(isValidUUID))];
  const { rows: emps } = await conn.query(
    `SELECT id, start_date, end_date, status, first_name, last_name
       FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [empIds]
  );
  const empById = new Map(emps.map((e) => [e.id, e]));

  // Cargar costos existentes para diferenciar create vs update + detectar locks.
  const { rows: existing } = await conn.query(
    `SELECT * FROM employee_costs WHERE period = $1 AND employee_id = ANY($2::uuid[])`,
    [period, empIds]
  );
  const existingByEmp = new Map(existing.map((c) => [c.employee_id, c]));

  // Cargar TODAS las tasas FX necesarias en bulk (una query) — performance.
  const currencies = [...new Set(items.map((i) => String(i.currency || '').toUpperCase()).filter(c => c && c !== 'USD'))];
  const { rows: fxRows } = currencies.length > 0
    ? await conn.query(
        `SELECT yyyymm, currency, usd_rate FROM exchange_rates
          WHERE currency = ANY($1::varchar[]) AND yyyymm <= $2
          ORDER BY yyyymm DESC`,
        [currencies, period]
      )
    : { rows: [] };
  const fxByCcy = {};
  for (const r of fxRows) {
    if (!fxByCcy[r.currency]) fxByCcy[r.currency] = [];
    fxByCcy[r.currency].push({ period: r.yyyymm, rate: Number(r.usd_rate) });
  }
  const resolveRate = (period, ccy) => {
    if (ccy === 'USD') return { rate: 1, fallback_period: null };
    const list = fxByCcy[ccy] || [];
    const direct = list.find((r) => r.period === period);
    if (direct) return { rate: direct.rate, fallback_period: null };
    const fb = list[0]; // ya viene ORDER BY yyyymm DESC
    return fb
      ? { rate: fb.rate, fallback_period: fb.period }
      : { rate: null, fallback_period: null };
  };

  const errors = [];
  const warnings = [];
  // Fase 1: validar todos los items y construir lista de "pendientes a aplicar".
  const pending = []; // { ctx, item, currency, gross, conv, existingRow }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ctx = { index: i, employee_id: item.employee_id };

    if (!isValidUUID(item.employee_id)) { errors.push({ ...ctx, code: 'employee_id_invalid', message: 'employee_id no es UUID' }); continue; }
    const emp = empById.get(item.employee_id);
    if (!emp) { errors.push({ ...ctx, code: 'employee_not_found', message: 'Empleado no existe' }); continue; }

    const epc = validateEmployeePeriod(emp, period);
    if (!epc.ok) { errors.push({ ...ctx, code: epc.code, message: epc.error }); continue; }

    const cc = validateCurrency(item.currency);
    if (!cc.ok) { errors.push({ ...ctx, code: 'currency_invalid', message: cc.error }); continue; }
    const currency = cc.currency;

    const gross = Number(item.gross_cost);
    if (!Number.isFinite(gross) || gross < 0) {
      errors.push({ ...ctx, code: 'gross_cost_invalid', message: 'gross_cost debe ser número >= 0' }); continue;
    }

    const existingRow = existingByEmp.get(item.employee_id);
    if (existingRow && existingRow.locked && user.role !== 'superadmin') {
      errors.push({ ...ctx, code: 'period_locked', message: 'Costo en período cerrado — solo superadmin' }); continue;
    }

    const fx = resolveRate(period, currency);
    const conv = convertToUsd(gross, currency, fx.rate);
    if (currency !== 'USD' && fx.fallback_period) {
      warnings.push({ ...ctx, code: 'fx_fallback_used', fallback_period: fx.fallback_period });
    }
    if (currency !== 'USD' && fx.rate == null) {
      warnings.push({ ...ctx, code: 'fx_missing', message: `Sin tasa para ${currency}. cost_usd queda NULL.` });
    }
    pending.push({ ctx, item, currency, gross, conv, existingRow });
  }

  // Fase 2: aplicar (sólo si no hay errores y no es dryRun).
  // Esta separación garantiza que en commit con error → no se ejecuta UN SOLO
  // INSERT/UPDATE, dejando la transacción virgen para el ROLLBACK del caller.
  const applied = [];
  if (dryRun || errors.length > 0) {
    for (const p of pending) {
      applied.push({
        ...p.ctx,
        action: p.existingRow ? 'would_update' : 'would_create',
        cost_usd: p.conv.cost_usd,
      });
    }
  } else {
    for (const p of pending) {
      if (p.existingRow) {
        await conn.query(
          `UPDATE employee_costs
              SET currency = $1, gross_cost = $2, cost_usd = $3, exchange_rate_used = $4,
                  notes = COALESCE($5, notes), updated_by = $6, updated_at = NOW()
            WHERE id = $7`,
          [p.currency, p.gross, p.conv.cost_usd, p.conv.exchange_rate_used,
           p.item.notes ?? null, user.id, p.existingRow.id]
        );
        applied.push({ ...p.ctx, action: 'updated', id: p.existingRow.id });
      } else {
        const { rows } = await conn.query(
          `INSERT INTO employee_costs
             (employee_id, period, currency, gross_cost, cost_usd, exchange_rate_used,
              notes, source, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'csv_import', $8, $8)
           RETURNING id`,
          [p.item.employee_id, period, p.currency, p.gross, p.conv.cost_usd, p.conv.exchange_rate_used,
           p.item.notes || null, user.id]
        );
        applied.push({ ...p.ctx, action: 'created', id: rows[0].id });
      }
    }
  }

  return { period, total: items.length, errors, warnings, applied };
}

/* ============================================================
 * POST /api/employee-costs/copy-from-previous
 * Body: { period }   — copia rows del período N-1 al período N.
 * Si N ya tiene rows, mergea: skip rows existentes en N (no sobreescribe).
 * Marcadas con source='copy_from_prev'.
 * ============================================================ */
router.post('/copy-from-previous', async (req, res) => {
  const conn = await pool.connect();
  try {
    const body = req.body || {};
    const periodCheck = validatePeriod(body.period);
    if (!periodCheck.ok) { conn.release(); return res.status(400).json({ error: periodCheck.error }); }
    const period = periodCheck.period;
    const prev = previousPeriod(period);

    await conn.query('BEGIN');

    // Empleados activos en el nuevo período (filtramos para no copiar costos
    // de empleados terminados antes de N, o que ya no aplican).
    const periodFirstDay = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;
    const { rows: activeEmps } = await conn.query(
      `SELECT id FROM employees
        WHERE deleted_at IS NULL
          AND status IN ('active','on_leave','bench')
          AND start_date <= (DATE '${periodFirstDay}' + INTERVAL '1 month - 1 day')::date
          AND (end_date IS NULL OR end_date >= DATE '${periodFirstDay}')`
    );
    const activeIds = new Set(activeEmps.map((e) => e.id));

    // Costos del período anterior.
    const { rows: prevCosts } = await conn.query(
      `SELECT * FROM employee_costs WHERE period = $1`,
      [prev]
    );
    // Costos ya en el nuevo período (no sobreescribir).
    const { rows: alreadyN } = await conn.query(
      `SELECT employee_id FROM employee_costs WHERE period = $1`,
      [period]
    );
    const alreadyByEmp = new Set(alreadyN.map((r) => r.employee_id));

    // FX para el nuevo período: cargar todas las monedas de prevCosts.
    const currencies = [...new Set(prevCosts.map((r) => r.currency).filter(c => c !== 'USD'))];
    const fxByCcy = {};
    if (currencies.length > 0) {
      const { rows: fxRows } = await conn.query(
        `SELECT yyyymm, currency, usd_rate FROM exchange_rates
          WHERE currency = ANY($1::varchar[]) AND yyyymm <= $2
          ORDER BY yyyymm DESC`,
        [currencies, period]
      );
      for (const r of fxRows) {
        if (!fxByCcy[r.currency]) fxByCcy[r.currency] = [];
        fxByCcy[r.currency].push({ period: r.yyyymm, rate: Number(r.usd_rate) });
      }
    }
    const resolveRate = (ccy) => {
      if (ccy === 'USD') return { rate: 1, fallback_period: null };
      const list = fxByCcy[ccy] || [];
      const direct = list.find((r) => r.period === period);
      if (direct) return { rate: direct.rate, fallback_period: null };
      const fb = list[0];
      return fb ? { rate: fb.rate, fallback_period: fb.period } : { rate: null, fallback_period: null };
    };

    let copied = 0;
    let skipped = 0;
    const warnings = [];
    for (const prevRow of prevCosts) {
      if (!activeIds.has(prevRow.employee_id)) { skipped++; continue; } // empleado ya no activo
      if (alreadyByEmp.has(prevRow.employee_id)) { skipped++; continue; } // ya tiene row en N
      const fx = resolveRate(prevRow.currency);
      const conv = convertToUsd(Number(prevRow.gross_cost), prevRow.currency, fx.rate);
      if (prevRow.currency !== 'USD' && fx.fallback_period) {
        warnings.push({
          employee_id: prevRow.employee_id,
          code: 'fx_fallback_used',
          fallback_period: fx.fallback_period,
        });
      }
      await conn.query(
        `INSERT INTO employee_costs
           (employee_id, period, currency, gross_cost, cost_usd, exchange_rate_used,
            notes, source, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'copy_from_prev', $8, $8)`,
        [prevRow.employee_id, period, prevRow.currency, prevRow.gross_cost,
         conv.cost_usd, conv.exchange_rate_used,
         prevRow.notes, req.user.id]
      );
      copied++;
    }

    await conn.query('COMMIT');

    await emitEvent(pool, {
      event_type: 'employee_cost.copied_from_previous',
      entity_type: 'employee_cost', entity_id: null,
      actor_user_id: req.user.id,
      payload: { from_period: prev, to_period: period, copied, skipped },
      req,
    });

    res.json({ from_period: prev, to_period: period, copied, skipped, warnings });
  } catch (err) {
    await safeRollback(conn, 'POST /employee-costs/copy-from-previous');
    serverError(res, 'POST /employee-costs/copy-from-previous', err);
  } finally { conn.release(); }
});

/* ============================================================
 * POST /api/employee-costs/project-to-future
 *
 * Proyecta el último costo conocido de cada empleado hacia los
 * próximos N meses, con opcional growth rate anual.
 *
 * Body:
 *   {
 *     base_period?:    YYYYMM,  // default: último período con costos guardados
 *     months_ahead:    number,  // 1..12 (cap duro)
 *     growth_pct?:     number,  // % anual; ej. 5 → +5%/año split mensualmente
 *     dry_run?:        boolean, // default false. true = no escribe, devuelve preview
 *   }
 *
 * Reglas:
 *   - NO sobreescribe rows existentes (los manuales/copy ganan).
 *   - NO toca rows locked.
 *   - Solo proyecta a empleados activos durante el período destino
 *     (start_date ≤ período destino ≤ end_date si terminado).
 *   - Recalcula FX con la tasa del período destino (no asume la anterior).
 *   - source = 'projected'.
 *   - Si growth_pct se aplica, multiplica gross_cost en moneda original
 *     (no en USD) — preservar la moneda del empleado.
 *
 * Idempotente: reproyectar es seguro; los rows ya proyectados se
 * actualizan (mantienen source='projected') sólo si nadie los editó
 * manualmente. La detección "manual override" es por source != 'projected'.
 *
 * Response:
 *   { base_period, target_periods: [...],
 *     created: N, updated: N, skipped_existing: N, skipped_locked: N,
 *     warnings: [...], details: [...] }
 * ============================================================ */
router.post('/project-to-future', async (req, res) => {
  const conn = await pool.connect();
  try {
    const body = req.body || {};
    const dryRun = body.dry_run === true;

    const monthsAhead = Number(body.months_ahead);
    if (!Number.isInteger(monthsAhead) || monthsAhead < 1 || monthsAhead > 12) {
      conn.release();
      return res.status(400).json({ error: 'months_ahead debe ser entero entre 1 y 12' });
    }
    const growthPct = body.growth_pct != null ? Number(body.growth_pct) : 0;
    if (!Number.isFinite(growthPct) || growthPct < -50 || growthPct > 200) {
      conn.release();
      return res.status(400).json({ error: 'growth_pct debe ser número entre -50 y 200' });
    }

    // Resolver base_period: si el caller no manda uno, usamos el período más
    // reciente con AL MENOS un costo registrado. Si la DB está vacía no hay
    // base — devolver 400 con instrucción.
    let basePeriod;
    if (body.base_period) {
      const v = validatePeriod(body.base_period);
      if (!v.ok) { conn.release(); return res.status(400).json({ error: v.error }); }
      basePeriod = v.period;
    } else {
      const { rows } = await conn.query(
        `SELECT period FROM employee_costs ORDER BY period DESC LIMIT 1`
      );
      if (!rows.length) {
        conn.release();
        return res.status(400).json({
          error: 'No hay ningún costo registrado para usar como base. Carga al menos un mes antes de proyectar.',
          code: 'no_base_period',
        });
      }
      basePeriod = rows[0].period;
    }

    // Períodos destino: del siguiente al basePeriod, N meses hacia adelante.
    const firstTarget = addMonths(basePeriod, 1);
    const targetPeriods = periodsForward(firstTarget, monthsAhead);

    // Cargar costos del basePeriod — son los "templates" a proyectar.
    const { rows: baseCosts } = await conn.query(
      `SELECT * FROM employee_costs WHERE period = $1`, [basePeriod]
    );
    if (!baseCosts.length) {
      conn.release();
      return res.status(400).json({
        error: `El período base ${basePeriod} no tiene costos registrados. Selecciona otro período.`,
        code: 'base_period_empty',
      });
    }

    // Empleados activos por período destino (cargamos start/end de los
    // employees involucrados de una vez).
    const empIds = baseCosts.map((c) => c.employee_id);
    const { rows: emps } = await conn.query(
      `SELECT id, start_date, end_date, status
         FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [empIds]
    );
    const empById = new Map(emps.map((e) => [e.id, e]));

    // Costos existentes en los períodos destino — para skip / detectar override.
    const { rows: existingFuture } = await conn.query(
      `SELECT employee_id, period, locked, source FROM employee_costs
        WHERE employee_id = ANY($1::uuid[]) AND period = ANY($2::char[])`,
      [empIds, targetPeriods]
    );
    const existingByKey = new Map(
      existingFuture.map((c) => [`${c.employee_id}|${c.period}`, c])
    );

    // FX rates necesarias para todos (target_period × currency).
    const currencies = [...new Set(baseCosts.map((c) => c.currency).filter((c) => c !== 'USD'))];
    const fxByCcy = {};
    if (currencies.length > 0) {
      const maxTarget = targetPeriods[targetPeriods.length - 1];
      const { rows: fxRows } = await conn.query(
        `SELECT yyyymm, currency, usd_rate FROM exchange_rates
          WHERE currency = ANY($1::varchar[]) AND yyyymm <= $2
          ORDER BY yyyymm DESC`,
        [currencies, maxTarget]
      );
      for (const r of fxRows) {
        if (!fxByCcy[r.currency]) fxByCcy[r.currency] = [];
        fxByCcy[r.currency].push({ period: r.yyyymm, rate: Number(r.usd_rate) });
      }
    }
    const resolveRate = (period, ccy) => {
      if (ccy === 'USD') return { rate: 1, fallback_period: null };
      const list = fxByCcy[ccy] || [];
      const direct = list.find((r) => r.period === period);
      if (direct) return { rate: direct.rate, fallback_period: null };
      const fb = list.find((r) => r.period < period);
      return fb ? { rate: fb.rate, fallback_period: fb.period } : { rate: null, fallback_period: null };
    };

    // Growth mensual derivado del growth anual: (1+r)^(1/12) - 1.
    // monthIndex 0 = primer mes proyectado (base+1), 1 = base+2, etc.
    const monthlyGrowth = growthPct === 0
      ? 1
      : Math.pow(1 + growthPct / 100, 1 / 12);

    if (!dryRun) await conn.query('BEGIN');

    const warnings = [];
    const details = [];
    let created = 0;
    let updated = 0;
    let skippedExisting = 0;
    let skippedLocked = 0;
    let skippedInactive = 0;

    for (let mi = 0; mi < targetPeriods.length; mi++) {
      const targetPeriod = targetPeriods[mi];
      const factor = Math.pow(monthlyGrowth, mi + 1);

      for (const baseRow of baseCosts) {
        const emp = empById.get(baseRow.employee_id);
        if (!emp) continue; // empleado borrado entre cargar baseCosts y emps
        // Validar que el empleado siga activo en targetPeriod.
        const epc = validateEmployeePeriod(emp, targetPeriod, { monthsAhead: 12 });
        if (!epc.ok) { skippedInactive++; continue; }

        const key = `${baseRow.employee_id}|${targetPeriod}`;
        const existing = existingByKey.get(key);
        if (existing && existing.locked) { skippedLocked++; continue; }
        // Si ya hay un row con source != 'projected', es una carga manual —
        // NO la sobreescribimos. La proyección respeta cargas explícitas.
        if (existing && existing.source !== 'projected') { skippedExisting++; continue; }

        const projectedGross = Math.round(Number(baseRow.gross_cost) * factor * 100) / 100;
        const fx = resolveRate(targetPeriod, baseRow.currency);
        const conv = convertToUsd(projectedGross, baseRow.currency, fx.rate);
        if (baseRow.currency !== 'USD' && fx.fallback_period) {
          warnings.push({
            employee_id: baseRow.employee_id, target_period: targetPeriod,
            code: 'fx_fallback_used', fallback_period: fx.fallback_period,
          });
        }
        if (baseRow.currency !== 'USD' && fx.rate == null) {
          warnings.push({
            employee_id: baseRow.employee_id, target_period: targetPeriod,
            code: 'fx_missing',
          });
        }

        details.push({
          employee_id: baseRow.employee_id,
          period: targetPeriod,
          currency: baseRow.currency,
          gross_cost: projectedGross,
          cost_usd: conv.cost_usd,
          action: existing ? 'would_update' : 'would_create',
        });

        if (!dryRun) {
          if (existing) {
            await conn.query(
              `UPDATE employee_costs
                  SET currency = $1, gross_cost = $2, cost_usd = $3, exchange_rate_used = $4,
                      source = 'projected', updated_by = $5, updated_at = NOW()
                WHERE employee_id = $6 AND period = $7`,
              [baseRow.currency, projectedGross, conv.cost_usd, conv.exchange_rate_used,
               req.user.id, baseRow.employee_id, targetPeriod]
            );
            updated++;
          } else {
            await conn.query(
              `INSERT INTO employee_costs
                 (employee_id, period, currency, gross_cost, cost_usd, exchange_rate_used,
                  notes, source, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'projected', $8, $8)`,
              [baseRow.employee_id, targetPeriod, baseRow.currency,
               projectedGross, conv.cost_usd, conv.exchange_rate_used,
               growthPct === 0
                 ? `Proyectado desde ${basePeriod}`
                 : `Proyectado desde ${basePeriod} con +${growthPct}%/año`,
               req.user.id]
            );
            created++;
          }
        }
      }
    }

    if (!dryRun) {
      await conn.query('COMMIT');
      await emitEvent(pool, {
        event_type: 'employee_cost.projected_to_future',
        entity_type: 'employee_cost', entity_id: null,
        actor_user_id: req.user.id,
        payload: {
          base_period: basePeriod, months_ahead: monthsAhead,
          growth_pct: growthPct,
          target_periods: targetPeriods,
          created, updated, skipped_existing: skippedExisting, skipped_locked: skippedLocked,
        },
        req,
      });
    }

    res.json({
      base_period: basePeriod,
      target_periods: targetPeriods,
      months_ahead: monthsAhead,
      growth_pct: growthPct,
      dry_run: dryRun,
      created: dryRun ? 0 : created,
      updated: dryRun ? 0 : updated,
      would_create: dryRun ? details.filter((d) => d.action === 'would_create').length : 0,
      would_update: dryRun ? details.filter((d) => d.action === 'would_update').length : 0,
      skipped_existing: skippedExisting,
      skipped_locked: skippedLocked,
      skipped_inactive: skippedInactive,
      warnings,
      details: dryRun ? details : undefined,
    });
  } catch (err) {
    await safeRollback(conn, 'POST /employee-costs/project-to-future');
    serverError(res, 'POST /employee-costs/project-to-future', err);
  } finally { conn.release(); }
});

/* ============================================================
 * POST /api/employee-costs/lock/:period
 * Marca todos los rows del período como locked. Idempotente.
 * Audit log mandatorio.
 * ============================================================ */
router.post('/lock/:period', async (req, res) => {
  try {
    const v = validatePeriod(req.params.period);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const period = v.period;

    const { rows } = await pool.query(
      `UPDATE employee_costs
          SET locked = true, locked_at = NOW(), locked_by = $2, updated_at = NOW()
        WHERE period = $1 AND locked = false
        RETURNING id`,
      [period, req.user.id]
    );
    await emitEvent(pool, {
      event_type: 'employee_cost.locked',
      entity_type: 'employee_cost', entity_id: null,
      actor_user_id: req.user.id,
      payload: { period, locked_count: rows.length },
      req,
    });
    res.json({ period, locked_count: rows.length });
  } catch (err) { serverError(res, 'POST /employee-costs/lock/:period', err); }
});

/* ============================================================
 * POST /api/employee-costs/unlock/:period — SUPERADMIN ONLY
 * ============================================================ */
router.post('/unlock/:period', superadminOnly, async (req, res) => {
  try {
    const v = validatePeriod(req.params.period);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const period = v.period;
    const { rows } = await pool.query(
      `UPDATE employee_costs
          SET locked = false, locked_at = NULL, locked_by = NULL, updated_at = NOW()
        WHERE period = $1 AND locked = true
        RETURNING id`,
      [period]
    );
    await emitEvent(pool, {
      event_type: 'employee_cost.unlocked',
      entity_type: 'employee_cost', entity_id: null,
      actor_user_id: req.user.id,
      payload: { period, unlocked_count: rows.length },
      req,
    });
    res.json({ period, unlocked_count: rows.length });
  } catch (err) { serverError(res, 'POST /employee-costs/unlock/:period', err); }
});

/* ============================================================
 * POST /api/employee-costs/recalculate-usd/:period
 * Recalcula cost_usd para rows abiertos del período (no toca locked).
 * Llamar después de actualizar exchange_rates.
 * ============================================================ */
router.post('/recalculate-usd/:period', async (req, res) => {
  const conn = await pool.connect();
  try {
    const v = validatePeriod(req.params.period);
    if (!v.ok) { conn.release(); return res.status(400).json({ error: v.error }); }
    const period = v.period;

    const { rows: targets } = await conn.query(
      `SELECT * FROM employee_costs
        WHERE period = $1 AND locked = false`,
      [period]
    );

    const currencies = [...new Set(targets.map((r) => r.currency).filter((c) => c !== 'USD'))];
    const fxByCcy = {};
    if (currencies.length > 0) {
      const { rows: fxRows } = await conn.query(
        `SELECT yyyymm, currency, usd_rate FROM exchange_rates
          WHERE currency = ANY($1::varchar[]) AND yyyymm <= $2
          ORDER BY yyyymm DESC`,
        [currencies, period]
      );
      for (const r of fxRows) {
        if (!fxByCcy[r.currency]) fxByCcy[r.currency] = [];
        fxByCcy[r.currency].push({ period: r.yyyymm, rate: Number(r.usd_rate) });
      }
    }
    const resolveRate = (ccy) => {
      if (ccy === 'USD') return 1;
      const list = fxByCcy[ccy] || [];
      const direct = list.find((r) => r.period === period);
      if (direct) return direct.rate;
      const fb = list[0];
      return fb ? fb.rate : null;
    };

    await conn.query('BEGIN');
    let updated = 0;
    let unchanged = 0;
    for (const row of targets) {
      const rate = resolveRate(row.currency);
      const conv = convertToUsd(Number(row.gross_cost), row.currency, rate);
      const oldUsd = row.cost_usd != null ? Number(row.cost_usd) : null;
      const oldRate = row.exchange_rate_used != null ? Number(row.exchange_rate_used) : null;
      if (oldUsd === conv.cost_usd && oldRate === conv.exchange_rate_used) { unchanged++; continue; }
      await conn.query(
        `UPDATE employee_costs
            SET cost_usd = $1, exchange_rate_used = $2, updated_by = $3, updated_at = NOW()
          WHERE id = $4`,
        [conv.cost_usd, conv.exchange_rate_used, req.user.id, row.id]
      );
      updated++;
    }
    await conn.query('COMMIT');

    await emitEvent(pool, {
      event_type: 'employee_cost.recalculated_after_fx_change',
      entity_type: 'employee_cost', entity_id: null,
      actor_user_id: req.user.id,
      payload: { period, updated, unchanged, locked_skipped: 'unknown_count_locked_rows_skipped' },
      req,
    });
    res.json({ period, updated, unchanged });
  } catch (err) {
    await safeRollback(conn, 'POST /employee-costs/recalculate-usd/:period');
    serverError(res, 'POST /employee-costs/recalculate-usd/:period', err);
  } finally { conn.release(); }
});

module.exports = router;
