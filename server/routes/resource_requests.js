/**
 * Resource Requests — Sprint 4 Module ER-1, ER-2.
 * Spec: docs/specs/v2/04_modules/04_contracts_requests_assignments.md
 *       docs/specs/v2/09_user_stories_backlog.md ER-1 / ER-2
 *
 * A Resource Request is the "need" side of the delivery equation:
 * "contract X needs 2 L3 developers from Colombia for 6 months". It
 * lives under a contract. Its status is computed from the active
 * assignments covering it:
 *
 *   open             = no active assignments yet
 *   partially_filled = 0 < active assignments < quantity
 *   filled           = active assignments >= quantity
 *   cancelled        = manually set (terminal)
 *
 * The stored `status` column is treated as authoritative only when it
 * is `cancelled`; otherwise the GET responses override it with the
 * computed value so the client always sees truth.
 *
 * Mutations are admin+. Reads are available to any authenticated user
 * because capacity dashboards and employee suggestions both consume
 * this data.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { parsePagination } = require('../utils/sanitize');
const { serverError } = require('../utils/http');
const { rankCandidates } = require('../utils/candidate_matcher');

router.use(auth);

const VALID_LEVELS = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];
const VALID_PRIORITIES = ['low','medium','high','critical'];

const EDITABLE_FIELDS = [
  'role_title', 'area_id', 'level', 'country', 'language_requirements',
  'required_skills', 'nice_to_have_skills', 'weekly_hours',
  'start_date', 'end_date', 'quantity', 'priority', 'notes',
];

/** Compute the live status of a single request given its row + active-assignment count. */
function computeStatus(stored, activeAssignments, quantity) {
  if (stored === 'cancelled') return 'cancelled';
  const q = Number(quantity || 1);
  const a = Number(activeAssignments || 0);
  if (a <= 0) return 'open';
  if (a < q) return 'partially_filled';
  return 'filled';
}

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const wheres = ['rr.deleted_at IS NULL'];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

    if (req.query.contract_id) wheres.push(`rr.contract_id = ${add(req.query.contract_id)}`);
    if (req.query.area_id)     wheres.push(`rr.area_id = ${add(req.query.area_id)}`);
    if (req.query.level)       wheres.push(`rr.level = ${add(req.query.level)}`);
    if (req.query.priority)    wheres.push(`rr.priority = ${add(req.query.priority)}`);
    if (req.query.status)      wheres.push(`rr.status = ${add(req.query.status)}`);
    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`LOWER(rr.role_title) LIKE LOWER(${add(like)})`);
    }

    const where = `WHERE ${wheres.join(' AND ')}`;
    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM resource_requests rr ${where}`, filterParams),
      pool.query(
        `SELECT rr.*,
           c.name AS contract_name,
           a.name AS area_name,
           (SELECT COUNT(*)::int FROM assignments WHERE resource_request_id=rr.id AND status='active' AND deleted_at IS NULL) AS active_assignments_count
           FROM resource_requests rr
           LEFT JOIN contracts c ON c.id = rr.contract_id
           LEFT JOIN areas     a ON a.id = rr.area_id
           ${where}
           ORDER BY
             CASE rr.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             rr.created_at DESC
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...filterParams, limit, offset]
      ),
    ]);
    const data = rowsRes.rows.map((r) => ({
      ...r,
      status: computeStatus(r.status, r.active_assignments_count, r.quantity),
      stored_status: r.status,
    }));
    res.json({
      data,
      pagination: { page, limit, total: countRes.rows[0].total, pages: Math.ceil(countRes.rows[0].total / limit) || 1 },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /resource-requests failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rr.*,
         c.name AS contract_name, c.client_id AS contract_client_id,
         cl.name AS client_name,
         a.name AS area_name,
         (SELECT COUNT(*)::int FROM assignments WHERE resource_request_id=rr.id AND status='active' AND deleted_at IS NULL) AS active_assignments_count,
         (SELECT COUNT(*)::int FROM assignments WHERE resource_request_id=rr.id AND deleted_at IS NULL) AS total_assignments_count
         FROM resource_requests rr
         LEFT JOIN contracts c  ON c.id = rr.contract_id
         LEFT JOIN clients  cl ON cl.id = c.client_id
         LEFT JOIN areas    a  ON a.id = rr.area_id
        WHERE rr.id=$1 AND rr.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const r = rows[0];
    res.json({
      ...r,
      status: computeStatus(r.status, r.active_assignments_count, r.quantity),
      stored_status: r.status,
    });
  } catch (err) { serverError(res, 'GET /resource-requests/:id', err); }
});

/* -------- CANDIDATES (US-RR-2) --------
 * GET /api/resource-requests/:id/candidates
 *
 * Returns a ranked list of employees that could fill this request, with
 * a composite score and structured match breakdown. Pure scoring lives
 * in server/utils/candidate_matcher.js; this handler just fans out 3
 * SELECTs (request, employees+skills, overlapping assignments) and hands
 * them to the matcher.
 *
 * Query params:
 *   • limit     — max candidates (default 25, clamped 1..100)
 *   • include_ineligible — "false" to hide score < 30 (default "true")
 *   • area_only — "true" to pre-filter employees by request.area_id
 */
router.get('/:id/candidates', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25));
    const includeIneligible = req.query.include_ineligible !== 'false';
    const areaOnly = req.query.area_only === 'true';

    // 1) Fetch the request (must not be cancelled/deleted).
    const rq = await pool.query(
      `SELECT rr.id, rr.contract_id, rr.role_title, rr.area_id, rr.level,
              rr.required_skills, rr.nice_to_have_skills,
              rr.weekly_hours, rr.start_date, rr.end_date,
              rr.status, a.name AS area_name
         FROM resource_requests rr
         LEFT JOIN areas a ON a.id = rr.area_id
         WHERE rr.id = $1 AND rr.deleted_at IS NULL`,
      [req.params.id],
    );
    if (!rq.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const request = rq.rows[0];

    // 2) Fetch candidate employees + their skill ids in one trip.
    //    We skip terminated rows in SQL; the matcher also skips them defensively.
    const empParams = [];
    const empWhere = [`e.deleted_at IS NULL`, `e.status <> 'terminated'`];
    if (areaOnly && request.area_id) {
      empParams.push(request.area_id);
      empWhere.push(`e.area_id = $${empParams.length}`);
    }
    const emp = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.area_id, e.status,
              e.weekly_capacity_hours, a.name AS area_name,
              COALESCE(
                (SELECT ARRAY_AGG(skill_id) FROM employee_skills es WHERE es.employee_id = e.id),
                ARRAY[]::int[]
              ) AS skill_ids
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         WHERE ${empWhere.join(' AND ')}
         ORDER BY e.first_name, e.last_name
         LIMIT 500`,
      empParams,
    );
    const employees = emp.rows.map((e) => ({
      ...e,
      full_name: `${e.first_name} ${e.last_name}`.trim(),
      skill_ids: Array.isArray(e.skill_ids) ? e.skill_ids : [],
    }));

    // 3) Overlapping, non-cancelled assignments during the request window.
    const asg = await pool.query(
      `SELECT employee_id, weekly_hours, start_date, end_date, status
         FROM assignments
         WHERE deleted_at IS NULL
           AND status <> 'cancelled'
           AND start_date <= $2::date
           AND (end_date IS NULL OR end_date >= $1::date)`,
      [request.start_date, request.end_date || '9999-12-31'],
    );

    const candidates = rankCandidates(request, employees, asg.rows, { limit, includeIneligible });

    // Attach skill-name lookups so the UI can render chips without another roundtrip.
    const skillIds = new Set();
    for (const c of candidates) {
      for (const id of c.match.required_skills.matched_ids || []) skillIds.add(id);
      for (const id of c.match.required_skills.missing_ids || []) skillIds.add(id);
      for (const id of c.match.nice_skills.matched_ids || [])     skillIds.add(id);
    }
    (request.required_skills || []).forEach((id) => skillIds.add(id));
    (request.nice_to_have_skills || []).forEach((id) => skillIds.add(id));
    let skillMap = {};
    if (skillIds.size > 0) {
      const sk = await pool.query(
        `SELECT id, name FROM skills WHERE id = ANY($1::int[])`,
        [Array.from(skillIds)],
      );
      skillMap = Object.fromEntries(sk.rows.map((r) => [r.id, r.name]));
    }

    res.json({
      request: {
        id: request.id,
        contract_id: request.contract_id,
        role_title: request.role_title,
        area_id: request.area_id,
        area_name: request.area_name,
        level: request.level,
        weekly_hours: Number(request.weekly_hours),
        start_date: request.start_date instanceof Date ? request.start_date.toISOString().slice(0, 10) : request.start_date,
        end_date: request.end_date instanceof Date ? request.end_date.toISOString().slice(0, 10) : (request.end_date || null),
        required_skills: request.required_skills || [],
        nice_to_have_skills: request.nice_to_have_skills || [],
      },
      candidates,
      skills_lookup: skillMap,
      meta: {
        employee_pool_size: employees.length,
        returned: candidates.length,
        area_only: areaOnly,
        include_ineligible: includeIneligible,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/resource-requests/:id/candidates failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- CREATE (admin+) -------- */
router.post('/', adminOnly, async (req, res) => {
  const body = req.body || {};
  const { contract_id, role_title, area_id, level, start_date } = body;
  if (!contract_id) return res.status(400).json({ error: 'contract_id es requerido' });
  if (!role_title || !String(role_title).trim()) return res.status(400).json({ error: 'role_title es requerido' });
  if (!area_id) return res.status(400).json({ error: 'area_id es requerido' });
  if (!level) return res.status(400).json({ error: 'level es requerido' });
  if (!VALID_LEVELS.includes(level)) return res.status(400).json({ error: 'level inválido' });
  if (!start_date) return res.status(400).json({ error: 'start_date es requerido' });
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
    return res.status(400).json({ error: 'priority inválida' });
  }

  try {
    // Referential check: contract must exist and be in an operable state
    const { rows: cRows } = await pool.query(
      `SELECT id, status FROM contracts WHERE id=$1 AND deleted_at IS NULL`, [contract_id]
    );
    if (!cRows.length) return res.status(400).json({ error: 'contract_id no existe' });
    if (['completed', 'cancelled'].includes(cRows[0].status)) {
      return res.status(400).json({ error: `No se puede agregar solicitud a un contrato ${cRows[0].status}` });
    }

    const { rows: aRows } = await pool.query(`SELECT id, active FROM areas WHERE id=$1`, [area_id]);
    if (!aRows.length) return res.status(400).json({ error: 'area_id no existe' });
    if (!aRows[0].active) return res.status(400).json({ error: 'El área está inactiva' });

    const { rows } = await pool.query(
      `INSERT INTO resource_requests
         (contract_id, role_title, area_id, level, country, language_requirements,
          required_skills, nice_to_have_skills, weekly_hours, start_date, end_date,
          quantity, priority, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        contract_id, String(role_title).trim(), area_id, level,
        body.country || null,
        body.language_requirements ? JSON.stringify(body.language_requirements) : null,
        body.required_skills || null,
        body.nice_to_have_skills || null,
        body.weekly_hours != null ? Number(body.weekly_hours) : 40,
        start_date, body.end_date || null,
        body.quantity != null ? Number(body.quantity) : 1,
        body.priority || 'medium',
        body.notes || null,
        req.user.id,
      ]
    );
    const rr = rows[0];
    await emitEvent(pool, {
      event_type: 'resource_request.created', entity_type: 'resource_request', entity_id: rr.id,
      actor_user_id: req.user.id,
      payload: { contract_id, role_title: rr.role_title, level: rr.level, quantity: rr.quantity, priority: rr.priority },
      req,
    });
    res.status(201).json(rr);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /resource-requests failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- UPDATE (admin+) -------- */
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: [before] } = await pool.query(
      `SELECT * FROM resource_requests WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!before) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const body = req.body || {};
    if (body.level && !VALID_LEVELS.includes(body.level)) {
      return res.status(400).json({ error: 'level inválido' });
    }
    if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
      return res.status(400).json({ error: 'priority inválida' });
    }
    if (body.role_title !== undefined && !String(body.role_title).trim()) {
      return res.status(400).json({ error: 'role_title no puede estar vacío' });
    }

    const { rows } = await pool.query(
      `UPDATE resource_requests SET
          role_title            = COALESCE($1, role_title),
          area_id               = COALESCE($2, area_id),
          level                 = COALESCE($3, level),
          country               = COALESCE($4, country),
          language_requirements = COALESCE($5::jsonb, language_requirements),
          required_skills       = COALESCE($6, required_skills),
          nice_to_have_skills   = COALESCE($7, nice_to_have_skills),
          weekly_hours          = COALESCE($8, weekly_hours),
          start_date            = COALESCE($9, start_date),
          end_date              = COALESCE($10, end_date),
          quantity              = COALESCE($11, quantity),
          priority              = COALESCE($12, priority),
          notes                 = COALESCE($13, notes),
          updated_at            = NOW()
        WHERE id=$14 AND deleted_at IS NULL
        RETURNING *`,
      [
        body.role_title ? String(body.role_title).trim() : null,
        body.area_id ?? null,
        body.level ?? null,
        body.country ?? null,
        body.language_requirements ? JSON.stringify(body.language_requirements) : null,
        body.required_skills ?? null,
        body.nice_to_have_skills ?? null,
        body.weekly_hours != null ? Number(body.weekly_hours) : null,
        body.start_date ?? null,
        body.end_date ?? null,
        body.quantity != null ? Number(body.quantity) : null,
        body.priority ?? null,
        body.notes ?? null,
        req.params.id,
      ]
    );
    const after = rows[0];
    await emitEvent(pool, {
      event_type: 'resource_request.updated', entity_type: 'resource_request', entity_id: after.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, after, EDITABLE_FIELDS),
      req,
    });
    res.json(after);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /resource-requests/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- CANCEL (admin+) -------- */
router.post('/:id/cancel', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE resource_requests SET status='cancelled', updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL AND status<>'cancelled' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Solicitud no encontrada o ya cancelada' });
    await emitEvent(pool, {
      event_type: 'resource_request.cancelled', entity_type: 'resource_request', entity_id: rows[0].id,
      actor_user_id: req.user.id, payload: { role_title: rows[0].role_title }, req,
    });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'POST /resource-requests/:id/cancel', err); }
});

/* -------- SOFT DELETE (admin+) -------- */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: deps } = await pool.query(
      `SELECT COUNT(*)::int AS active FROM assignments WHERE resource_request_id=$1 AND status='active' AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (deps[0].active > 0) {
      return res.status(409).json({
        error: `Solicitud con ${deps[0].active} asignación(es) activa(s). Cancélala antes de eliminar.`,
        active_assignments: deps[0].active,
      });
    }
    const { rows } = await pool.query(
      `UPDATE resource_requests SET deleted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    await emitEvent(pool, {
      event_type: 'resource_request.deleted', entity_type: 'resource_request', entity_id: rows[0].id,
      actor_user_id: req.user.id, payload: { role_title: rows[0].role_title }, req,
    });
    res.json({ message: 'Solicitud eliminada' });
  } catch (err) { serverError(res, 'DELETE /resource-requests/:id', err); }
});

module.exports = router;
