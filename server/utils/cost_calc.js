/**
 * Helpers para Employee Costs (spec_costos_empleado.docx).
 *
 * Funciones puras: validación de período, monedas, conversión a USD.
 * El I/O contra DB lo hace el route. Esto es testeable sin pool.
 */

const VALID_CURRENCIES = ['USD', 'COP', 'MXN', 'GTQ', 'EUR'];

/** YYYYMM regex. */
const PERIOD_RE = /^[0-9]{6}$/;

/**
 * Valida que period sea un YYYYMM válido (mes 01-12, año 2000-2100).
 * Retorna `{ ok, period? , error? }`.
 */
function validatePeriod(input) {
  if (input == null) return { ok: false, error: 'period es requerido' };
  const s = String(input).trim();
  // Acepta también "YYYY-MM" para conveniencia del caller — normaliza a YYYYMM.
  const norm = s.replace('-', '');
  if (!PERIOD_RE.test(norm)) {
    return { ok: false, error: 'period debe ser YYYYMM o YYYY-MM' };
  }
  const year = parseInt(norm.slice(0, 4), 10);
  const month = parseInt(norm.slice(4, 6), 10);
  if (year < 2000 || year > 2100) return { ok: false, error: 'period: año fuera de rango (2000..2100)' };
  if (month < 1 || month > 12) return { ok: false, error: 'period: mes fuera de rango (01..12)' };
  return { ok: true, period: norm };
}

/** Devuelve el período anterior. '202604' → '202603', '202601' → '202512'. */
function previousPeriod(yyyymm) {
  const v = validatePeriod(yyyymm);
  if (!v.ok) return null;
  let year = parseInt(v.period.slice(0, 4), 10);
  let month = parseInt(v.period.slice(4, 6), 10);
  month -= 1;
  if (month === 0) { month = 12; year -= 1; }
  return `${year}${String(month).padStart(2, '0')}`;
}

/** Comparar períodos lexicográficamente (funciona porque YYYYMM zero-padded). */
function periodLessThan(a, b) { return String(a) < String(b); }
function periodLessOrEqual(a, b) { return String(a) <= String(b); }

/** Período del mes actual en UTC. */
function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** ¿period está dentro de N meses hacia adelante del mes actual? Default 1. */
function periodWithinAllowedFuture(period, monthsAhead = 1) {
  const v = validatePeriod(period);
  if (!v.ok) return false;
  const now = currentPeriod();
  if (v.period <= now) return true; // pasado o presente, OK
  // Calcular máximo permitido sumando monthsAhead.
  let year = parseInt(now.slice(0, 4), 10);
  let month = parseInt(now.slice(4, 6), 10) + monthsAhead;
  while (month > 12) { month -= 12; year += 1; }
  const maxAllowed = `${year}${String(month).padStart(2, '0')}`;
  return v.period <= maxAllowed;
}

/** Validar moneda contra catálogo. */
function validateCurrency(input) {
  if (input == null) return { ok: false, error: 'currency es requerido' };
  const c = String(input).toUpperCase().trim();
  if (!VALID_CURRENCIES.includes(c)) {
    return { ok: false, error: `currency inválida (válidas: ${VALID_CURRENCIES.join(', ')})` };
  }
  return { ok: true, currency: c };
}

/**
 * Convierte gross_cost en una moneda a USD usando una tasa.
 * Devuelve `{ cost_usd, exchange_rate_used }`.
 *
 * Convención (consistente con utils/fx.js y exchange_rates):
 *   usd_rate = N tal que 1 USD = N <currency>
 *   Por lo tanto cost_usd = gross_cost / usd_rate
 *   Para currency='USD', usd_rate=1.0 implícito.
 */
function convertToUsd(grossCost, currency, usdRate) {
  const gross = Number(grossCost);
  if (!Number.isFinite(gross) || gross < 0) return { cost_usd: null, exchange_rate_used: null };
  const cur = String(currency || '').toUpperCase();
  if (cur === 'USD') {
    return { cost_usd: round2(gross), exchange_rate_used: 1 };
  }
  if (!usdRate || !Number.isFinite(Number(usdRate)) || Number(usdRate) <= 0) {
    return { cost_usd: null, exchange_rate_used: null };
  }
  const rate = Number(usdRate);
  return { cost_usd: round2(gross / rate), exchange_rate_used: rate };
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Devuelve el último mes en que el empleado estuvo activo (mes de termino o
 * mes actual si sigue activo). Usado para decidir si un período es válido
 * para registrar costo de una persona.
 *
 * @param {object} emp { start_date, end_date, status } — fechas como Date o string ISO.
 */
function employeeActiveRange(emp) {
  const startMonth = monthOfDate(emp.start_date);
  const endMonth = emp.end_date ? monthOfDate(emp.end_date) : null;
  return { startMonth, endMonth };
}

function monthOfDate(d) {
  if (!d) return null;
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Decide si un (employee, period) es válido para registrar costo:
 *   - period >= mes de inicio del empleado
 *   - period <= mes de fin (si está terminado)
 *   - period dentro del rango permitido (no muy lejos en el futuro)
 *
 * Retorna `{ ok, error?, code? }` con códigos accionables.
 */
function validateEmployeePeriod(emp, period, opts = {}) {
  const v = validatePeriod(period);
  if (!v.ok) return { ok: false, code: 'period_invalid', error: v.error };
  if (!periodWithinAllowedFuture(v.period, opts.monthsAhead ?? 1)) {
    return {
      ok: false, code: 'period_too_far_future',
      error: 'period demasiado lejos en el futuro (máximo 1 mes adelante por default)',
    };
  }
  const { startMonth, endMonth } = employeeActiveRange(emp);
  if (startMonth && v.period < startMonth) {
    return {
      ok: false, code: 'period_before_employee_start',
      error: `period ${v.period} es anterior al mes de inicio del empleado (${startMonth})`,
    };
  }
  if (endMonth && v.period > endMonth) {
    return {
      ok: false, code: 'period_after_employee_end',
      error: `period ${v.period} es posterior al mes de termino del empleado (${endMonth})`,
    };
  }
  return { ok: true, period: v.period };
}

/**
 * Calcula el "δ vs teórico" entre el costo real y el teórico del nivel.
 * Devuelve un objeto con el delta absoluto, % y la "zona" semáforo.
 *
 * - Verde (`on_target`):  |Δ%| <= 5
 * - Amarillo (`warn`):    5 < |Δ%| <= 15
 * - Rojo (`alert`):       |Δ%| > 15
 *
 * Si theoretical es 0/null → zone='no_baseline'.
 */
function deltaVsTheoretical(real, theoretical) {
  // null / undefined explícitos (Number(null)=0 → escapaba la guarda).
  if (real == null) return { delta: null, deltaPct: null, zone: 'no_data' };
  const r = Number(real);
  const t = Number(theoretical);
  if (!Number.isFinite(r)) return { delta: null, deltaPct: null, zone: 'no_data' };
  if (!Number.isFinite(t) || t <= 0) {
    return { delta: null, deltaPct: null, zone: 'no_baseline' };
  }
  const delta = round2(r - t);
  const deltaPct = round2((delta / t) * 100);
  const abs = Math.abs(deltaPct);
  let zone;
  if (abs <= 5) zone = 'on_target';
  else if (abs <= 15) zone = 'warn';
  else zone = 'alert';
  return { delta, deltaPct, zone };
}

module.exports = {
  VALID_CURRENCIES,
  PERIOD_RE,
  validatePeriod,
  previousPeriod,
  periodLessThan,
  periodLessOrEqual,
  currentPeriod,
  periodWithinAllowedFuture,
  validateCurrency,
  convertToUsd,
  validateEmployeePeriod,
  deltaVsTheoretical,
};
