/**
 * Sanitize / validation helpers para inputs de query strings y params.
 *
 * El objetivo: una sola fuente de verdad para parsear y validar inputs
 * comunes, en vez de repetir patrones inconsistentes (`parseInt | NaN |
 * Math.min/max`) en cada ruta.
 *
 * Convenciones:
 *   - `parseX` retorna el valor SI es válido, o el default si no.
 *   - `requireX` retorna `{ value, error }`. Cuando hay error, el caller
 *     responde 400. Cuando no hay error, value es el valor saneado.
 *   - Nunca lanzan: la rama de error es responsabilidad del caller.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// PostgreSQL UUIDs: 8-4-4-4-12, version y variant variables.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `?page=&limit=` con defaults y clamps. Devuelve { page, limit, offset }. */
function parsePagination(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const page = parseFiniteInt(query.page, 1);
  const limitRaw = parseFiniteInt(query.limit, defaultLimit);
  const limit = Math.min(Math.max(limitRaw, 1), maxLimit);
  const offset = (Math.max(page, 1) - 1) * limit;
  return { page: Math.max(page, 1), limit, offset };
}

/** Number entero finito ≥ 0; retorna `fallback` si NaN/undefined/no-numérico. */
function parseFiniteInt(input, fallback = 0) {
  if (input == null || input === '') return fallback;
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/** Number finito (puede ser decimal); retorna `fallback` si inválido. */
function parseFiniteNumber(input, fallback = 0) {
  if (input == null || input === '') return fallback;
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

/** Verifica que `s` sea un UUID válido (string lo suficientemente bien formado). */
function isValidUUID(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

/** Verifica que `s` sea una fecha ISO YYYY-MM-DD válida (parseable y consistente). */
function isValidISODate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  // Reject 2026-02-30 etc. — Date(parses) y reconstruimos para confirmar.
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

/**
 * Lunes (UTC) de la semana que contiene la fecha ISO dada. Retorna null si
 * la fecha es inválida. Útil para endpoints semanales que aceptan cualquier
 * día y normalizan al lunes.
 */
function mondayOf(dateIso) {
  if (!isValidISODate(dateIso)) return null;
  const d = new Date(dateIso + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  parsePagination,
  parseFiniteInt,
  parseFiniteNumber,
  isValidUUID,
  isValidISODate,
  mondayOf,
  UUID_RE,
  ISO_DATE_RE,
};
