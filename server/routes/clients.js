/**
 * Clients CRUD — Sprint 2 Module 1.
 * Spec: docs/specs/v2/04_modules/02_clients_opportunities.md (EC-*)
 *
 * Scope ownership:
 *   - Any authenticated user (member+) may create/edit clients and read the list.
 *   - Only admin+ can deactivate/soft-delete.
 *   - Hard delete is rejected if the client has opportunities or active contracts.
 *
 * All mutations emit a structured event via server/utils/events.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');

router.use(auth);

const VALID_TIERS = ['enterprise', 'mid_market', 'smb'];
const EDITABLE_FIELDS = [
  'name', 'legal_name', 'country', 'industry', 'tier',
  'preferred_currency', 'notes', 'tags', 'external_crm_id',
];

function sanitizeTier(tier) {
  if (tier === null || tier === undefined || tier === '') return null;
  return VALID_TIERS.includes(tier) ? tier : undefined;
}

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const offset = (page - 1) * limit;

    const wheres = ['deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.search)   wheres.push(`(LOWER(name) LIKE LOWER(${add('%' + req.query.search + '%')}) OR LOWER(legal_name) LIKE LOWER(${add('%' + req.query.search + '%')}))`);
    if (req.query.country)  wheres.push(`country = ${add(req.query.country)}`);
    if (req.query.industry) wheres.push(`industry = ${add(req.query.industry)}`);
    if (req.query.tier)     wheres.push(`tier = ${add(req.query.tier)}`);
    if (req.query.active !== undefined) {
      wheres.push(`active = ${add(req.query.active === 'true' || req.query.active === '1')}`);
    }

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM clients ${where}`, params),
      pool.query(
        `SELECT c.*,
           (SELECT COUNT(*)::int FROM opportunities o WHERE o.client_id=c.id AND o.deleted_at IS NULL) AS opportunities_count,
           (SELECT COUNT(*)::int FROM contracts ct WHERE ct.client_id=c.id AND ct.status='active' AND ct.deleted_at IS NULL) AS active_contracts_count
           FROM clients c
           ${where}
           ORDER BY c.name ASC
           LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
    ]);
    const total = countRes.rows[0].total;
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /clients failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
         (SELECT COUNT(*)::int FROM opportunities WHERE client_id=c.id AND deleted_at IS NULL) AS opportunities_count,
         (SELECT COUNT(*)::int FROM contracts    WHERE client_id=c.id AND status='active' AND deleted_at IS NULL) AS active_contracts_count
         FROM clients c
        WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /clients/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- CREATE -------- */
router.post('/', async (req, res) => {
  const { name, legal_name, country, industry, tier, preferred_currency, notes, tags, external_crm_id } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const cleanTier = sanitizeTier(tier);
  if (cleanTier === undefined) return res.status(400).json({ error: 'Tier inválido' });

  try {
    // 409 with hint if a client with that (case-insensitive) name already exists
    const dup = await pool.query(
      `SELECT id, name FROM clients WHERE LOWER(name)=LOWER($1) AND deleted_at IS NULL`,
      [name.trim()],
    );
    if (dup.rows.length) {
      return res.status(409).json({
        error: 'Ya existe un cliente con ese nombre',
        hint: dup.rows[0].name,
        existing_id: dup.rows[0].id,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO clients (name, legal_name, country, industry, tier, preferred_currency, notes, tags, external_crm_id, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'USD'),$7,$8,$9,$10)
       RETURNING *`,
      [
        name.trim(),
        legal_name || null,
        country || null,
        industry || null,
        cleanTier,
        preferred_currency || null,
        notes || null,
        tags || null,
        external_crm_id || null,
        req.user.id,
      ],
    );
    const client = rows[0];
    await emitEvent(pool, {
      event_type: 'client.created',
      entity_type: 'client',
      entity_id: client.id,
      actor_user_id: req.user.id,
      payload: { name: client.name, country: client.country, tier: client.tier },
      req,
    });
    res.status(201).json(client);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /clients failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- UPDATE -------- */
router.put('/:id', async (req, res) => {
  try {
    const { rows: [before] } = await pool.query(
      `SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!before) return res.status(404).json({ error: 'Cliente no encontrado' });

    const body = req.body || {};
    const tierClean = sanitizeTier(body.tier);
    if (body.tier !== undefined && tierClean === undefined) {
      return res.status(400).json({ error: 'Tier inválido' });
    }
    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    }
    if (body.name && String(body.name).trim().toLowerCase() !== before.name.toLowerCase()) {
      const dup = await pool.query(
        `SELECT id FROM clients WHERE LOWER(name)=LOWER($1) AND deleted_at IS NULL AND id<>$2`,
        [String(body.name).trim(), req.params.id],
      );
      if (dup.rows.length) return res.status(409).json({ error: 'Ya existe un cliente con ese nombre' });
    }

    const { rows } = await pool.query(
      `UPDATE clients SET
          name               = COALESCE($1, name),
          legal_name         = COALESCE($2, legal_name),
          country            = COALESCE($3, country),
          industry           = COALESCE($4, industry),
          tier               = COALESCE($5, tier),
          preferred_currency = COALESCE($6, preferred_currency),
          notes              = COALESCE($7, notes),
          tags               = COALESCE($8, tags),
          external_crm_id    = COALESCE($9, external_crm_id),
          updated_at         = NOW()
        WHERE id=$10 AND deleted_at IS NULL
        RETURNING *`,
      [
        body.name ? String(body.name).trim() : null,
        body.legal_name ?? null,
        body.country ?? null,
        body.industry ?? null,
        tierClean ?? null,
        body.preferred_currency ?? null,
        body.notes ?? null,
        body.tags ?? null,
        body.external_crm_id ?? null,
        req.params.id,
      ],
    );
    const after = rows[0];
    await emitEvent(pool, {
      event_type: 'client.updated',
      entity_type: 'client',
      entity_id: after.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, after, EDITABLE_FIELDS),
      req,
    });
    res.json(after);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /clients/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- DEACTIVATE / ACTIVATE (admin+) -------- */
router.post('/:id/deactivate', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE clients SET active=false, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    await emitEvent(pool, {
      event_type: 'client.deactivated',
      entity_type: 'client',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { name: rows[0].name },
      req,
    });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

router.post('/:id/activate', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE clients SET active=true, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    await emitEvent(pool, {
      event_type: 'client.activated',
      entity_type: 'client',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { name: rows[0].name },
      req,
    });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

/* -------- SOFT DELETE (admin+) -------- */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: deps } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM opportunities WHERE client_id=$1 AND deleted_at IS NULL) AS opps,
         (SELECT COUNT(*)::int FROM contracts    WHERE client_id=$1 AND deleted_at IS NULL) AS ctrs`,
      [req.params.id],
    );
    if (deps[0].opps > 0 || deps[0].ctrs > 0) {
      return res.status(409).json({
        error: `Este cliente tiene ${deps[0].opps} oportunidad(es) y ${deps[0].ctrs} contrato(s). Desactívalo en lugar de eliminarlo para preservar la historia.`,
      });
    }
    const { rows } = await pool.query(
      `UPDATE clients SET deleted_at=NOW(), active=false, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    await emitEvent(pool, {
      event_type: 'client.deleted',
      entity_type: 'client',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { name: rows[0].name },
      req,
    });
    res.json({ message: 'Cliente eliminado' });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
