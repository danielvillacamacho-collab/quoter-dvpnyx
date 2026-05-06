/**
 * Budgets CRUD — Commercial booking targets by period/country/owner/service line.
 *
 * Scope ownership:
 *   - Any authenticated user (member+) may read budgets.
 *   - Only admin+ can create, update, or delete.
 *   - Hard delete is allowed (budgets are config data, not transactional).
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

const SORTABLE = {
  period_year:    'b.period_year',
  period_quarter: 'b.period_quarter',
  period_month:   'b.period_month',
  country:        'b.country',
  target_usd:     'b.target_usd',
  status:         'b.status',
  created_at:     'b.created_at',
  owner_name:     '(SELECT u2.name FROM users u2 WHERE u2.id = b.owner_id)',
};

const VALID_STATUSES = ['draft', 'active', 'closed'];

router.use(auth);

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const wheres = [];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.period_year)    wheres.push(`b.period_year = ${add(Number(req.query.period_year))}`);
    if (req.query.period_quarter) wheres.push(`b.period_quarter = ${add(Number(req.query.period_quarter))}`);
    if (req.query.period_month)   wheres.push(`b.period_month = ${add(Number(req.query.period_month))}`);
    if (req.query.country)        wheres.push(`b.country = ${add(req.query.country)}`);
    if (req.query.owner_id)       wheres.push(`b.owner_id = ${add(req.query.owner_id)}`);
    if (req.query.service_line)   wheres.push(`b.service_line = ${add(req.query.service_line)}`);
    if (req.query.status)         wheres.push(`b.status = ${add(req.query.status)}`);

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const sort = parseSort(req.query, SORTABLE, {
      defaultField: 'period_year', defaultDir: 'desc', tieBreaker: 'b.period_quarter ASC NULLS LAST, b.period_month ASC NULLS LAST, b.id ASC',
    });
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM budgets b ${where}`, params),
      pool.query(
        `SELECT b.*,
           ow.name  AS owner_name,
           ab.name  AS approved_by_name
         FROM budgets b
         LEFT JOIN users ow ON ow.id = b.owner_id
         LEFT JOIN users ab ON ab.id = b.approved_by
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
  } catch (err) { serverError(res, 'GET /budgets', err); }
});

/* -------- SUMMARY -------- */
router.get('/summary', async (req, res) => {
  try {
    const tWheres = ["b.status = 'active'"];
    const tParams = [];
    const addT = (v) => { tParams.push(v); return `$${tParams.length}`; };

    if (req.query.period_year) tWheres.push(`b.period_year = ${addT(Number(req.query.period_year))}`);

    const groupCol = req.query.by_quarter === 'true'
      ? 'b.period_year, b.period_quarter'
      : 'b.period_year';
    const selectCol = req.query.by_quarter === 'true'
      ? 'b.period_year, b.period_quarter, SUM(b.target_usd)::numeric AS target_usd'
      : 'b.period_year, SUM(b.target_usd)::numeric AS target_usd';

    const tWhere = 'WHERE ' + tWheres.join(' AND ');
    const targets = await pool.query(
      `SELECT ${selectCol}
       FROM budgets b ${tWhere}
       GROUP BY ${groupCol}
       ORDER BY b.period_year DESC${req.query.by_quarter === 'true' ? ', b.period_quarter ASC' : ''}`,
      tParams,
    );

    // Actuals: closed_won opportunities grouped the same way
    const aWheres = ["o.status = 'closed_won'", 'o.deleted_at IS NULL'];
    const aParams = [];
    const addA = (v) => { aParams.push(v); return `$${aParams.length}`; };

    if (req.query.period_year) aWheres.push(`EXTRACT(YEAR FROM o.closed_at) = ${addA(Number(req.query.period_year))}`);

    const aGroupCol = req.query.by_quarter === 'true'
      ? 'EXTRACT(YEAR FROM o.closed_at), EXTRACT(QUARTER FROM o.closed_at)'
      : 'EXTRACT(YEAR FROM o.closed_at)';
    const aSelectCol = req.query.by_quarter === 'true'
      ? 'EXTRACT(YEAR FROM o.closed_at)::int AS period_year, EXTRACT(QUARTER FROM o.closed_at)::int AS period_quarter, SUM(o.booking_amount_usd)::numeric AS actual_usd'
      : 'EXTRACT(YEAR FROM o.closed_at)::int AS period_year, SUM(o.booking_amount_usd)::numeric AS actual_usd';

    const aWhere = 'WHERE ' + aWheres.join(' AND ');
    const actuals = await pool.query(
      `SELECT ${aSelectCol}
       FROM opportunities o ${aWhere}
       GROUP BY ${aGroupCol}
       ORDER BY 1 DESC${req.query.by_quarter === 'true' ? ', 2 ASC' : ''}`,
      aParams,
    );

    res.json({ targets: targets.rows, actuals: actuals.rows });
  } catch (err) { serverError(res, 'GET /budgets/summary', err); }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*,
         ow.name  AS owner_name,
         ab.name  AS approved_by_name
       FROM budgets b
       LEFT JOIN users ow ON ow.id = b.owner_id
       LEFT JOIN users ab ON ab.id = b.approved_by
       WHERE b.id = $1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /budgets/:id', err); }
});

/* -------- CREATE (admin+) -------- */
router.post('/', adminOnly, async (req, res) => {
  const {
    period_year, period_quarter, period_month, country,
    owner_id, service_line, target_usd, status, notes,
  } = req.body || {};

  if (!period_year) return res.status(400).json({ error: 'period_year es requerido' });
  if (target_usd === undefined || target_usd === null) return res.status(400).json({ error: 'target_usd es requerido' });
  if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Status inválido' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO budgets
         (period_year, period_quarter, period_month, country, owner_id,
          service_line, target_usd, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'draft'),$9,$10)
       RETURNING *`,
      [
        period_year,
        period_quarter || null,
        period_month || null,
        country || null,
        owner_id || null,
        service_line || null,
        target_usd,
        status || null,
        notes || null,
        req.user.id,
      ],
    );
    const budget = rows[0];
    await emitEvent(pool, {
      event_type: 'budget.created',
      entity_type: 'budget',
      entity_id: budget.id,
      actor_user_id: req.user.id,
      payload: { period_year: budget.period_year, target_usd: budget.target_usd, status: budget.status },
      req,
    });
    res.status(201).json(budget);
  } catch (err) { serverError(res, 'POST /budgets', err); }
});

/* -------- UPDATE (admin+) -------- */
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: [before] } = await pool.query(
      `SELECT * FROM budgets WHERE id = $1`,
      [req.params.id],
    );
    if (!before) return res.status(404).json({ error: 'Presupuesto no encontrado' });

    const body = req.body || {};
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    // If status changes to 'active', auto-set approved_by and approved_at
    const becomingActive = body.status === 'active' && before.status !== 'active';

    const { rows } = await pool.query(
      `UPDATE budgets SET
          period_year    = COALESCE($1, period_year),
          period_quarter = COALESCE($2, period_quarter),
          period_month   = COALESCE($3, period_month),
          country        = COALESCE($4, country),
          owner_id       = COALESCE($5, owner_id),
          service_line   = COALESCE($6, service_line),
          target_usd     = COALESCE($7, target_usd),
          status         = COALESCE($8, status),
          notes          = COALESCE($9, notes),
          approved_by    = CASE WHEN $10 THEN $11 ELSE approved_by END,
          approved_at    = CASE WHEN $10 THEN NOW() ELSE approved_at END,
          updated_at     = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        body.period_year ?? null,
        body.period_quarter ?? null,
        body.period_month ?? null,
        body.country ?? null,
        body.owner_id ?? null,
        body.service_line ?? null,
        body.target_usd ?? null,
        body.status ?? null,
        body.notes ?? null,
        becomingActive,
        req.user.id,
        req.params.id,
      ],
    );
    const after = rows[0];
    await emitEvent(pool, {
      event_type: 'budget.updated',
      entity_type: 'budget',
      entity_id: after.id,
      actor_user_id: req.user.id,
      payload: { period_year: after.period_year, target_usd: after.target_usd, status: after.status },
      req,
    });
    res.json(after);
  } catch (err) { serverError(res, 'PUT /budgets/:id', err); }
});

/* -------- DELETE (admin+) -------- */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM budgets WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    await emitEvent(pool, {
      event_type: 'budget.deleted',
      entity_type: 'budget',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { period_year: rows[0].period_year, target_usd: rows[0].target_usd },
      req,
    });
    res.json({ message: 'Presupuesto eliminado' });
  } catch (err) { serverError(res, 'DELETE /budgets/:id', err); }
});

module.exports = router;
