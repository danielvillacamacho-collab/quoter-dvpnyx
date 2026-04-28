/**
 * Helpers de Employee Costs (espejo del catálogo de
 * `server/utils/cost_calc.js`).
 *
 * Si agregas una moneda nueva, hacelo en AMBOS archivos.
 */

export const VALID_CURRENCIES = ['USD', 'COP', 'MXN', 'GTQ', 'EUR'];

/** "202604" → "2026-04". Usado para mostrar al usuario. */
export function formatPeriod(period) {
  if (!period) return '—';
  const s = String(period).replace('-', '');
  if (s.length !== 6) return String(period);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
}

/** "2026-04" o "202604" → "202604" (canónico para enviar al server). */
export function normalizePeriod(input) {
  if (!input) return null;
  const s = String(input).replace('-', '');
  return /^\d{6}$/.test(s) ? s : null;
}

/** Mes actual en formato YYYYMM (UTC). */
export function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Período anterior. '202604' → '202603'. */
export function previousPeriod(p) {
  const norm = normalizePeriod(p);
  if (!norm) return null;
  let y = parseInt(norm.slice(0, 4), 10);
  let m = parseInt(norm.slice(4, 6), 10) - 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}${String(m).padStart(2, '0')}`;
}

/** Período siguiente. '202604' → '202605'. */
export function nextPeriod(p) {
  const norm = normalizePeriod(p);
  if (!norm) return null;
  let y = parseInt(norm.slice(0, 4), 10);
  let m = parseInt(norm.slice(4, 6), 10) + 1;
  if (m === 13) { m = 1; y += 1; }
  return `${y}${String(m).padStart(2, '0')}`;
}

/** Genera lista de N períodos hacia atrás desde el actual (incluido). */
export function recentPeriods(count = 12) {
  const out = [];
  let p = currentPeriod();
  for (let i = 0; i < count; i++) {
    out.push(p);
    p = previousPeriod(p);
  }
  return out;
}

/**
 * Formato monetario. Default USD, pero acepta otra moneda.
 * Ej. formatMoney(12500000, 'COP') → "$12,500,000".
 *     formatMoney(3000.45, 'USD') → "$3,000.45".
 */
export function formatMoney(amount, currency = 'USD', { decimals } = {}) {
  if (amount == null || isNaN(Number(amount))) return '—';
  const n = Number(amount);
  // USD con decimales; COP/MXN/GTQ usualmente sin (montos grandes) salvo USD pequeño.
  const dec = decimals != null
    ? decimals
    : (currency === 'USD' || Math.abs(n) < 1000 ? 2 : 0);
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(dec)}`;
  }
}

/** ¿la moneda recomendada según país? Devuelve la "default" sugerida. */
export function defaultCurrencyForCountry(country) {
  if (!country) return 'USD';
  const c = String(country).toLowerCase();
  if (c.includes('colombia') || c === 'co') return 'COP';
  if (c.includes('méxico') || c.includes('mexico') || c === 'mx') return 'MXN';
  if (c.includes('guatemala') || c === 'gt') return 'GTQ';
  if (c.includes('españa') || c.includes('spain') || c === 'es') return 'EUR';
  return 'USD';
}

/** Color del semáforo según zone (alineado a delta zones del server). */
export function deltaZoneColor(zone) {
  switch (zone) {
    case 'on_target':   return 'var(--ds-ok, #16a34a)';
    case 'warn':        return 'var(--ds-warn, #ca8a04)';
    case 'alert':       return 'var(--ds-bad, #dc2626)';
    case 'no_baseline': return 'var(--ds-text-dim, #6b7280)';
    case 'no_data':     return 'var(--ds-text-dim, #6b7280)';
    default:            return 'inherit';
  }
}
export function deltaZoneLabel(zone) {
  return ({
    on_target: '✓ En rango',
    warn: '⚠ Atención',
    alert: '✕ Desviación',
    no_baseline: 'Sin baseline',
    no_data: '—',
  })[zone] || zone;
}
