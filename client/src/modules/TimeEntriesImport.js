/**
 * TimeEntriesImport — modal para importar historial de horas desde CSV jerárquico.
 *
 * Flujo: subir CSV → parsear → dry run (preview resolución) → confirmar import.
 * El CSV tiene el formato agrupado que exporta el sistema anterior:
 *   col0=empleado (header de grupo), col1=fecha (sub-header DD/MM/YYYY),
 *   col2=proyecto + col4=horas decimal (filas de entrada).
 */
import React, { useState, useRef } from 'react';
import { apiPost } from '../utils/apiV2';
import { parseCsv } from '../utils/csvParse';

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  modal:   { background: 'var(--ds-surface, #fff)', borderRadius: 12, padding: 28, width: 780, maxWidth: '96vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' },
  h2:      { fontSize: 17, fontWeight: 700, margin: '0 0 4px', color: 'var(--ds-text)' },
  sub:     { fontSize: 12.5, color: 'var(--ds-text-dim)', marginBottom: 20 },
  btn:     { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, border: '1px solid var(--ds-border)', background: 'var(--ds-surface)', color: 'var(--ds-text)', cursor: 'pointer', whiteSpace: 'nowrap' },
  btnPrimary: { border: 'none', background: 'var(--ds-accent)', color: '#fff' },
  btnDanger:  { border: 'none', background: '#d32f2f', color: '#fff' },
  btnRow:  { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end', flexWrap: 'wrap' },
  dropzone: { border: '2px dashed var(--ds-border)', borderRadius: 10, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', color: 'var(--ds-text-dim)', fontSize: 13, transition: 'border-color 0.15s' },
  dropzoneHover: { borderColor: 'var(--ds-accent)' },
  summary: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 },
  pill:    (color) => ({ background: color, borderRadius: 20, padding: '3px 12px', fontSize: 12.5, fontWeight: 600, color: '#fff' }),
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th:      { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid var(--ds-border)', fontWeight: 600, color: 'var(--ds-text-dim)', fontSize: 11.5 },
  td:      { padding: '5px 8px', borderBottom: '1px solid var(--ds-border)', verticalAlign: 'top' },
  badge:   { created: { color: '#1b7a3e', fontWeight: 600 }, ready: { color: '#1565c0', fontWeight: 600 }, unresolved: { color: '#c62828', fontWeight: 600 }, skipped: { color: '#e65100', fontWeight: 600 }, error: { color: '#6a1a1a', fontWeight: 600 } },
  warn:    { fontSize: 11, color: '#e65100', marginTop: 2 },
  progress:{ height: 6, borderRadius: 3, background: 'var(--ds-border)', marginBottom: 16, overflow: 'hidden' },
  progBar: (pct) => ({ height: '100%', width: `${pct}%`, background: 'var(--ds-accent)', transition: 'width 0.3s' }),
};

/** Parse DD/MM/YYYY → YYYY-MM-DD */
function ddmmyyyy(s) {
  const parts = String(s || '').trim().split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!y || !m || !d) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Flatten the hierarchical CSV into [{employee_name, work_date, project_name, hours}].
 * Structure:
 *  - col "user" non-empty + col "date" empty → new employee block
 *  - col "user" empty + col "date" non-empty → new date block  (DD/MM/YYYY)
 *  - col "user" empty + col "date" empty + col "project" non-empty → entry row
 */
function parseHistoricalCsv(text) {
  const { rows } = parseCsv(text);
  const entries = [];
  const errors  = [];
  let employee  = null;
  let workDate  = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const user    = (row['user']    || '').trim();
    const date    = (row['date']    || '').trim();
    const project = (row['project'] || '').trim();
    const decimal = (row['time (decimal)'] || row['time(decimal)'] || row['decimal'] || '').trim();

    if (user) {
      employee = user;
      workDate = null;
    } else if (date && !project) {
      const iso = ddmmyyyy(date);
      if (!iso) errors.push(`Fila ${i + 2}: fecha no reconocida "${date}"`);
      workDate = iso;
    } else if (project && employee && workDate) {
      const hours = parseFloat(decimal.replace(',', '.'));
      if (isNaN(hours) || hours <= 0) continue; // totals / blank rows
      entries.push({ employee_name: employee, work_date: workDate, project_name: project, hours });
    }
  }

  return { entries, errors };
}

const STEP_UPLOAD   = 'upload';
const STEP_PREVIEW  = 'preview';
const STEP_DRYRUN   = 'dryrun';
const STEP_DONE     = 'done';

export default function TimeEntriesImport({ onClose, onImported }) {
  const [step, setStep]         = useState(STEP_UPLOAD);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed]     = useState([]);   // flat entries
  const [parseErrs, setParseErrs] = useState([]);
  const [dryResult, setDryResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [apiError, setApiError] = useState('');
  const fileRef = useRef();

  function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { entries, errors } = parseHistoricalCsv(e.target.result);
      setParsed(entries);
      setParseErrs(errors);
      setStep(STEP_PREVIEW);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }

  async function runDryRun() {
    setImporting(true); setApiError('');
    try {
      const res = await apiPost('/time-entries/import-bulk', { entries: parsed, dry_run: true });
      setDryResult(res);
      setStep(STEP_DRYRUN);
    } catch (err) {
      setApiError(err.message || 'Error al validar');
    } finally {
      setImporting(false);
    }
  }

  async function runImport() {
    setImporting(true); setApiError('');
    try {
      const res = await apiPost('/time-entries/import-bulk', { entries: parsed, dry_run: false });
      setImportResult(res);
      setStep(STEP_DONE);
      if (onImported) onImported(res.summary.created);
    } catch (err) {
      setApiError(err.message || 'Error al importar');
    } finally {
      setImporting(false);
    }
  }

  const resolvedCount   = dryResult?.rows.filter((r) => r.status === 'ready').length ?? 0;
  const unresolvedCount = dryResult?.rows.filter((r) => r.status === 'unresolved').length ?? 0;

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <h2 style={s.h2}>Importar historial de horas</h2>
        <p style={s.sub}>
          Sube el CSV exportado del sistema anterior. El archivo debe tener columnas:
          <strong> User, Date, Project, Time (h), Time (decimal)</strong>.
        </p>

        {/* ── STEP 1: upload ── */}
        {step === STEP_UPLOAD && (
          <>
            <div
              style={{ ...s.dropzone, ...(dragging ? s.dropzoneHover : {}) }}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              &#128193; Arrastra tu CSV aquí o haz clic para seleccionar
            </div>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files[0])} />
            <div style={s.btnRow}>
              <button style={s.btn} onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}

        {/* ── STEP 2: preview parsed ── */}
        {step === STEP_PREVIEW && (
          <>
            <div style={s.summary}>
              <span style={s.pill('#1565c0')}>{parsed.length} entradas</span>
              <span style={s.pill('#2e7d32')}>{new Set(parsed.map((e) => e.employee_name)).size} empleados</span>
              <span style={s.pill('#6a1a6a')}>{new Set(parsed.map((e) => e.project_name)).size} proyectos</span>
              {parseErrs.length > 0 && <span style={s.pill('#c62828')}>{parseErrs.length} advertencias</span>}
            </div>

            {parseErrs.length > 0 && (
              <div style={{ background: '#fff3e0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12 }}>
                {parseErrs.map((e, i) => <div key={i}>&#9888; {e}</div>)}
              </div>
            )}

            <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--ds-border)', borderRadius: 8 }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Empleado</th>
                    <th style={s.th}>Fecha</th>
                    <th style={s.th}>Proyecto</th>
                    <th style={s.th}>Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 200).map((e, i) => (
                    <tr key={i}>
                      <td style={s.td}>{e.employee_name}</td>
                      <td style={s.td}>{e.work_date}</td>
                      <td style={s.td}>{e.project_name}</td>
                      <td style={s.td}>{e.hours}</td>
                    </tr>
                  ))}
                  {parsed.length > 200 && (
                    <tr><td colSpan={4} style={{ ...s.td, color: 'var(--ds-text-dim)', fontStyle: 'italic' }}>
                      … y {parsed.length - 200} entradas más
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {apiError && <div style={{ color: '#c62828', fontSize: 12.5, marginTop: 10 }}>{apiError}</div>}
            <div style={s.btnRow}>
              <button style={s.btn} onClick={onClose}>Cancelar</button>
              <button style={s.btn} onClick={() => { setParsed([]); setStep(STEP_UPLOAD); }}>Cambiar archivo</button>
              <button style={{ ...s.btn, ...s.btnPrimary }} onClick={runDryRun} disabled={importing || parsed.length === 0}>
                {importing ? 'Validando…' : 'Validar resolución →'}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 3: dry run results ── */}
        {step === STEP_DRYRUN && dryResult && (
          <>
            <div style={s.summary}>
              <span style={s.pill('#1565c0')}>{dryResult.summary.total} total</span>
              <span style={s.pill('#2e7d32')}>{resolvedCount} resueltas</span>
              {unresolvedCount > 0 && <span style={s.pill('#c62828')}>{unresolvedCount} sin resolver</span>}
            </div>

            {unresolvedCount > 0 && (
              <div style={{ background: '#fff3e0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
                <strong>&#9888; Las entradas sin resolver se saltarán.</strong> Puede que el empleado o contrato no exista en el sistema, o que no tenga asignación para ese contrato. Puedes importar igual y luego crear las asignaciones faltantes.
              </div>
            )}

            <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--ds-border)', borderRadius: 8 }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Estado</th>
                    <th style={s.th}>Empleado</th>
                    <th style={s.th}>Fecha</th>
                    <th style={s.th}>Proyecto</th>
                    <th style={s.th}>Horas</th>
                    <th style={s.th}>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {dryResult.rows.map((r, i) => (
                    <tr key={i} style={{ background: r.status === 'unresolved' ? '#fff5f5' : undefined }}>
                      <td style={s.td}>
                        <span style={s.badge[r.status] || {}}>
                          {r.status === 'ready'      ? '✓ Lista'       :
                           r.status === 'unresolved' ? '✗ Sin resolver' : r.status}
                        </span>
                      </td>
                      <td style={s.td}>{r.employee_name}</td>
                      <td style={s.td}>{r.work_date}</td>
                      <td style={s.td}>{r.project_name}</td>
                      <td style={s.td}>{r.hours}</td>
                      <td style={s.td}>
                        {r.reason && <div style={{ color: '#c62828', fontSize: 11.5 }}>{r.reason}</div>}
                        {r.warn   && <div style={s.warn}>&#9888; {r.warn}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {apiError && <div style={{ color: '#c62828', fontSize: 12.5, marginTop: 10 }}>{apiError}</div>}
            <div style={s.btnRow}>
              <button style={s.btn} onClick={onClose}>Cancelar</button>
              <button style={s.btn} onClick={() => setStep(STEP_PREVIEW)}>← Atrás</button>
              <button
                style={{ ...s.btn, ...s.btnPrimary }}
                onClick={runImport}
                disabled={importing || resolvedCount === 0}
              >
                {importing ? 'Importando…' : `Importar ${resolvedCount} entradas`}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 4: done ── */}
        {step === STEP_DONE && importResult && (
          <>
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>&#10003;</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                Importación completada
              </div>
              <div style={s.summary}>
                <span style={s.pill('#2e7d32')}>{importResult.summary.created} creadas</span>
                {importResult.summary.skipped > 0 &&
                  <span style={s.pill('#e65100')}>{importResult.summary.skipped} saltadas</span>}
              </div>
            </div>
            <div style={s.btnRow}>
              <button style={{ ...s.btn, ...s.btnPrimary }} onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
