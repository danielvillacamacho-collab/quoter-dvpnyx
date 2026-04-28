/**
 * Slug generation — URL-friendly identifiers para entidades.
 *
 * Por qué importan:
 *   - URLs legibles (`/contracts/bancolombia-corepay-2026q2` vs UUID)
 *   - LLMs razonan mejor con slugs que con UUIDs
 *   - Logs y discusiones humanas son más claros
 *
 * Convenciones:
 *   - lowercase, ASCII, separado por guiones
 *   - máximo 80 chars (truncado por palabra)
 *   - sin tildes (NFD + remove diacríticos)
 *   - sin caracteres especiales
 *   - colisiones se resuelven con sufijo `-2`, `-3`, …
 */

/**
 * Convierte un string a slug. Pure function, no toca DB.
 *
 * Ejemplos:
 *   slugify('Bancolombia CorePay Q2 2026') → 'bancolombia-corepay-q2-2026'
 *   slugify('Programa Académico — Año 1') → 'programa-academico-ano-1'
 *   slugify('  hola  mundo  ')             → 'hola-mundo'
 *   slugify('')                              → null
 */
function slugify(input, { maxLength = 80 } = {}) {
  if (input == null) return null;
  const text = String(input).trim();
  if (!text) return null;

  // Descomponer y eliminar diacríticos (combining marks). Usamos Unicode
  // property escape para no depender de literales que podrían perderse en
  // copy-paste cross-platform.
  const stripped = text.normalize('NFD').replace(/\p{M}/gu, '');

  // A lowercase + reemplazar no-alfanuméricos por '-'.
  const ascii = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!ascii) return null;

  // Truncar respetando límite de palabras (no cortar a la mitad).
  if (ascii.length <= maxLength) return ascii;
  const truncated = ascii.slice(0, maxLength);
  const lastDash = truncated.lastIndexOf('-');
  return lastDash > maxLength * 0.6 ? truncated.slice(0, lastDash) : truncated;
}

/**
 * Genera un slug único contra una función `existsFn(candidate) → boolean`.
 * Empieza con el slug base y va probando `-2`, `-3`, … hasta encontrar libre.
 *
 * `existsFn` es async-friendly: el caller hace la query a su tabla.
 *
 * Caps a 100 intentos antes de lanzar — proteger de loops infinitos en
 * caso de bug en existsFn.
 */
async function uniqueSlug(input, existsFn, opts = {}) {
  const base = slugify(input, opts);
  if (!base) return null;
  if (!(await existsFn(base))) return base;

  for (let i = 2; i <= 100; i++) {
    const candidate = `${base}-${i}`;
    // Si alarga demasiado, recortar el base para respetar maxLength.
    if (candidate.length > (opts.maxLength || 80)) {
      const room = (opts.maxLength || 80) - String(i).length - 1;
      const trimmed = base.slice(0, room).replace(/-+$/g, '');
      const c2 = `${trimmed}-${i}`;
      if (!(await existsFn(c2))) return c2;
    } else {
      if (!(await existsFn(candidate))) return candidate;
    }
  }
  throw new Error(`uniqueSlug: 100 intentos sin encontrar libre para "${base}"`);
}

module.exports = { slugify, uniqueSlug };
