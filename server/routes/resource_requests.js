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
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const offset = (page - 1) * limit;

    const wheres = ['rr.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

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
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM resource_requests rr ${where}`, params),
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
           LIMIT ${limit} OFFSET ${offset}`,
        params
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
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
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
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
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
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
