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
const { notify, notifyMany } = require('../utils/notifications');
const { runAllChecks } = require('../utils/assignment_validation');
const { stringifyCsv } = require('../utils/csv');
const { parsePagination, isValidISODate } = require('../utils/sanitize');
const { serverError, safeRollback } = require('../utils/http');

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

/* -------- FILTER HELPERS — SPEC-007 --------
 *
 * buildAssignmentFilters(query) → { wheres, params, error }
 *
 * Single source of truth for WHERE-clause construction shared by the
 * paginated list and the CSV export. Both routes apply the same set of
 * filters so any addition here automatically lands in both.
 *
 * Employee filter (Spec 1):
 *   ?employee_id=<uuid>              single (backward-compat)
 *   ?employee_ids=<uuid>,<uuid>,...  multi (OR logic)
 *   Both params can be present simultaneously; the Set deduplicates.
 *
 * Date-range filter (Spec 2 — intersection logic):
 *   ?date_from=YYYY-MM-DD  → assignments that end on/after this date
 *   ?date_to=YYYY-MM-DD    → assignments that start on/before this date
 *   Together they match any assignment whose window intersects the range.
 *   Open assignments (end_date IS NULL) are treated as ongoing forever.
 */
function buildEmployeeIds(query) {
  const ids = new Set();
  if (query.employee_id) ids.add(String(query.employee_id).trim());
  if (query.employee_ids) {
    String(query.employee_ids)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => ids.add(id));
  }
  return [...ids];
}

function buildAssignmentFilters(query) {
  const wheres = ['a.deleted_at IS NULL'];
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if (query.contract_id)         wheres.push(`a.contract_id = ${add(query.contract_id)}`);
  if (query.resource_request_id) wheres.push(`a.resource_request_id = ${add(query.resource_request_id)}`);
  if (query.status)              wheres.push(`a.status = ${add(query.status)}`);

  const empIds = buildEmployeeIds(query);
  if (empIds.length === 1) {
    wheres.push(`a.employee_id = ${add(empIds[0])}`);
  } else if (empIds.length > 1) {
    wheres.push(`a.employee_id IN (${empIds.map((id) => add(id)).join(', ')})`);
  }

  if (query.date_from) {
    if (!isValidISODate(query.date_from)) {
      return { wheres, params, error: 'date_from debe ser una fecha válida (YYYY-MM-DD)' };
    }
    // Open assignments (end_date IS NULL) are always included when date_from
    // is provided — they are treated as ongoing with no end.
    wheres.push(`(a.end_date IS NULL OR a.end_date >= ${add(query.date_from)}::date)`);
  }

  if (query.date_to) {
    if (!isValidISODate(query.date_to)) {
      return { wheres, params, error: 'date_to debe ser una fecha válida (YYYY-MM-DD)' };
    }
    wheres.push(`a.start_date <= ${add(query.date_to)}::date`);
  }

  return { wheres, params, error: null };
}

/* -------- VALIDATE (read-only pre-check) — US-BK-2 --------
 *
 * Dry-runs the validation engine for a proposed assignment of
 * `employee_id` to `request_id`. Does not create anything; purely
 * informational so the UI modal (US-VAL-4) can render the checklist
 * BEFORE the user commits.
 *
 * Query params:
 *   employee_id   UUID (required)
 *   request_id    UUID (required)        — resource_request
 *   weekly_hours  number (optional, defaults to request.weekly_hours)
 *   start_date    YYYY-MM-DD (optional, defaults to request.start_date)
 *   end_date      YYYY-MM-DD (optional, defaults to request.end_date)
 *   ignore_assignment_id  UUID (optional) — exclude this assignment
 *                         from the committed-hours sum (useful when
 *                         editing an existing assignment).
 *
 * Response:
 *   { valid, can_override, requires_justification,
 *     checks: [{ check, status, message, detail?, overridable? }],
 *     summary: { pass, warn, info, fail, ... },
 *     context: { employee, request, proposed }  // what we evaluated
 *   }
 */
router.get('/validate', async (req, res) => {
  const {
    employee_id, request_id, weekly_hours,
    start_date, end_date, ignore_assignment_id,
  } = req.query;

  if (!employee_id) return res.status(400).json({ error: 'employee_id es requerido' });
  if (!request_id)  return res.status(400).json({ error: 'request_id es requerido' });

  try {
    // Load employee (with area) and request (with area) in parallel
    const [eRes, rRes] = await Promise.all([
      pool.query(
        `SELECT e.id, e.first_name, e.last_name, e.level,
                e.weekly_capacity_hours, e.status,
                e.area_id, a.name AS area_name
           FROM employees e
           LEFT JOIN areas a ON a.id = e.area_id
          WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [employee_id],
      ),
      pool.query(
        `SELECT rr.id, rr.contract_id, rr.role_title, rr.level,
                rr.weekly_hours, rr.start_date, rr.end_date, rr.status,
                rr.area_id, a.name AS area_name
           FROM resource_requests rr
           LEFT JOIN areas a ON a.id = rr.area_id
          WHERE rr.id = $1 AND rr.deleted_at IS NULL`,
        [request_id],
      ),
    ]);

    if (!eRes.rows.length) return res.status(404).json({ error: 'employee no encontrado' });
    if (!rRes.rows.length) return res.status(404).json({ error: 'resource_request no encontrado' });

    const employee = eRes.rows[0];
    const requestRow = rRes.rows[0];

    // Resolve proposed window (query overrides, falling back to request)
    const propStart = start_date || requestRow.start_date;
    const propEnd   = end_date   || requestRow.end_date;
    const propHours = weekly_hours != null ? Number(weekly_hours) : Number(requestRow.weekly_hours);

    // Committed hours = sum of overlapping non-terminal assignments.
    // Mirrors the logic in sumOverlappingHours() but is run only once.
    const committed = await sumOverlappingHours(
      pool, employee_id, propStart, propEnd || null,
      ignore_assignment_id || null,
    );

    const result = runAllChecks({
      employee: {
        area_id: employee.area_id,
        area_name: employee.area_name,
        level: employee.level,
        weekly_capacity_hours: employee.weekly_capacity_hours,
        committed_hours: committed,
      },
      request: {
        area_id: requestRow.area_id,
        area_name: requestRow.area_name,
        level: requestRow.level,
        start_date: requestRow.start_date,
        end_date: requestRow.end_date,
      },
      proposed: {
        weekly_hours: propHours,
        start_date: propStart,
        end_date: propEnd,
      },
    });

    // Surface employee status as an additional advisory warning so the
    // UI can render it alongside the structured checks (not part of the
    // engine because it's operational metadata, not a compatibility rule).
    const advisories = [];
    if (employee.status === 'on_leave')   advisories.push({ code: 'employee_on_leave',   message: 'El empleado está en "on_leave".' });
    if (employee.status === 'bench')      advisories.push({ code: 'employee_bench',      message: 'El empleado está en "bench" — priorízalo si buscas ocupación.' });
    if (employee.status === 'terminated') advisories.push({ code: 'employee_terminated', message: 'El empleado está terminado y no puede recibir asignaciones nuevas.' });
    if (requestRow.status === 'cancelled') advisories.push({ code: 'request_cancelled', message: 'La solicitud está cancelada.' });
    if (requestRow.status === 'filled')    advisories.push({ code: 'request_filled',    message: 'La solicitud ya está cubierta por otras asignaciones activas.' });

    res.json({
      ...result,
      advisories,
      context: {
        employee: {
          id: employee.id,
          name: `${employee.first_name} ${employee.last_name}`.trim(),
          level: employee.level,
          area_id: employee.area_id,
          area_name: employee.area_name,
          weekly_capacity_hours: Number(employee.weekly_capacity_hours),
          committed_hours: Number(committed),
          status: employee.status,
        },
        request: {
          id: requestRow.id,
          role_title: requestRow.role_title,
          level: requestRow.level,
          area_id: requestRow.area_id,
          area_name: requestRow.area_name,
          weekly_hours: Number(requestRow.weekly_hours),
          start_date: requestRow.start_date,
          end_date: requestRow.end_date,
          status: requestRow.status,
          contract_id: requestRow.contract_id,
        },
        proposed: {
          weekly_hours: propHours,
          start_date: propStart,
          end_date: propEnd || null,
        },
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /assignments/validate failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { wheres, params, error } = buildAssignmentFilters(req.query);
    if (error) return res.status(400).json({ error });

    const where = `WHERE ${wheres.join(' AND ')}`;
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
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
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, limit, offset]
      ),
    ]);
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total: countRes.rows[0].total, pages: Math.ceil(countRes.rows[0].total / limit) || 1 },
    });
  } catch (err) { serverError(res, 'GET /assignments', err); }
});

/* -------- EXPORT CSV --------
 *
 * Honors the SAME filter params as GET '/', but ignores pagination and
 * caps at EXPORT_LIMIT so a bad filter doesn't stream megabytes. The
 * ordering matches the list so what the user sees in the UI is what
 * they get in the file. Any authenticated user can export.
 */
const EXPORT_LIMIT = 10000;
router.get('/export.csv', async (req, res) => {
  try {
    const { wheres, params, error } = buildAssignmentFilters(req.query);
    if (error) return res.status(400).json({ error });

    const where = `WHERE ${wheres.join(' AND ')}`;
    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.weekly_hours, a.start_date, a.end_date, a.role_title, a.notes,
              a.created_at,
              (e.first_name || ' ' || e.last_name) AS employee_name,
              c.name AS contract_name,
              rr.role_title AS request_role_title
         FROM assignments a
         LEFT JOIN employees         e  ON e.id = a.employee_id
         LEFT JOIN contracts         c  ON c.id = a.contract_id
         LEFT JOIN resource_requests rr ON rr.id = a.resource_request_id
         ${where}
         ORDER BY a.start_date DESC
         LIMIT ${EXPORT_LIMIT}`,
      params
    );
    const csv = stringifyCsv(rows, [
      { key: 'id',                  header: 'ID' },
      { key: 'employee_name',       header: 'Empleado' },
      { key: 'contract_name',       header: 'Contrato' },
      { key: 'request_role_title',  header: 'Rol (solicitud)' },
      { key: 'role_title',          header: 'Rol (asignación)' },
      { key: 'status',              header: 'Estado' },
      { key: 'weekly_hours',        header: 'Horas/semana' },
      { key: 'start_date',          header: 'Inicio' },
      { key: 'end_date',            header: 'Fin' },
      { key: 'notes',               header: 'Notas' },
      { key: 'created_at',          header: 'Creada' },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="asignaciones.csv"');
    res.send(csv);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /assignments/export.csv failed:', err);
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
  } catch (err) { serverError(res, 'GET /assignments/:id', err); }
});

/* -------- CREATE (admin+) — EN-1 + EN-2 + US-VAL-4 --------
 *
 * Strict validation flow:
 *   1. Referential checks (request exists + belongs to contract, contract
 *      is not closed, employee exists + not terminated).
 *   2. Engine checks via runAllChecks (area/level/capacity/dates).
 *   3. If any non-overridable FAIL → 409 VALIDATION_FAILED (no bypass).
 *   4. If any overridable FAIL and no `override_reason` → 409 OVERRIDE_REQUIRED.
 *   5. Otherwise INSERT; persist override audit metadata when reason was provided.
 *
 * Backward compat:
 *   - Legacy body.force is accepted but ignored; override_reason is the
 *     only way to bypass an overridable fail. This is an intentional
 *     tightening coordinated with the UI modal (US-VAL-4).
 */
router.post('/', adminOnly, async (req, res) => {
  const body = req.body || {};
  const {
    resource_request_id, employee_id, contract_id, weekly_hours,
    start_date, end_date, role_title, notes, override_reason,
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
  const reasonTrimmed = typeof override_reason === 'string' ? override_reason.trim() : '';
  if (override_reason != null && reasonTrimmed.length < 10) {
    return res.status(400).json({ error: 'override_reason debe tener al menos 10 caracteres' });
  }

  const conn = await pool.connect();
  try {
    // --- Referential + state checks --------------------------------------
    const { rows: rrRows } = await conn.query(
      `SELECT rr.id, rr.contract_id, rr.status, rr.level, rr.weekly_hours,
              rr.start_date, rr.end_date, rr.area_id, a.name AS area_name
         FROM resource_requests rr
         LEFT JOIN areas a ON a.id = rr.area_id
        WHERE rr.id=$1 AND rr.deleted_at IS NULL`,
      [resource_request_id]
    );
    if (!rrRows.length) { conn.release(); return res.status(400).json({ error: 'resource_request no existe' }); }
    const rr = rrRows[0];
    if (rr.status === 'cancelled') { conn.release(); return res.status(400).json({ error: 'La solicitud está cancelada' }); }
    if (rr.contract_id !== contract_id) {
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
      `SELECT e.id, e.weekly_capacity_hours, e.status, e.first_name, e.last_name,
              e.level, e.area_id, a.name AS area_name
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
        WHERE e.id=$1 AND e.deleted_at IS NULL`,
      [employee_id]
    );
    if (!eRows.length) { conn.release(); return res.status(400).json({ error: 'employee no existe' }); }
    const emp = eRows[0];
    const warnings = [];
    if (emp.status === 'on_leave')   warnings.push(`El empleado está en "on_leave".`);
    if (emp.status === 'terminated') {
      conn.release();
      return res.status(400).json({ error: 'El empleado está terminado y no puede recibir asignaciones nuevas.' });
    }
    if (emp.status === 'bench') warnings.push(`El empleado está en "bench" — priorízalo si buscas ocupación.`);

    // --- Engine validation (US-BK-2 / US-VAL-4) --------------------------
    const committed = await sumOverlappingHours(conn, employee_id, start_date, end_date || null);
    const validation = runAllChecks({
      employee: {
        area_id: emp.area_id, area_name: emp.area_name,
        level: emp.level,
        weekly_capacity_hours: emp.weekly_capacity_hours,
        committed_hours: committed,
      },
      request: {
        area_id: rr.area_id, area_name: rr.area_name,
        level: rr.level,
        start_date: rr.start_date, end_date: rr.end_date,
      },
      proposed: {
        weekly_hours: wh,
        start_date, end_date: end_date || null,
      },
    });

    // Hard fails (inverted dates, no-overlap, etc.) — no bypass.
    if (!validation.valid && !validation.can_override) {
      conn.release();
      return res.status(409).json({
        error: 'No se puede crear la asignación: hay incompatibilidades no soslayables.',
        code: 'VALIDATION_FAILED',
        checks: validation.checks,
        summary: validation.summary,
      });
    }
    // Overridable fails require an explicit justification.
    if (validation.requires_justification && !reasonTrimmed) {
      conn.release();
      return res.status(409).json({
        error: 'Esta asignación tiene incompatibilidades. Proporciona override_reason para continuar.',
        code: 'OVERRIDE_REQUIRED',
        requires_justification: true,
        checks: validation.checks,
        summary: validation.summary,
      });
    }

    const isOverride = !validation.valid && reasonTrimmed.length > 0;

    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `INSERT INTO assignments
         (resource_request_id, employee_id, contract_id, weekly_hours,
          start_date, end_date, status, role_title, notes,
          approval_required, created_by,
          override_reason, override_checks, override_author_id, override_at)
        VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'planned'),$8,$9,COALESCE($10,false),$11,
                $12,$13,$14,$15)
        RETURNING *`,
      [
        resource_request_id, employee_id, contract_id, wh,
        start_date, end_date || null, body.status || null,
        role_title || null, notes || null,
        body.approval_required != null ? !!body.approval_required : null,
        req.user.id,
        isOverride ? reasonTrimmed : null,
        isOverride ? JSON.stringify({ checks: validation.checks, summary: validation.summary }) : null,
        isOverride ? req.user.id : null,
        isOverride ? new Date() : null,
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
        validation_summary: validation.summary,
      },
      req,
    });
    if (isOverride) {
      await emitEvent(conn, {
        event_type: 'assignment.overridden', entity_type: 'assignment', entity_id: asg.id,
        actor_user_id: req.user.id,
        payload: {
          reason: reasonTrimmed,
          checks: validation.checks,
          summary: validation.summary,
        },
        req,
      });
    }

    await conn.query('COMMIT');
    res.status(201).json({ ...asg, warnings, validation });

    // ---- Notifications (best-effort, AFTER commit) ----
    // INC-002: notify() and notifyMany() must run on the pool, NOT the
    // transaction client. If a notification INSERT throws (e.g. FK
    // violation because employees.user_id points to a user that no
    // longer exists), notify()'s internal try/catch swallows the JS
    // error — but Postgres has already marked the txn ABORTED, so the
    // subsequent COMMIT fails with "current transaction is aborted",
    // killing the whole assignment creation. Running these *after*
    // COMMIT against `pool` keeps notifications best-effort and
    // prevents the txn from being poisoned.
    try {
      const { rows: ctx } = await pool.query(
        `SELECT e.user_id AS employee_user_id,
                (e.first_name || ' ' || e.last_name) AS employee_name,
                k.name AS contract_name,
                k.delivery_manager_id,
                k.capacity_manager_id
           FROM employees e, contracts k
          WHERE e.id = $1 AND k.id = $2`,
        [employee_id, contract_id]
      );
      const c = ctx[0];
      if (c) {
        // The assignee — only notify if different from the actor.
        if (c.employee_user_id && c.employee_user_id !== req.user.id) {
          await notify(pool, {
            user_id: c.employee_user_id,
            type: 'assignment.created',
            title: 'Te asignaron a un proyecto',
            body: `${c.contract_name} — ${wh}h/sem desde ${start_date}`,
            link: '/assignments',
            entity_type: 'assignment',
            entity_id: asg.id,
          });
        }
        // On override, notify the contract's managers so they know an
        // override was exercised against a request under their remit.
        if (isOverride) {
          await notifyMany(
            pool,
            [c.delivery_manager_id, c.capacity_manager_id].filter((id) => id && id !== req.user.id),
            {
              type: 'assignment.overridden',
              title: 'Asignación creada con justificación',
              body: `${c.employee_name} → ${c.contract_name} (override registrado)`,
              link: '/assignments',
              entity_type: 'assignment',
              entity_id: asg.id,
            }
          );
        }
      }
    } catch (notifyErr) {
      // eslint-disable-next-line no-console
      console.error('notify producers failed (non-fatal):', notifyErr.message);
    }
  } catch (err) {
    await safeRollback(conn, 'transaction');
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
    await safeRollback(conn, 'transaction');
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
