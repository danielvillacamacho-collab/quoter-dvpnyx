import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createTimeEntryRepository } from './repository';
import { createTimeEntryService } from './service';
import { ENTRY_SORTABLE } from './types';
import type { TimeEntryFilters } from './types';

const db = getPool();
const entryRepo = createTimeEntryRepository(db);
const events = createEventEmitter();
const entryService = createTimeEntryService(entryRepo, events, db);

const router = createRouter();

// ─── Time Entries ───

router.get('/api/time-entries', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, ENTRY_SORTABLE, { defaultField: 'work_date', defaultDir: 'desc', tieBreaker: 'te.id ASC' });
  const filters: TimeEntryFilters = {
    employee_id: qs.employee_id,
    assignment_id: qs.assignment_id,
    date_from: qs.date_from,
    date_to: qs.date_to,
    status: qs.status,
  };
  return paginated(await entryService.list({ page, limit, offset, filters, sort }, user));
});

router.get('/api/time-entries/:id', async (event, user) => {
  return ok(await entryService.getById(event.pathParameters!.id!, user));
});

router.post('/api/time-entries', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await entryService.create(body, user));
});

router.post('/api/time-entries/copy-week', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await entryService.copyWeek(body, user));
});

router.put('/api/time-entries/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await entryService.update(event.pathParameters!.id!, body, user));
});

router.delete('/api/time-entries/:id', async (event, user) => {
  await entryService.softDelete(event.pathParameters!.id!, user);
  return ok({ message: 'Entrada de tiempo eliminada' });
});

// ─── Weekly Allocations ───

/** Returns YYYY-MM-DD of the Monday of the week containing dateStr */
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

router.get('/api/time-allocations', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const weekStart = String(qs.week_start || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'week_start inválido (YYYY-MM-DD)' }) };
  }
  const monday = mondayOf(weekStart);
  const sundayDate = new Date(monday + 'T00:00:00Z');
  sundayDate.setUTCDate(sundayDate.getUTCDate() + 6);
  const sunday = sundayDate.toISOString().slice(0, 10);

  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  const isLead  = user.role === 'lead';
  const requestedEmployeeId = qs.employee_id || null;

  // Resolve the employee to show
  let employee: { id: string; name: string } | null = null;
  if (requestedEmployeeId) {
    if (isAdmin) {
      const { rows } = await db.query(
        `SELECT id, (first_name || ' ' || last_name) AS name FROM employees WHERE id=$1 AND deleted_at IS NULL`,
        [requestedEmployeeId],
      );
      if (!rows.length) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Empleado no encontrado' }) };
      employee = rows[0];
    } else if (isLead) {
      const { rows } = await db.query(
        `SELECT id, (first_name || ' ' || last_name) AS name FROM employees
          WHERE id=$1 AND deleted_at IS NULL AND (user_id=$2 OR manager_user_id=$2)`,
        [requestedEmployeeId, user.id],
      );
      if (!rows.length) return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No puedes ver allocations de otro empleado' }) };
      employee = rows[0];
    } else {
      const { rows } = await db.query(
        `SELECT id, (first_name || ' ' || last_name) AS name FROM employees
          WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`,
        [requestedEmployeeId, user.id],
      );
      if (!rows.length) return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No puedes ver allocations de otro empleado' }) };
      employee = rows[0];
    }
  } else {
    // Derive from calling user
    const { rows } = await db.query(
      `SELECT id, (first_name || ' ' || last_name) AS name FROM employees WHERE user_id=$1 AND deleted_at IS NULL`,
      [user.id],
    );
    if (rows.length) {
      employee = rows[0];
    } else if (isAdmin || isLead) {
      // Admin/lead without an employee row → return picker
      const candidateRows = isAdmin
        ? (await db.query(
            `SELECT e.id, (e.first_name || ' ' || e.last_name) AS name, e.user_id, u.email
               FROM employees e LEFT JOIN users u ON u.id = e.user_id
              WHERE e.deleted_at IS NULL ORDER BY e.first_name, e.last_name LIMIT 500`,
          )).rows
        : (await db.query(
            `SELECT e.id, (e.first_name || ' ' || e.last_name) AS name, e.user_id, u.email
               FROM employees e LEFT JOIN users u ON u.id = e.user_id
              WHERE e.deleted_at IS NULL AND e.manager_user_id=$1
              ORDER BY e.first_name, e.last_name`,
            [user.id],
          )).rows;
      return ok({
        requires_employee_pick: true,
        available_employees: candidateRows,
        week_start_date: monday,
        message: isLead
          ? 'Eres líder de equipo. Selecciona uno de tus reportes directos para ver/editar su tiempo.'
          : 'Tu usuario no tiene un empleado vinculado. Selecciona uno para ver su tiempo.',
      });
    } else {
      return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Tu usuario no está vinculado a un empleado. Contacta a admin.', code: 'no_employee_for_user' }) };
    }
  }

  const emp = employee!;
  const [{ rows: activeAssignments }, { rows: allocations }] = await Promise.all([
    db.query(
      `SELECT a.id, a.employee_id, a.contract_id, a.role_title, a.weekly_hours,
              to_char(a.start_date, 'YYYY-MM-DD') AS start_date,
              to_char(a.end_date,   'YYYY-MM-DD') AS end_date,
              a.status,
              c.name AS contract_name, c.type AS contract_type, c.original_currency
         FROM assignments a
         LEFT JOIN contracts c ON c.id = a.contract_id
        WHERE a.employee_id=$1
          AND a.deleted_at IS NULL
          AND a.start_date <= $3::date
          AND (a.end_date IS NULL OR a.end_date >= $2::date)
          AND a.status IN ('planned','active')
        ORDER BY c.name ASC`,
      [emp.id, monday, sunday],
    ),
    db.query(
      `SELECT id, assignment_id, pct, notes, updated_at, updated_by
         FROM weekly_time_allocations
        WHERE employee_id=$1 AND week_start_date=$2
        ORDER BY updated_at DESC`,
      [emp.id, monday],
    ),
  ]);

  const totalPct = allocations.reduce((s: number, a: Record<string, unknown>) => s + Number(a.pct || 0), 0);
  return ok({
    week_start_date: monday,
    week_end_date: sunday,
    employee: emp,
    active_assignments: activeAssignments,
    allocations: allocations.map((a: Record<string, unknown>) => ({ ...a, pct: Number(a.pct) })),
    summary: { total_pct: totalPct, bench_pct: Math.max(0, 100 - totalPct) },
  });
});

router.put('/api/time-allocations/bulk', async (event, user) => {
  const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const weekStart = String(body.week_start_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'week_start_date inválido (YYYY-MM-DD)' }) };
  }
  const monday = mondayOf(weekStart);
  const allocations = Array.isArray(body.allocations) ? (body.allocations as Array<Record<string, unknown>>) : null;
  if (!allocations) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'allocations[] es requerido' }) };
  }
  for (const a of allocations) {
    const pct = Number(a.pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: `pct fuera de rango (0..100) para assignment ${a.assignment_id}` }) };
    }
  }
  const sumPct = allocations.reduce((s: number, a: Record<string, unknown>) => s + Number(a.pct || 0), 0);
  if (sumPct > 100.0001) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: `La suma de % es ${sumPct.toFixed(2)}%. No puede exceder 100%.`, code: 'pct_sum_exceeds_100', sum_pct: sumPct }) };
  }

  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  const isLead  = user.role === 'lead';
  const requestedEmployeeId = body.employee_id ? String(body.employee_id) : null;

  // Resolve employee same way as GET
  let employee: { id: string; name: string } | null = null;
  if (requestedEmployeeId) {
    if (isAdmin) {
      const { rows } = await db.query(`SELECT id, (first_name||' '||last_name) AS name FROM employees WHERE id=$1 AND deleted_at IS NULL`, [requestedEmployeeId]);
      if (!rows.length) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Empleado no encontrado' }) };
      employee = rows[0];
    } else if (isLead) {
      const { rows } = await db.query(`SELECT id, (first_name||' '||last_name) AS name FROM employees WHERE id=$1 AND deleted_at IS NULL AND (user_id=$2 OR manager_user_id=$2)`, [requestedEmployeeId, user.id]);
      if (!rows.length) return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No puedes editar allocations de otro empleado' }) };
      employee = rows[0];
    } else {
      const { rows } = await db.query(`SELECT id, (first_name||' '||last_name) AS name FROM employees WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, [requestedEmployeeId, user.id]);
      if (!rows.length) return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No puedes editar allocations de otro empleado' }) };
      employee = rows[0];
    }
  } else {
    const { rows } = await db.query(`SELECT id, (first_name||' '||last_name) AS name FROM employees WHERE user_id=$1 AND deleted_at IS NULL`, [user.id]);
    if (!rows.length) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Tu usuario no está vinculado a un empleado.' }) };
    employee = rows[0];
  }

  const emp2 = employee!;

  // Validate assignments belong to this employee
  if (allocations.length > 0) {
    const assignmentIds = allocations.map((a) => a.assignment_id);
    const { rows: validAsg } = await db.query(
      `SELECT id FROM assignments WHERE id = ANY($1::uuid[]) AND employee_id=$2 AND deleted_at IS NULL`,
      [assignmentIds, emp2.id],
    );
    if (validAsg.length !== assignmentIds.length) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Hay assignment_id inválidos o que no pertenecen a este empleado' }) };
    }
  }

  // DELETE + INSERT (atomic, matches monolith behavior)
  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    await conn.query(
      `DELETE FROM weekly_time_allocations WHERE employee_id=$1 AND week_start_date=$2`,
      [emp2.id, monday],
    );
    const inserted: Array<Record<string, unknown>> = [];
    for (const a of allocations) {
      const pct = Number(a.pct);
      if (pct === 0) continue;
      const { rows } = await conn.query(
        `INSERT INTO weekly_time_allocations
           (employee_id, week_start_date, assignment_id, pct, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4::numeric, $5, $6, $6)
         RETURNING id, assignment_id, pct, notes, updated_at, updated_by`,
        [emp2.id, monday, a.assignment_id, pct, a.notes || null, user.id],
      );
      inserted.push({ ...rows[0], pct: Number(rows[0].pct) });
    }
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1,'weekly_time_allocations_bulk_save','weekly_time_allocations',$2,
                 jsonb_build_object('employee_id',$3::uuid,'week_start_date',$4::date,
                                    'entries_count',$5::int,'sum_pct',$6::numeric))
       ON CONFLICT DO NOTHING`,
      [user.id, emp2.id, emp2.id, monday, inserted.length, sumPct],
    );
    await conn.query('COMMIT');
    const benchPct = Math.max(0, 100 - sumPct);
    return ok({
      week_start_date: monday,
      employee: emp2,
      allocations: inserted,
      summary: { total_pct: sumPct, bench_pct: benchPct },
      warnings: sumPct < 99.9999 ? [{ code: 'bench', message: `${benchPct.toFixed(0)}% de la semana queda en bench.` }] : [],
    });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
