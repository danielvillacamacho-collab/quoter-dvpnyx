/**
 * Activities CRUD — Commercial interaction log.
 *
 * Activities track calls, emails, meetings, demos, etc. linked to
 * opportunities, clients, and/or contacts.
 *
 * Scope ownership:
 *   - Any authenticated user can create activities and read the list.
 *   - Only the creator or admin can update/soft-delete.
 *
 * All mutations emit a structured event via server/utils/events.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent } = require('../utils/events');
const { parsePagination } = require('../utils/sanitize');
const { parseSort } = require('../utils/sort');
const { serverError } = require('../utils/http');

const VALID_TYPES = [
  'call', 'email', 'meeting', 'note',
  'proposal_sent', 'demo', 'follow_up', 'other',
];

const SORTABLE = {
  activity_date: 'a.activity_date',
  subject:       'a.subject',
  activity_type: 'a.activity_type',
  created_at:    'a.created_at',
  user_name:     '(SELECT name FROM users WHERE id = a.user_id)',
};

const JOIN_FRAGMENT = `
  LEFT JOIN users    u  ON u.id  = a.user_id
  LEFT JOIN opportunities o ON o.id = a.opportunity_id
  LEFT JOIN clients  cl ON cl.id = a.client_id
  LEFT JOIN contacts ct ON ct.id = a.contact_id`;

const SELECT_FIELDS = `
  a.*,
  u.name  AS user_name,
  o.name  AS opportunity_name,
  cl.name AS client_name,
  ct.first_name || ' ' || ct.last_name AS contact_name`;

router.use(auth);

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const wheres = ['a.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.opportunity_id) wheres.push(`a.opportunity_id = ${add(req.query.opportunity_id)}`);
    if (req.query.client_id)      wheres.push(`a.client_id = ${add(req.query.client_id)}`);
    if (req.query.contact_id)     wheres.push(`a.contact_id = ${add(req.query.contact_id)}`);
    if (req.query.activity_type)  wheres.push(`a.activity_type = ${add(req.query.activity_type)}`);
    if (req.query.user_id)        wheres.push(`a.user_id = ${add(req.query.user_id)}`);

    const where = 'WHERE ' + wheres.join(' AND ');
    const sort = parseSort(req.query, SORTABLE, {
      defaultField: 'activity_date', defaultDir: 'desc', tieBreaker: 'a.id ASC',
    });
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM activities a ${where}`, params),
      pool.query(
        `SELECT ${SELECT_FIELDS}
           FROM activities a
           ${JOIN_FRAGMENT}
           ${where}
           ORDER BY ${sort.orderBy}
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, limit, offset],
      ),
    ]);
    const total = countRes.rows[0].total;
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) { serverError(res, 'GET /activities', err); }
});

/* -------- BY OPPORTUNITY -------- */
router.get('/by-opportunity/:opportunityId', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = 'WHERE a.deleted_at IS NULL AND a.opportunity_id = $1';
    const sort = parseSort(req.query, SORTABLE, {
      defaultField: 'activity_date', defaultDir: 'desc', tieBreaker: 'a.id ASC',
    });

    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM activities a ${where}`, [req.params.opportunityId]),
      pool.query(
        `SELECT ${SELECT_FIELDS}
           FROM activities a
           ${JOIN_FRAGMENT}
           ${where}
           ORDER BY ${sort.orderBy}
           LIMIT $2 OFFSET $3`,
        [req.params.opportunityId, limit, offset],
      ),
    ]);
    const total = countRes.rows[0].total;
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) { serverError(res, 'GET /activities/by-opportunity', err); }
});

/* -------- BY CLIENT (direct + via opportunities) -------- */
router.get('/by-client/:clientId', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = `WHERE a.deleted_at IS NULL
      AND (a.client_id = $1 OR a.opportunity_id IN (
        SELECT id FROM opportunities WHERE client_id = $1 AND deleted_at IS NULL
      ))`;
    const sort = parseSort(req.query, SORTABLE, {
      defaultField: 'activity_date', defaultDir: 'desc', tieBreaker: 'a.id ASC',
    });

    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM activities a ${where}`, [req.params.clientId]),
      pool.query(
        `SELECT ${SELECT_FIELDS}
           FROM activities a
           ${JOIN_FRAGMENT}
           ${where}
           ORDER BY ${sort.orderBy}
           LIMIT $2 OFFSET $3`,
        [req.params.clientId, limit, offset],
      ),
    ]);
    const total = countRes.rows[0].total;
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) { serverError(res, 'GET /activities/by-client', err); }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_FIELDS}
         FROM activities a
         ${JOIN_FRAGMENT}
       WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Actividad no encontrada' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /activities/:id', err); }
});

/* -------- CREATE -------- */
router.post('/', async (req, res) => {
  const {
    opportunity_id, client_id, contact_id,
    activity_type, subject, notes, activity_date,
  } = req.body || {};

  if (!subject || !String(subject).trim()) {
    return res.status(400).json({ error: 'El asunto (subject) es requerido' });
  }
  if (!activity_type || !VALID_TYPES.includes(activity_type)) {
    return res.status(400).json({ error: `Tipo inválido. Valores permitidos: ${VALID_TYPES.join(', ')}` });
  }

  const warnings = [];
  if (!opportunity_id && !client_id) {
    warnings.push('Se recomienda vincular la actividad a un cliente o una oportunidad');
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO activities
         (opportunity_id, client_id, contact_id, user_id,
          activity_type, subject, notes, activity_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,NOW()))
       RETURNING *`,
      [
        opportunity_id || null,
        client_id || null,
        contact_id || null,
        req.user.id,
        activity_type,
        String(subject).trim(),
        notes || null,
        activity_date || null,
      ],
    );
    const activity = rows[0];

    /* Update last_activity_at on the related client */
    let resolvedClientId = client_id || null;
    if (!resolvedClientId && opportunity_id) {
      const { rows: oppRows } = await pool.query(
        `SELECT client_id FROM opportunities WHERE id = $1`,
        [opportunity_id],
      );
      if (oppRows.length) resolvedClientId = oppRows[0].client_id;
    }
    if (resolvedClientId) {
      await pool.query(
        `UPDATE clients SET last_activity_at = NOW() WHERE id = $1`,
        [resolvedClientId],
      );
    }

    await emitEvent(pool, {
      event_type: 'activity.created',
      entity_type: 'activity',
      entity_id: activity.id,
      actor_user_id: req.user.id,
      payload: { subject: activity.subject, activity_type: activity.activity_type },
      req,
    });

    const response = { ...activity };
    if (warnings.length) response._warnings = warnings;
    res.status(201).json(response);
  } catch (err) { serverError(res, 'POST /activities', err); }
});

/* -------- UPDATE -------- */
router.put('/:id', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM activities WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: 'Actividad no encontrada' });
    if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el creador o un admin puede editar esta actividad' });
    }

    const body = req.body || {};
    if (body.activity_type && !VALID_TYPES.includes(body.activity_type)) {
      return res.status(400).json({ error: `Tipo inválido. Valores permitidos: ${VALID_TYPES.join(', ')}` });
    }
    if (body.subject !== undefined && !String(body.subject).trim()) {
      return res.status(400).json({ error: 'El asunto no puede estar vacío' });
    }

    const { rows } = await pool.query(
      `UPDATE activities SET
          opportunity_id = COALESCE($1, opportunity_id),
          client_id      = COALESCE($2, client_id),
          contact_id     = COALESCE($3, contact_id),
          activity_type  = COALESCE($4, activity_type),
          subject        = COALESCE($5, subject),
          notes          = COALESCE($6, notes),
          activity_date  = COALESCE($7, activity_date)
        WHERE id = $8 AND deleted_at IS NULL
        RETURNING *`,
      [
        body.opportunity_id ?? null,
        body.client_id ?? null,
        body.contact_id ?? null,
        body.activity_type ?? null,
        body.subject ? String(body.subject).trim() : null,
        body.notes ?? null,
        body.activity_date ?? null,
        req.params.id,
      ],
    );
    await emitEvent(pool, {
      event_type: 'activity.updated',
      entity_type: 'activity',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { subject: rows[0].subject, activity_type: rows[0].activity_type },
      req,
    });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'PUT /activities/:id', err); }
});

/* -------- SOFT DELETE -------- */
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM activities WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: 'Actividad no encontrada' });
    if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el creador o un admin puede eliminar esta actividad' });
    }

    await pool.query(
      `UPDATE activities SET deleted_at = NOW() WHERE id = $1`,
      [req.params.id],
    );
    await emitEvent(pool, {
      event_type: 'activity.deleted',
      entity_type: 'activity',
      entity_id: existing.id,
      actor_user_id: req.user.id,
      payload: { subject: existing.subject, activity_type: existing.activity_type },
      req,
    });
    res.json({ message: 'Actividad eliminada' });
  } catch (err) { serverError(res, 'DELETE /activities/:id', err); }
});

module.exports = router;
