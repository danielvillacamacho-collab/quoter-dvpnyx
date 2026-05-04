/**
 * Contacts CRUD + opportunity_contacts bridge.
 *
 * Scope ownership:
 *   - Any authenticated user (member+) may create/edit contacts and read the list.
 *   - Only admin+ can soft-delete.
 *   - Sub-resource: opportunity_contacts links contacts to opportunities with a deal_role.
 *
 * All mutations emit a structured event via server/utils/events.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { parsePagination } = require('../utils/sanitize');
const { parseSort } = require('../utils/sort');
const { serverError } = require('../utils/http');

const SORTABLE = {
  first_name:    'co.first_name',
  last_name:     'co.last_name',
  email_primary: 'co.email_primary',
  job_title:     'co.job_title',
  seniority:     'co.seniority',
  client_name:   '(SELECT cl.name FROM clients cl WHERE cl.id=co.client_id)',
  created_at:    'co.created_at',
};

router.use(auth);

const VALID_SENIORITIES = [
  'c_level', 'vp', 'director', 'manager', 'senior', 'mid', 'junior', 'intern',
];
const VALID_DEAL_ROLES = [
  'economic_buyer', 'champion', 'coach', 'decision_maker', 'influencer',
  'technical_evaluator', 'procurement', 'legal', 'detractor', 'blocker',
];
const EDITABLE_FIELDS = [
  'first_name', 'last_name', 'job_title', 'email_primary',
  'phone_mobile', 'seniority', 'notes', 'client_id',
];

function sanitizeSeniority(val) {
  if (val === null || val === undefined || val === '') return null;
  return VALID_SENIORITIES.includes(val) ? val : undefined;
}

/* -------- BY CLIENT (before /:id) -------- */
router.get('/by-client/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT co.*, cl.name AS client_name
         FROM contacts co
         JOIN clients cl ON cl.id = co.client_id
        WHERE co.client_id = $1 AND co.deleted_at IS NULL
        ORDER BY co.last_name ASC, co.first_name ASC
        LIMIT 200`,
      [req.params.clientId],
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /contacts/by-client/:clientId', err); }
});

/* -------- BY OPPORTUNITY (before /:id) -------- */
router.get('/by-opportunity/:opportunityId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT co.*, oc.id AS link_id, oc.deal_role, oc.notes AS link_notes,
              cl.name AS client_name
         FROM opportunity_contacts oc
         JOIN contacts co ON co.id = oc.contact_id
         JOIN clients  cl ON cl.id = co.client_id
        WHERE oc.opportunity_id = $1 AND co.deleted_at IS NULL
        ORDER BY co.last_name ASC, co.first_name ASC`,
      [req.params.opportunityId],
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /contacts/by-opportunity/:opportunityId', err); }
});

/* -------- LINK CONTACT <-> OPPORTUNITY (upsert) -------- */
router.post('/opportunity-link', async (req, res) => {
  const { opportunity_id, contact_id, deal_role, notes } = req.body || {};
  if (!opportunity_id || !contact_id || !deal_role) {
    return res.status(400).json({ error: 'opportunity_id, contact_id y deal_role son requeridos' });
  }
  if (!VALID_DEAL_ROLES.includes(deal_role)) {
    return res.status(400).json({ error: 'deal_role inválido' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO opportunity_contacts (opportunity_id, contact_id, deal_role, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (opportunity_id, contact_id)
       DO UPDATE SET deal_role = EXCLUDED.deal_role, notes = EXCLUDED.notes
       RETURNING *`,
      [opportunity_id, contact_id, deal_role, notes || null],
    );
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, 'POST /contacts/opportunity-link', err); }
});

/* -------- UNLINK CONTACT <-> OPPORTUNITY -------- */
router.delete('/opportunity-link/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM opportunity_contacts WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Vínculo no encontrado' });
    res.json({ message: 'Vínculo eliminado' });
  } catch (err) { serverError(res, 'DELETE /contacts/opportunity-link/:id', err); }
});

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const wheres = ['co.deleted_at IS NULL'];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

    if (req.query.search) {
      wheres.push(`(LOWER(co.first_name) LIKE LOWER(${add('%' + req.query.search + '%')}) OR LOWER(co.last_name) LIKE LOWER(${add('%' + req.query.search + '%')}) OR LOWER(co.email_primary) LIKE LOWER(${add('%' + req.query.search + '%')}))`);
    }
    if (req.query.client_id) wheres.push(`co.client_id = ${add(req.query.client_id)}`);
    if (req.query.seniority) wheres.push(`co.seniority = ${add(req.query.seniority)}`);

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const sort = parseSort(req.query, SORTABLE, {
      defaultField: 'last_name', defaultDir: 'asc', tieBreaker: 'co.id ASC',
    });
    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM contacts co ${where}`, filterParams),
      pool.query(
        `SELECT co.*, cl.name AS client_name
           FROM contacts co
           JOIN clients cl ON cl.id = co.client_id
           ${where}
           ORDER BY ${sort.orderBy}
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...filterParams, limit, offset],
      ),
    ]);
    const total = countRes.rows[0].total;
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /contacts failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT co.*, cl.name AS client_name
         FROM contacts co
         JOIN clients cl ON cl.id = co.client_id
        WHERE co.id = $1 AND co.deleted_at IS NULL`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Contacto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /contacts/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- CREATE -------- */
router.post('/', async (req, res) => {
  const { first_name, last_name, client_id, job_title, email_primary, phone_mobile, seniority, notes } = req.body || {};
  if (!first_name || !first_name.trim()) return res.status(400).json({ error: 'first_name es requerido' });
  if (!last_name || !last_name.trim()) return res.status(400).json({ error: 'last_name es requerido' });
  if (!client_id) return res.status(400).json({ error: 'client_id es requerido' });

  const cleanSeniority = sanitizeSeniority(seniority);
  if (cleanSeniority === undefined) return res.status(400).json({ error: 'Seniority inválido' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (first_name, last_name, client_id, job_title, email_primary, phone_mobile, seniority, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        first_name.trim(),
        last_name.trim(),
        client_id,
        job_title || null,
        email_primary || null,
        phone_mobile || null,
        cleanSeniority,
        notes || null,
        req.user.id,
      ],
    );
    const contact = rows[0];
    await emitEvent(pool, {
      event_type: 'contact.created',
      entity_type: 'contact',
      entity_id: contact.id,
      actor_user_id: req.user.id,
      payload: { first_name: contact.first_name, last_name: contact.last_name, client_id: contact.client_id },
      req,
    });
    res.status(201).json(contact);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /contacts failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- UPDATE -------- */
router.put('/:id', async (req, res) => {
  try {
    const { rows: [before] } = await pool.query(
      `SELECT * FROM contacts WHERE id=$1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!before) return res.status(404).json({ error: 'Contacto no encontrado' });

    const body = req.body || {};
    const seniorityClean = sanitizeSeniority(body.seniority);
    if (body.seniority !== undefined && seniorityClean === undefined) {
      return res.status(400).json({ error: 'Seniority inválido' });
    }
    if (body.first_name !== undefined && !String(body.first_name).trim()) {
      return res.status(400).json({ error: 'first_name no puede estar vacío' });
    }
    if (body.last_name !== undefined && !String(body.last_name).trim()) {
      return res.status(400).json({ error: 'last_name no puede estar vacío' });
    }

    const { rows } = await pool.query(
      `UPDATE contacts SET
          first_name    = COALESCE($1, first_name),
          last_name     = COALESCE($2, last_name),
          job_title     = COALESCE($3, job_title),
          email_primary = COALESCE($4, email_primary),
          phone_mobile  = COALESCE($5, phone_mobile),
          seniority     = COALESCE($6, seniority),
          notes         = COALESCE($7, notes),
          client_id     = COALESCE($8, client_id),
          updated_at    = NOW()
        WHERE id=$9 AND deleted_at IS NULL
        RETURNING *`,
      [
        body.first_name ? String(body.first_name).trim() : null,
        body.last_name ? String(body.last_name).trim() : null,
        body.job_title ?? null,
        body.email_primary ?? null,
        body.phone_mobile ?? null,
        seniorityClean ?? null,
        body.notes ?? null,
        body.client_id ?? null,
        req.params.id,
      ],
    );
    const after = rows[0];
    await emitEvent(pool, {
      event_type: 'contact.updated',
      entity_type: 'contact',
      entity_id: after.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, after, EDITABLE_FIELDS),
      req,
    });
    res.json(after);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /contacts/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- SOFT DELETE (admin+) -------- */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Contacto no encontrado' });
    await emitEvent(pool, {
      event_type: 'contact.deleted',
      entity_type: 'contact',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { first_name: rows[0].first_name, last_name: rows[0].last_name },
      req,
    });
    res.json({ message: 'Contacto eliminado' });
  } catch (err) { serverError(res, 'DELETE /contacts/:id', err); }
});

module.exports = router;
