import React, { useState, useCallback } from 'react';
import { parseCsv } from '../utils/csvParse';
import { apiPost } from '../utils/apiV2';

/* ---------- styles (match the other modules) ---------- */
const s = {
  page:   { maxWidth: 1100, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({
    background: c, color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat',
  }),
  btnOutline: {
    background: 'transparent', color: 'var(--purple-dark)',
    border: '1px solid var(--purple-dark)', borderRadius: 8,
    padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  input:  { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none' },
  label:  { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th:     { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:     { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border)' },
  dropzone: (drag) => ({
    border: '2px dashed ' + (drag ? 'var(--teal-mid)' : 'var(--border)'),
    background: drag ? 'rgba(0,216,212,0.08)' : '#fafafa',
    borderRadius: 12, padding: 40, textAlign: 'center',
    transition: 'all .15s', cursor: 'pointer',
  }),
  chip: (bg, fg = '#fff') => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    fontSize: 10, fontWeight: 700, background: bg, color: fg, textTransform: 'uppercase',
  }),
  stepper: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 },
  step: (active, done) => ({
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    background: active ? 'var(--purple-dark)' : done ? 'var(--teal-mid)' : '#e5e5e5',
    color: active || done ? '#fff' : 'var(--text-light)',
  }),
};

/** Human-readable name per entity (matches sidebar wording). */
const ENTITIES = [
  { key: 'employees',        label: 'Empleados',              desc: 'Nuevos empleados con área, país, nivel, capacidad, fechas.' },
  { key: 'employee-skills',  label: 'Empleado ↔ Skill',       desc: 'Vincula empleados (por email) con skills (por nombre) + proficiency.' },
  { key: 'skills',           label: 'Catálogo de Skills',     desc: 'Agrega skills al catálogo con su categoría.' },
  { key: 'areas',            label: 'Catálogo de Áreas',      desc: 'Agrega especialidades funcionales.' },
  { key: 'clients',          label: 'Clientes',               desc: 'Carga clientes existentes con tier, país, moneda.' },
];

function statusColor(status) {
  switch (status) {
    case 'created': return 'var(--success)';
    case 'updated': return 'var(--teal-mid)';
    case 'skipped': return 'var(--text-light)';
    case 'preview': return 'var(--purple-dark)';
    case 'error':   return 'var(--danger)';
    default:        return 'var(--text-light)';
  }
}

export default function BulkImport() {
  const [step, setStep] = useState(0);          // 0=entity 1=upload 2=preview 3=done
  const [entity, setEntity] = useState('employees');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);   // { headers, rows }
  const [preview, setPreview] = useState(null); // response from /preview
  const [result, setResult]   = useState(null); // response from /commit
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setStep(0); setFileName(''); setParsed(null);
    setPreview(null); setResult(null); setError('');
  };

  /* ---------- Step 0: pick entity ---------- */
  const pickEntity = (e) => { setEntity(e); setStep(1); };

  /* ---------- Step 1: receive CSV ---------- */
  const onFile = useCallback(async (file) => {
    if (!file) return;
    setError('');
    setFileName(file.name);
    const text = await file.text();
    const out = parseCsv(text);
    if (!out.rows.length) {
      setError('El archivo no tiene filas de datos (sólo el header o está vacío).');
      setParsed(null);
      return;
    }
    setParsed(out);
    setSubmitting(true);
    try {
      const resp = await apiPost(`/api/bulk-import/${entity}/preview`, { rows: out.rows });
      setPreview(resp);
      setStep(2);
    } catch (ex) {
      setError(`Error en el preview: ${ex.message}`);
    } finally {
      setSubmitting(false);
    }
  }, [entity]);

  const downloadTemplate = async () => {
    // Browser-triggered file download; uses a direct anchor so the browser's
    // built-in Save dialog handles the content-disposition header.
    const token = localStorage.getItem('dvpnyx_token');
    const res = await fetch(`/api/bulk-import/templates/${entity}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError('No se pudo descargar la plantilla'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `template_${entity}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  /* ---------- Step 2: commit ---------- */
  const commit = async () => {
    if (!parsed) return;
    setSubmitting(true);
    setError('');
    try {
      const resp = await apiPost(`/api/bulk-import/${entity}/commit`, { rows: parsed.rows });
      setResult(resp);
      setStep(3);
    } catch (ex) {
      setError(`Error al ejecutar la carga: ${ex.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- Render ---------- */
  return (
    <div style={s.page}>
      <h1 style={s.h1}>📤 Carga masiva</h1>
      <div style={s.sub}>
        Sube un archivo CSV para crear o actualizar múltiples registros a la vez.
        Todos los cambios corren en una sola transacción (si algo revienta, no se aplica nada).
      </div>

      {/* Step indicator */}
      <div style={s.stepper} aria-label="Progreso">
        <div style={s.step(step === 0, step > 0)}>1. Entidad</div>
        <div style={s.step(step === 1, step > 1)}>2. Archivo</div>
        <div style={s.step(step === 2, step > 2)}>3. Preview</div>
        <div style={s.step(step === 3, false)}>4. Resultado</div>
      </div>

      {error && (
        <div style={{ ...s.card, borderLeft: '4px solid var(--danger)', padding: '12px 16px', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* ==== Step 0 ==== */}
      {step === 0 && (
        <div style={s.card}>
          <h2 style={{ margin: '0 0 12px', color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>¿Qué quieres cargar?</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {ENTITIES.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => pickEntity(e.key)}
                style={{
                  textAlign: 'left', border: '1px solid var(--border)',
                  borderRadius: 10, padding: 16, background: '#fff',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
                aria-label={`Cargar ${e.label}`}
              >
                <div style={{ fontWeight: 700, color: 'var(--purple-dark)', marginBottom: 4 }}>{e.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{e.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ==== Step 1 ==== */}
      {step === 1 && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
              Subir CSV — <span style={{ color: 'var(--teal-mid)' }}>{ENTITIES.find(e => e.key === entity)?.label}</span>
            </h2>
            <button type="button" style={s.btnOutline} onClick={downloadTemplate}>⬇️ Descargar plantilla</button>
          </div>

          <label
            htmlFor="bulk-csv"
            style={s.dropzone(dragging)}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragging(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) onFile(f);
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 700, color: 'var(--purple-dark)', marginBottom: 4 }}>
              {submitting ? 'Procesando…' : 'Arrastra un CSV aquí o haz clic para seleccionar'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
              Máximo 5000 filas. La primera fila debe ser el encabezado.
            </div>
            <input
              id="bulk-csv" type="file" accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => onFile(e.target.files?.[0])}
              aria-label="Archivo CSV"
            />
          </label>

          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" style={s.btnOutline} onClick={() => setStep(0)}>← Volver</button>
          </div>
        </div>
      )}

      {/* ==== Step 2 — preview ==== */}
      {step === 2 && preview && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
              Revisión previa — {fileName}
            </h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={s.btnOutline} onClick={() => setStep(1)}>← Cambiar archivo</button>
              <button
                type="button"
                style={preview.counts.error > 0 && preview.counts.total === preview.counts.error ? { ...s.btn('#999'), cursor: 'not-allowed' } : s.btn('var(--success)')}
                disabled={submitting || (preview.counts.error > 0 && preview.counts.total === preview.counts.error)}
                onClick={commit}
              >
                {submitting ? 'Aplicando…' : '✅ Confirmar carga'}
              </button>
            </div>
          </div>

          {/* Summary chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={s.chip('var(--purple-dark)')}>Total: {preview.counts.total}</span>
            <span style={s.chip('var(--success)')}>Válidas: {preview.counts.total - (preview.counts.error || 0)}</span>
            <span style={s.chip('var(--danger)')}>Con errores: {preview.counts.error || 0}</span>
          </div>

          {preview.counts.error > 0 && (
            <div style={{ background: '#fef3c7', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
              ⚠ Hay filas con errores. Puedes confirmar de todos modos: las filas válidas se crearán y las
              inválidas se registrarán como errores en el reporte. Si prefieres, corrige el CSV y vuelve a subir.
            </div>
          )}

          {/* Preview table (first 50 rows) */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>Fila</th>
                  <th style={s.th}>Estado</th>
                  <th style={s.th}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {preview.report.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...s.td, fontFamily: 'monospace', width: 60 }}>{r.row_number}</td>
                    <td style={s.td}>
                      <span style={s.chip(statusColor(r.status))}>{r.status}</span>
                    </td>
                    <td style={{ ...s.td, fontSize: 11 }}>
                      {r.status === 'error' ? r.reason : JSON.stringify(r.value).slice(0, 140)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==== Step 3 — result ==== */}
      {step === 3 && result && (
        <div style={s.card}>
          <h2 style={{ margin: '0 0 12px', color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
            Carga completada
          </h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={s.chip('var(--purple-dark)')}>Total: {result.counts.total}</span>
            <span style={s.chip('var(--success)')}>Creadas: {result.counts.created || 0}</span>
            <span style={s.chip('var(--teal-mid)')}>Actualizadas: {result.counts.updated || 0}</span>
            <span style={s.chip('var(--text-light)')}>Omitidas: {result.counts.skipped || 0}</span>
            <span style={s.chip('var(--danger)')}>Con errores: {result.counts.error || 0}</span>
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>Fila</th>
                  <th style={s.th}>Estado</th>
                  <th style={s.th}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {result.report.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...s.td, fontFamily: 'monospace', width: 60 }}>{r.row_number}</td>
                    <td style={s.td}><span style={s.chip(statusColor(r.status))}>{r.status}</span></td>
                    <td style={{ ...s.td, fontSize: 11 }}>
                      {r.reason || (r.id ? `id: ${r.id}` : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={s.btn('var(--teal-mid)')} onClick={reset}>📤 Otra carga</button>
          </div>
        </div>
      )}
    </div>
  );
}
