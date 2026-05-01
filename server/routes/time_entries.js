/**
 * Time Entries — Sprint 5 Modules ET-1, ET-2, ET-3, ET-6, ET-7.
 * Spec: docs/specs/v2/04_modules/05_time_tracking.md
 *       docs/specs/v2/09_user_stories_backlog.md ET-*
 *
 * A TimeEntry is hours logged on a specific day against a specific
 * assignment. Core rules enforced server-side:
 *
 *   ET-2: CRUD + retroactive window (default 30 days) + daily ≤16h
 *         sum across an employee's entries on a single date.
 *   ET-3: POST /api/time-entries/copy-week duplicates entries from
 *         one week into the next.
 *   ET-6: edit gating — employee writes only to their own rows AND
 *         only within the window; admin can do anything.
 *   ET-7: work_date > TODAY → 400 (no future entries).
 *
 * All mutations emit structured events via server/utils/events.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { parsePagination } = require('../utils/sanitize');
const { parseSort } = require('../utils/sort');
const { serverError } = require('../utils/http');

const SORTABLE = {
  work_date:     'te.work_date',
  hours:         'te.hours',
  status:        'te.status',
  created_at:    'te.created_at',
  updated_at:    'te.updated_at',
  contract_name: 'c.name',
  role_title:    'a.role_title',
};

router.use(auth);

const VALID_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];
const DEFAULT_WINDOW_DAYS = 30;
const DAILY_MAX_HOURS = 16;
const EDITABLE_FIELDS = ['hours', 'description', 'work_date', 'assignment_id', 'status'];

/** Parse a YYYY-MM-DD date string into a local Date; null-safe. */
function asDate(s) { return s ? new Date(String(s) + 'T00:00:00') : null; }
function isoDay(d) { return d.toISOString().slice(0, 10); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

/**
 * Check whether the actor may write an entry for the given employee on
 * the given work_date.
 *   admin / superadmin: always OK
 *   employee themselves: OK iff entry_date is within the retroactive
 *                        window AND not in the future
 *   lead of that employee's squad: OK iff within window (leads also
 *     cannot log future). Squad-lead lookup via users.squad_id matches
 *     the employee's squad_id.
 *   everyone else: NOT OK
 */
async function authorizeWrite(conn, actor, entryEmployeeId, workDate) {
  if (actor.role === 'admin' || actor.role === 'superadmin') return { ok: true, bypass: true };

  const today = todayISO();
  if (workDate > today) return { ok: false, reason: 'future_entry' };

  // Window check
  const windowStart = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86400000);
  if (asDate(workDate) < windowStart) return { ok: false, reason: 'outside_window', window_days: DEFAULT_WINDOW_DAYS };

  // Identify the actor's employee row (via user_id) and their squad
  const { rows: actorRows } = await conn.query(
    `SELECT id AS employee_id, squad_id FROM employees WHERE user_id=$1 AND deleted_at IS NULL`,
    [actor.id]
  );
  const actorEmpId = actorRows[0]?.employee_id || null;
  const actorSquad = actorRows[0]?.squad_id || null;

  // Self-write
  if (actorEmpId && actorEmpId === entryEmployeeId) return { ok: true, reason: 'self' };

  // Lead of the target's squad? The spec uses the user's squad_id + a
  // function='capacity' or 'delivery' guard; we accept any non-admin
  // whose squad_id matches the target employee's squad. The capability
  // check lives in middleware/auth.js once roles expand; for now we
  // keep the squad match as the minimum rule.
  if (actor.function === 'capacity' || actor.function === 'delivery') {
    const { rows: targetRows } = await conn.query(
      `SELECT squad_id FROM employees WHERE id=$1 AND deleted_at IS NULL`,
      [entryEmployeeId]
    );
    const targetSquad = targetRows[0]?.squad_id;
    if (targetSquad && actorSquad && targetSquad === actorSquad) return { ok: true, reason: 'squad_lead' };
  }

  return { ok: false, reason: 'not_authorized' };
}

/** Sum hours for an employee on a given date, optionally excluding one entry (for updates). */
async function sumDailyHours(conn, employeeId, workDate, ignoreId = null) {
  const params = [employeeId, workDate];
  let ignoreClause = '';
  if (ignoreId) { params.push(ignoreId); ignoreClause = `AND id<>$${params.length}`; }
  const { rows } = await conn.query(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE employee_id=$1 AND work_date=$2 AND deleted_at IS NULL ${ignoreClause}`,
    params
  );
  return Number(rows[0].total || 0);
}

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 500 });

    const wheres = ['te.deleted_at IS NULL'];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

    if (req.query.employee_id)   wheres.push(`te.employee_id = ${add(req.query.employee_id)}`);
    if (req.query.assignment_id) wheres.push(`te.assignment_id = ${add(req.query.assignment_id)}`);
    if (req.query.status)        wheres.push(`te.status = ${add(req.query.status)}`);
    if (req.query.from)          wheres.push(`te.work_date >= ${add(req.query.from)}`);
    if (req.query.to)            wheres.push(`te.work_date <= ${add(req.query.to)}`);

    // If a non-admin caller omits employee_id, scope to their own entries.
    if (!['admin', 'superadmin'].includes(req.user.role) && !req.query.employee_id) {
      const { rows: me } = await pool.query(`SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL`, [req.user.id]);
      if (me.length) wheres.push(`te.employee_id = ${add(me[0].id)}`);
      else { res.json({ data: [], pagination: { page: 1, limit, total: 0, pages: 1 } }); return; }
    }

    const where = `WHERE ${wheres.join(' AND ')}`;
    const sort = parseSort(req.query, SORTABLE, {
      defaultField: 'work_date', defaultDir: 'desc', tieBreaker: 'te.created_at DESC',
    });
    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM time_entries te ${where}`, filterParams),
      pool.query(
        `SELECT te.*,
           a.role_title AS assignment_role_title, a.contract_id AS assignment_contract_id,
           c.name AS contract_name
           FROM time_entries te
           LEFT JOIN assignments a ON a.id = te.assignment_id
           LEFT JOIN contracts   c ON c.id = a.contract_id
           ${where}
           ORDER BY ${sort.orderBy}
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...filterParams, limit, offset]
      ),
    ]);
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total: countRes.rows[0].total, pages: Math.ceil(countRes.rows[0].total / limit) || 1 },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /time-entries failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- CREATE -------- */
router.post('/', async (req, res) => {
  const body = req.body || {};
  const { assignment_id, work_date, hours, description } = body;

  if (!assignment_id) return res.status(400).json({ error: 'assignment_id es requerido' });
  if (!work_date) return res.status(400).json({ error: 'work_date es requerido' });
  if (hours == null) return res.status(400).json({ error: 'hours es requerido' });
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 24) return res.status(400).json({ error: 'hours debe estar entre 0 y 24' });
  // ET-7
  if (work_date > todayISO()) return res.status(400).json({ error: 'No se pueden registrar horas futuras' });
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: 'status inválido' });
  }

  const conn = await pool.connect();
  try {
    const { rows: aRows } = await conn.query(
      `SELECT id, employee_id, start_date, end_date, status FROM assignments WHERE id=$1 AND deleted_at IS NULL`,
      [assignment_id]
    );
    if (!aRows.length) { conn.release(); return res.status(400).json({ error: 'assignment no existe' }); }
    const asg = aRows[0];
    if (['cancelled'].includes(asg.status)) {
      conn.release();
      return res.status(400).json({ error: 'No se pueden registrar horas en una asignación cancelada' });
    }
    // work_date within the assignment window
    if (work_date < String(asg.start_date).slice(0, 10) ||
        (asg.end_date && work_date > String(asg.end_date).slice(0, 10))) {
      conn.release();
      return res.status(400).json({ error: 'work_date fuera del rango de la asignación' });
    }

    // ET-6 authorization
    const auth = await authorizeWrite(conn, req.user, asg.employee_id, work_date);
    if (!auth.ok) {
      conn.release();
      const msg = auth.reason === 'future_entry' ? 'No se pueden registrar horas futuras'
                : auth.reason === 'outside_window' ? `Fuera de la ventana retroactiva de ${auth.window_days} días`
                : 'No tienes permiso para registrar horas de este empleado';
      return res.status(auth.reason === 'future_entry' ? 400 : 403).json({ error: msg, reason: auth.reason });
    }

    // ET-2: daily cap ≤ 16h across this employee's entries for that date
    const existingSum = await sumDailyHours(conn, asg.employee_id, work_date);
    if (existingSum + h > DAILY_MAX_HOURS) {
      conn.release();
      return res.status(409).json({
        error: `La suma diaria excedería ${DAILY_MAX_HOURS}h (actual ${existingSum}h + ${h}h propuestas).`,
        existing_hours: existingSum, proposed_hours: h, daily_max: DAILY_MAX_HOURS,
      });
    }

    const { rows } = await conn.query(
      `INSERT INTO time_entries (employee_id, assignment_id, work_date, hours, description, status, created_by)
        VALUES ($1,$2,$3,$4,$5,COALESCE($6,'submitted'),$7) RETURNING *`,
      [asg.employee_id, assignment_id, work_date, h, description || null, body.status || null, req.user.id]
    );
    const te = rows[0];
    await emitEvent(conn, {
      event_type: 'time_entry.created', entity_type: 'time_entry', entity_id: te.id,
      actor_user_id: req.user.id,
      payload: { employee_id: asg.employee_id, assignment_id, work_date, hours: h, status: te.status, by: auth.reason || 'admin' },
      req,
    });
    res.status(201).json(te);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /time-entries failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

/* -------- UPDATE -------- */
router.put('/:id', async (req, res) => {
  const conn = await pool.connect();
  try {
    const { rows: [before] } = await conn.query(
      `SELECT * FROM time_entries WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!before) { conn.release(); return res.status(404).json({ error: 'Time entry no encontrado' }); }

    const body = req.body || {};
    let nextHours = before.hours;
    let nextDate  = String(before.work_date).slice(0, 10);
    if (body.hours != null) {
      const h = Number(body.hours);
      if (!Number.isFinite(h) || h <= 0 || h > 24) { conn.release(); return res.status(400).json({ error: 'hours debe estar entre 0 y 24' }); }
      nextHours = h;
    }
    if (body.work_date) {
      if (body.work_date > todayISO()) { conn.release(); return res.status(400).json({ error: 'No se pueden registrar horas futuras' }); }
      nextDate = body.work_date;
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) { conn.release(); return res.status(400).json({ error: 'status inválido' }); }

    // ET-6 authorization checked against the NEW date (most restrictive)
    const auth = await authorizeWrite(conn, req.user, before.employee_id, nextDate);
    if (!auth.ok) {
      conn.release();
      return res.status(auth.reason === 'future_entry' ? 400 : 403).json({
        error: auth.reason === 'outside_window' ? `Fuera de la ventana retroactiva de ${auth.window_days} días` : 'No tienes permiso para editar este entry',
        reason: auth.reason,
      });
    }

    // ET-2 daily cap re-check
    if (body.hours != null || body.work_date) {
      const existingSum = await sumDailyHours(conn, before.employee_id, nextDate, before.id);
      if (existingSum + nextHours > DAILY_MAX_HOURS) {
        conn.release();
        return res.status(409).json({
          error: `La suma diaria excedería ${DAILY_MAX_HOURS}h`,
          existing_hours: existingSum, proposed_hours: nextHours, daily_max: DAILY_MAX_HOURS,
        });
      }
    }

    const { rows } = await conn.query(
      `UPDATE time_entries SET
          hours        = COALESCE($1, hours),
          description  = COALESCE($2, description),
          work_date    = COALESCE($3, work_date),
          status       = COALESCE($4, status),
          updated_at   = NOW()
        WHERE id=$5 AND deleted_at IS NULL RETURNING *`,
      [
        body.hours != null ? Number(body.hours) : null,
        body.description ?? null,
        body.work_date ?? null,
        body.status ?? null,
        req.params.id,
      ]
    );
    const after = rows[0];
    await emitEvent(conn, {
      event_type: 'time_entry.updated', entity_type: 'time_entry', entity_id: after.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, after, EDITABLE_FIELDS),
      req,
    });
    res.json(after);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /time-entries/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

/* -------- DELETE (soft) -------- */
router.delete('/:id', async (req, res) => {
  const conn = await pool.connect();
  try {
    const { rows: [before] } = await conn.query(
      `SELECT * FROM time_entries WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!before) { conn.release(); return res.status(404).json({ error: 'Time entry no encontrado' }); }

    const auth = await authorizeWrite(conn, req.user, before.employee_id, String(before.work_date).slice(0, 10));
    if (!auth.ok) {
      conn.release();
      return res.status(403).json({ error: 'No tienes permiso para borrar este entry', reason: auth.reason });
    }

    const { rows } = await conn.query(
      `UPDATE time_entries SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) { conn.release(); return res.status(404).json({ error: 'Time entry no encontrado' }); }
    await emitEvent(conn, {
      event_type: 'time_entry.deleted', entity_type: 'time_entry', entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { employee_id: rows[0].employee_id, work_date: rows[0].work_date, hours: rows[0].hours },
      req,
    });
    res.json({ message: 'Time entry eliminado' });
  } catch (err) { serverError(res, 'DELETE /time-entries/:id', err); }
  finally { conn.release(); }
});

/* -------- COPY WEEK (ET-3) --------
 * Copies entries from source_week_start (YYYY-MM-DD, must be a Monday)
 * into the following week (same weekday offsets). Skips entries whose
 * assignment is no longer active/planned. Uses the ET-2 daily cap and
 * ET-6 authorization for every candidate — any failure is reported as
 * a skipped row with a reason, the rest still write.
 */
router.post('/copy-week', async (req, res) => {
  const { employee_id, source_week_start } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'employee_id es requerido' });
  if (!source_week_start) return res.status(400).json({ error: 'source_week_start es requerido' });

  const conn = await pool.connect();
  try {
    // Pull source entries (whole week)
    const { rows: source } = await conn.query(
      `SELECT te.* FROM time_entries te
        WHERE te.employee_id=$1
          AND te.deleted_at IS NULL
          AND te.work_date >= $2::date
          AND te.work_date <  ($2::date + INTERVAL '7 days')
        ORDER BY te.work_date`,
      [employee_id, source_week_start]
    );
    if (!source.length) { conn.release(); return res.json({ copied: 0, skipped: [] }); }

    const created = [];
    const skipped = [];
    for (const e of source) {
      const newDate = new Date(asDate(String(e.work_date).slice(0, 10)).getTime() + 7 * 86400000);
      const newDateIso = isoDay(newDate);

      // Guard rails: future date, authorization, cap, valid assignment
      if (newDateIso > todayISO()) { skipped.push({ source_id: e.id, reason: 'future_entry', target_date: newDateIso }); continue; }

      const auth = await authorizeWrite(conn, req.user, e.employee_id, newDateIso);
      if (!auth.ok) { skipped.push({ source_id: e.id, reason: auth.reason, target_date: newDateIso }); continue; }

      const { rows: [asg] } = await conn.query(`SELECT status, start_date, end_date FROM assignments WHERE id=$1`, [e.assignment_id]);
      if (!asg || asg.status === 'cancelled') { skipped.push({ source_id: e.id, reason: 'assignment_cancelled' }); continue; }
      if (newDateIso < String(asg.start_date).slice(0, 10)) { skipped.push({ source_id: e.id, reason: 'before_assignment' }); continue; }
      if (asg.end_date && newDateIso > String(asg.end_date).slice(0, 10)) { skipped.push({ source_id: e.id, reason: 'after_assignment' }); continue; }

      const existingSum = await sumDailyHours(conn, employee_id, newDateIso);
      if (existingSum + Number(e.hours) > DAILY_MAX_HOURS) {
        skipped.push({ source_id: e.id, reason: 'daily_cap_exceeded', existing_hours: existingSum, proposed_hours: Number(e.hours) });
        continue;
      }

      const { rows } = await conn.query(
        `INSERT INTO time_entries (employee_id, assignment_id, work_date, hours, description, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'submitted',$6) RETURNING id`,
        [e.employee_id, e.assignment_id, newDateIso, e.hours, e.description || null, req.user.id]
      );
      created.push(rows[0].id);
    }

    await emitEvent(conn, {
      event_type: 'time_entry.copied_week', entity_type: 'employee', entity_id: employee_id,
      actor_user_id: req.user.id,
      payload: {
        source_week_start,
        target_week_start: isoDay(new Date(asDate(source_week_start).getTime() + 7 * 86400000)),
        copied: created.length, skipped: skipped.length,
      },
      req,
    });

    res.json({ copied: created.length, created, skipped });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /time-entries/copy-week failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

module.exports = router;
