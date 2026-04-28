/**
 * Importar costos desde CSV.
 *
 * Flujo: el usuario pega/sube un CSV con columnas
 * `employee_id, currency, gross_cost, notes` (notes opcional).
 * Click en "Preview" → llama bulk/preview que valida sin escribir.
 * Si OK → click en "Aplicar" → bulk/commit en transacción atómica.
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { apiPost } from '../utils/apiV2';
import { useAuth } from '../AuthContext';
import { formatPeriod, normalizePeriod, currentPeriod, recentPeriods } from '../utils/cost';

const s = {
  page:    { maxWidth: 1100, margin: '0 auto' },
  h1:      { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:     { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:    { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  textarea: { width: '100%', minHeight: 200, padding: 12, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8 },
  input:   { padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 },
  th:      { padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:      { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid var(--border)' },
};

const SAMPLE_CSV = `employee_id,currency,gross_cost,notes
550e8400-e29b-41d4-a716-446655440000,COP,12500000,
550e8400-e29b-41d4-a716-446655440001,USD,4500,Incluye bono Q1
550e8400-e29b-41d4-a716-446655440002,MXN,75000,`;

/** Parsea un CSV mínimo (sin escapes de comas dentro de campos, no necesario aquí). */
function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 1) return { items: [], errors: ['CSV vacío'] };
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const required = ['employee_id', 'currency', 'gross_cost'];
  for (const r of required) {
    if (!header.includes(r)) return { items: [], errors: [`Falta columna requerida: ${r}`] };
  }
  const items = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.length < 3) { errors.push(`Línea ${i + 1}: columnas insuficientes`); continue; }
    const rec = {};
    header.forEach((h, idx) => { rec[h] = cols[idx] ?? ''; });
    items.push({
      employee_id: rec.employee_id,
      currency: rec.currency,
      gross_cost: rec.gross_cost === '' ? null : Number(rec.gross_cost),
      notes: rec.notes || null,
    });
  }
  return { items, errors };
}

export default function EmployeeCostsImport() {
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;

  const [period, setPeriod] = useState(currentPeriod());
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(null);

  const periodOptions = useMemo(() => recentPeriods(18), []);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(f);
  };

  const onPreview = async () => {
    setErr(''); setPreview(null); setCommitted(null);
    const parsed = parseCsv(csvText);
    if (parsed.errors.length) { setErr(parsed.errors.join('; ')); return; }
    if (parsed.items.length === 0) { setErr('CSV sin filas de datos'); return; }
    setBusy(true);
    try {
      const r = await apiPost('/api/employee-costs/bulk/preview', { period, items: parsed.items });
      setPreview(r);
    } catch (e) { setErr(e.message || 'Error en preview'); }
    finally { setBusy(false); }
  };

  const onCommit = async () => {
    if (!preview) return;
    setErr(''); setBusy(true);
    try {
      const parsed = parseCsv(csvText);
      const r = await apiPost('/api/employee-costs/bulk/commit', { period, items: parsed.items });
      setCommitted(r);
      setPreview(null);
    } catch (e) { setErr(e.message || 'Error commit'); }
    finally { setBusy(false); }
  };

  if (!isAdmin) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, background: '#fffbe6', borderColor: '#facc15', color: '#92400e' }}>
          <strong>Acceso restringido.</strong> Solo admin/superadmin pueden importar costos.
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <Link to="/admin/employee-costs" style={{ ...s.btnOutline, textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
        ← Volver a Costos
      </Link>
      <h1 style={s.h1}>⤓ Importar costos desde CSV</h1>
      <div style={s.sub}>
        Carga masiva de costos para un período. Se hace preview con validación antes de aplicar.
        Columnas requeridas: <code>employee_id, currency, gross_cost</code>. Opcional: <code>notes</code>.
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>Período</label>
            <select style={s.input} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {periodOptions.map((p) => <option key={p} value={p}>{formatPeriod(p)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>Subir archivo CSV</label>
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
          </div>
          <button type="button" style={s.btnOutline} onClick={() => setCsvText(SAMPLE_CSV)}>
            Usar plantilla de ejemplo
          </button>
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>
          Contenido CSV
        </label>
        <textarea
          style={s.textarea}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="employee_id,currency,gross_cost,notes&#10;..."
          aria-label="CSV"
        />

        {err && <div style={{ marginTop: 12, color: 'var(--danger)', fontSize: 13 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" style={s.btn()} onClick={onPreview} disabled={busy || !csvText.trim()}>
            {busy ? 'Procesando…' : 'Preview'}
          </button>
        </div>
      </div>

      {preview && (
        <div style={s.card}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--purple-dark)' }}>
            Preview · {preview.total} filas leídas · {preview.errors.length} errores · {preview.warnings.length} warnings
          </h2>

          {preview.errors.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, color: 'var(--danger)' }}>Errores ({preview.errors.length})</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Fila', 'Empleado', 'Código', 'Mensaje'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {preview.errors.map((e, i) => (
                    <tr key={i}>
                      <td style={s.td}>{e.index + 2}</td>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>{e.employee_id}</td>
                      <td style={s.td}>{e.code}</td>
                      <td style={s.td}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ fontSize: 13, color: 'var(--orange)', cursor: 'pointer' }}>
                Warnings FX ({preview.warnings.length}) — no bloquean el commit
              </summary>
              <ul style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 6 }}>
                {preview.warnings.slice(0, 20).map((w, i) => (
                  <li key={i}>Fila {w.index + 2}: {w.code}{w.fallback_period ? ` — fallback ${formatPeriod(w.fallback_period)}` : ''}</li>
                ))}
                {preview.warnings.length > 20 && <li>… +{preview.warnings.length - 20} más</li>}
              </ul>
            </details>
          )}

          {preview.applied.length > 0 && (
            <div>
              <h3 style={{ fontSize: 13, color: 'var(--ds-ok, #16a34a)' }}>
                A aplicar ({preview.applied.length})
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Fila', 'Empleado', 'Acción', 'Costo USD'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {preview.applied.slice(0, 50).map((a, i) => (
                    <tr key={i}>
                      <td style={s.td}>{a.index + 2}</td>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>{a.employee_id}</td>
                      <td style={s.td}>{a.action === 'would_create' ? 'Crear' : 'Actualizar'}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>{a.cost_usd != null ? a.cost_usd.toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                  {preview.applied.length > 50 && (
                    <tr><td colSpan={4} style={{ ...s.td, color: 'var(--text-light)', textAlign: 'center' }}>… +{preview.applied.length - 50} filas más</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={s.btnOutline} onClick={() => setPreview(null)}>Cancelar</button>
            <button
              type="button"
              style={s.btn(preview.errors.length === 0 ? 'var(--ds-ok, #16a34a)' : 'var(--ds-text-dim, #888)')}
              onClick={onCommit}
              disabled={busy || preview.errors.length > 0}
              title={preview.errors.length > 0 ? 'Corregí los errores antes de aplicar' : ''}
            >
              {busy ? 'Aplicando…' : `Aplicar (${preview.applied.length})`}
            </button>
          </div>
        </div>
      )}

      {committed && (
        <div style={{ ...s.card, background: '#e8f5ec', borderColor: '#10b981' }}>
          <h2 style={{ margin: '0 0 8px', color: '#065f46' }}>✓ Importación aplicada</h2>
          <div>
            {committed.applied.filter((a) => a.action === 'created').length} creados ·{' '}
            {committed.applied.filter((a) => a.action === 'updated').length} actualizados
            {committed.warnings?.length > 0 && ` · ${committed.warnings.length} warnings FX`}
          </div>
          <Link to="/admin/employee-costs" style={{ ...s.btnOutline, textDecoration: 'none', marginTop: 12, display: 'inline-block' }}>
            ← Volver a Costos
          </Link>
        </div>
      )}
    </div>
  );
}
