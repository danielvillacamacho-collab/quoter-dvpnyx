/**
 * Sort genérico client-side para tablas que NO paginan en server (Reports,
 * EmployeeCosts mass view, etc.).
 *
 * sortRows(rows, accessor, dir, opts)
 *   accessor: string (path "a.b.c") | function (row → value)
 *   dir:      'asc' | 'desc'
 *
 * Comportamiento:
 *   - null/undefined al final independientemente de dir.
 *   - Strings: comparación localizada en español, case-insensitive.
 *   - Numbers/Dates: comparación natural.
 *   - Estable: rows con misma key conservan orden original.
 */
export function sortRows(rows, accessor, dir = 'asc', opts = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const get = typeof accessor === 'function' ? accessor : (r) => deepGet(r, accessor);
  const desc = dir === 'desc';
  // Decorate-sort-undecorate para estabilidad.
  return rows
    .map((r, i) => ({ r, i, k: get(r), nil: isNil(get(r)) }))
    .sort((a, b) => {
      // Nulls/empty siempre al final, independiente de dir — si invirtieras
      // esto con `desc`, los nulls saltarían al frente y quedarías sin
      // garantía visual de "datos válidos primero".
      if (a.nil && !b.nil) return 1;
      if (!a.nil && b.nil) return -1;
      if (a.nil && b.nil) return a.i - b.i;
      const cmp = compare(a.k, b.k, opts);
      if (cmp !== 0) return desc ? -cmp : cmp;
      return a.i - b.i; // estable
    })
    .map((x) => x.r);
}

function isNil(v) { return v == null || v === ''; }

/** Comparador con nullsLast + tipos. */
function compare(a, b, opts) {
  const aNil = a == null || a === '';
  const bNil = b == null || b === '';
  if (aNil && bNil) return 0;
  if (aNil) return 1;   // nulls al final SIEMPRE
  if (bNil) return -1;
  // Date instances o strings ISO
  if (a instanceof Date || b instanceof Date) {
    const da = +new Date(a), db = +new Date(b);
    return da - db;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a === b) ? 0 : (a ? 1 : -1);
  // String comparison (incluye numeric=true para "L1" < "L2" < "L10")
  return String(a).localeCompare(String(b), opts.locale || 'es-CO', { numeric: true, sensitivity: 'base' });
}

function deepGet(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
}
