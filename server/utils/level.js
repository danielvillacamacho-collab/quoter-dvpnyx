/**
 * Helper unificado para el "level" de un recurso (L1..L11).
 *
 * El sistema tiene dos representaciones históricamente:
 *   - `quotation_lines.level INT` (1..11)            — V1 legacy
 *   - `employees.level VARCHAR(5)` ('L1'..'L11')      — V2 spec
 *   - `resource_requests.level VARCHAR(5)`            — V2 spec
 *
 * Cualquier código que cruce estos modelos (kick-off, candidate matching,
 * reportes) tiene que mapear. Antes vivía inline en cada lugar — ahora
 * vive aquí.
 */

const VALID_INT_LEVELS    = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const VALID_STRING_LEVELS = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];

/**
 * INT → 'Lx' (1 → 'L1'). Devuelve null si el input es inválido.
 * Acepta también string numéricos ('5' → 'L5') por conveniencia.
 */
function levelIntToString(input) {
  if (input == null) return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  if (!VALID_INT_LEVELS.includes(t)) return null;
  return `L${t}`;
}

/** 'Lx' → INT. Devuelve null si el input es inválido. */
function levelStringToInt(input) {
  if (typeof input !== 'string') return null;
  if (!VALID_STRING_LEVELS.includes(input)) return null;
  return Number(input.slice(1));
}

/**
 * Normalizar a string. Acepta INT, string numérico o 'Lx'. Devuelve
 * 'Lx' si válido, null si no. Útil cuando el input viene de fuentes
 * mixtas (CSV import, kick-off seeding desde quotation, etc.).
 */
function normalizeLevel(input) {
  if (typeof input === 'string' && VALID_STRING_LEVELS.includes(input)) return input;
  return levelIntToString(input);
}

/**
 * Distancia entre dos niveles (siempre positiva). Útil para validation
 * engines que califican gap entre el nivel del request y el del candidato.
 * Devuelve null si alguno es inválido.
 */
function levelDistance(a, b) {
  const ai = typeof a === 'number' ? a : levelStringToInt(a);
  const bi = typeof b === 'number' ? b : levelStringToInt(b);
  if (ai == null || bi == null) return null;
  return Math.abs(ai - bi);
}

module.exports = {
  VALID_INT_LEVELS,
  VALID_STRING_LEVELS,
  levelIntToString,
  levelStringToInt,
  normalizeLevel,
  levelDistance,
};
