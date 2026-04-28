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
const { parsePagination } = require('../utils/sanitize');
const { serverError, safeRollback } = require('../utils/http');

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
    const { page, limit, offset } = parsePagination(req.query);

    const wheres = ['c.deleted_at IS NULL'];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`(LOWER(c.name) LIKE LOWER(${add(like)}))`);
    }
    if (req.query.client_id) wheres.push(`c.client_id = ${add(req.query.client_id)}`);
    if (req.query.status)    wheres.push(`c.status = ${add(normalizeStatus(req.query.status))}`);
    if (req.query.type)      wheres.push(`c.type = ${add(req.query.type)}`);
    if (req.query.squad_id)  wheres.push(`c.squad_id = ${add(req.query.squad_id)}`);

    const where = `WHERE ${wheres.join(' AND ')}`;
    // limit/offset son enteros saneados → siempre seguros vía $N (no al template).
    const dataParams = [...filterParams, limit, offset];
    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM contracts c ${where}`, filterParams),
      pool.query(
        `SELECT c.*,
           cl.name AS client_name,
           (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests_count,
           (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND status='active' AND deleted_at IS NULL) AS active_assignments_count
           FROM contracts c
           LEFT JOIN clients cl ON cl.id = c.client_id
           ${where}
           ORDER BY c.updated_at DESC
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
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
         uao.name  AS account_owner_name,    uao.email  AS account_owner_email,
         udm.name  AS delivery_manager_name, udm.email  AS delivery_manager_email,
         ucm.name  AS capacity_manager_name, ucm.email  AS capacity_manager_email,
         (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND deleted_at IS NULL) AS requests_count,
         (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests_count,
         (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND deleted_at IS NULL) AS assignments_count,
         (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND status='active' AND deleted_at IS NULL) AS active_assignments_count
         FROM contracts c
         LEFT JOIN clients        cl  ON cl.id = c.client_id
         LEFT JOIN opportunities  o   ON o.id = c.opportunity_id
         LEFT JOIN quotations     q   ON q.id = c.winning_quotation_id
         LEFT JOIN users          uao ON uao.id = c.account_owner_id
         LEFT JOIN users          udm ON udm.id = c.delivery_manager_id
         LEFT JOIN users          ucm ON ucm.id = c.capacity_manager_id
        WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contrato no encontrado' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /contracts/:id', err); }
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

/* -------- CREATE FROM QUOTATION (admin+) --------
 *
 * `POST /api/contracts/from-quotation/:quotation_id`
 *
 * Atajo de un click para convertir una cotización ganada en contrato.
 * Toma defaults sensatos de la quotation:
 *   - name              ← quotation.project_name
 *   - client_id         ← quotation.client_id (o opportunity.client_id)
 *   - type              ← staff_aug → 'capacity', fixed_scope → 'project'
 *   - start_date        ← hoy (override en body)
 *   - winning_quotation_id ← :quotation_id
 *   - opportunity_id    ← quotation.opportunity_id (si existe)
 *   - account_owner_id  ← caller
 *
 * Body opcional:
 *   { name?, start_date?, end_date?, type? }   // overrides
 *
 * Si la quotation no tiene client_id directo NI opportunity, devuelve 400
 * pidiéndole al UI que elija un client_id antes de convertir.
 *
 * Importante: NO marca la quotation como 'approved' ni la oportunidad como
 * 'won' — eso queda como decisión humana en sus respectivos endpoints
 * (evita state-changes mágicos en cascada).
 */
router.post('/from-quotation/:quotation_id', adminOnly, async (req, res) => {
  const { quotation_id } = req.params;
  const body = req.body || {};

  try {
    const { rows: qRows } = await pool.query(
      `SELECT q.id, q.type, q.project_name, q.client_id, q.opportunity_id,
              q.client_name, o.client_id AS opp_client_id
         FROM quotations q
         LEFT JOIN opportunities o ON o.id = q.opportunity_id
        WHERE q.id = $1 AND (q.deleted_at IS NULL)`,
      [quotation_id]
    );
    if (!qRows.length) return res.status(404).json({ error: 'Cotización no encontrada' });
    const q = qRows[0];

    const clientId = body.client_id || q.client_id || q.opp_client_id;
    if (!clientId) {
      return res.status(400).json({
        error: 'La cotización no está vinculada a ningún cliente. Vincula la cotización a un cliente/oportunidad antes de convertir, o pasa client_id en el body.',
        code: 'no_client_link',
        quotation: { id: q.id, project_name: q.project_name, client_name: q.client_name },
      });
    }

    // Map quotation type → contract type.
    const contractType = body.type || (q.type === 'fixed_scope' ? 'project' : 'capacity');
    if (!VALID_TYPES.includes(contractType)) {
      return res.status(400).json({ error: 'type inválido (capacity|project|resell)' });
    }

    // Verify client exists.
    const { rows: cRows } = await pool.query(
      `SELECT id, name FROM clients WHERE id=$1 AND deleted_at IS NULL`, [clientId]
    );
    if (!cRows.length) return res.status(400).json({ error: 'Cliente no existe' });

    // Resolve squad like POST / does (creator's squad → default).
    const { rows: uRows } = await pool.query(`SELECT squad_id FROM users WHERE id=$1`, [req.user.id]);
    let resolvedSquadId = uRows[0]?.squad_id || null;
    if (!resolvedSquadId) {
      const { rows: sRows } = await pool.query(
        `SELECT id FROM squads WHERE deleted_at IS NULL AND active=true
          ORDER BY (LOWER(name)=LOWER('DVPNYX Global')) DESC, created_at ASC LIMIT 1`
      );
      resolvedSquadId = sRows[0]?.id || null;
    }
    if (!resolvedSquadId) {
      const { rows: createdRows } = await pool.query(
        `INSERT INTO squads (name, description, active)
           VALUES ('DVPNYX Global', 'Squad por defecto (auto-creado)', true)
           RETURNING id`
      );
      resolvedSquadId = createdRows[0]?.id || null;
    }

    const startDate = body.start_date || new Date().toISOString().slice(0, 10);
    const contractName = (body.name && String(body.name).trim()) || q.project_name || `Contrato ${q.id.slice(0, 8)}`;

    const { rows } = await pool.query(
      `INSERT INTO contracts
         (name, client_id, opportunity_id, winning_quotation_id, type,
          start_date, end_date, account_owner_id, squad_id, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 'planned')
       RETURNING *`,
      [
        contractName, clientId, q.opportunity_id || null, q.id, contractType,
        startDate, body.end_date || null, resolvedSquadId, req.user.id,
      ]
    );
    const c = rows[0];

    await emitEvent(pool, {
      event_type: 'contract.created_from_quotation', entity_type: 'contract', entity_id: c.id,
      actor_user_id: req.user.id,
      payload: {
        quotation_id: q.id, project_name: q.project_name,
        contract_id: c.id, contract_name: c.name, type: contractType,
      },
      req,
    });

    res.status(201).json(c);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /contracts/from-quotation failed:', err);
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
    await safeRollback(conn, 'transaction');
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
  } catch (err) { serverError(res, 'DELETE /contracts/:id', err); }
});

/* -------- KICK-OFF: SEED RESOURCE_REQUESTS FROM WINNING QUOTATION --------
 *
 * `POST /api/contracts/:id/kick-off`
 *
 * Después de que el contrato fue creado (típicamente desde una oportunidad
 * ganada con cotización), el delivery manager hace el "kick-off" del
 * proyecto. Le da una fecha de inicio (kick_off_date) y el sistema lee las
 * líneas de la winning_quotation y crea automáticamente las
 * resource_requests con esos defaults.
 *
 * Permisos: admin/superadmin SIEMPRE. Para roles 'lead' y 'member' está
 * permitido sólo si son el delivery_manager_id, account_owner_id o
 * capacity_manager_id del contrato.
 *
 * Body:
 *   { kick_off_date: 'YYYY-MM-DD' }
 *
 * Reglas:
 *   - El contrato debe tener winning_quotation_id.
 *   - El contrato NO debe tener resource_requests previas (devuelve 409
 *     con `code: 'already_seeded'` para que la UI pueda decidir si
 *     forzar — ofrecemos `?force=1` para borrar las anteriores y resembrar).
 *   - Los quotation_lines se mapean así:
 *       role_title    ← line.role_title (o `${specialty} (${level})` si vacío)
 *       level         ← `L${line.level}` (1..11) — fallback 'L3' si ausente
 *       country       ← line.country
 *       quantity      ← line.quantity (default 1)
 *       weekly_hours  ← line.hours_per_week (default 40)
 *       start_date    ← kick_off_date
 *       end_date      ← kick_off_date + duration_months*30 días
 *       area_id       ← match por specialty (ILIKE area.name) → fallback 1
 *
 * Response:
 *   201 { contract, kick_off_date, created_requests: [...], skipped: [...] }
 */
const SPECIALTY_TO_AREA_KEY = {
  // Mapeo heurístico de specialties típicas en quotations a area.key.
  // Nuevos términos se pueden añadir aquí sin migración.
  'desarrollo': 'development', 'development': 'development', 'dev': 'development',
  'frontend': 'development', 'backend': 'development', 'fullstack': 'development', 'mobile': 'development',
  'qa': 'testing', 'testing': 'testing', 'quality': 'testing',
  'devops': 'devops_sre', 'sre': 'devops_sre', 'infra': 'infra_security',
  'seguridad': 'infra_security', 'security': 'infra_security',
  'data': 'data_ai', 'ai': 'data_ai', 'ml': 'data_ai', 'analytics': 'data_ai',
  'ux': 'ux_ui', 'ui': 'ux_ui', 'diseño': 'ux_ui', 'design': 'ux_ui',
  'product': 'product_management', 'pm': 'product_management', 'po': 'product_management',
  'project': 'project_management', 'pmo': 'project_management',
  'analista': 'functional_analysis', 'analisis': 'functional_analysis', 'funcional': 'functional_analysis',
};

router.post('/:id/kick-off', async (req, res) => {
  const contractId = req.params.id;
  const body = req.body || {};
  const kickOffDate = String(body.kick_off_date || '').trim();
  const force = req.query.force === '1' || body.force === true;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(kickOffDate)) {
    return res.status(400).json({ error: 'kick_off_date es requerido (YYYY-MM-DD)' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    const { rows: cRows } = await conn.query(
      `SELECT id, name, status, winning_quotation_id,
              delivery_manager_id, account_owner_id, capacity_manager_id
         FROM contracts WHERE id=$1 AND deleted_at IS NULL`,
      [contractId]
    );
    if (!cRows.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }
    const contract = cRows[0];

    // Permission gate: admin OR (DM/owner/capacity_manager del contrato).
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const isContractStakeholder =
      contract.delivery_manager_id === req.user.id ||
      contract.account_owner_id === req.user.id ||
      contract.capacity_manager_id === req.user.id;
    if (!isAdmin && !isContractStakeholder) {
      await conn.query('ROLLBACK');
      return res.status(403).json({
        error: 'Sólo el delivery manager (o un admin) puede iniciar el kick-off de este contrato.',
      });
    }

    if (['completed', 'cancelled'].includes(contract.status)) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: `Contrato está ${contract.status}, no se puede sembrar.` });
    }

    if (!contract.winning_quotation_id) {
      await conn.query('ROLLBACK');
      return res.status(400).json({
        error: 'El contrato no tiene cotización ganadora vinculada. Edita el contrato y asocia una winning_quotation_id antes del kick-off.',
        code: 'no_winning_quotation',
      });
    }

    // Idempotency check: no permitir resiembra accidental.
    const { rows: existingRR } = await conn.query(
      `SELECT id FROM resource_requests WHERE contract_id=$1 AND deleted_at IS NULL LIMIT 1`,
      [contractId]
    );
    if (existingRR.length && !force) {
      await conn.query('ROLLBACK');
      return res.status(409).json({
        error: 'El contrato ya tiene solicitudes. Pasa ?force=1 para borrar las anteriores y resembrar.',
        code: 'already_seeded',
      });
    }
    if (existingRR.length && force) {
      // Soft-delete las previas — assignments existentes se preservan
      // pero quedan huérfanas de su request. Decisión consciente: el
      // resembrar se considera "operación de admin" y se loggea.
      await conn.query(
        `UPDATE resource_requests SET deleted_at = NOW()
          WHERE contract_id=$1 AND deleted_at IS NULL`,
        [contractId]
      );
    }

    // Cargar las quotation_lines.
    const { rows: lines } = await conn.query(
      `SELECT id, sort_order, specialty, role_title, level, country,
              quantity, duration_months, hours_per_week, phase
         FROM quotation_lines
        WHERE quotation_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [contract.winning_quotation_id]
    );
    if (!lines.length) {
      await conn.query('ROLLBACK');
      return res.status(400).json({
        error: 'La cotización ganadora no tiene líneas. Nada que sembrar.',
        code: 'empty_quotation',
      });
    }

    // Cargar areas para mapeo specialty → area_id.
    const { rows: areaRows } = await conn.query(
      `SELECT id, key, name FROM areas WHERE active=true ORDER BY id`
    );
    const areaByKey = new Map(areaRows.map((a) => [a.key, a]));
    const areaByName = new Map(areaRows.map((a) => [String(a.name).toLowerCase(), a]));
    const defaultAreaId = (areaByKey.get('development') || areaRows[0])?.id;
    if (!defaultAreaId) {
      await conn.query('ROLLBACK');
      return res.status(500).json({ error: 'No hay áreas en el sistema. Ejecuta seeds primero.' });
    }

    function resolveAreaId(specialty) {
      if (!specialty) return defaultAreaId;
      const norm = String(specialty).toLowerCase().trim();
      // exact name match
      if (areaByName.has(norm)) return areaByName.get(norm).id;
      // heuristic key match
      for (const [needle, key] of Object.entries(SPECIALTY_TO_AREA_KEY)) {
        if (norm.includes(needle)) {
          const a = areaByKey.get(key);
          if (a) return a.id;
        }
      }
      return defaultAreaId;
    }

    const created = [];
    const skipped = [];
    const kickoffMs = new Date(kickOffDate + 'T00:00:00Z').getTime();
    for (const line of lines) {
      try {
        const lvl = Number(line.level);
        const levelStr = (Number.isFinite(lvl) && lvl >= 1 && lvl <= 11) ? `L${lvl}` : 'L3';
        const months = Number(line.duration_months) > 0 ? Number(line.duration_months) : 6;
        const endMs = kickoffMs + months * 30 * 86400000;
        const endDate = new Date(endMs).toISOString().slice(0, 10);
        const areaId = resolveAreaId(line.specialty);
        const roleTitle = (line.role_title && String(line.role_title).trim())
          || (line.specialty ? `${line.specialty} ${levelStr}` : `Recurso ${levelStr}`);
        const weeklyHours = Number(line.hours_per_week) > 0 ? Number(line.hours_per_week) : 40;
        const quantity = Number(line.quantity) > 0 ? Number(line.quantity) : 1;
        const notesParts = [];
        if (line.phase) notesParts.push(`Fase: ${line.phase}`);
        if (line.specialty) notesParts.push(`Specialty: ${line.specialty}`);
        notesParts.push(`Sembrado desde quotation_line ${line.id} en kick-off ${kickOffDate}`);

        const { rows: rrRows } = await conn.query(
          `INSERT INTO resource_requests
             (contract_id, role_title, area_id, level, country,
              weekly_hours, start_date, end_date, quantity, priority, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'medium',$10,$11)
           RETURNING *`,
          [
            contractId, roleTitle, areaId, levelStr, line.country || null,
            weeklyHours, kickOffDate, endDate, quantity, notesParts.join(' · '), req.user.id,
          ]
        );
        created.push(rrRows[0]);
      } catch (lineErr) {
        // Una línea inválida no debe tumbar todo el seeding.
        skipped.push({
          line_id: line.id, role_title: line.role_title, specialty: line.specialty,
          error: lineErr.message,
        });
      }
    }

    // Guarda kick_off_date y timestamp en metadata del contrato (sin
    // migración — metadata es jsonb).
    const { rows: updated } = await conn.query(
      `UPDATE contracts
          SET start_date  = LEAST(start_date, $2::date),
              metadata    = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                              'kick_off_date',           $2::date,
                              'kicked_off_at',           NOW(),
                              'kicked_off_by',           $3::uuid,
                              'kick_off_seeded_count',   $4::int
                            ),
              updated_at  = NOW()
        WHERE id = $1
        RETURNING *`,
      [contractId, kickOffDate, req.user.id, created.length]
    );

    await emitEvent(pool, {
      event_type: 'contract.kicked_off', entity_type: 'contract', entity_id: contractId,
      actor_user_id: req.user.id,
      payload: {
        kick_off_date: kickOffDate,
        seeded_requests: created.length,
        skipped_lines: skipped.length,
        force: !!force,
      },
      req,
    });

    await conn.query('COMMIT');
    res.status(201).json({
      contract: updated[0],
      kick_off_date: kickOffDate,
      created_requests: created,
      skipped,
    });
  } catch (err) {
    await safeRollback(conn, 'transaction');
    // eslint-disable-next-line no-console
    console.error('POST /contracts/:id/kick-off failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

module.exports = router;
