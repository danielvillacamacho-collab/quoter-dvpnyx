/**
 * Helper de ordenamiento para queries paginadas.
 *
 * Patrón: cada route GET acepta `?sort=<field>&dir=<asc|desc>` y construye
 * un fragmento `ORDER BY ...` seguro contra SQL injection mediante una
 * **whitelist** explícita de campos ordenables.
 *
 * Uso típico:
 *
 *   const SORTABLE = {
 *     name:        'c.name',
 *     created_at:  'c.created_at',
 *     status:      'c.status',
 *     client_name: 'cl.name',  // alias join
 *   };
 *
 *   const sort = parseSort(req.query, SORTABLE, { defaultField: 'created_at', defaultDir: 'desc' });
 *   // sort.orderBy → "c.created_at DESC NULLS LAST"
 *   // sort.field   → 'created_at'
 *   // sort.dir     → 'desc'
 *
 *   pool.query(`SELECT ... ORDER BY ${sort.orderBy} LIMIT ...`);
 *
 * Notas:
 *   - El valor de `field` SIEMPRE va contra la whitelist. Si el caller pasa
 *     un valor no listado, caemos al default. Esto es lo que protege de
 *     inyección — los nombres de columna no se pueden parametrizar con $N.
 *   - `NULLS LAST` por default para que filas con NULL no contaminen el top.
 *   - Se acepta `dir` con cualquier casing y aliases comunes (`up`/`down`,
 *     `ascending`/`descending`).
 */

const VALID_DIR_TOKENS = {
  asc: 'asc',  ascending: 'asc',  up: 'asc',   a: 'asc',
  desc: 'desc', descending: 'desc', down: 'desc', d: 'desc',
};

/**
 * @param {object} query           - req.query
 * @param {object} sortable        - map de field-name (api) → SQL column expression (whitelist)
 * @param {object} [opts]
 * @param {string} [opts.defaultField] - field a usar si no llega `sort` en query
 * @param {'asc'|'desc'} [opts.defaultDir='desc'] - dir si no llega
 * @param {boolean} [opts.nullsLast=true]
 * @param {string} [opts.tieBreaker] - SQL adicional para desempate (ej. 'id ASC')
 *
 * @returns {{ field: string, dir: 'asc'|'desc', column: string, orderBy: string }}
 */
function parseSort(query, sortable, opts = {}) {
  const {
    defaultField = null,
    defaultDir = 'desc',
    nullsLast = true,
    tieBreaker = null,
  } = opts;

  const requestedField = String((query && query.sort) || '').trim();
  const requestedDir = String((query && (query.dir || query.order)) || '').trim().toLowerCase();

  // Resolución de field — debe estar en la whitelist.
  let field = null;
  if (requestedField && Object.prototype.hasOwnProperty.call(sortable, requestedField)) {
    field = requestedField;
  } else if (defaultField && Object.prototype.hasOwnProperty.call(sortable, defaultField)) {
    field = defaultField;
  } else {
    // Sin field válido y sin default. Devolvemos null.orderBy para que
    // el caller pueda omitir el ORDER BY (raro — el caller debería pasar
    // un default sensato siempre).
    return { field: null, dir: null, column: null, orderBy: null };
  }

  // Resolución de dir.
  let dir = VALID_DIR_TOKENS[requestedDir] || null;
  if (!dir) dir = defaultDir === 'asc' ? 'asc' : 'desc';

  const column = sortable[field];
  const sqlDir = dir === 'asc' ? 'ASC' : 'DESC';
  const nullsClause = nullsLast ? ' NULLS LAST' : '';
  const orderBy = `${column} ${sqlDir}${nullsClause}${tieBreaker ? ', ' + tieBreaker : ''}`;

  return { field, dir, column, orderBy };
}

module.exports = { parseSort, VALID_DIR_TOKENS };
