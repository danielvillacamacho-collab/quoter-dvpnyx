import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated, error } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createResourceRequestRepository } from './repository';
import { createResourceRequestService } from './service';
import { SORTABLE } from './types';
import type { ResourceRequestFilters } from './types';

const db = getPool();
const repo = createResourceRequestRepository(db);
const events = createEventEmitter();
const service = createResourceRequestService(repo, events, db);

const router = createRouter();

router.get('/api/resource-requests/lookup', async (event) => {
  const qs = event.queryStringParameters || {};
  const includeAll = String(qs.include_all || '').toLowerCase() === 'true';
  const wheres = ['rr.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (!includeAll) wheres.push(`rr.status NOT IN ('filled','cancelled')`);
  if (qs.contract_id) wheres.push(`rr.contract_id = ${add(qs.contract_id)}`);
  const { rows } = await db.query(
    `SELECT rr.id, rr.role_title, rr.level, rr.weekly_hours,
            rr.start_date, rr.end_date, rr.status, rr.priority,
            rr.contract_id, c.name AS contract_name, c.type AS contract_type,
            c.original_currency AS contract_currency,
            rr.area_id, a.name AS area_name
       FROM resource_requests rr
       LEFT JOIN contracts c ON c.id = rr.contract_id
       LEFT JOIN areas a ON a.id = rr.area_id
      WHERE ${wheres.join(' AND ')}
      ORDER BY
        CASE rr.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        rr.created_at DESC`,
    params,
  );
  return ok({ data: rows });
});

router.get('/api/resource-requests', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, SORTABLE, { defaultField: 'created_at', defaultDir: 'desc', tieBreaker: 'rr.id ASC' });
  const filters: ResourceRequestFilters = {
    search: qs.search, contract_id: qs.contract_id,
    area_id: qs.area_id, level: qs.level,
    status: qs.status, priority: qs.priority,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort }));
});

router.get('/api/resource-requests/:id', async (event) => {
  return ok(await service.getById(event.pathParameters!.id!));
});

router.get('/api/resource-requests/:id/candidates', async (event) => {
  return ok(await service.getCandidates(event.pathParameters!.id!));
});

router.post('/api/resource-requests', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await service.create(body, user));
});

router.put('/api/resource-requests/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

router.delete('/api/resource-requests/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Requerimiento eliminado');
});

router.post('/api/resource-requests/:id/cancel', async (event, user) => {
  requireAdmin(user);
  const { rows } = await db.query(
    `UPDATE resource_requests SET status='cancelled', updated_at=NOW(), updated_by=$1
      WHERE id=$2 AND deleted_at IS NULL
      RETURNING *`,
    [user.id, event.pathParameters!.id!],
  );
  if (!rows.length) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Requerimiento no encontrado' }) };
  return ok(rows[0]);
});

/* ==================================================================
 * RM — /api/rm/* (Resource Management bulk operations)
 * ================================================================== */

const CAPACITY_HOURS = 40;
const MAX_BULK_EMPLOYEES = 200;
const MAX_TARGET_WEEKS = 52;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

function toMonday(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function weeksBetween(startDate: string, endDate: string): string[] {
  const weeks: string[] = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    weeks.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return weeks;
}

async function getLockedWeeks(conn: any, employeeId: string, weekDates: string[]): Promise<Set<string>> {
  if (!weekDates.length) return new Set();
  const { rows } = await conn.query(
    `SELECT week_starting::text FROM assignment_locks
      WHERE employee_id = $1 AND week_starting = ANY($2::date[]) AND unlocked_at IS NULL`,
    [employeeId, weekDates],
  );
  return new Set(rows.map((r: any) => r.week_starting));
}

async function sumHoursForWeek(conn: any, employeeId: string, weekMonday: string): Promise<number> {
  const weekEnd = new Date(weekMonday);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const { rows } = await conn.query(
    `SELECT COALESCE(SUM(weekly_hours), 0) AS total FROM assignments
      WHERE employee_id=$1 AND deleted_at IS NULL AND status IN ('planned','active')
        AND start_date <= $3::date AND (end_date IS NULL OR end_date >= $2::date)`,
    [employeeId, weekMonday, weekEnd.toISOString().slice(0, 10)],
  );
  return Number(rows[0].total || 0);
}

/* ── POST /api/rm/assignments/bulk ── */
router.post('/api/rm/assignments/bulk', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const { assignments, dry_run } = body;
  if (!Array.isArray(assignments) || !assignments.length) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Se requiere un array de assignments' }) };
  }
  if (assignments.length > 200) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Máximo 200 assignments por operación' }) };
  }

  const results: any = { created: 0, skipped_locked: 0, warnings: [], assignment_ids: [], errors: [] };
  const conn = await db.connect();
  try {
    if (!dry_run) await conn.query('BEGIN');
    for (const asgn of assignments as any[]) {
      const { employee_id, contract_id, resource_request_id, weekly_hours, start_date, end_date, role_title, notes } = asgn;
      if (!employee_id || !contract_id || !weekly_hours || !start_date) {
        results.errors.push({ employee_id, reason: 'campos_requeridos' }); continue;
      }
      const weekMonday = toMonday(start_date);
      if (!weekMonday) { results.errors.push({ employee_id, reason: 'fecha_invalida', detail: start_date }); continue; }
      const locked = await getLockedWeeks(conn, employee_id, [weekMonday]);
      if (locked.has(weekMonday)) { results.skipped_locked++; continue; }
      const existing = await sumHoursForWeek(conn, employee_id, weekMonday);
      const newTotal = existing + Number(weekly_hours);
      if (newTotal > CAPACITY_HOURS) {
        results.warnings.push({ employee_id, week_starting: weekMonday, reason: 'over_capacity', current_total: existing, adding: Number(weekly_hours), new_total: newTotal, threshold: CAPACITY_HOURS });
      }
      const effectiveEnd = end_date || null;
      const { rows: existing_asgn } = await conn.query(
        `SELECT id FROM assignments WHERE employee_id=$1 AND contract_id=$2 AND deleted_at IS NULL AND status IN ('planned','active') AND start_date <= $4::date AND (end_date IS NULL OR end_date >= $3::date) LIMIT 1`,
        [employee_id, contract_id, start_date, effectiveEnd || '9999-12-31'],
      );
      if (existing_asgn.length) { results.created++; results.assignment_ids.push(existing_asgn[0].id); continue; }
      if (!dry_run) {
        const { rows } = await conn.query(
          `INSERT INTO assignments (employee_id, contract_id, resource_request_id, weekly_hours, start_date, end_date, role_title, notes, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9) RETURNING id`,
          [employee_id, contract_id, resource_request_id || null, Number(weekly_hours), start_date, effectiveEnd, role_title || null, notes || null, user.id],
        );
        results.assignment_ids.push(rows[0].id);
      }
      results.created++;
    }
    if (!dry_run) await conn.query('COMMIT');
    return ok(results);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

/* ── POST /api/rm/assignments/bulk-extend ── */
router.post('/api/rm/assignments/bulk-extend', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const { employee_ids, contract_id, source_week, target_weeks, weekly_hours, overwrite_existing } = body;
  if (!Array.isArray(employee_ids) || !employee_ids.length) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'employee_ids requerido' }) };
  if (employee_ids.length > MAX_BULK_EMPLOYEES) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: `Máximo ${MAX_BULK_EMPLOYEES} empleados` }) };
  if (!employee_ids.every(isUuid)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'employee_ids inválidos' }) };
  if (!isUuid(contract_id)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'contract_id inválido' }) };
  if (!source_week) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'source_week requerido' }) };
  if (!Array.isArray(target_weeks) || !target_weeks.length) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'target_weeks requerido' }) };
  if (target_weeks.length > MAX_TARGET_WEEKS) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: `Máximo ${MAX_TARGET_WEEKS} semanas` }) };

  const conn = await db.connect();
  const results: any = { created: 0, skipped_locked: 0, skipped_existing: 0, warnings: [] };
  try {
    await conn.query('BEGIN');
    const sourceMonday = toMonday(source_week);
    const sourceEnd = new Date(sourceMonday!);
    sourceEnd.setUTCDate(sourceEnd.getUTCDate() + 6);
    const { rows: sourceRows } = await conn.query(
      `SELECT employee_id, weekly_hours, role_title, resource_request_id FROM assignments WHERE contract_id=$1 AND employee_id=ANY($2::uuid[]) AND deleted_at IS NULL AND status IN ('planned','active') AND start_date<=$4::date AND (end_date IS NULL OR end_date>=$3::date)`,
      [contract_id, employee_ids, sourceMonday, sourceEnd.toISOString().slice(0, 10)],
    );
    const sourceMap: Record<string, any> = {};
    sourceRows.forEach((r: any) => { sourceMap[r.employee_id] = r; });
    for (const empId of employee_ids as string[]) {
      const source = sourceMap[empId];
      const hours = weekly_hours || source?.weekly_hours || 40;
      for (const tw of target_weeks as string[]) {
        const monday = toMonday(tw);
        if (!monday) continue;
        const locked = await getLockedWeeks(conn, empId, [monday]);
        if (locked.has(monday)) { results.skipped_locked++; continue; }
        const weekEnd = new Date(monday);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
        const { rows: dup } = await conn.query(
          `SELECT id FROM assignments WHERE employee_id=$1 AND contract_id=$2 AND deleted_at IS NULL AND status IN ('planned','active') AND start_date<=$4::date AND (end_date IS NULL OR end_date>=$3::date) LIMIT 1`,
          [empId, contract_id, monday, weekEnd.toISOString().slice(0, 10)],
        );
        if (dup.length && !overwrite_existing) { results.skipped_existing++; continue; }
        if (dup.length && overwrite_existing) {
          await conn.query('UPDATE assignments SET weekly_hours=$1, updated_at=NOW() WHERE id=$2', [Number(hours), dup[0].id]);
          results.created++; continue;
        }
        await conn.query(
          `INSERT INTO assignments (employee_id, contract_id, resource_request_id, weekly_hours, start_date, end_date, role_title, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)`,
          [empId, contract_id, source?.resource_request_id || null, Number(hours), monday, weekEnd.toISOString().slice(0, 10), source?.role_title || null, user.id],
        );
        results.created++;
      }
    }
    await conn.query('COMMIT');
    return ok(results);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

/* ── POST /api/rm/assignments/bulk-remove ── */
router.post('/api/rm/assignments/bulk-remove', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const { employee_ids, contract_id, week_from, week_to } = body;
  if (!Array.isArray(employee_ids) || !employee_ids.length || !contract_id || !week_from || !week_to) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'employee_ids, contract_id, week_from y week_to son requeridos' }) };
  }
  if (!employee_ids.every(isUuid)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'employee_ids inválidos' }) };
  const { rows: lockRows } = await db.query(
    `SELECT employee_id, week_starting::text FROM assignment_locks WHERE employee_id=ANY($1::uuid[]) AND week_starting>=$2::date AND week_starting<=$3::date AND unlocked_at IS NULL`,
    [employee_ids, week_from, week_to],
  );
  const { rowCount } = await db.query(
    `UPDATE assignments SET deleted_at=NOW(), status='cancelled', updated_at=NOW() WHERE employee_id=ANY($1::uuid[]) AND contract_id=$2 AND deleted_at IS NULL AND status IN ('planned','active') AND start_date>=$3::date AND start_date<=$4::date AND NOT EXISTS (SELECT 1 FROM assignment_locks al WHERE al.employee_id=assignments.employee_id AND al.unlocked_at IS NULL AND al.week_starting BETWEEN $3::date AND $4::date AND al.week_starting<=COALESCE(assignments.end_date,'9999-12-31'::date) AND (al.week_starting+6)>=assignments.start_date)`,
    [employee_ids, contract_id, week_from, week_to],
  );
  return ok({ removed: rowCount, skipped_locked: lockRows.length });
});

/* ── GET /api/rm/locks ── */
router.get('/api/rm/locks', async (event, _user) => {
  const qs = (event.queryStringParameters || {}) as Record<string, string | undefined>;
  const wheres = ['unlocked_at IS NULL'];
  const params: unknown[] = [];
  if (qs.employee_id) { params.push(qs.employee_id); wheres.push(`employee_id=$${params.length}`); }
  if (qs.week_from) { params.push(qs.week_from); wheres.push(`week_starting>=$${params.length}::date`); }
  if (qs.week_to) { params.push(qs.week_to); wheres.push(`week_starting<=$${params.length}::date`); }
  const { rows } = await db.query(
    `SELECT al.id, al.employee_id, al.week_starting, al.locked_at, al.lock_reason, e.first_name||' '||e.last_name AS employee_name, u.name AS locked_by_name FROM assignment_locks al JOIN employees e ON e.id=al.employee_id LEFT JOIN users u ON u.id=al.locked_by WHERE ${wheres.join(' AND ')} ORDER BY al.week_starting DESC LIMIT 500`,
    params,
  );
  return ok({ data: rows });
});

/* ── POST /api/rm/locks ── */
router.post('/api/rm/locks', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const { employee_id, week_starting, lock_reason } = body;
  if (!employee_id || !week_starting) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'employee_id y week_starting son requeridos' }) };
  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `INSERT INTO assignment_locks (employee_id, week_starting, locked_by, lock_reason) VALUES ($1,$2::date,$3,$4) ON CONFLICT (employee_id, week_starting) DO UPDATE SET unlocked_at=NULL, locked_by=$3, lock_reason=$4, locked_at=NOW() RETURNING id`,
      [employee_id, week_starting, user.id, lock_reason || 'manual_lock'],
    );
    await conn.query(`UPDATE assignments SET is_locked=true, updated_at=NOW() WHERE employee_id=$1 AND deleted_at IS NULL AND start_date<=($2::date+6) AND (end_date IS NULL OR end_date>=$2::date)`, [employee_id, week_starting]);
    await conn.query('COMMIT');
    return ok({ id: rows[0].id, locked: true });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

/* ── DELETE /api/rm/locks/:id ── */
router.delete('/api/rm/locks/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(`UPDATE assignment_locks SET unlocked_at=NOW(), unlocked_by=$1 WHERE id=$2 AND unlocked_at IS NULL RETURNING employee_id, week_starting`, [user.id, event.pathParameters!.id!]);
    if (!rows.length) { await conn.query('ROLLBACK'); return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Lock no encontrado o ya desbloqueado' }) }; }
    const { employee_id, week_starting } = rows[0];
    await conn.query(`UPDATE assignments SET is_locked=false, updated_at=NOW() WHERE employee_id=$1 AND deleted_at IS NULL AND start_date<=($2::date+6) AND (end_date IS NULL OR end_date>=$2::date) AND NOT EXISTS (SELECT 1 FROM assignment_locks al WHERE al.employee_id=assignments.employee_id AND al.unlocked_at IS NULL AND al.week_starting<=COALESCE(assignments.end_date,'9999-12-31'::date) AND (al.week_starting+6)>=assignments.start_date)`, [employee_id, week_starting]);
    await conn.query(`INSERT INTO audit_log (user_id, action, details) VALUES ($1,'assignment_unlock',$2)`, [user.id, JSON.stringify({ lock_id: event.pathParameters!.id!, employee_id, week_starting, reason: body.reason })]);
    await conn.query('COMMIT');
    return ok({ unlocked: true });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

/* ── GET /api/rm/actual-hours/export (CSV fallback — exceljs not available) ── */
router.get('/api/rm/actual-hours/export', async (event, user) => {
  requireAdmin(user);
  const qs = (event.queryStringParameters || {}) as Record<string, string | undefined>;
  const { week_from, week_to, area_id, contract_id } = qs;
  if (!week_from || !week_to) return error(400, { error: 'week_from y week_to son requeridos' });
  const diffDays = (new Date(week_to).getTime() - new Date(week_from).getTime()) / 86400000;
  if (diffDays > 92) return error(400, { error: 'Máximo 90 días por exportación' });

  const wheres = ['te.deleted_at IS NULL', 'te.work_date>=$1::date', 'te.work_date<=$2::date'];
  const params: unknown[] = [week_from, week_to];
  if (area_id) { params.push(area_id); wheres.push(`e.area_id=$${params.length}`); }
  if (contract_id) { params.push(contract_id); wheres.push(`a.contract_id=$${params.length}`); }

  const { rows } = await db.query(
    `SELECT e.first_name||' '||e.last_name AS employee_name, e.level AS employee_level, ar.name AS employee_area, te.work_date, date_trunc('week',te.work_date)::date AS week_starting, c.name AS contract_name, cl.name AS client_name, te.hours AS actual_hours, te.status AS entry_status, te.description FROM time_entries te JOIN employees e ON e.id=te.employee_id LEFT JOIN areas ar ON ar.id=e.area_id JOIN assignments a ON a.id=te.assignment_id LEFT JOIN contracts c ON c.id=a.contract_id LEFT JOIN clients cl ON cl.id=c.client_id WHERE ${wheres.join(' AND ')} ORDER BY e.last_name, e.first_name, te.work_date`,
    params,
  );

  const cols = ['employee_name','employee_level','employee_area','work_date','week_starting','contract_name','client_name','actual_hours','entry_status','description'] as const;
  const esc = (v: unknown) => { const s = v == null ? '' : String(v).slice(0, 10); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...(rows as any[]).map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');

  return { statusCode: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="horas_reales_${week_from}_${week_to}.csv"`, 'Access-Control-Allow-Origin': '*' }, body: csv };
});

/* ── GET /api/rm/deviations/weekly ── */
router.get('/api/rm/deviations/weekly', async (event, user) => {
  const qs = (event.queryStringParameters || {}) as Record<string, string | undefined>;
  const { week_from, week_to, area_id, contract_id, min_variance_pct } = qs;
  const group_by = qs.group_by || 'person';
  if (!week_from || !week_to) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'week_from y week_to son requeridos' }) };

  const isAdmin = ['superadmin', 'admin', 'director', 'lead'].includes(user.role);
  const wheres = ['a.deleted_at IS NULL', "a.status IN ('planned','active')"];
  const params: unknown[] = [week_from, week_to];

  if (!isAdmin) {
    const { rows: empRows } = await db.query('SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL LIMIT 1', [user.id]);
    if (!empRows.length) return ok({ summary: {}, weeks: [], rows: [] });
    params.push(empRows[0].id);
    wheres.push(`a.employee_id=$${params.length}`);
  }
  if (area_id) { params.push(area_id); wheres.push(`e.area_id=$${params.length}`); }
  if (contract_id) { params.push(contract_id); wheres.push(`a.contract_id=$${params.length}`); }

  const weeks = weeksBetween(toMonday(week_from)!, toMonday(week_to)!);

  if (group_by === 'project') {
    const { rows } = await db.query(
      `SELECT a.contract_id, c.name AS contract_name, cl.name AS client_name, date_trunc('week',d.day)::date AS week_starting, SUM(a.weekly_hours) AS planned_hours, COALESCE(SUM(te.actual),0) AS actual_hours FROM assignments a JOIN contracts c ON c.id=a.contract_id LEFT JOIN clients cl ON cl.id=c.client_id JOIN employees e ON e.id=a.employee_id CROSS JOIN generate_series($1::date,$2::date,'7 days'::interval) AS d(day) LEFT JOIN (SELECT assignment_id,date_trunc('week',work_date)::date AS w,SUM(hours) AS actual FROM time_entries WHERE deleted_at IS NULL GROUP BY assignment_id,date_trunc('week',work_date)::date) te ON te.assignment_id=a.id AND te.w=date_trunc('week',d.day)::date WHERE ${wheres.join(' AND ')} AND a.start_date<=(d.day+6) AND (a.end_date IS NULL OR a.end_date>=d.day) GROUP BY a.contract_id,c.name,cl.name,date_trunc('week',d.day)::date ORDER BY c.name,week_starting`,
      params,
    );
    const grouped: Record<string, any> = {};
    (rows as any[]).forEach(r => {
      if (!grouped[r.contract_id]) grouped[r.contract_id] = { contract_id: r.contract_id, contract_name: r.contract_name, client_name: r.client_name, weeks: {}, totals: { planned: 0, actual: 0 } };
      const p = Number(r.planned_hours); const a = Number(r.actual_hours); const v = a - p;
      grouped[r.contract_id].weeks[r.week_starting] = { planned_hours: p, actual_hours: a, variance_hours: v, variance_pct: p ? Number(((v/p)*100).toFixed(1)) : null };
      grouped[r.contract_id].totals.planned += p; grouped[r.contract_id].totals.actual += a;
    });
    const resultRows = Object.values(grouped).map((g: any) => {
      const v = g.totals.actual - g.totals.planned;
      g.totals.variance = v; g.totals.variance_pct = g.totals.planned ? Number(((v/g.totals.planned)*100).toFixed(1)) : null;
      return g;
    });
    const filtered = min_variance_pct ? resultRows.filter((r: any) => r.totals.variance_pct !== null && Math.abs(r.totals.variance_pct) >= Number(min_variance_pct)) : resultRows;
    return ok({ weeks, rows: filtered });
  }

  const { rows } = await db.query(
    `SELECT e.id AS employee_id, e.first_name||' '||e.last_name AS employee_name, e.level, ar.name AS area_name, date_trunc('week',d.day)::date AS week_starting, SUM(a.weekly_hours) AS planned_hours, COALESCE(te_sum.actual,0) AS actual_hours FROM assignments a JOIN employees e ON e.id=a.employee_id LEFT JOIN areas ar ON ar.id=e.area_id CROSS JOIN generate_series($1::date,$2::date,'7 days'::interval) AS d(day) LEFT JOIN (SELECT te.employee_id,date_trunc('week',te.work_date)::date AS w,SUM(te.hours) AS actual FROM time_entries te WHERE te.deleted_at IS NULL GROUP BY te.employee_id,date_trunc('week',te.work_date)::date) te_sum ON te_sum.employee_id=e.id AND te_sum.w=date_trunc('week',d.day)::date WHERE ${wheres.join(' AND ')} AND a.start_date<=(d.day+6) AND (a.end_date IS NULL OR a.end_date>=d.day) GROUP BY e.id,e.first_name,e.last_name,e.level,ar.name,date_trunc('week',d.day)::date ORDER BY e.last_name,e.first_name,week_starting`,
    params,
  );
  const grouped: Record<string, any> = {};
  (rows as any[]).forEach(r => {
    if (!grouped[r.employee_id]) grouped[r.employee_id] = { employee_id: r.employee_id, employee_name: r.employee_name, level: r.level, area_name: r.area_name, weeks: {}, totals: { planned: 0, actual: 0 } };
    const p = Number(r.planned_hours); const a = Number(r.actual_hours); const v = a - p;
    grouped[r.employee_id].weeks[r.week_starting] = { planned_hours: p, actual_hours: a, variance_hours: v, variance_pct: p ? Number(((v/p)*100).toFixed(1)) : null };
    grouped[r.employee_id].totals.planned += p; grouped[r.employee_id].totals.actual += a;
  });
  const resultRows = Object.values(grouped).map((g: any) => {
    const v = g.totals.actual - g.totals.planned;
    g.totals.variance = v; g.totals.variance_pct = g.totals.planned ? Number(((v/g.totals.planned)*100).toFixed(1)) : null;
    return g;
  });
  const summary: any = {
    total_planned_hours: resultRows.reduce((s: number, r: any) => s + r.totals.planned, 0),
    total_actual_hours: resultRows.reduce((s: number, r: any) => s + r.totals.actual, 0),
    employees_over_plan: resultRows.filter((r: any) => (r.totals.variance_pct || 0) > 5).length,
    employees_under_plan: resultRows.filter((r: any) => (r.totals.variance_pct || 0) < -5).length,
    employees_on_plan: resultRows.filter((r: any) => Math.abs(r.totals.variance_pct || 0) <= 5).length,
  };
  summary.total_variance_hours = summary.total_actual_hours - summary.total_planned_hours;
  summary.total_variance_pct = summary.total_planned_hours ? Number(((summary.total_variance_hours/summary.total_planned_hours)*100).toFixed(1)) : 0;
  const filtered = min_variance_pct ? resultRows.filter((r: any) => r.totals.variance_pct !== null && Math.abs(r.totals.variance_pct) >= Number(min_variance_pct)) : resultRows;
  return ok({ summary, weeks, rows: filtered });
});

/* ── GET /api/rm/contracts/active ── */
router.get('/api/rm/contracts/active', async (_event, _user) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, cl.name AS client_name, c.start_date, c.end_date FROM contracts c LEFT JOIN clients cl ON cl.id=c.client_id WHERE c.status IN ('planned','active') AND c.deleted_at IS NULL ORDER BY cl.name, c.name`,
  );
  return ok({ data: rows });
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
