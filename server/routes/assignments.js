/**
 * Assignments — Sprint 4 Modules EN-1, EN-2, EN-5.
 * Spec: docs/specs/v2/04_modules/04_contracts_requests_assignments.md
 *       docs/specs/v2/09_user_stories_backlog.md EN-1 / EN-2 / EN-5
 *
 * An Assignment is a person committed to a contract for some weekly
 * hours over a date range. Every assignment ties three entities:
 *   employee  → who is doing the work
 *   contract  → who pays for the work
 *   resource_request → why the work exists (fulfills a request)
 *
 * ### Key business rules (EN-2 overbooking)
 *
 * When creating or updating an assignment the server sums the
 * employee's ACTIVE + PLANNED overlapping assignments' weekly_hours and
 * adds the proposed value. If the total exceeds
 * `employee.weekly_capacity_hours * 1.10` the request is REJECTED with
 * 409 unless the caller sent `force: true` (admin override). The
 * override is logged via an `assignment.overbooked` event so it shows
 * up in audit/reporting.
 *
 * ### EN-5 — Delete
 *
 * Hard delete is permitted ONLY when no time_entries reference the
 * assignment. Otherwise the record soft-deletes AND flips status to
 * cancelled — the time entries stay intact for history/billing.
 *
 * Reads: any authenticated user. Mutations: admin+.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');

router.use(auth);

const VALID_STATUSES = ['planned', 'active', 'ended', 'cancelled'];
const OVERBOOK_FACTOR = 1.10;

const EDITABLE_FIELDS = [
  'weekly_hours', 'start_date', 'end_date', 'role_title', 'notes',
  'approval_required',
];

/**
 * Compute overlap-aware weekly hours for the employee. Returns the
 * sum of weekly_hours over all of their non-terminal assignments whose
 * date window overlaps [start, end), excluding the assignment being
 * created/edited (if ignoreAssignmentId is provided).
 */
async function sumOverlappingHours(conn, employeeId, start, end, ignoreAssignmentId = null) {
  // Treat missing end_date as +infinity on either side.
  const effectiveEnd = end || '9999-12-31';
  const params = [employeeId, start, effectiveEnd];
  let ignoreClause = '';
  if (ignoreAssignmentId) {
    params.push(ignoreAssignmentId);
    ignoreClause = `AND id<>$${params.length}`;
  }
  const { rows } = await conn.query(
    `SELECT COALESCE(SUM(weekly_hours), 0) AS total
       FROM assignments
      WHERE employee_id=$1
        AND deleted_at IS NULL
        AND status IN ('planned','active')
        AND start_date <= $3::date
        AND (end_date IS NULL OR end_date >= $2::date)
        ${ignoreClause}`,
    params
  );
  return Number(rows[0].total || 0);
}

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const offset = (page - 1) * limit;

    const wheres = ['a.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.employee_id)         wheres.push(`a.employee_id = ${add(req.query.employee_id)}`);
    if (req.query.contract_id)         wheres.push(`a.contract_id = ${add(req.query.contract_id)}`);
    if (req.query.resource_request_id) wheres.push(`a.resource_request_id = ${add(req.query.resource_request_id)}`);
    if (req.query.status)              wheres.push(`a.status = ${add(req.query.status)}`);

    const where = `WHERE ${wheres.join(' AND ')}`;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM assignments a ${where}`, params),
      pool.query(
        `SELECT a.*,
           e.first_name AS employee_first_name, e.last_name AS employee_last_name,
           c.name AS contract_name,
           rr.role_title AS request_role_title
           FROM assignments a
           LEFT JOIN employees         e  ON e.id = a.employee_id
           LEFT JOIN contracts         c  ON c.id = a.contract_id
           LEFT JOIN resource_requests rr ON rr.id = a.resource_request_id
           ${where}
           ORDER BY a.start_date DESC
           LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
    ]);
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total: countRes.rows[0].total, pages: Math.ceil(countRes.rows[0].total / limit) || 1 },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /assignments failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*,
         e.first_name AS employee_first_name, e.last_name AS employee_last_name,
         e.weekly_capacity_hours AS employee_capacity,
         c.name AS contract_name, c.client_id AS contract_client_id,
         rr.role_title AS request_role_title,
         (SELECT COUNT(*)::int FROM time_entries WHERE assignment_id=a.id) AS time_entries_count
         FROM assignments a
         LEFT JOIN employees         e  ON e.id = a.employee_id
         LEFT JOIN contracts         c  ON c.id = a.contract_id
         LEFT JOIN resource_requests rr ON rr.id = a.resource_request_id
        WHERE a.id=$1 AND a.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Asignación no encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

/* -------- CREATE (admin+) — EN-1 + EN-2 -------- */
router.post('/', adminOnly, async (req, res) => {
  const body = req.body || {};
  const {
    resource_request_id, employee_id, contract_id, weekly_hours,
    start_date, end_date, role_title, notes, force,
  } = body;

  if (!resource_request_id) return res.status(400).json({ error: 'resource_request_id es requerido' });
  if (!employee_id) return res.status(400).json({ error: 'employee_id es requerido' });
  if (!contract_id) return res.status(400).json({ error: 'contract_id es requerido' });
  if (weekly_hours == null) return res.status(400).json({ error: 'weekly_hours es requerido' });
  const wh = Number(weekly_hours);
  if (!Number.isFinite(wh) || wh <= 0 || wh > 80) return res.status(400).json({ error: 'weekly_hours debe estar entre 0 y 80' });
  if (!start_date) return res.status(400).json({ error: 'start_date es requerido' });
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: 'status inválido' });
  }

  const conn = await pool.connect();
  try {
    // Referential + state checks
    const { rows: rrRows } = await conn.query(
      `SELECT id, contract_id, status FROM resource_requests WHERE id=$1 AND deleted_at IS NULL`,
      [resource_request_id]
    );
    if (!rrRows.length) { conn.release(); return res.status(400).json({ error: 'resource_request no existe' }); }
    if (rrRows[0].status === 'cancelled') { conn.release(); return res.status(400).json({ error: 'La solicitud está cancelada' }); }
    if (rrRows[0].contract_id !== contract_id) {
      conn.release();
      return res.status(409).json({ error: 'La solicitud no pertenece al contrato indicado' });
    }

    const { rows: cRows } = await conn.query(
      `SELECT id, status FROM contracts WHERE id=$1 AND deleted_at IS NULL`, [contract_id]
    );
    if (!cRows.length) { conn.release(); return res.status(400).json({ error: 'contract no existe' }); }
    if (['completed', 'cancelled'].includes(cRows[0].status)) {
      conn.release();
      return res.status(400).json({ error: `No se puede asignar a un contrato ${cRows[0].status}` });
    }

    const { rows: eRows } = await conn.query(
      `SELECT id, weekly_capacity_hours, status, first_name, last_name FROM employees WHERE id=$1 AND deleted_at IS NULL`,
      [employee_id]
    );
    if (!eRows.length) { conn.release(); return res.status(400).json({ error: 'employee no existe' }); }
    const emp = eRows[0];
    // Warnings (non-blocking per spec) surfaced via response.warnings.
    const warnings = [];
    if (emp.status === 'on_leave')   warnings.push(`El empleado está en "on_leave".`);
    if (emp.status === 'terminated') {
      conn.release();
      return res.status(400).json({ error: 'El empleado está terminado y no puede recibir asignaciones nuevas.' });
    }
    if (emp.status === 'bench') warnings.push(`El empleado está en "bench" — priorízalo si buscas ocupación.`);

    // EN-2 overbooking
    const existing = await sumOverlappingHours(conn, employee_id, start_date, end_date || null);
    const proposed = existing + wh;
    const capacity = Number(emp.weekly_capacity_hours || 40);
    const threshold = capacity * OVERBOOK_FACTOR;
    const overbooked = proposed > threshold;

    if (overbooked && !force) {
      conn.release();
      return res.status(409).json({
        error: `Overbooking: ${emp.first_name} ${emp.last_name} quedaría en ${proposed.toFixed(2)}h/semana (capacidad ${capacity}h × 1.10 = ${threshold.toFixed(2)}h). Usa force=true para sobrescribir.`,
        employee_capacity: capacity,
        threshold,
        existing_weekly_hours: existing,
        proposed_weekly_hours: proposed,
      });
    }

    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `INSERT INTO assignments
         (resource_request_id, employee_id, contract_id, weekly_hours,
          start_date, end_date, status, role_title, notes,
          approval_required, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'planned'),$8,$9,COALESCE($10,false),$11)
        RETURNING *`,
      [
        resource_request_id, employee_id, contract_id, wh,
        start_date, end_date || null, body.status || null,
        role_title || null, notes || null,
        body.approval_required != null ? !!body.approval_required : null,
        req.user.id,
      ]
    );
    const asg = rows[0];

    await emitEvent(conn, {
      event_type: 'assignment.created', entity_type: 'assignment', entity_id: asg.id,
      actor_user_id: req.user.id,
      payload: {
        employee_id, contract_id, resource_request_id,
        weekly_hours: wh, start_date, end_date: end_date || null,
        status: asg.status, warnings,
      },
      req,
    });
    if (overbooked && force) {
      await emitEvent(conn, {
        event_type: 'assignment.overbooked', entity_type: 'assignment', entity_id: asg.id,
        actor_user_id: req.user.id,
        payload: { employee_capacity: capacity, threshold, proposed_weekly_hours: proposed },
        req,
      });
    }

    await conn.query('COMMIT');
    res.status(201).json({ ...asg, warnings, overbooked });
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('POST /assignments failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

/* -------- UPDATE (admin+) -------- */
router.put('/:id', adminOnly, async (req, res) => {
  const conn = await pool.connect();
  try {
    const { rows: [before] } = await conn.query(
      `SELECT * FROM assignments WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!before) { conn.release(); return res.status(404).json({ error: 'Asignación no encontrada' }); }

    const body = req.body || {};
    if (body.weekly_hours != null) {
      const wh = Number(body.weekly_hours);
      if (!Number.isFinite(wh) || wh <= 0 || wh > 80) { conn.release(); return res.status(400).json({ error: 'weekly_hours debe estar entre 0 y 80' }); }
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      conn.release();
      return res.status(400).json({ error: 'status inválido' });
    }

    // EN-2 re-check if hours or window changed
    const nextHours = body.weekly_hours != null ? Number(body.weekly_hours) : Number(before.weekly_hours);
    const nextStart = body.start_date || before.start_date;
    const nextEnd   = body.end_date !== undefined ? body.end_date : before.end_date;
    const hoursOrWindowChanged = (
      body.weekly_hours != null && Number(body.weekly_hours) !== Number(before.weekly_hours)
    ) || body.start_date || body.end_date !== undefined;

    if (hoursOrWindowChanged) {
      const { rows: eRows } = await conn.query(
        `SELECT weekly_capacity_hours, first_name, last_name FROM employees WHERE id=$1`,
        [before.employee_id]
      );
      const capacity = Number(eRows[0]?.weekly_capacity_hours || 40);
      const existing = await sumOverlappingHours(conn, before.employee_id, nextStart, nextEnd, before.id);
      const proposed = existing + nextHours;
      const threshold = capacity * OVERBOOK_FACTOR;
      if (proposed > threshold && !body.force) {
        conn.release();
        return res.status(409).json({
          error: `Overbooking: el empleado quedaría en ${proposed.toFixed(2)}h/semana (umbral ${threshold.toFixed(2)}h). Usa force=true para sobrescribir.`,
          employee_capacity: capacity, threshold,
          existing_weekly_hours: existing,
          proposed_weekly_hours: proposed,
        });
      }
    }

    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `UPDATE assignments SET
          weekly_hours      = COALESCE($1, weekly_hours),
          start_date        = COALESCE($2, start_date),
          end_date          = COALESCE($3, end_date),
          status            = COALESCE($4, status),
          role_title        = COALESCE($5, role_title),
          notes             = COALESCE($6, notes),
          approval_required = COALESCE($7, approval_required),
          updated_at        = NOW()
        WHERE id=$8 AND deleted_at IS NULL
        RETURNING *`,
      [
        body.weekly_hours != null ? Number(body.weekly_hours) : null,
        body.start_date ?? null,
        body.end_date ?? null,
        body.status ?? null,
        body.role_title ?? null,
        body.notes ?? null,
        body.approval_required != null ? !!body.approval_required : null,
        req.params.id,
      ]
    );
    const after = rows[0];
    await emitEvent(conn, {
      event_type: 'assignment.updated', entity_type: 'assignment', entity_id: after.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, after, EDITABLE_FIELDS),
      req,
    });
    await conn.query('COMMIT');
    res.json(after);
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('PUT /assignments/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

/* -------- DELETE (admin+) — EN-5
 * Hard delete only when the assignment has no time_entries. Otherwise
 * soft-delete + mark as cancelled to keep the history intact.
 */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: te } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM time_entries WHERE assignment_id=$1`,
      [req.params.id]
    );
    if (te[0].count === 0) {
      const { rows } = await pool.query(
        `DELETE FROM assignments WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Asignación no encontrada' });
      await emitEvent(pool, {
        event_type: 'assignment.hard_deleted', entity_type: 'assignment', entity_id: rows[0].id,
        actor_user_id: req.user.id, payload: {}, req,
      });
      return res.json({ message: 'Asignación eliminada (hard delete, sin time entries)', mode: 'hard' });
    }
    // Has time_entries → soft delete + cancel
    const { rows } = await pool.query(
      `UPDATE assignments SET deleted_at=NOW(), status='cancelled', updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Asignación no encontrada' });
    await emitEvent(pool, {
      event_type: 'assignment.soft_deleted', entity_type: 'assignment', entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { preserved_time_entries: te[0].count },
      req,
    });
    res.json({
      message: `Asignación cancelada (soft delete, ${te[0].count} time entries preservados)`,
      mode: 'soft',
      preserved_time_entries: te[0].count,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('DELETE /assignments/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
