/**
 * Minimal CSV parser for client-side use. Same rules as the backend's
 * server/utils/csv.js — keeping the two copies in sync is a conscious
 * trade-off for zero dependencies.
 *
 * Returns { headers, rows } where rows is an array of plain objects
 * keyed by the lowercase trimmed header name.
 */
export function parseCsv(text) {
  if (!text) return { headers: [], rows: [] };
  let input = String(text);
  if (input.charCodeAt(0) === 0xFEFF) input = input.slice(1);

  const sep = ',';
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const n = input.length;
  let i = 0;
  while (i < n) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
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
  if (field.length || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const data = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (rows[r][c] !== undefined ? String(rows[r][c]) : '').trim();
    }
    data.push(obj);
  }
  return { headers, rows: data };
}
