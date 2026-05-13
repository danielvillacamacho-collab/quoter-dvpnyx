import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated, error } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createEmployeeRepository } from './repository';
import { createAreaRepository } from './areas.repository';
import { createSkillRepository } from './skills.repository';
import { createEmployeeService } from './service';
import { EMPLOYEE_SORTABLE } from './types';
import { NotFound, Conflict } from '@shared/errors';

const db = getPool();
const evts = createEventEmitter();
const empSvc = createEmployeeService(createEmployeeRepository(db), evts, db);
const areaRepo = createAreaRepository(db);
const skillRepo = createSkillRepository(db);

const router = createRouter();

// ── Employees ───────────────────────────────────────────────────────
router.get('/api/employees/lookup', async (event) => {
  const qs = event.queryStringParameters || {};
  const includeTerminated = String(qs.include_terminated || '').toLowerCase() === 'true';
  const wheres = ['e.deleted_at IS NULL'];
  if (!includeTerminated) wheres.push(`e.status <> 'terminated'`);
  const { rows } = await db.query(
    `SELECT e.id, e.first_name, e.last_name, e.level, e.status,
            e.area_id, a.name AS area_name, e.weekly_capacity_hours
       FROM employees e
       LEFT JOIN areas a ON a.id = e.area_id
      WHERE ${wheres.join(' AND ')}
      ORDER BY e.last_name, e.first_name`,
  );
  return ok({ data: rows });
});

router.get('/api/employees', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, EMPLOYEE_SORTABLE, { defaultField: 'last_name', defaultDir: 'asc', tieBreaker: 'e.id ASC' });
  return paginated(await empSvc.list({ page, limit, offset, filters: qs, sort }));
});

router.get('/api/employees/:id', async (event) => ok(await empSvc.getById(event.pathParameters!.id!)));

router.post('/api/employees', async (event, user) => {
  requireAdmin(user);
  return created(await empSvc.create(JSON.parse(event.body || '{}'), user));
});

router.put('/api/employees/:id', async (event, user) => {
  requireAdmin(user);
  return ok(await empSvc.update(event.pathParameters!.id!, JSON.parse(event.body || '{}'), user));
});

router.delete('/api/employees/:id', async (event, user) => {
  requireAdmin(user);
  await empSvc.softDelete(event.pathParameters!.id!, user);
  return message('Empleado eliminado');
});

router.get('/api/employees/:id/skills', async (event) => ok({ data: await empSvc.getSkills(event.pathParameters!.id!) }));

router.put('/api/employees/:id/skills', async (event, user) => {
  requireAdmin(user);
  const { skill_ids } = JSON.parse(event.body || '{}');
  return ok({ data: await empSvc.setSkills(event.pathParameters!.id!, skill_ids || [], user) });
});

// ── Areas ───────────────────────────────────────────────────────────
router.get('/api/areas', async (event) => {
  const qs = event.queryStringParameters || {};
  return ok({ data: await areaRepo.findAll({ active: qs.active }) });
});

router.get('/api/areas/:id', async (event) => {
  const area = await areaRepo.findById(event.pathParameters!.id!);
  if (!area) throw new NotFound('Área', event.pathParameters!.id!);
  return ok(area);
});

router.post('/api/areas', async (event, user) => {
  requireAdmin(user);
  return created(await areaRepo.create(JSON.parse(event.body || '{}')));
});

router.put('/api/areas/:id', async (event, user) => {
  requireAdmin(user);
  const area = await areaRepo.update(event.pathParameters!.id!, JSON.parse(event.body || '{}'));
  if (!area) throw new NotFound('Área', event.pathParameters!.id!);
  return ok(area);
});

router.delete('/api/areas/:id', async (event, user) => {
  requireAdmin(user);
  const hasEmps = await areaRepo.hasActiveEmployees(event.pathParameters!.id!);
  if (hasEmps) throw new Conflict('No se puede desactivar: tiene empleados activos');
  const area = await areaRepo.deactivate(event.pathParameters!.id!);
  if (!area) throw new NotFound('Área', event.pathParameters!.id!);
  return ok(area);
});

// ── Skills ──────────────────────────────────────────────────────────
router.get('/api/skills', async (event) => {
  const qs = event.queryStringParameters || {};
  return ok({ data: await skillRepo.findAll({ active: qs.active, category: qs.category, search: qs.search }) });
});

router.get('/api/skills/:id', async (event) => {
  const skill = await skillRepo.findById(event.pathParameters!.id!);
  if (!skill) throw new NotFound('Skill', event.pathParameters!.id!);
  return ok(skill);
});

router.post('/api/skills', async (event, user) => {
  requireAdmin(user);
  return created(await skillRepo.create(JSON.parse(event.body || '{}')));
});

router.put('/api/skills/:id', async (event, user) => {
  requireAdmin(user);
  const skill = await skillRepo.update(event.pathParameters!.id!, JSON.parse(event.body || '{}'));
  if (!skill) throw new NotFound('Skill', event.pathParameters!.id!);
  return ok(skill);
});

router.delete('/api/skills/:id', async (event, user) => {
  requireAdmin(user);
  const hasEmps = await skillRepo.hasEmployees(event.pathParameters!.id!);
  if (hasEmps) throw new Conflict('No se puede desactivar: tiene empleados asociados');
  const skill = await skillRepo.deactivate(event.pathParameters!.id!);
  if (!skill) throw new NotFound('Skill', event.pathParameters!.id!);
  return ok(skill);
});

// ── Employee Costs ───────────────────────────────────────────────
const PERIOD_RE = /^[0-9]{6}$/;

function previousPeriod(period: string): string {
  let y = Number(period.slice(0, 4));
  let m = Number(period.slice(4)) - 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}${String(m).padStart(2, '0')}`;
}

function convertToUsd(gross: number, currency: string, fxRate: number | null): { cost_usd: number | null; exchange_rate_used: number | null } {
  if (currency === 'USD') return { cost_usd: gross, exchange_rate_used: 1 };
  if (fxRate == null) return { cost_usd: null, exchange_rate_used: null };
  return { cost_usd: parseFloat((gross / fxRate).toFixed(4)), exchange_rate_used: fxRate };
}

async function resolveRatesBulk(db: ReturnType<typeof import('@shared/db/connection').getPool>, currencies: string[], period: string): Promise<Record<string, Array<{ period: string; rate: number }>>> {
  const fxByCcy: Record<string, Array<{ period: string; rate: number }>> = {};
  if (currencies.length === 0) return fxByCcy;
  const { rows } = await db.query(
    `SELECT yyyymm, currency, usd_rate FROM exchange_rates WHERE currency = ANY($1::varchar[]) AND yyyymm <= $2 ORDER BY yyyymm DESC`,
    [currencies, period],
  );
  for (const r of rows as Record<string, unknown>[]) {
    const ccy = r.currency as string;
    if (!fxByCcy[ccy]) fxByCcy[ccy] = [];
    fxByCcy[ccy].push({ period: r.yyyymm as string, rate: Number(r.usd_rate) });
  }
  return fxByCcy;
}

function pickRate(fxByCcy: Record<string, Array<{ period: string; rate: number }>>, ccy: string, period: string): { rate: number | null; fallback_period: string | null } {
  if (ccy === 'USD') return { rate: 1, fallback_period: null };
  const list = fxByCcy[ccy] || [];
  const direct = list.find(r => r.period === period);
  if (direct) return { rate: direct.rate, fallback_period: null };
  const fb = list[0];
  return fb ? { rate: fb.rate, fallback_period: fb.period } : { rate: null, fallback_period: null };
}

router.get('/api/employee-costs', async (event, user) => {
  requireAdmin(user);
  const qs = event.queryStringParameters || {};
  const d = new Date();
  const period = String(qs.period || `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`).trim();
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido (formato YYYYMM)' });

  const pFirst = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;
  const pLast = `(DATE '${pFirst}' + INTERVAL '1 month - 1 day')::date`;

  const [{ rows: employees }, { rows: costs }, { rows: params }] = await Promise.all([
    db.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.country, e.status,
              e.start_date, e.end_date, a.name AS area_name
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
        WHERE e.deleted_at IS NULL
          AND e.start_date <= ${pLast}
          AND (e.end_date IS NULL OR e.end_date >= DATE '${pFirst}')
          AND e.status IN ('active','on_leave','bench')
        ORDER BY e.first_name, e.last_name`,
    ),
    db.query(`SELECT * FROM employee_costs WHERE period = $1`, [period]),
    db.query(`SELECT key, value FROM parameters WHERE category IN ('cost_per_level','level_costs') ORDER BY key`),
  ]);

  const costsByEmp = new Map((costs as Record<string, unknown>[]).map(c => [c.employee_id as string, c]));
  const theoretical = new Map<string, number>();
  for (const p of params as Record<string, unknown>[]) {
    let lvl = String(p.key).trim().toUpperCase();
    if (/^[0-9]+$/.test(lvl)) lvl = `L${lvl}`;
    theoretical.set(lvl, Number(p.value));
  }

  const data = (employees as Record<string, unknown>[]).map(emp => {
    const cost = (costsByEmp.get(emp.id as string) || null) as Record<string, unknown> | null;
    const theoreticalUsd = theoretical.get(emp.level as string) ?? null;
    const costUsd = cost?.cost_usd != null ? Number(cost.cost_usd) : null;
    const delta = (cost && costUsd != null && theoreticalUsd)
      ? { delta: costUsd - theoreticalUsd, deltaPct: (costUsd - theoreticalUsd) / theoreticalUsd, zone: costUsd > theoreticalUsd * 1.1 ? 'above' : costUsd < theoreticalUsd * 0.9 ? 'below' : 'ok' }
      : { delta: null, deltaPct: null, zone: theoreticalUsd ? 'no_data' : 'no_baseline' };
    return { employee: emp, cost, theoretical_cost_usd: theoreticalUsd, delta };
  });

  const withCost = data.filter(d => d.cost).length;
  const totalCostUsd = data.reduce((s, d) => s + (d.cost?.cost_usd ? Number(d.cost.cost_usd) : 0), 0);
  const summary = {
    period, total_employees: data.length, with_cost: withCost,
    without_cost: data.length - withCost,
    total_cost_usd: totalCostUsd,
    avg_cost_usd: withCost > 0 ? Math.round((totalCostUsd / withCost) * 100) / 100 : 0,
    locked_count: data.filter(d => d.cost?.locked).length,
  };
  return ok({ period, data, summary });
});

router.post('/api/employee-costs/bulk/commit', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const period = String(body.period || '');
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido (formato YYYYMM)' });
  const items: Record<string, unknown>[] = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return error(400, { error: 'items[] es requerido' });

  const empIds = [...new Set(items.map(i => i.employee_id as string).filter(Boolean))];
  const [{ rows: emps }, { rows: existing }] = await Promise.all([
    db.query(`SELECT id, start_date, end_date, status FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [empIds]),
    db.query(`SELECT * FROM employee_costs WHERE period = $1 AND employee_id = ANY($2::uuid[])`, [period, empIds]),
  ]);
  const empById = new Map((emps as Record<string, unknown>[]).map(e => [e.id as string, e]));
  const existingByEmp = new Map((existing as Record<string, unknown>[]).map(c => [c.employee_id as string, c as Record<string, unknown>]));

  const ccys = [...new Set(items.map(i => String(i.currency || '').toUpperCase()).filter(c => c && c !== 'USD'))];
  const fxByCcy = await resolveRatesBulk(db, ccys, period);

  const errors: unknown[] = [];
  const warnings: unknown[] = [];
  const pending: Array<{ item: Record<string, unknown>; currency: string; gross: number; conv: ReturnType<typeof convertToUsd>; existingRow?: Record<string, unknown> }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ctx = { index: i, employee_id: item.employee_id };
    if (!empById.has(item.employee_id as string)) { errors.push({ ...ctx, code: 'employee_not_found' }); continue; }
    const currency = String(item.currency || '').toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) { errors.push({ ...ctx, code: 'currency_invalid' }); continue; }
    const gross = Number(item.gross_cost);
    if (!Number.isFinite(gross) || gross < 0) { errors.push({ ...ctx, code: 'gross_cost_invalid' }); continue; }
    const existingRow = existingByEmp.get(item.employee_id as string);
    if (existingRow?.locked && user.role !== 'superadmin') { errors.push({ ...ctx, code: 'period_locked' }); continue; }
    const fx = pickRate(fxByCcy, currency, period);
    const conv = convertToUsd(gross, currency, fx.rate);
    if (currency !== 'USD' && fx.fallback_period) warnings.push({ ...ctx, code: 'fx_fallback_used', fallback_period: fx.fallback_period });
    if (currency !== 'USD' && fx.rate == null) warnings.push({ ...ctx, code: 'fx_missing' });
    pending.push({ item, currency, gross, conv, existingRow });
  }

  if (errors.length > 0) return error(400, { error: 'Hay errores en el payload — ningún cambio fue aplicado.', errors, warnings, applied: [] });

  const conn = await db.connect();
  const applied: unknown[] = [];
  try {
    await conn.query('BEGIN');
    for (const p of pending) {
      if (p.existingRow) {
        await conn.query(
          `UPDATE employee_costs SET currency=$1,gross_cost=$2,cost_usd=$3,exchange_rate_used=$4,notes=COALESCE($5,notes),updated_by=$6,updated_at=NOW() WHERE id=$7`,
          [p.currency, p.gross, p.conv.cost_usd, p.conv.exchange_rate_used, (p.item.notes as string) ?? null, user.id, p.existingRow.id],
        );
        applied.push({ employee_id: p.item.employee_id, action: 'updated', id: p.existingRow.id });
      } else {
        const { rows } = await conn.query(
          `INSERT INTO employee_costs (employee_id,period,currency,gross_cost,cost_usd,exchange_rate_used,notes,source,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$8) RETURNING id`,
          [p.item.employee_id, period, p.currency, p.gross, p.conv.cost_usd, p.conv.exchange_rate_used, (p.item.notes as string) || null, user.id],
        );
        applied.push({ employee_id: p.item.employee_id, action: 'created', id: rows[0].id });
      }
    }
    await conn.query('COMMIT');
    return ok({ period, total: items.length, errors: [], warnings, applied });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

router.post('/api/employee-costs/copy-from-previous', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const period = String(body.period || '');
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido (formato YYYYMM)' });
  const prev = previousPeriod(period);
  const pFirst = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;

  const [{ rows: activeEmps }, { rows: prevCosts }, { rows: alreadyN }] = await Promise.all([
    db.query(`SELECT id FROM employees WHERE deleted_at IS NULL AND status IN ('active','on_leave','bench') AND start_date <= (DATE '${pFirst}' + INTERVAL '1 month - 1 day')::date AND (end_date IS NULL OR end_date >= DATE '${pFirst}')`),
    db.query(`SELECT * FROM employee_costs WHERE period = $1`, [prev]),
    db.query(`SELECT employee_id FROM employee_costs WHERE period = $1`, [period]),
  ]);

  const activeIds = new Set((activeEmps as Record<string, unknown>[]).map(e => e.id as string));
  const alreadyByEmp = new Set((alreadyN as Record<string, unknown>[]).map(r => r.employee_id as string));
  const ccys = [...new Set((prevCosts as Record<string, unknown>[]).map(r => r.currency as string).filter(c => c !== 'USD'))];
  const fxByCcy = await resolveRatesBulk(db, ccys, period);

  const conn = await db.connect();
  let copied = 0; let skipped = 0; const warnings: unknown[] = [];
  try {
    await conn.query('BEGIN');
    for (const row of prevCosts as Record<string, unknown>[]) {
      if (!activeIds.has(row.employee_id as string)) { skipped++; continue; }
      if (alreadyByEmp.has(row.employee_id as string)) { skipped++; continue; }
      const fx = pickRate(fxByCcy, row.currency as string, period);
      const conv = convertToUsd(Number(row.gross_cost), row.currency as string, fx.rate);
      if (row.currency !== 'USD' && fx.fallback_period) warnings.push({ employee_id: row.employee_id, code: 'fx_fallback_used', fallback_period: fx.fallback_period });
      await conn.query(
        `INSERT INTO employee_costs (employee_id,period,currency,gross_cost,cost_usd,exchange_rate_used,notes,source,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'copy_from_prev',$8,$8)`,
        [row.employee_id, period, row.currency, row.gross_cost, conv.cost_usd, conv.exchange_rate_used, row.notes, user.id],
      );
      copied++;
    }
    await conn.query('COMMIT');
    return ok({ from_period: prev, to_period: period, copied, skipped, warnings });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

router.post('/api/employee-costs/lock/:period', async (event, user) => {
  requireAdmin(user);
  const period = event.pathParameters!.period!;
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido' });
  const { rows } = await db.query(
    `UPDATE employee_costs SET locked=true,locked_at=NOW(),locked_by=$2,updated_at=NOW() WHERE period=$1 AND locked=false RETURNING id`,
    [period, user.id],
  );
  return ok({ period, locked_count: rows.length });
});

router.post('/api/employee-costs/unlock/:period', async (event, user) => {
  if (user.role !== 'superadmin') return error(403, { error: 'Solo superadmin puede desbloquear períodos' });
  const period = event.pathParameters!.period!;
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido' });
  const { rows } = await db.query(
    `UPDATE employee_costs SET locked=false,locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE period=$1 AND locked=true RETURNING id`,
    [period],
  );
  return ok({ period, unlocked_count: rows.length });
});

router.post('/api/employee-costs/recalculate-usd/:period', async (event, user) => {
  requireAdmin(user);
  const period = event.pathParameters!.period!;
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido' });
  const { rows: openRows } = await db.query(
    `SELECT id, currency, gross_cost FROM employee_costs WHERE period=$1 AND locked=false AND currency <> 'USD'`,
    [period],
  );
  const ccys = [...new Set((openRows as Record<string, unknown>[]).map(r => r.currency as string))];
  const fxByCcy = await resolveRatesBulk(db, ccys, period);
  let updated = 0; let unchanged = 0;
  for (const row of openRows as Record<string, unknown>[]) {
    const fx = pickRate(fxByCcy, row.currency as string, period);
    if (fx.rate == null) { unchanged++; continue; }
    const costUsd = parseFloat((Number(row.gross_cost) / fx.rate).toFixed(4));
    await db.query(`UPDATE employee_costs SET cost_usd=$1,exchange_rate_used=$2,updated_at=NOW() WHERE id=$3`, [costUsd, fx.rate, row.id]);
    updated++;
  }
  return ok({ period, updated, unchanged });
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
