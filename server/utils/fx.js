/*
 * Currency conversion helpers (RR-MVP-00.6).
 *
 * Convención: usd_rate(yyyymm, currency) = N tal que 1 USD = N <currency>.
 * USD tiene rate=1.0 implícito (no vive en la tabla). Si no hay rate para
 * ese yyyymm, el caller decide fallback (suele usar último rate disponible).
 *
 * El equipo de ingeniería va a refactorizar esto en un servicio formal
 * con caching + locked rates por mes cerrado. Por ahora es una función
 * pura sobre un `rates` map cargado por el caller.
 */

// rates: Map keyed by `${yyyymm}|${currency}` → Number
function rateKey(yyyymm, currency) { return `${yyyymm}|${currency.toUpperCase()}`; }

/**
 * Resuelve el rate para (yyyymm, currency) con fallback al rate más
 * reciente ≤ yyyymm para esa misma moneda. Si no encuentra ninguno,
 * retorna null y el caller decide qué hacer (warning, dejar null, etc.).
 */
function resolveRate(rates, yyyymm, currency) {
  const ccy = String(currency || 'USD').toUpperCase();
  if (ccy === 'USD') return 1;
  // Direct hit
  const direct = rates.get(rateKey(yyyymm, ccy));
  if (direct != null) return direct;
  // Fallback: more-recent <= yyyymm (caller pre-loads sorted set)
  const fb = (rates._fallback || {})[ccy];
  if (fb && yyyymm) {
    // Find most recent month <= yyyymm in fb (sorted asc by yyyymm).
    let best = null;
    for (const [mm, val] of fb) {
      if (mm <= yyyymm) best = val; else break;
    }
    return best;
  }
  return null;
}

/**
 * Convierte amount de una moneda a otra usando rates del yyyymm.
 * Retorna { amount: Number|null, rateUsed: { from, to, fxFrom, fxTo } | null }.
 */
function convert(amount, fromCcy, toCcy, yyyymm, rates) {
  if (amount == null) return { amount: null, rateUsed: null };
  const from = String(fromCcy || 'USD').toUpperCase();
  const to = String(toCcy || 'USD').toUpperCase();
  if (from === to) return { amount: Number(amount), rateUsed: { from, to, fxFrom: 1, fxTo: 1 } };
  const fxFrom = resolveRate(rates, yyyymm, from);
  const fxTo = resolveRate(rates, yyyymm, to);
  if (fxFrom == null || fxTo == null) return { amount: null, rateUsed: null };
  const amountUsd = from === 'USD' ? Number(amount) : Number(amount) / Number(fxFrom);
  const amountTo = to === 'USD' ? amountUsd : amountUsd * Number(fxTo);
  return { amount: amountTo, rateUsed: { from, to, fxFrom: Number(fxFrom), fxTo: Number(fxTo) } };
}

/**
 * Construye un Map a partir de filas de exchange_rates. Filas tipo:
 *   { yyyymm, currency, usd_rate }
 * Resultado: Map.get('202604|COP') → rate. También adjunta `_fallback`
 * = { COP: [['202601', x], ['202603', y], ...] } sorted asc por yyyymm.
 */
function buildRatesMap(rows) {
  const map = new Map();
  const fb = {};
  for (const r of rows) {
    map.set(rateKey(r.yyyymm, r.currency), Number(r.usd_rate));
    const ccy = String(r.currency).toUpperCase();
    if (!fb[ccy]) fb[ccy] = [];
    fb[ccy].push([r.yyyymm, Number(r.usd_rate)]);
  }
  // Sort asc each currency by yyyymm
  for (const ccy of Object.keys(fb)) fb[ccy].sort((a, b) => a[0].localeCompare(b[0]));
  map._fallback = fb;
  return map;
}

module.exports = { convert, resolveRate, buildRatesMap };
