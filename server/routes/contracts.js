/**
 * Contracts CRUD + status flow — Sprint 4 Module EK-1, EK-2.
 * Spec: docs/specs/v2/04_modules/04_contracts_requests_assignments.md
 *       docs/specs/v2/09_user_stories_backlog.md EK-1 / EK-2
 *
 * Scope ownership:
 *   - Any authenticated user may READ (dashboards + selectors).
 *   - Only admin+ can create / update / transition / soft-delete.
 *   - Soft delete is rejected (409) when the contract still has active
 *     assignments or open resource_requests — preserves history.
 *
 * Schema note: the DB enum uses `planned / active / paused / completed
 * / cancelled`. The spec in user_stories_backlog uses the older labels
 * `draft / on_hold`. We map draft→planned and on_hold→paused at the
 * API boundary to keep both consumers happy.
 *
 * All mutations emit structured events via server/utils/events.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { stringifyCsv } = require('../utils/csv');

router.use(auth);

const VALID_TYPES = ['capacity', 'project', 'resell'];
const VALID_STATUSES = ['planned', 'active', 'paused', 'completed', 'cancelled'];
const TERMINAL = new Set(['completed', 'cancelled']);
const TRANSITIONS = {
  planned:   new Set(['active', 'cancelled']),
  active:    new Set(['paused', 'completed', 'cancelled']),
  paused:    new Set(['active', 'completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

// Normalize spec aliases → schema values on the way in.
function normalizeStatus(s) {
  if (s === 'draft') return 'planned';
  if (s === 'on_hold') return 'paused';
  return s;
}

const EDITABLE_FIELDS = [
  'name', 'type', 'opportunity_id', 'winning_quotation_id',
  'start_date', 'end_date', 'account_owner_id', 'delivery_manager_id',
  'capacity_manager_id', 'squad_id', 'notes', 'tags', 'metadata',
];

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const offset = (page - 1) * limit;

    const wheres = ['c.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`(LOWER(c.name) LIKE LOWER(${add(like)}))`);
    }
    if (req.query.client_id) wheres.push(`c.client_id = ${add(req.query.client_id)}`);
    if (req.query.status)    wheres.push(`c.status = ${add(normalizeStatus(req.query.status))}`);
    if (req.query.type)      wheres.push(`c.type = ${add(req.query.type)}`);
    if (req.query.squad_id)  wheres.push(`c.squad_id = ${add(req.query.squad_id)}`);

    const where = `WHERE ${wheres.join(' AND ')}`;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM contracts c ${where}`, params),
      pool.query(
        `SELECT c.*,
           cl.name AS client_name,
           (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests_count,
           (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND status='active' AND deleted_at IS NULL) AS active_assignments_count
           FROM contracts c
           LEFT JOIN clients cl ON cl.id = c.client_id
           ${where}
           ORDER BY c.updated_at DESC
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
    console.error('GET /contracts failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- EXPORT CSV -------- */
const EXPORT_LIMIT = 10000;
router.get('/export.csv', async (req, res) => {
  try {
    const wheres = ['c.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`(LOWER(c.name) LIKE LOWER(${add(like)}))`);
    }
    if (req.query.client_id) wheres.push(`c.client_id = ${add(req.query.client_id)}`);
    if (req.query.status)    wheres.push(`c.status = ${add(normalizeStatus(req.query.status))}`);
    if (req.query.type)      wheres.push(`c.type = ${add(req.query.type)}`);

    const where = `WHERE ${wheres.join(' AND ')}`;
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.type, c.status, c.start_date, c.end_date,
              c.notes, c.created_at,
              cl.name AS client_name
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         ${where}
         ORDER BY c.updated_at DESC
         LIMIT ${EXPORT_LIMIT}`,
      params
    );
    const csv = stringifyCsv(rows, [
      { key: 'id',           header: 'ID' },
      { key: 'name',         header: 'Nombre' },
      { key: 'client_name',  header: 'Cliente' },
      { key: 'type',         header: 'Tipo' },
      { key: 'status',       header: 'Estado' },
      { key: 'start_date',   header: 'Inicio' },
      { key: 'end_date',     header: 'Fin' },
      { key: 'notes',        header: 'Notas' },
      { key: 'created_at',   header: 'Creado' },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contratos.csv"');
    res.send(csv);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /contracts/export.csv failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
         cl.name AS client_name, cl.country AS client_country, cl.tier AS client_tier,
         o.name  AS opportunity_name, o.status AS opportunity_status,
         q.project_name AS winning_quotation_name, q.type AS winning_quotation_type,
         (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND deleted_at IS NULL) AS requests_count,
         (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests_count,
         (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND deleted_at IS NULL) AS assignments_count,
         (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND status='active' AND deleted_at IS NULL) AS active_assignments_count
         FROM contracts c
         LEFT JOIN clients        cl ON cl.id = c.client_id
         LEFT JOIN opportunities  o  ON o.id = c.opportunity_id
         LEFT JOIN quotations     q  ON q.id = c.winning_quotation_id
        WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contrato no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

/* -------- CREATE (admin+) -------- */
router.post('/', adminOnly, async (req, res) => {
  const body = req.body || {};
  const {
    name, client_id, opportunity_id, winning_quotation_id, type,
    start_date, end_date, account_owner_id, delivery_manager_id,
    capacity_manager_id, squad_id, notes, tags, metadata,
  } = body;

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name es requerido' });
  if (!client_id) return res.status(400).json({ error: 'client_id es requerido' });
  if (!type) return res.status(400).json({ error: 'type es requerido' });
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'type inválido (capacity|project|resell)' });
  if (!start_date) return res.status(400).json({ error: 'start_date es requerido' });

  try {
    // Resolve squad_id automatically: explicit body → creator's squad → global default.
    // The DB column is NOT NULL, but the UI no longer exposes this field — users
    // should never have to think about squads when creating a contract.
    let resolvedSquadId = squad_id || null;
    if (!resolvedSquadId) {
      const { rows: uRows } = await pool.query(
        `SELECT squad_id FROM users WHERE id = $1`, [req.user.id]
      );
      resolvedSquadId = uRows[0]?.squad_id || null;
    }
    if (!resolvedSquadId) {
      // Fallback to the default squad ("DVPNYX Global"). Squads are an internal
      // concept no longer exposed in the UI — we auto-provision the default so
      // contract creation never fails on a fresh/empty DB.
      const { rows: sRows } = await pool.query(
        `SELECT id FROM squads
           WHERE deleted_at IS NULL AND active = true
           ORDER BY (LOWER(name) = LOWER('DVPNYX Global')) DESC, created_at ASC
           LIMIT 1`
      );
      resolvedSquadId = sRows[0]?.id || null;
    }
    if (!resolvedSquadId) {
      // Last resort: create the default squad on the fly so the system is
      // self-healing in environments where the V2 data migration never ran.
      const { rows: createdRows } = await pool.query(
        `INSERT INTO squads (name, description, active)
           VALUES ('DVPNYX Global', 'Squad por defecto (auto-creado)', true)
           RETURNING id`
      );
      resolvedSquadId = createdRows[0]?.id || null;
    }
    if (!resolvedSquadId) {
      return res.status(500).json({ error: 'No se pudo resolver el squad por defecto. Contacta al administrador.' });
    }
    // Referential checks
    const { rows: cRows } = await pool.query(
      `SELECT id, name FROM clients WHERE id=$1 AND deleted_at IS NULL`, [client_id]
    );
    if (!cRows.length) return res.status(400).json({ error: 'Cliente no existe' });

    if (opportunity_id) {
      const { rows: oRows } = await pool.query(
        `SELECT id, client_id FROM opportunities WHERE id=$1 AND deleted_at IS NULL`, [opportunity_id]
      );
      if (!oRows.length) return res.status(400).json({ error: 'Oportunidad no existe' });
      if (oRows[0].client_id !== client_id) {
        return res.status(409).json({ error: 'La oportunidad no pertenece al cliente indicado' });
      }
    }

    if (winning_quotation_id) {
      const { rows: qRows } = await pool.query(
        `SELECT id, opportunity_id FROM quotations WHERE id=$1`, [winning_quotation_id]
      );
      if (!qRows.length) return res.status(400).json({ error: 'winning_quotation_id no existe' });
      if (opportunity_id && qRows[0].opportunity_id && qRows[0].opportunity_id !== opportunity_id) {
        return res.status(409).json({ error: 'La cotización ganadora no pertenece a la oportunidad indicada' });
      }
    }

    const ownerId = account_owner_id || req.user.id;

    const { rows } = await pool.query(
      `INSERT INTO contracts
         (name, client_id, opportunity_id, winning_quotation_id, type,
          start_date, end_date, account_owner_id, delivery_manager_id,
          capacity_manager_id, squad_id, notes, tags, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        String(name).trim(), client_id, opportunity_id || null, winning_quotation_id || null, type,
        start_date, end_date || null, ownerId, delivery_manager_id || null,
        capacity_manager_id || null, resolvedSquadId, notes || null, tags || null,
        metadata ? JSON.stringify(metadata) : null, req.user.id,
      ]
    );
    const c = rows[0];
    await emitEvent(pool, {
      event_type: 'contract.created', entity_type: 'contract', entity_id: c.id,
      actor_user_id: req.user.id,
      payload: { name: c.name, type: c.type, client_id: c.client_id, opportunity_id: c.opportunity_id, status: c.status },
      req,
    });
    res.status(201).json(c);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /contracts failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- UPDATE (admin+) -------- */
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: [before] } = await pool.query(
      `SELECT * FROM contracts WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!before) return res.status(404).json({ error: 'Contrato no encontrado' });

    const body = req.body || {};
    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ error: 'name no puede estar vacío' });
    }
    if (body.type && !VALID_TYPES.includes(body.type)) {
      return res.status(400).json({ error: 'type inválido' });
    }

    const { rows } = await pool.query(
      `UPDATE contracts SET
          name                 = COALESCE($1, name),
          type                 = COALESCE($2, type),
          opportunity_id       = COALESCE($3, opportunity_id),
          winning_quotation_id = COALESCE($4, winning_quotation_id),
          start_date           = COALESCE($5, start_date),
          end_date             = COALESCE($6, end_date),
          account_owner_id     = COALESCE($7, account_owner_id),
          delivery_manager_id  = COALESCE($8, delivery_manager_id),
          capacity_manager_id  = COALESCE($9, capacity_manager_id),
          squad_id             = COALESCE($10, squad_id),
          notes                = COALESCE($11, notes),
          tags                 = COALESCE($12, tags),
          metadata             = COALESCE($13::jsonb, metadata),
          updated_at           = NOW()
        WHERE id=$14 AND deleted_at IS NULL
        RETURNING *`,
      [
        body.name ? String(body.name).trim() : null,
        body.type ?? null,
        body.opportunity_id ?? null,
        body.winning_quotation_id ?? null,
        body.start_date ?? null,
        body.end_date ?? null,
        body.account_owner_id ?? null,
        body.delivery_manager_id ?? null,
        body.capacity_manager_id ?? null,
        body.squad_id ?? null,
        body.notes ?? null,
        body.tags ?? null,
        body.metadata ? JSON.stringify(body.metadata) : null,
        req.params.id,
      ]
    );
    const after = rows[0];
    await emitEvent(pool, {
      event_type: 'contract.updated', entity_type: 'contract', entity_id: after.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, after, EDITABLE_FIELDS),
      req,
    });
    res.json(after);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /contracts/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- STATUS TRANSITION (EK-2) --------
 * Side effects on completed/cancelled:
 *   - Active + planned assignments → ended (completed) / cancelled (cancelled)
 *   - Open + partially_filled resource_requests → cancelled
 */
router.post('/:id/status', adminOnly, async (req, res) => {
  const newStatusRaw = req.body?.new_status;
  const newStatus = normalizeStatus(newStatusRaw);
  if (!VALID_STATUSES.includes(newStatus)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: [current] } = await conn.query(
      `SELECT * FROM contracts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id]
    );
    if (!current) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }
    if (current.status === newStatus) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: 'El contrato ya está en ese estado' });
    }
    const allowed = TRANSITIONS[current.status];
    if (!allowed || !allowed.has(newStatus)) {
      await conn.query('ROLLBACK');
      return res.status(409).json({
        error: `Transición inválida: ${current.status} → ${newStatus}`,
        valid_transitions: Array.from(allowed || []),
      });
    }

    // Side effects on terminal transitions
    let endedAssignments = [];
    let cancelledAssignments = [];
    let cancelledRequests = [];
    if (newStatus === 'completed') {
      const { rows: active } = await conn.query(
        `UPDATE assignments SET status='ended', end_date=COALESCE(end_date, NOW()::date), updated_at=NOW()
           WHERE contract_id=$1 AND status='active' RETURNING id`,
        [req.params.id]
      );
      endedAssignments = active.map((r) => r.id);
      const { rows: plan } = await conn.query(
        `UPDATE assignments SET status='cancelled', updated_at=NOW()
           WHERE contract_id=$1 AND status='planned' RETURNING id`,
        [req.params.id]
      );
      cancelledAssignments = plan.map((r) => r.id);
      const { rows: reqs } = await conn.query(
        `UPDATE resource_requests SET status='cancelled', updated_at=NOW()
           WHERE contract_id=$1 AND status IN ('open','partially_filled') RETURNING id`,
        [req.params.id]
      );
      cancelledRequests = reqs.map((r) => r.id);
    } else if (newStatus === 'cancelled') {
      const { rows: asg } = await conn.query(
        `UPDATE assignments SET status='cancelled', updated_at=NOW()
           WHERE contract_id=$1 AND status IN ('planned','active') RETURNING id`,
        [req.params.id]
      );
      cancelledAssignments = asg.map((r) => r.id);
      const { rows: reqs } = await conn.query(
        `UPDATE resource_requests SET status='cancelled', updated_at=NOW()
           WHERE contract_id=$1 AND status IN ('open','partially_filled') RETURNING id`,
        [req.params.id]
      );
      cancelledRequests = reqs.map((r) => r.id);
    }

    const { rows: [after] } = await conn.query(
      `UPDATE contracts SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [newStatus, req.params.id]
    );

    await emitEvent(conn, {
      event_type: 'contract.status_changed',
      entity_type: 'contract',
      entity_id: after.id,
      actor_user_id: req.user.id,
      payload: {
        from: current.status, to: newStatus,
        ended_assignments: endedAssignments.length,
        cancelled_assignments: cancelledAssignments.length,
        cancelled_requests: cancelledRequests.length,
      },
      req,
    });
    if (TERMINAL.has(newStatus)) {
      await emitEvent(conn, {
        event_type: newStatus === 'completed' ? 'contract.completed' : 'contract.cancelled',
        entity_type: 'contract', entity_id: after.id,
        actor_user_id: req.user.id,
        payload: { ended_assignments: endedAssignments, cancelled_assignments: cancelledAssignments, cancelled_requests: cancelledRequests },
        req,
      });
    }

    await conn.query('COMMIT');
    res.json({
      ...after,
      ended_assignments: endedAssignments.length,
      cancelled_assignments: cancelledAssignments.length,
      cancelled_requests: cancelledRequests.length,
    });
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('POST /contracts/:id/status failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

/* -------- SOFT DELETE (admin+) -------- */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: deps } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM assignments WHERE contract_id=$1 AND status='active' AND deleted_at IS NULL) AS active_assignments,
         (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=$1 AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests`,
      [req.params.id]
    );
    const { active_assignments, open_requests } = deps[0];
    if (active_assignments > 0 || open_requests > 0) {
      return res.status(409).json({
        error: `Contrato con ${active_assignments} asignación(es) activa(s) y ${open_requests} solicitud(es) abiertas. Complétalo o cancélalo antes de eliminar.`,
        active_assignments, open_requests,
      });
    }
    const { rows } = await pool.query(
      `UPDATE contracts SET deleted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contrato no encontrado' });
    await emitEvent(pool, {
      event_type: 'contract.deleted', entity_type: 'contract', entity_id: rows[0].id,
      actor_user_id: req.user.id, payload: { name: rows[0].name }, req,
    });
    res.json({ message: 'Contrato eliminado' });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
