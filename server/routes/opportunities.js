/**
 * Opportunities CRUD + status flow — Sprint 2 Module 2.
 * Spec: docs/specs/v2/04_modules/02_clients_opportunities.md (EO-*)
 *       docs/specs/v2/05_api_spec.md (Opportunities section)
 *
 * Scope ownership (aligned with Clients):
 *   - Any authenticated user may create/edit/list/read opportunities.
 *   - Any authenticated user may transition status (server enforces valid
 *     transitions; UI gates who sees which buttons).
 *   - Only admin+ can soft-delete.
 *   - Hard delete is rejected if the opportunity has any quotation.
 *
 * Status flow (enforced server-side):
 *   open        → qualified | cancelled
 *   qualified   → proposal  | cancelled
 *   proposal    → negotiation | won | lost | cancelled
 *   negotiation → won | lost | cancelled
 *   won/lost/cancelled are terminal.
 *
 * Side effects on status transitions:
 *   won:       winning_quotation_id required; if that quotation is `sent`,
 *              it is promoted to `approved`. closed_at = NOW().
 *   lost:      outcome_reason required. Any opp quotations in `sent` become
 *              `rejected`. `draft` and `approved` are left untouched. closed_at=NOW().
 *   cancelled: outcome_reason required. Same quotation side effect as lost.
 *              closed_at=NOW().
 *
 * All mutations emit structured events via server/utils/events.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { stringifyCsv } = require('../utils/csv');

router.use(auth);

const VALID_STATUSES = ['open', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'cancelled'];
const TERMINAL = new Set(['won', 'lost', 'cancelled']);
const NON_TERMINAL = new Set(['open', 'qualified', 'proposal', 'negotiation']);
// CRM-MVP-00.1: las transiciones se relajaron para soportar el drag-and-drop
// del Kanban. La regla de integridad se mantiene: terminal es inmutable y
// las transiciones a terminal exigen los datos requeridos (winning_quotation_id
// para won, outcome_reason para lost/cancelled). Saltos hacia atrás o saltos
// "ilegales" del flujo lineal SÍ son permitidos pero generan warnings que el
// frontend muestra al usuario antes de confirmar.
const TRANSITIONS = {
  open:        new Set(['qualified', 'proposal', 'negotiation', 'won', 'lost', 'cancelled']),
  qualified:   new Set(['open', 'proposal', 'negotiation', 'won', 'lost', 'cancelled']),
  proposal:    new Set(['open', 'qualified', 'negotiation', 'won', 'lost', 'cancelled']),
  negotiation: new Set(['open', 'qualified', 'proposal', 'won', 'lost', 'cancelled']),
  won:         new Set(),
  lost:        new Set(),
  cancelled:   new Set(),
};
// Orden canónico para detectar saltos hacia atrás (warning en /status).
const STAGE_ORDER = { open: 1, qualified: 2, proposal: 3, negotiation: 4, won: 5, lost: 5, cancelled: 5 };
const VALID_OUTCOME_REASONS = ['price', 'timing', 'competition', 'technical_fit', 'client_internal', 'other'];

const EDITABLE_FIELDS = [
  'name', 'description', 'account_owner_id', 'presales_lead_id',
  'squad_id', 'expected_close_date', 'tags', 'external_crm_id',
  // CRM-MVP-00.1
  'booking_amount_usd', 'next_step', 'next_step_due_date',
];

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const offset = (page - 1) * limit;

    const wheres = ['o.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`(LOWER(o.name) LIKE LOWER(${add(like)}) OR LOWER(o.description) LIKE LOWER(${add(like)}))`);
    }
    if (req.query.client_id) wheres.push(`o.client_id = ${add(req.query.client_id)}`);
    if (req.query.status)    wheres.push(`o.status = ${add(req.query.status)}`);
    if (req.query.owner_id)  wheres.push(`o.account_owner_id = ${add(req.query.owner_id)}`);
    if (req.query.squad_id)  wheres.push(`o.squad_id = ${add(req.query.squad_id)}`);
    if (req.query.from_expected_close) wheres.push(`o.expected_close_date >= ${add(req.query.from_expected_close)}`);
    if (req.query.to_expected_close)   wheres.push(`o.expected_close_date <= ${add(req.query.to_expected_close)}`);

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM opportunities o ${where}`, params),
      pool.query(
        `SELECT o.*,
           c.name AS client_name,
           (SELECT COUNT(*)::int FROM quotations q WHERE q.opportunity_id=o.id) AS quotations_count
           FROM opportunities o
           LEFT JOIN clients c ON c.id = o.client_id
           ${where}
           ORDER BY o.created_at DESC
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
    console.error('GET /opportunities failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- KANBAN (CRM-MVP-00.1) --------
 * Devuelve oportunidades agrupadas por stage con summaries (count, total
 * USD, weighted USD) por columna y global. Reusa filtros del listado.
 * Cap por columna 100 para evitar payloads gigantes; el frontend pagina
 * con el listado normal si una columna se llena.
 */
const KANBAN_PER_COLUMN = 100;
router.get('/kanban', async (req, res) => {
  try {
    const { STAGES } = require('../utils/pipeline');
    const wheres = ['o.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };
    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`(LOWER(o.name) LIKE LOWER(${add(like)}) OR LOWER(o.description) LIKE LOWER(${add(like)}))`);
    }
    if (req.query.client_id) wheres.push(`o.client_id = ${add(req.query.client_id)}`);
    if (req.query.owner_id)  wheres.push(`o.account_owner_id = ${add(req.query.owner_id)}`);
    if (req.query.squad_id)  wheres.push(`o.squad_id = ${add(req.query.squad_id)}`);
    if (req.query.from_expected_close) wheres.push(`o.expected_close_date >= ${add(req.query.from_expected_close)}`);
    if (req.query.to_expected_close)   wheres.push(`o.expected_close_date <= ${add(req.query.to_expected_close)}`);
    if (req.query.min_amount_usd) wheres.push(`o.booking_amount_usd >= ${add(Number(req.query.min_amount_usd) || 0)}`);
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.status, o.client_id, o.account_owner_id,
              o.expected_close_date, o.booking_amount_usd, o.weighted_amount_usd,
              o.probability, o.last_stage_change_at, o.next_step, o.next_step_due_date,
              o.created_at,
              c.name AS client_name,
              u.name AS owner_name, u.email AS owner_email,
              EXTRACT(DAY FROM NOW() - o.last_stage_change_at)::int AS days_in_current_stage,
              (SELECT COUNT(*)::int FROM quotations q WHERE q.opportunity_id=o.id) AS quotations_count
         FROM opportunities o
         LEFT JOIN clients c ON c.id = o.client_id
         LEFT JOIN users u ON u.id = o.account_owner_id
         ${where}
         ORDER BY o.last_stage_change_at DESC`,
      params,
    );

    // Group by stage + compute summaries
    const byStage = {};
    STAGES.forEach((s) => { byStage[s.id] = { stage: s, opportunities: [], count: 0, total_usd: 0, weighted_usd: 0 }; });
    rows.forEach((r) => {
      const bucket = byStage[r.status] || byStage.open;
      bucket.count += 1;
      bucket.total_usd += Number(r.booking_amount_usd || 0);
      bucket.weighted_usd += Number(r.weighted_amount_usd || 0);
      if (bucket.opportunities.length < KANBAN_PER_COLUMN) bucket.opportunities.push(r);
    });

    const stages = STAGES.map((s) => {
      const bucket = byStage[s.id];
      return {
        id: s.id,
        label: s.label,
        prob: s.prob,
        color: s.color,
        terminal: s.terminal,
        sort: s.sort,
        summary: {
          count: bucket.count,
          total_amount_usd: Math.round(bucket.total_usd * 100) / 100,
          weighted_amount_usd: Math.round(bucket.weighted_usd * 100) / 100,
          has_more: bucket.count > bucket.opportunities.length,
        },
        opportunities: bucket.opportunities,
      };
    });

    const global_summary = stages.reduce(
      (acc, s) => {
        acc.total_opportunities += s.summary.count;
        acc.total_amount_usd += s.summary.total_amount_usd;
        acc.weighted_amount_usd += s.summary.weighted_amount_usd;
        return acc;
      },
      { total_opportunities: 0, total_amount_usd: 0, weighted_amount_usd: 0 },
    );
    global_summary.total_amount_usd = Math.round(global_summary.total_amount_usd * 100) / 100;
    global_summary.weighted_amount_usd = Math.round(global_summary.weighted_amount_usd * 100) / 100;

    res.json({ stages, global_summary });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /opportunities/kanban failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- EXPORT CSV -------- */
const EXPORT_LIMIT = 10000;
router.get('/export.csv', async (req, res) => {
  try {
    const wheres = ['o.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`(LOWER(o.name) LIKE LOWER(${add(like)}) OR LOWER(o.description) LIKE LOWER(${add(like)}))`);
    }
    if (req.query.client_id) wheres.push(`o.client_id = ${add(req.query.client_id)}`);
    if (req.query.status)    wheres.push(`o.status = ${add(req.query.status)}`);
    if (req.query.owner_id)  wheres.push(`o.account_owner_id = ${add(req.query.owner_id)}`);
    if (req.query.from_expected_close) wheres.push(`o.expected_close_date >= ${add(req.query.from_expected_close)}`);
    if (req.query.to_expected_close)   wheres.push(`o.expected_close_date <= ${add(req.query.to_expected_close)}`);

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.status, o.outcome, o.outcome_reason,
              o.expected_close_date, o.closed_at, o.description, o.created_at,
              c.name AS client_name
         FROM opportunities o
         LEFT JOIN clients c ON c.id = o.client_id
         ${where}
         ORDER BY o.created_at DESC
         LIMIT ${EXPORT_LIMIT}`,
      params
    );
    const csv = stringifyCsv(rows, [
      { key: 'id',                   header: 'ID' },
      { key: 'name',                 header: 'Nombre' },
      { key: 'client_name',          header: 'Cliente' },
      { key: 'status',               header: 'Estado' },
      { key: 'outcome',              header: 'Resultado' },
      { key: 'outcome_reason',       header: 'Motivo' },
      { key: 'expected_close_date',  header: 'Cierre esperado' },
      { key: 'closed_at',            header: 'Cerrada' },
      { key: 'description',          header: 'Descripción' },
      { key: 'created_at',           header: 'Creada' },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="oportunidades.csv"');
    res.send(csv);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /opportunities/export.csv failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
         c.id   AS client__id,
         c.name AS client__name,
         c.country AS client__country,
         c.tier    AS client__tier,
         (SELECT COUNT(*)::int FROM quotations q WHERE q.opportunity_id=o.id) AS quotations_count
         FROM opportunities o
         LEFT JOIN clients c ON c.id = o.client_id
        WHERE o.id=$1 AND o.deleted_at IS NULL`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    // total_usd no existe como columna en quotations — se deriva de la
    // suma de quotation_lines.total. El test mockeaba pg in-memory por lo
    // que la query rota nunca se validó. Bug preexistente expuesto por
    // CRM-MVP-00.1 al haber más oportunidades con cotizaciones linkeadas.
    const quotations = (await pool.query(
      `SELECT q.id, q.project_name, q.type, q.status, q.created_at,
              COALESCE((SELECT SUM(total) FROM quotation_lines WHERE quotation_id=q.id), 0)::numeric AS total_usd
         FROM quotations q WHERE q.opportunity_id=$1 ORDER BY q.created_at DESC`,
      [req.params.id],
    )).rows;

    const row = rows[0];
    const client = row.client__id ? {
      id: row.client__id, name: row.client__name, country: row.client__country, tier: row.client__tier,
    } : null;
    delete row.client__id; delete row.client__name; delete row.client__country; delete row.client__tier;

    res.json({ ...row, client, quotations });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /opportunities/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- CREATE --------
 *
 * Owner + squad selectors are not in scope yet (user selector UI is not
 * built until the dashboards sprint). Until then, if the caller does not
 * specify them, we default:
 *   account_owner_id → req.user.id
 *   squad_id         → user's squad_id (looked up on demand from users)
 * Admins can override by sending the fields explicitly.
 */
router.post('/', async (req, res) => {
  const {
    client_id, name, description,
    account_owner_id, presales_lead_id, squad_id,
    expected_close_date, tags, external_crm_id,
  } = req.body || {};

  if (!client_id) return res.status(400).json({ error: 'client_id es requerido' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  try {
    // Verify the client exists and is not soft-deleted
    const { rows: clientRows } = await pool.query(
      `SELECT id, active FROM clients WHERE id=$1 AND deleted_at IS NULL`,
      [client_id],
    );
    if (!clientRows.length) return res.status(400).json({ error: 'Cliente no existe o está eliminado' });

    const ownerId = account_owner_id || req.user.id;

    // Resolve squad_id automatically. Squads are an internal concept no longer
    // exposed in the UI — we resolve (or auto-create) a default so opportunity
    // creation never fails. Order: body → user's squad → default "DVPNYX Global"
    // → auto-create the default if the table is empty.
    let finalSquadId = squad_id || null;
    if (!finalSquadId) {
      const { rows: userRows } = await pool.query(`SELECT squad_id FROM users WHERE id=$1`, [ownerId]);
      finalSquadId = userRows[0]?.squad_id || null;
    }
    if (!finalSquadId) {
      const { rows: sRows } = await pool.query(
        `SELECT id FROM squads
           WHERE deleted_at IS NULL AND active = true
           ORDER BY (LOWER(name) = LOWER('DVPNYX Global')) DESC, created_at ASC
           LIMIT 1`
      );
      finalSquadId = sRows[0]?.id || null;
    }
    if (!finalSquadId) {
      const { rows: createdRows } = await pool.query(
        `INSERT INTO squads (name, description, active)
           VALUES ('DVPNYX Global', 'Squad por defecto (auto-creado)', true)
           RETURNING id`
      );
      finalSquadId = createdRows[0]?.id || null;
    }
    if (!finalSquadId) {
      return res.status(500).json({ error: 'No se pudo resolver el squad por defecto. Contacta al administrador.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO opportunities
         (client_id, name, description, account_owner_id, presales_lead_id, squad_id,
          expected_close_date, tags, external_crm_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        client_id,
        String(name).trim(),
        description || null,
        ownerId,
        presales_lead_id || null,
        finalSquadId,
        expected_close_date || null,
        tags || null,
        external_crm_id || null,
        req.user.id,
      ],
    );
    const opp = rows[0];
    await emitEvent(pool, {
      event_type: 'opportunity.created',
      entity_type: 'opportunity',
      entity_id: opp.id,
      actor_user_id: req.user.id,
      payload: { name: opp.name, client_id: opp.client_id, status: opp.status },
      req,
    });
    res.status(201).json(opp);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /opportunities failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- UPDATE (editable fields only — status goes through /status) -------- */
router.put('/:id', async (req, res) => {
  try {
    const { rows: [before] } = await pool.query(
      `SELECT * FROM opportunities WHERE id=$1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!before) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    const body = req.body || {};
    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    }

    const { rows } = await pool.query(
      `UPDATE opportunities SET
          name                = COALESCE($1, name),
          description         = COALESCE($2, description),
          account_owner_id    = COALESCE($3, account_owner_id),
          presales_lead_id    = COALESCE($4, presales_lead_id),
          squad_id            = COALESCE($5, squad_id),
          expected_close_date = COALESCE($6, expected_close_date),
          tags                = COALESCE($7, tags),
          external_crm_id     = COALESCE($8, external_crm_id),
          updated_at          = NOW()
        WHERE id=$9 AND deleted_at IS NULL
        RETURNING *`,
      [
        body.name ? String(body.name).trim() : null,
        body.description ?? null,
        body.account_owner_id ?? null,
        body.presales_lead_id ?? null,
        body.squad_id ?? null,
        body.expected_close_date ?? null,
        body.tags ?? null,
        body.external_crm_id ?? null,
        req.params.id,
      ],
    );
    const after = rows[0];
    await emitEvent(pool, {
      event_type: 'opportunity.updated',
      entity_type: 'opportunity',
      entity_id: after.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, after, EDITABLE_FIELDS),
      req,
    });
    res.json(after);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /opportunities/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- STATUS TRANSITION -------- */
router.post('/:id/status', async (req, res) => {
  const { new_status, winning_quotation_id, outcome_reason, outcome_notes } = req.body || {};
  if (!VALID_STATUSES.includes(new_status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');

    const { rows: [current] } = await connection.query(
      `SELECT * FROM opportunities WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id],
    );
    if (!current) {
      await connection.query('ROLLBACK');
      return res.status(404).json({ error: 'Oportunidad no encontrada' });
    }
    if (current.status === new_status) {
      await connection.query('ROLLBACK');
      return res.status(400).json({ error: 'La oportunidad ya está en ese estado' });
    }
    const allowed = TRANSITIONS[current.status];
    if (!allowed || !allowed.has(new_status)) {
      await connection.query('ROLLBACK');
      return res.status(409).json({
        error: `Transición inválida: ${current.status} → ${new_status}`,
        valid_transitions: Array.from(allowed || []),
      });
    }
    if (new_status === 'won' && !winning_quotation_id) {
      await connection.query('ROLLBACK');
      return res.status(400).json({ error: 'winning_quotation_id es requerido al marcar ganada' });
    }
    if ((new_status === 'lost' || new_status === 'cancelled')) {
      if (!outcome_reason || !VALID_OUTCOME_REASONS.includes(outcome_reason)) {
        await connection.query('ROLLBACK');
        return res.status(400).json({ error: 'outcome_reason es requerido y debe ser un valor válido' });
      }
    }

    let quotationSideEffects = null;
    if (new_status === 'won') {
      const { rows: qrows } = await connection.query(
        `SELECT id, status, type, project_name FROM quotations WHERE id=$1 AND opportunity_id=$2`,
        [winning_quotation_id, req.params.id],
      );
      if (!qrows.length) {
        await connection.query('ROLLBACK');
        return res.status(400).json({ error: 'winning_quotation_id no pertenece a esta oportunidad' });
      }
      const winning = qrows[0];
      if (winning.status === 'sent') {
        await connection.query(
          `UPDATE quotations SET status='approved', updated_at=NOW() WHERE id=$1`,
          [winning.id],
        );
        quotationSideEffects = { promoted_to_approved: winning.id };
      }

      // RR-MVP-00.1: si la oportunidad aún no tiene contrato, crearlo
      // automáticamente. Side effect síncrono (no worker async — eso lo
      // hará el eng team cuando entre a refactorizar).
      const { rows: existingContract } = await connection.query(
        `SELECT id FROM contracts WHERE opportunity_id=$1 AND deleted_at IS NULL`,
        [req.params.id],
      );
      if (!existingContract.length) {
        // total_value_usd = SUM(quotation_lines.total) — quotations no tiene
        // total_usd como columna (ver fix #61). Si la cotización no tiene
        // líneas, queda en 0 y el operations_owner lo edita después.
        const { rows: totalRow } = await connection.query(
          `SELECT COALESCE(SUM(total), 0)::numeric AS total
             FROM quotation_lines WHERE quotation_id=$1`,
          [winning.id],
        );
        const totalValueUsd = Number(totalRow[0].total || 0);
        // Mapeo type quotation → type contract.
        const contractType = winning.type === 'fixed_scope' ? 'project' : 'capacity';
        const startDate = current.expected_close_date || new Date().toISOString().slice(0, 10);
        const { rows: createdContract } = await connection.query(
          `INSERT INTO contracts (
              name, client_id, opportunity_id, winning_quotation_id,
              type, status, start_date, account_owner_id, squad_id,
              total_value_usd, created_by, metadata
            ) VALUES ($1,$2,$3,$4,$5,'planned',$6,$7,$8,$9,$10,$11)
           RETURNING id, name, type, total_value_usd`,
          [
            winning.project_name || current.name,
            current.client_id,
            current.id,
            winning.id,
            contractType,
            startDate,
            current.account_owner_id,
            current.squad_id,
            totalValueUsd,
            req.user.id,
            JSON.stringify({ source_system: 'opportunity_won', auto_generated: true }),
          ],
        );
        quotationSideEffects = {
          ...(quotationSideEffects || {}),
          contract_created: createdContract[0],
        };
      }
    }

    if (new_status === 'lost' || new_status === 'cancelled') {
      // `sent` -> `rejected`. `draft` and `approved` are left untouched.
      const { rows: rejectedRows } = await connection.query(
        `UPDATE quotations SET status='rejected', updated_at=NOW()
         WHERE opportunity_id=$1 AND status='sent'
         RETURNING id`,
        [req.params.id],
      );
      quotationSideEffects = { rejected: rejectedRows.map((r) => r.id) };
    }

    const closingNow = TERMINAL.has(new_status);
    const outcomeValue = (new_status === 'won' || new_status === 'lost' || new_status === 'cancelled') ? new_status : null;

    const { rows: [after] } = await connection.query(
      `UPDATE opportunities SET
          status               = $1,
          outcome              = COALESCE($2, outcome),
          outcome_reason       = COALESCE($3, outcome_reason),
          outcome_notes        = COALESCE($4, outcome_notes),
          winning_quotation_id = COALESCE($5, winning_quotation_id),
          closed_at            = CASE WHEN $6::boolean THEN NOW() ELSE closed_at END,
          updated_at           = NOW()
        WHERE id=$7 RETURNING *`,
      [
        new_status,
        outcomeValue,
        outcome_reason || null,
        outcome_notes || null,
        new_status === 'won' ? winning_quotation_id : null,
        closingNow,
        req.params.id,
      ],
    );

    // Events: status_changed always; plus a specific event for won/lost/cancelled
    await emitEvent(connection, {
      event_type: 'opportunity.status_changed',
      entity_type: 'opportunity',
      entity_id: after.id,
      actor_user_id: req.user.id,
      payload: { from: current.status, to: new_status, side_effects: quotationSideEffects },
      req,
    });
    if (new_status === 'won') {
      await emitEvent(connection, {
        event_type: 'opportunity.won',
        entity_type: 'opportunity',
        entity_id: after.id,
        actor_user_id: req.user.id,
        payload: { winning_quotation_id },
        req,
      });
    } else if (new_status === 'lost') {
      await emitEvent(connection, {
        event_type: 'opportunity.lost',
        entity_type: 'opportunity',
        entity_id: after.id,
        actor_user_id: req.user.id,
        payload: { reason: outcome_reason, notes: outcome_notes || null },
        req,
      });
    } else if (new_status === 'cancelled') {
      await emitEvent(connection, {
        event_type: 'opportunity.cancelled',
        entity_type: 'opportunity',
        entity_id: after.id,
        actor_user_id: req.user.id,
        payload: { reason: outcome_reason, notes: outcome_notes || null },
        req,
      });
    }

    // CRM-MVP-00.1: warnings soft (no bloqueantes) calculados sobre la
    // transición. Los devolvemos al cliente para que el modal del kanban
    // los muestre. NO afectan persistencia — la transición ya pasó.
    const warnings = [];
    const fromOrder = STAGE_ORDER[current.status] || 0;
    const toOrder = STAGE_ORDER[new_status] || 0;
    if (fromOrder > 0 && toOrder > 0 && fromOrder > toOrder && !TERMINAL.has(new_status)) {
      warnings.push({ code: 'backwards', message: `Movida hacia atrás: ${current.status} → ${new_status}.` });
    }
    if (Number(after.booking_amount_usd || 0) === 0 && ['proposal', 'negotiation', 'won'].includes(new_status)) {
      warnings.push({ code: 'amount_zero', message: 'El monto USD está en 0. Recomendado actualizarlo.' });
    }

    await connection.query('COMMIT');
    res.json({ ...after, warnings });
  } catch (err) {
    await connection.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('POST /opportunities/:id/status failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    connection.release();
  }
});

/* -------- SOFT DELETE (admin+) -------- */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: deps } = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM quotations WHERE opportunity_id=$1) AS quots`,
      [req.params.id],
    );
    if (deps[0].quots > 0) {
      return res.status(409).json({
        error: `Esta oportunidad tiene ${deps[0].quots} cotización(es). No puede eliminarse; cancélala si ya no aplica.`,
      });
    }
    const { rows } = await pool.query(
      `UPDATE opportunities SET deleted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Oportunidad no encontrada' });
    await emitEvent(pool, {
      event_type: 'opportunity.deleted',
      entity_type: 'opportunity',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { name: rows[0].name },
      req,
    });
    res.json({ message: 'Oportunidad eliminada' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('DELETE /opportunities/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
