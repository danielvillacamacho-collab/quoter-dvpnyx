/**
 * Exchange rates admin (RR-MVP-00.6).
 *
 * Tabla matricial de tasas de cambio mensuales tipo Excel:
 *   - filas = currency (COP, MXN, GTQ, EUR, ...)
 *   - columnas = yyyymm
 *   - cell = usd_rate (1 USD = N currency)
 *
 * USD no se almacena (rate=1 implícito en código). Eng team va a
 * refactorizar esto a un servicio con caching + lock post-cierre.
 *
 * Endpoints (admin only):
 *   GET    /api/admin/exchange-rates?from=YYYYMM&to=YYYYMM[&currency=COP]
 *   PUT    /api/admin/exchange-rates/:yyyymm/:currency  body: { usd_rate, notes? }
 *   DELETE /api/admin/exchange-rates/:yyyymm/:currency
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { serverError } = require('../utils/http');

router.use(auth);

const YYYYMM_RE = /^[0-9]{6}$/;
const CCY_RE = /^[A-Z]{3}$/;

function expandMonths(from, to) {
  if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) return [];
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4));
  const yEnd = Number(to.slice(0, 4));
  const mEnd = Number(to.slice(4));
  let safety = 0;
  while ((y < yEnd || (y === yEnd && m <= mEnd)) && safety < 240) {
    out.push(`${y.toString().padStart(4, '0')}${m.toString().padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
    safety += 1;
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) {
      return res.status(400).json({ error: 'from/to inválidos (formato YYYYMM)' });
    }
    const months = expandMonths(from, to);
    if (!months.length) return res.status(400).json({ error: 'Rango de meses vacío' });

    const params = [from, to];
    let where = `WHERE yyyymm BETWEEN $1 AND $2`;
    if (req.query.currency) {
      const ccy = String(req.query.currency).toUpperCase();
      if (!CCY_RE.test(ccy)) return res.status(400).json({ error: 'currency inválido (ISO 4217 3 letras)' });
      params.push(ccy);
      where += ` AND currency = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT yyyymm, currency, usd_rate, notes, updated_at, updated_by
         FROM exchange_rates ${where}
         ORDER BY currency ASC, yyyymm ASC`,
      params,
    );

    // Distinct currencies presentes en el rango (filas de la matriz).
    const currencies = Array.from(new Set(rows.map((r) => r.currency))).sort();
    // Construir matriz por (currency, yyyymm).
    const cellMap = {};
    rows.forEach((r) => {
      cellMap[`${r.currency}|${r.yyyymm}`] = {
        usd_rate: Number(r.usd_rate),
        notes: r.notes,
        updated_at: r.updated_at,
        updated_by: r.updated_by,
      };
    });

    res.json({ months, currencies, cells: cellMap });
  } catch (err) {
    serverError(res, 'GET /admin/exchange-rates', err);
  }
});

router.put('/:yyyymm/:currency', adminOnly, async (req, res) => {
  const { yyyymm } = req.params;
  const currency = String(req.params.currency || '').toUpperCase();
  if (!YYYYMM_RE.test(yyyymm)) return res.status(400).json({ error: 'yyyymm inválido' });
  if (!CCY_RE.test(currency)) return res.status(400).json({ error: 'currency inválido (ISO 4217 3 letras)' });
  if (currency === 'USD') return res.status(400).json({ error: 'USD no se almacena (rate=1 implícito)' });
  const body = req.body || {};
  const usdRate = Number(body.usd_rate);
  if (!Number.isFinite(usdRate) || usdRate <= 0) {
    return res.status(400).json({ error: 'usd_rate debe ser > 0' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO exchange_rates (yyyymm, currency, usd_rate, notes, updated_by)
         VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (yyyymm, currency) DO UPDATE SET
         usd_rate   = EXCLUDED.usd_rate,
         notes      = EXCLUDED.notes,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [yyyymm, currency, usdRate, body.notes || null, req.user.id],
    );
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'exchange_rate_upsert', 'exchange_rate', NULL,
                 jsonb_build_object('yyyymm', $2::text, 'currency', $3::text, 'usd_rate', $4::numeric))`,
      [req.user.id, yyyymm, currency, usdRate],
    );
    res.json(rows[0]);
  } catch (err) {
    serverError(res, 'PUT /admin/exchange-rates/:yyyymm/:currency', err);
  }
});

router.delete('/:yyyymm/:currency', adminOnly, async (req, res) => {
  const { yyyymm } = req.params;
  const currency = String(req.params.currency || '').toUpperCase();
  if (!YYYYMM_RE.test(yyyymm)) return res.status(400).json({ error: 'yyyymm inválido' });
  if (!CCY_RE.test(currency)) return res.status(400).json({ error: 'currency inválido' });
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM exchange_rates WHERE yyyymm=$1 AND currency=$2`,
      [yyyymm, currency],
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Rate no encontrado' });
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'exchange_rate_delete', 'exchange_rate', NULL,
                 jsonb_build_object('yyyymm', $2::text, 'currency', $3::text))`,
      [req.user.id, yyyymm, currency],
    );
    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'DELETE /admin/exchange-rates/:yyyymm/:currency', err);
  }
});

module.exports = router;
module.exports._internal = { expandMonths };
