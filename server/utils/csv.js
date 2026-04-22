/**
 * Minimal RFC 4180-ish CSV parser. Zero deps.
 *
 * Handles:
 *   - comma separator (default) or custom
 *   - quoted fields with embedded commas, quotes (doubled inside), and newlines
 *   - CRLF and LF line endings
 *   - trailing empty rows are dropped
 *
 * NOT supported (keep it small):
 *   - semicolon auto-detect
 *   - BOM stripping beyond the UTF-8 BOM at the very start
 *
 * Returns { headers: [...], rows: [{headerName: value}, ...] }
 *
 * The first non-empty line is treated as the header. Header names are
 * trimmed and lowercased. Extra columns in a row are ignored; missing
 * columns become empty strings.
 */

function tokenize(text, sep) {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === sep) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue; }
    field += ch; i++;
  }
  // Flush last field
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop();
  return rows;
}

function parseCsv(text, options = {}) {
  const sep = options.separator || ',';
  const raw = tokenize(String(text || ''), sep);
  if (!raw.length) return { headers: [], rows: [] };

  const headers = raw[0].map(h => String(h).trim().toLowerCase());
  const rows = [];
  for (let r = 1; r < raw.length; r++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (raw[r][c] !== undefined ? String(raw[r][c]) : '').trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
}

/**
 * Minimal RFC 4180 CSV writer. Used by the /export.csv endpoints.
 *
 *   rows    — array of plain objects
 *   columns — ordered list of { key, header } shaping the output
 *
 * Each cell is stringified (null/undefined → ''), and fields that
 * contain a separator, quote, CR or LF are wrapped in double quotes
 * with embedded quotes doubled. We prepend a UTF-8 BOM so Excel opens
 * the file with the right encoding on Windows without the user having
 * to change anything.
 */
function escapeField(v, sep) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  const needsQuote = s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r');
  if (!needsQuote) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function stringifyCsv(rows, columns, options = {}) {
  const sep = options.separator || ',';
  const bom = options.bom === false ? '' : '\uFEFF';
  const header = columns.map((c) => escapeField(c.header, sep)).join(sep);
  const body = (rows || []).map((r) => columns.map((c) => {
    const raw = typeof c.value === 'function' ? c.value(r) : r[c.key];
    return escapeField(raw, sep);
  }).join(sep)).join('\r\n');
  return bom + header + (body ? '\r\n' + body : '') + '\r\n';
}

module.exports = { parseCsv, stringifyCsv };
