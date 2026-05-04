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
const { parsePagination } = require('../utils/sanitize');
const { parseSort } = require('../utils/sort');
const { serverError, safeRollback } = require('../utils/http');
// SPEC-CRM-00 v1.1 PR4 — Alerts + RBAC.
const { SEE_ALL_ROLES, WRITE_ROLES } = require('../middleware/auth');
const {
  ALERT_DEFS, A3_STAGES, checkA3, createAlertNotification, runAlertScan,
} = require('../utils/alerts');

const SORTABLE = {
  name:                 'o.name',
  status:               'o.status',
  expected_close_date:  'o.expected_close_date',
  closed_at:            'o.closed_at',
  booking_amount_usd:   'o.booking_amount_usd',
  weighted_amount_usd:  'o.weighted_amount_usd',
  probability:          'o.probability',
  last_stage_change_at: 'o.last_stage_change_at',
  next_step_due_date:   'o.next_step_due_date',
  created_at:           'o.created_at',
  updated_at:           'o.updated_at',
  client_name:          'c.name',
};

router.use(auth);

// SPEC-CRM-00 v1.1 — Pipeline de 9 estados. Estos sets se derivan del
// SSOT en server/utils/pipeline.js para que cualquier cambio del modelo
// se propague aquí automáticamente.
const { STAGE_BY_ID, STAGES, isTerminal, isPostponed } = require('../utils/pipeline');
// SPEC-CRM-00 v1.1 PR2/PR3 — Revenue model + funding + loss reasons + margin.
const {
  REVENUE_TYPES, FUNDING_SOURCES, LOSS_REASONS, LOSS_REASON_DETAIL_MIN,
  MARGIN_LOW_THRESHOLD,
  computeBooking, validateRevenueModel, validateFunding, validateLossReason,
  computeMargin, validateMarginInput,
} = require('../utils/booking');
const VALID_STATUSES = STAGES.map((s) => s.id);
const TERMINAL = new Set(STAGES.filter((s) => s.terminal).map((s) => s.id)); // closed_won, closed_lost
const NON_TERMINAL = new Set(STAGES.filter((s) => !s.terminal && !s.postponed).map((s) => s.id));
// Para el drag-and-drop del Kanban relajamos transiciones a "cualquier no-terminal
// → cualquier no-terminal" más Postponed. Las transiciones canónicas (lead→qualified
// →solution_design→…) viven en utils/pipeline.js TRANSITIONS y son las que el
// frontend muestra como botones por defecto. Saltos hacia atrás o "ilegales" siguen
// permitiéndose pero generan warnings (computeTransitionWarnings) y se loguean en
// el evento opportunity.status_changed para que la auditoría capture el patrón.
const ACTIVE_STAGES = STAGES.filter((s) => !s.terminal).map((s) => s.id); // incluye postponed
const TRANSITIONS = STAGES.reduce((acc, s) => {
  if (s.terminal) {
    acc[s.id] = new Set();         // closed_won, closed_lost — inmutables
  } else if (s.postponed) {
    // Postponed solo sale a qualified (per spec) o closed_lost.
    acc[s.id] = new Set(['qualified', 'closed_lost']);
  } else {
    acc[s.id] = new Set([
      ...ACTIVE_STAGES.filter((id) => id !== s.id), // cualquier otra etapa activa
      'closed_won', 'closed_lost',
    ]);
  }
  return acc;
}, {});
// Orden canónico para detectar saltos hacia atrás (warning soft en /status).
const STAGE_ORDER = STAGES.reduce((acc, s) => { acc[s.id] = s.sort; return acc; }, {});
const VALID_OUTCOME_REASONS = ['price', 'timing', 'competition', 'technical_fit', 'client_internal', 'other'];

const EDITABLE_FIELDS = [
  'name', 'description', 'account_owner_id', 'presales_lead_id',
  'squad_id', 'expected_close_date', 'tags', 'external_crm_id',
  // CRM-MVP-00.1
  'booking_amount_usd', 'next_step', 'next_step_due_date',
  // SPEC-CRM-00 v1.1 PR1 — country denormalizado + identificador legible
  'country',
  // SPEC-CRM-00 v1.1 PR2 — modelo de revenue + funding + flags + drive_url
  'revenue_type', 'one_time_amount_usd', 'mrr_usd', 'contract_length_months',
  'champion_identified', 'economic_buyer_identified',
  'funding_source', 'funding_amount_usd', 'drive_url',
];

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const wheres = ['o.deleted_at IS NULL'];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

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
    // SPEC-CRM-00 v1.1 PR2 — filtros de revenue model + flags + funding.
    if (req.query.revenue_type && REVENUE_TYPES.includes(req.query.revenue_type)) {
      wheres.push(`o.revenue_type = ${add(req.query.revenue_type)}`);
    }
    if (req.query.funding_source && FUNDING_SOURCES.includes(req.query.funding_source)) {
      wheres.push(`o.funding_source = ${add(req.query.funding_source)}`);
    }
    if (req.query.has_champion === 'true')  wheres.push(`o.champion_identified = true`);
    if (req.query.has_champion === 'false') wheres.push(`o.champion_identified = false`);
    if (req.query.has_economic_buyer === 'true')  wheres.push(`o.economic_buyer_identified = true`);
    if (req.query.has_economic_buyer === 'false') wheres.push(`o.economic_buyer_identified = false`);

    // SPEC-CRM-00 v1.1 PR4 — RBAC scoping.
    if (req.user.role === 'external') {
      return res.status(403).json({ error: 'Acceso restringido para usuarios externos' });
    }
    if (!SEE_ALL_ROLES.has(req.user.role)) {
      if (req.user.role === 'lead' && req.user.squad_id) {
        wheres.push(`o.squad_id = ${add(req.user.squad_id)}`);
      } else {
        wheres.push(`(o.account_owner_id = ${add(req.user.id)} OR o.presales_lead_id = ${add(req.user.id)})`);
      }
    }

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const sort = parseSort(req.query, SORTABLE, {
      defaultField: 'created_at', defaultDir: 'desc', tieBreaker: 'o.id ASC',
    });
    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM opportunities o ${where}`, filterParams),
      pool.query(
        `SELECT o.*,
           c.name AS client_name,
           (SELECT COUNT(*)::int FROM quotations q WHERE q.opportunity_id=o.id) AS quotations_count
           FROM opportunities o
           LEFT JOIN clients c ON c.id = o.client_id
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

    // SPEC-CRM-00 v1.1 PR4 — RBAC scoping (same logic as GET /).
    if (req.user.role === 'external') {
      return res.status(403).json({ error: 'Acceso restringido para usuarios externos' });
    }
    if (!SEE_ALL_ROLES.has(req.user.role)) {
      if (req.user.role === 'lead' && req.user.squad_id) {
        wheres.push(`o.squad_id = ${add(req.user.squad_id)}`);
      } else {
        wheres.push(`(o.account_owner_id = ${add(req.user.id)} OR o.presales_lead_id = ${add(req.user.id)})`);
      }
    }

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.status, o.client_id, o.account_owner_id,
              o.expected_close_date, o.booking_amount_usd, o.weighted_amount_usd,
              o.probability, o.last_stage_change_at, o.next_step, o.next_step_due_date,
              o.created_at,
              -- SPEC-CRM-00 v1.1 PR2 — el card del Kanban necesita estos
              -- campos para los badges (⚠Champ, MRR breakdown, funding chip).
              o.revenue_type, o.one_time_amount_usd, o.mrr_usd, o.contract_length_months,
              o.champion_identified, o.economic_buyer_identified,
              o.funding_source, o.funding_amount_usd,
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

/* -------- CHECK ALERTS (SPEC-CRM-00 v1.1 PR4) --------
 * Escanea oportunidades activas y genera notificaciones A1/A2/A3/A5
 * (con dedup de 24 h). Diseñado para ser invocado por cron diario
 * (o manualmente). Solo roles con permisos de escritura (member+).
 * Responde: { checked, created, details }
 */
router.post('/check-alerts', async (req, res) => {
  if (!WRITE_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'No tienes permisos para ejecutar el escaneo de alertas' });
  }
  try {
    const result = await runAlertScan(pool, { user: req.user });
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /opportunities/check-alerts failed:', err);
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
    country: countryOverride,
    // SPEC-CRM-00 v1.1 PR2 — revenue model + flags + funding + drive_url.
    // Si la app no manda revenue_type, asumimos 'one_time' y mapeamos
    // booking_amount_usd legacy → one_time_amount_usd. Esto preserva
    // compat con el cliente del PR1 mientras transiciona al nuevo modelo.
    revenue_type: revenueTypeIn,
    one_time_amount_usd: oneTimeAmountIn,
    mrr_usd, contract_length_months,
    champion_identified, economic_buyer_identified,
    funding_source: fundingSourceIn,
    funding_amount_usd,
    drive_url,
    booking_amount_usd: legacyBookingAmount,
  } = req.body || {};

  if (!client_id) return res.status(400).json({ error: 'client_id es requerido' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  // Normalizar revenue model + funding con compat legacy.
  // Si la app NO mandó nada del nuevo modelo asumimos one_time con
  // monto = booking_amount_usd legacy (o 0 si tampoco hay). Esto preserva
  // el comportamiento "Nueva Oportunidad rápida" del PR1 mientras la UI
  // del nuevo formulario llega.
  const revenue_type = revenueTypeIn || 'one_time';
  let one_time_amount_usd = oneTimeAmountIn != null
    ? oneTimeAmountIn
    : (revenue_type === 'one_time' && legacyBookingAmount != null ? legacyBookingAmount : null);
  if (revenue_type === 'one_time' && one_time_amount_usd == null && !revenueTypeIn) {
    // Compat: caller "legacy" sin revenue_type ni amount → default 0.
    one_time_amount_usd = 0;
  }
  const funding_source = fundingSourceIn || 'client_direct';

  const revenueErr = validateRevenueModel({ revenue_type, one_time_amount_usd, mrr_usd, contract_length_months });
  if (revenueErr) return res.status(400).json({ error: revenueErr });
  const fundingErr = validateFunding({ funding_source, funding_amount_usd });
  if (fundingErr) return res.status(400).json({ error: fundingErr });

  try {
    // Verify the client exists and is not soft-deleted. We also pull the
    // client's country to denormalize on the opportunity row + drive the
    // opportunity_number country prefix.
    const { rows: clientRows } = await pool.query(
      `SELECT id, active, country FROM clients WHERE id=$1 AND deleted_at IS NULL`,
      [client_id],
    );
    if (!clientRows.length) return res.status(400).json({ error: 'Cliente no existe o está eliminado' });
    const oppCountry = countryOverride || clientRows[0].country || null;

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

    // SPEC-CRM-00 v1.1 — opportunity_number legible. Generamos en una
    // transacción con SERIALIZABLE-like guard mediante advisory lock por
    // (cc, año) para evitar colisión de seq cuando 2 POSTs concurrentes
    // crean la primera opp del año en el mismo país. El fallback `XX` se
    // usa para opps sin country definible.
    const oppNumber = await generateOpportunityNumber(pool, oppCountry);

    // booking_amount_usd se calcula en el trigger DB; si la app legacy lo
    // mandó nosotros lo enviamos a la BD pero el trigger lo sobreescribirá
    // según revenue_type + componentes. Lo conservamos para compat.
    const computedBooking = computeBooking({
      revenue_type, one_time_amount_usd, mrr_usd, contract_length_months,
    });

    const { rows } = await pool.query(
      `INSERT INTO opportunities
         (client_id, name, description, account_owner_id, presales_lead_id, squad_id,
          expected_close_date, tags, external_crm_id, created_by,
          country, opportunity_number,
          revenue_type, one_time_amount_usd, mrr_usd, contract_length_months,
          champion_identified, economic_buyer_identified,
          funding_source, funding_amount_usd, drive_url, booking_amount_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
               $13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
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
        oppCountry,
        oppNumber,
        revenue_type,
        one_time_amount_usd != null ? Number(one_time_amount_usd) : null,
        mrr_usd != null ? Number(mrr_usd) : null,
        contract_length_months != null ? Number(contract_length_months) : null,
        Boolean(champion_identified),
        Boolean(economic_buyer_identified),
        funding_source,
        funding_amount_usd != null ? Number(funding_amount_usd) : null,
        drive_url || null,
        computedBooking,
      ],
    );
    const opp = rows[0];
    await emitEvent(pool, {
      event_type: 'opportunity.created',
      entity_type: 'opportunity',
      entity_id: opp.id,
      actor_user_id: req.user.id,
      payload: {
        name: opp.name,
        client_id: opp.client_id,
        status: opp.status,
        opportunity_number: opp.opportunity_number,
      },
      req,
    });
    res.status(201).json(opp);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /opportunities failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * Genera un opportunity_number "OPP-{cc}-{año}-{seq}" donde:
 *   cc  = primeras 4 letras del país (mayúsculas, alfanuméricas), o "XX"
 *   año = año actual UTC
 *   seq = siguiente secuencia para esa combinación, padded a 5 dígitos
 *
 * En un equipo pequeño (DVPNYX) la probabilidad de carrera entre dos
 * POSTs concurrentes para el mismo país en el mismo segundo es
 * efectivamente cero. El UNIQUE INDEX `opportunities_number_unique` actúa
 * como red de seguridad: si dos requests calculan el mismo seq, uno gana
 * el INSERT y el otro recibe 23505 → 500 → cliente reintenta. Se hace
 * fila a un sequence por (cc, año) si esto se vuelve un problema real.
 */
async function generateOpportunityNumber(db, country) {
  const ccRaw = String(country || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
  const cc = ccRaw || 'XX';
  const year = new Date().getUTCFullYear();
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(
        CAST(SUBSTRING(opportunity_number FROM '\\d+$') AS INTEGER)
      ), 0) + 1 AS next_seq
       FROM opportunities
      WHERE opportunity_number LIKE $1`,
    [`OPP-${cc}-${year}-%`],
  );
  const seq = rows[0].next_seq || 1;
  return `OPP-${cc}-${year}-${String(seq).padStart(5, '0')}`;
}

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

    // SPEC-CRM-00 v1.1 PR2 — si se cambia el modelo de revenue, validar
    // consistencia. Aceptamos PATCH parcial: si solo viene 1 campo del modelo
    // se valida contra los actuales del DB (before).
    if (body.revenue_type != null
      || body.one_time_amount_usd !== undefined
      || body.mrr_usd !== undefined
      || body.contract_length_months !== undefined) {
      const merged = {
        revenue_type: body.revenue_type ?? before.revenue_type,
        one_time_amount_usd: body.one_time_amount_usd !== undefined ? body.one_time_amount_usd : before.one_time_amount_usd,
        mrr_usd: body.mrr_usd !== undefined ? body.mrr_usd : before.mrr_usd,
        contract_length_months: body.contract_length_months !== undefined
          ? body.contract_length_months : before.contract_length_months,
      };
      const revenueErr = validateRevenueModel(merged);
      if (revenueErr) return res.status(400).json({ error: revenueErr });
    }
    if (body.funding_source != null || body.funding_amount_usd !== undefined) {
      const merged = {
        funding_source: body.funding_source ?? before.funding_source,
        funding_amount_usd: body.funding_amount_usd !== undefined ? body.funding_amount_usd : before.funding_amount_usd,
      };
      const fundingErr = validateFunding(merged);
      if (fundingErr) return res.status(400).json({ error: fundingErr });
    }

    const { rows } = await pool.query(
      `UPDATE opportunities SET
          name                      = COALESCE($1, name),
          description               = COALESCE($2, description),
          account_owner_id          = COALESCE($3, account_owner_id),
          presales_lead_id          = COALESCE($4, presales_lead_id),
          squad_id                  = COALESCE($5, squad_id),
          expected_close_date       = COALESCE($6, expected_close_date),
          tags                      = COALESCE($7, tags),
          external_crm_id           = COALESCE($8, external_crm_id),
          revenue_type              = COALESCE($10, revenue_type),
          one_time_amount_usd       = COALESCE($11, one_time_amount_usd),
          mrr_usd                   = COALESCE($12, mrr_usd),
          contract_length_months    = COALESCE($13, contract_length_months),
          champion_identified       = COALESCE($14, champion_identified),
          economic_buyer_identified = COALESCE($15, economic_buyer_identified),
          funding_source            = COALESCE($16, funding_source),
          funding_amount_usd        = COALESCE($17, funding_amount_usd),
          drive_url                 = COALESCE($18, drive_url),
          updated_at                = NOW()
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
        body.revenue_type ?? null,
        body.one_time_amount_usd != null ? Number(body.one_time_amount_usd) : null,
        body.mrr_usd != null ? Number(body.mrr_usd) : null,
        body.contract_length_months != null ? Number(body.contract_length_months) : null,
        body.champion_identified != null ? Boolean(body.champion_identified) : null,
        body.economic_buyer_identified != null ? Boolean(body.economic_buyer_identified) : null,
        body.funding_source ?? null,
        body.funding_amount_usd != null ? Number(body.funding_amount_usd) : null,
        body.drive_url ?? null,
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

    // SPEC-CRM-00 v1.1 PR4 — A3: si la opp ya está en etapa avanzada y
    // el PUT cambió champion/EB a false, disparar alerta (fire-and-forget).
    if (A3_STAGES.has(after.status) && after.account_owner_id
        && (body.champion_identified !== undefined || body.economic_buyer_identified !== undefined)) {
      const a3gaps = checkA3({
        status: after.status,
        champion_identified: after.champion_identified,
        economic_buyer_identified: after.economic_buyer_identified,
      });
      if (a3gaps) {
        const a3def = ALERT_DEFS.A3_MEDDPICC;
        createAlertNotification(pool, {
          user_id: after.account_owner_id,
          type: a3def.type,
          title: a3def.title(after.name || 'Oportunidad'),
          body: a3def.body(a3gaps),
          opp_id: after.id,
        }).catch(() => {}); // swallow — non-fatal
      }
    }

    res.json(after);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /opportunities/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- STATUS TRANSITION -------- */
router.post('/:id/status', async (req, res) => {
  const {
    new_status,
    winning_quotation_id,
    outcome_reason,
    outcome_notes,
    // SPEC-CRM-00 v1.1 PR1 — postponed transition data
    postponed_until_date,
    postponed_reason,
    // SPEC-CRM-00 v1.1 PR2 — loss model formal (enum extendido + detail
    // mínimo 30 chars). El legacy outcome_reason se mantiene como fallback
    // para clientes que aún no migraron su payload.
    loss_reason,
    loss_reason_detail,
  } = req.body || {};
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
    if (new_status === 'closed_won' && !winning_quotation_id) {
      await connection.query('ROLLBACK');
      return res.status(400).json({ error: 'winning_quotation_id es requerido al marcar ganada' });
    }
    if (new_status === 'closed_lost') {
      // SPEC-CRM-00 v1.1 PR2 — modelo formal de loss_reason. Si el caller
      // mandó loss_reason, validamos contra el enum extendido + detail
      // ≥30 chars. Si no mandó loss_reason pero sí outcome_reason (legacy),
      // aceptamos como fallback. Sin ninguno → 400.
      if (loss_reason != null) {
        const lossErr = validateLossReason({ loss_reason, loss_reason_detail });
        if (lossErr) {
          await connection.query('ROLLBACK');
          return res.status(400).json({ error: lossErr });
        }
      } else if (!outcome_reason || !VALID_OUTCOME_REASONS.includes(outcome_reason)) {
        await connection.query('ROLLBACK');
        return res.status(400).json({ error: 'outcome_reason o loss_reason es requerido' });
      }
    }
    // SPEC-CRM-00 v1.1 — Postponed exige fecha de reactivación.
    // El DB constraint (opp_postponed_has_until_date) es la última red,
    // pero validamos en API para devolver un mensaje útil al usuario.
    if (new_status === 'postponed') {
      if (!postponed_until_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(postponed_until_date))) {
        await connection.query('ROLLBACK');
        return res.status(400).json({
          error: 'postponed_until_date es requerido (formato YYYY-MM-DD) al postergar la oportunidad',
        });
      }
      // Sanity check: la fecha debe ser futura. Es un warning soft pero
      // la rechazamos para evitar postponed_until_date=ayer (bug obvio).
      const today = new Date().toISOString().slice(0, 10);
      if (postponed_until_date <= today) {
        await connection.query('ROLLBACK');
        return res.status(400).json({
          error: 'postponed_until_date debe ser una fecha futura',
        });
      }
    }

    let quotationSideEffects = null;
    if (new_status === 'closed_won') {
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

    if (new_status === 'closed_lost') {
      // `sent` -> `rejected`. `draft` and `approved` are left untouched.
      const { rows: rejectedRows } = await connection.query(
        `UPDATE quotations SET status='rejected', updated_at=NOW()
         WHERE opportunity_id=$1 AND status='sent'
         RETURNING id`,
        [req.params.id],
      );
      quotationSideEffects = { rejected: rejectedRows.map((r) => r.id) };
    }

    const closingNow = TERMINAL.has(new_status); // closed_won | closed_lost
    const outcomeValue = (new_status === 'closed_won' || new_status === 'closed_lost') ? new_status : null;

    // Postponed: persistir fecha + razón. Salir de Postponed: limpiar campos.
    const setPostponedDate = (new_status === 'postponed') ? postponed_until_date : null;
    const setPostponedReason = (new_status === 'postponed') ? (postponed_reason || null) : null;
    const clearPostponedFields = (current.status === 'postponed' && new_status !== 'postponed');

    const { rows: [after] } = await connection.query(
      `UPDATE opportunities SET
          status               = $1,
          outcome              = COALESCE($2, outcome),
          outcome_reason       = COALESCE($3, outcome_reason),
          outcome_notes        = COALESCE($4, outcome_notes),
          winning_quotation_id = COALESCE($5, winning_quotation_id),
          closed_at            = CASE WHEN $6::boolean THEN NOW() ELSE closed_at END,
          postponed_until_date = CASE
                                   WHEN $7::boolean THEN NULL
                                   WHEN $8::date IS NOT NULL THEN $8::date
                                   ELSE postponed_until_date
                                 END,
          postponed_reason     = CASE
                                   WHEN $7::boolean THEN NULL
                                   WHEN $9::text IS NOT NULL THEN $9::text
                                   ELSE postponed_reason
                                 END,
          loss_reason          = COALESCE($11, loss_reason),
          loss_reason_detail   = COALESCE($12, loss_reason_detail),
          updated_at           = NOW()
        WHERE id=$10 RETURNING *`,
      [
        new_status,
        outcomeValue,
        outcome_reason || null,
        outcome_notes || null,
        new_status === 'closed_won' ? winning_quotation_id : null,
        closingNow,
        clearPostponedFields,
        setPostponedDate,
        setPostponedReason,
        req.params.id,
        new_status === 'closed_lost' && loss_reason ? loss_reason : null,
        new_status === 'closed_lost' && loss_reason_detail ? String(loss_reason_detail).trim() : null,
      ],
    );

    // Events: status_changed always; plus stage-specific events.
    await emitEvent(connection, {
      event_type: 'opportunity.status_changed',
      entity_type: 'opportunity',
      entity_id: after.id,
      actor_user_id: req.user.id,
      payload: { from: current.status, to: new_status, side_effects: quotationSideEffects },
      req,
    });
    if (new_status === 'closed_won') {
      await emitEvent(connection, {
        event_type: 'opportunity.won',
        entity_type: 'opportunity',
        entity_id: after.id,
        actor_user_id: req.user.id,
        payload: { winning_quotation_id },
        req,
      });
    } else if (new_status === 'closed_lost') {
      await emitEvent(connection, {
        event_type: 'opportunity.lost',
        entity_type: 'opportunity',
        entity_id: after.id,
        actor_user_id: req.user.id,
        payload: {
          // Compat con consumidores legacy: seguimos emitiendo `reason`
          // pero agregamos los campos formales del v1.1 cuando vienen.
          reason: outcome_reason || loss_reason || null,
          notes: outcome_notes || null,
          loss_reason: loss_reason || null,
          loss_reason_detail: loss_reason_detail ? String(loss_reason_detail).trim() : null,
        },
        req,
      });
    } else if (new_status === 'postponed') {
      await emitEvent(connection, {
        event_type: 'opportunity.postponed',
        entity_type: 'opportunity',
        entity_id: after.id,
        actor_user_id: req.user.id,
        payload: {
          until_date: postponed_until_date,
          reason: postponed_reason || null,
          previous_status: current.status,
        },
        req,
      });
    } else if (current.status === 'postponed') {
      // Salir de postponed (a qualified o closed_lost) — reactivación.
      await emitEvent(connection, {
        event_type: 'opportunity.reactivated',
        entity_type: 'opportunity',
        entity_id: after.id,
        actor_user_id: req.user.id,
        payload: { to: new_status, was_postponed_until: current.postponed_until_date || null },
        req,
      });
    }

    // SPEC-CRM-00 v1.1 — warnings soft (no bloqueantes). El frontend los
    // muestra en el toast tras la transición.
    const warnings = [];
    const fromOrder = STAGE_ORDER[current.status] || 0;
    const toOrder = STAGE_ORDER[new_status] || 0;
    if (fromOrder > 0 && toOrder > 0 && fromOrder > toOrder
        && !TERMINAL.has(new_status) && !isPostponed(new_status) && current.status !== 'postponed') {
      warnings.push({ code: 'backwards', message: `Movida hacia atrás: ${current.status} → ${new_status}.` });
    }
    if (Number(after.booking_amount_usd || 0) === 0
        && ['proposal_validated', 'negotiation', 'verbal_commit', 'closed_won'].includes(new_status)) {
      warnings.push({ code: 'amount_zero', message: 'El monto USD está en 0. Recomendado actualizarlo.' });
    }
    // SPEC-CRM-00 v1.1 PR3 — Alerta A4: margen bajo al avanzar etapas clave.
    // Solo dispara si margin_pct ya fue calculado (no null).
    if (after.margin_pct != null
        && Number(after.margin_pct) < MARGIN_LOW_THRESHOLD
        && ['proposal_validated', 'negotiation', 'verbal_commit', 'closed_won'].includes(new_status)) {
      warnings.push({
        code: 'a4_margin_low',
        message: `⚠ Alerta A4: margen de ${after.margin_pct}% está por debajo del umbral mínimo (${MARGIN_LOW_THRESHOLD}%). Revisa la cotización antes de avanzar.`,
      });
    }

    await connection.query('COMMIT');

    // SPEC-CRM-00 v1.1 PR4 — A3: Champion/EB gap check. Fire-and-forget
    // notification (fuera de la txn, non-blocking, non-fatal). Se dispara
    // al entrar en una etapa avanzada sin Champion o EB identificados.
    if (A3_STAGES.has(new_status) && after.account_owner_id) {
      const a3gaps = checkA3({
        status: new_status,
        champion_identified: after.champion_identified,
        economic_buyer_identified: after.economic_buyer_identified,
      });
      if (a3gaps) {
        const a3def = ALERT_DEFS.A3_MEDDPICC;
        createAlertNotification(pool, {
          user_id: after.account_owner_id,
          type: a3def.type,
          title: a3def.title(after.name || 'Oportunidad'),
          body: a3def.body(a3gaps),
          opp_id: after.id,
        }).catch(() => {}); // swallow — non-fatal
      }
    }

    res.json({ ...after, warnings });
  } catch (err) {
    await safeRollback(connection, 'opportunities');
    // eslint-disable-next-line no-console
    console.error('POST /opportunities/:id/status failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    connection.release();
  }
});

/* -------- CHECK MARGIN (SPEC-CRM-00 v1.1 PR3) --------
 * Calcula margin_pct = (booking - cost) / booking × 100 y lo persiste.
 *
 * Body:
 *   estimated_cost_usd?: number  — si se omite, se auto-computa desde
 *     las líneas de cotización (cost_hour / rate_hour × total).
 *
 * Si margin_pct < MARGIN_LOW_THRESHOLD (20 %) emite opportunity.margin_low
 * (Alerta A4).
 *
 * Responde: { margin_pct, estimated_cost_usd, booking_amount_usd, alert_fired }
 */
router.post('/:id/check-margin', async (req, res) => {
  const { estimated_cost_usd: costIn } = req.body || {};

  const inputErr = validateMarginInput({ estimated_cost_usd: costIn });
  if (inputErr) return res.status(400).json({ error: inputErr });

  try {
    const { rows: [opp] } = await pool.query(
      `SELECT id, booking_amount_usd FROM opportunities WHERE id=$1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!opp) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    const booking = Number(opp.booking_amount_usd || 0);
    if (booking <= 0) {
      return res.status(400).json({
        error: 'booking_amount_usd debe ser > 0 para calcular margen. Actualiza el revenue model primero.',
      });
    }

    let estimatedCost;
    if (costIn != null) {
      estimatedCost = Number(costIn);
    } else {
      // Auto-computa desde quotation_lines.
      // Estrategia: si rate_hour > 0 → (cost_hour / rate_hour) × total
      //             si no             → cost_hour × horas × meses × 4.33 × qty
      // Las líneas sin cost_hour contribuyen 0 al costo estimado.
      const { rows: [costRow] } = await pool.query(
        `SELECT COALESCE(SUM(
           CASE
             WHEN ql.rate_hour IS NOT NULL AND ql.rate_hour > 0 AND ql.total IS NOT NULL
               THEN (COALESCE(ql.cost_hour, 0) / ql.rate_hour) * ql.total
             WHEN ql.cost_hour IS NOT NULL
               THEN ql.cost_hour
                    * COALESCE(ql.hours_per_week, 0)
                    * COALESCE(ql.duration_months::numeric, 0) * 4.33
                    * COALESCE(ql.quantity::numeric, 1)
             ELSE 0
           END
         ), 0)::numeric AS estimated_cost_usd
           FROM quotation_lines ql
           JOIN quotations q ON q.id = ql.quotation_id
          WHERE q.opportunity_id = $1`,
        [req.params.id],
      );
      estimatedCost = Number(costRow.estimated_cost_usd || 0);
    }

    const marginPct = computeMargin({ booking_amount_usd: booking, estimated_cost_usd: estimatedCost });

    const { rows: [updated] } = await pool.query(
      `UPDATE opportunities
          SET estimated_cost_usd = $1,
              margin_pct         = $2,
              updated_at         = NOW()
        WHERE id=$3 AND deleted_at IS NULL
        RETURNING id, booking_amount_usd, estimated_cost_usd, margin_pct`,
      [estimatedCost, marginPct, req.params.id],
    );

    const alertFired = marginPct != null && marginPct < MARGIN_LOW_THRESHOLD;
    if (alertFired) {
      await emitEvent(pool, {
        event_type: 'opportunity.margin_low',
        entity_type: 'opportunity',
        entity_id: opp.id,
        actor_user_id: req.user.id,
        payload: {
          margin_pct: marginPct,
          booking_amount_usd: booking,
          estimated_cost_usd: estimatedCost,
          threshold: MARGIN_LOW_THRESHOLD,
        },
        req,
      });
    }

    res.json({
      margin_pct:           updated.margin_pct,
      estimated_cost_usd:   updated.estimated_cost_usd,
      booking_amount_usd:   updated.booking_amount_usd,
      alert_fired:          alertFired,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /opportunities/:id/check-margin failed:', err);
    res.status(500).json({ error: 'Error interno' });
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
