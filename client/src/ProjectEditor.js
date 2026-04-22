import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from './utils/api';
import ProjectEditorUnified from './ProjectEditorUnified';
import {
  calcProjectProfile,
  calcAllocation,
  calcProjectSummary,
  formatUSD,
  formatUSD2,
  formatPct,
  SPECIALTIES,
  EMPTY_PROFILE,
  DEFAULT_PHASES,
  PHASE_COLORS,
} from './utils/calc';

/**
 * Spec URGENTE — Editor de Proyectos (Abril 2026):
 * por defecto ahora renderizamos la vista single-page; el stepper clásico
 * queda como fallback accesible desde el toggle "Vista clásica" en el
 * header. La preferencia del usuario se persiste en localStorage.
 */
const CLASSIC_PREF_KEY = 'dvpnyx_project_editor_classic';

/* ========== shared tiny style helpers (not exhaustive) ========== */
const s = {
  card: { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 24, marginBottom: 20 },
  btn: (color = 'var(--purple-dark)') => ({ background: color, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnDisabled: { background: '#ccc', color: '#666', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'not-allowed' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none' },
  select: { padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th: { padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
};

/* ========== STEPPER COMPONENT ========== */
const STEPS = [
  { id: 0, label: 'Proyecto',   icon: '📝' },
  { id: 1, label: 'Equipo',     icon: '👥' },
  { id: 2, label: 'Fases',      icon: '📅' },
  { id: 3, label: 'Asignación', icon: '🧮' },
  { id: 4, label: 'Épicas',     icon: '🗂️' },
  { id: 5, label: 'Resumen',    icon: '💰' },
];

function Stepper({ current, completed, onJump }) {
  return (
    <div className="stepper" role="navigation" aria-label="Pasos">
      {STEPS.map((st, i) => {
        const isDone = completed.has(st.id);
        const isActive = current === st.id;
        const state = isActive ? 'active' : isDone ? 'done' : 'pending';
        const canJumpBack = st.id < current || isDone;
        return (
          <React.Fragment key={st.id}>
            <button
              type="button"
              className={`stepper-item stepper-${state}`}
              onClick={() => canJumpBack && onJump(st.id)}
              disabled={!canJumpBack}
              aria-current={isActive ? 'step' : undefined}
              aria-label={`Paso ${st.id + 1}: ${st.label}`}
            >
              <span className="stepper-bullet">{isDone ? '✓' : st.id + 1}</span>
              <span className="stepper-label">{st.icon} {st.label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={`stepper-line ${isDone ? 'done' : ''}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ========== STEP 1 — PROJECT DATA ========== */
function StepProject({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div style={s.card}>
      <h3 style={{ fontSize: 15, color: 'var(--purple-dark)', marginBottom: 16, fontFamily: 'Montserrat' }}>📝 Datos del Proyecto</h3>
      <div className="project-info-grid">
        <div>
          <label style={s.label}>Nombre del Proyecto *</label>
          <input style={s.input} value={data.project_name || ''} onChange={e => set('project_name', e.target.value)} placeholder="Ej: Plataforma de analítica" />
        </div>
        <div>
          <label style={s.label}>Cliente *</label>
          <input style={s.input} value={data.client_name || ''} onChange={e => set('client_name', e.target.value)} placeholder="Ej: Acme SA" />
        </div>
        <div>
          <label style={s.label}>Responsable Comercial</label>
          <input style={s.input} value={data.commercial_name || ''} onChange={e => set('commercial_name', e.target.value)} />
        </div>
        <div>
          <label style={s.label}>Ingeniero de Pre-venta</label>
          <input style={s.input} value={data.preventa_name || ''} onChange={e => set('preventa_name', e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={s.label}>Notas / Observaciones</label>
          <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical' }} value={data.notes || ''} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>
    </div>
  );
}

/* ========== STEP 2 — TEAM ========== */
function StepTeam({ data, onChange, params }) {
  const countries = params?.geo?.map(p => p.key) || [];
  const stacks = params?.stack?.map(p => p.key) || [];
  const profiles = data.lines || [];

  const updateProfile = (idx, field, value) => {
    const next = [...profiles];
    next[idx] = { ...next[idx], [field]: value };
    next[idx] = calcProjectProfile(next[idx], params);
    onChange({ ...data, lines: next });
  };
  const addProfile = () => {
    if (profiles.length >= 15) return;
    onChange({ ...data, lines: [...profiles, { ...EMPTY_PROFILE }] });
  };
  const removeProfile = (idx) => {
    const next = profiles.filter((_, i) => i !== idx);
    // remove matching allocation row
    const alloc = { ...(data.metadata?.allocation || {}) };
    const newAlloc = {};
    Object.entries(alloc).forEach(([k, v]) => {
      const pIdx = Number(k);
      if (pIdx < idx) newAlloc[pIdx] = v;
      else if (pIdx > idx) newAlloc[pIdx - 1] = v;
    });
    onChange({ ...data, lines: next, metadata: { ...(data.metadata || {}), allocation: newAlloc } });
  };

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 15, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>👥 Composición del Equipo ({profiles.length}/15)</h3>
        <button type="button" style={s.btn('var(--teal-mid)')} onClick={addProfile} disabled={profiles.length >= 15}>+ Agregar perfil</button>
      </div>
      <div className="table-wrapper">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['#','Rol / Título','Especialidad','Nivel','País','Biling.','Stack','Costo/Hr','Tarifa/Hr',''].map(h => (
                <th key={h} style={{ ...s.th, fontSize: 10, padding: '8px 6px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p, i) => (
              <tr key={i}>
                <td style={{ ...s.td, textAlign: 'center', fontWeight: 600, width: 30 }}>{i + 1}</td>
                <td style={s.td}>
                  <input style={{ ...s.input, minWidth: 140, fontSize: 12, padding: 6 }} value={p.role_title || ''} onChange={e => updateProfile(i, 'role_title', e.target.value)} placeholder="Ej: Senior Data Eng." />
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, fontSize: 11, minWidth: 130 }} value={p.specialty || ''} onChange={e => updateProfile(i, 'specialty', e.target.value)}>
                    <option value="">—</option>
                    {SPECIALTIES.map(sp => <option key={sp}>{sp}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, fontSize: 11, width: 60 }} value={p.level || ''} onChange={e => updateProfile(i, 'level', Number(e.target.value))}>
                    <option value="">—</option>
                    {[1,2,3,4,5,6,7,8,9,10,11].map(n => <option key={n} value={n}>L{n}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, fontSize: 11, minWidth: 110 }} value={p.country || 'Colombia'} onChange={e => updateProfile(i, 'country', e.target.value)}>
                    {countries.map(c => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ ...s.td, textAlign: 'center' }}>
                  <input type="checkbox" checked={p.bilingual || false} onChange={e => updateProfile(i, 'bilingual', e.target.checked)} />
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, fontSize: 11, minWidth: 120 }} value={p.stack || 'Especializada'} onChange={e => updateProfile(i, 'stack', e.target.value)}>
                    {stacks.map(st => <option key={st}>{st}</option>)}
                  </select>
                </td>
                <td style={{ ...s.td, fontWeight: 600, color: 'var(--purple-dark)', whiteSpace: 'nowrap' }}>{formatUSD2(p.cost_hour)}</td>
                <td style={{ ...s.td, fontWeight: 600, color: 'var(--teal-mid)', whiteSpace: 'nowrap' }}>{formatUSD2(p.rate_hour)}</td>
                <td style={s.td}>
                  <button type="button" aria-label={`Eliminar perfil ${i + 1}`} onClick={() => removeProfile(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>✕</button>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay perfiles aún. Usa "+ Agregar perfil" para comenzar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 10, fontStyle: 'italic' }}>
        En proyectos la <b>dedicación</b> se define por fase en el siguiente paso — no por perfil.
        No hay modalidad, herramientas, cantidad ni meses aquí.
      </div>
    </div>
  );
}

/* ========== STEP 3 — PHASES ========== */
function StepPhases({ data, onChange }) {
  const phases = data.phases || [];

  const updatePhase = (idx, field, value) => {
    const next = [...phases];
    next[idx] = { ...next[idx], [field]: value };
    onChange({ ...data, phases: next });
  };
  const addPhase = () => onChange({ ...data, phases: [...phases, { name: 'Nueva fase', weeks: 0, description: '' }] });
  const removePhase = (idx) => {
    const next = phases.filter((_, i) => i !== idx);
    const alloc = { ...(data.metadata?.allocation || {}) };
    const newAlloc = {};
    Object.entries(alloc).forEach(([pKey, row]) => {
      const newRow = {};
      Object.entries(row || {}).forEach(([fKey, v]) => {
        const fIdx = Number(fKey);
        if (fIdx < idx) newRow[fIdx] = v;
        else if (fIdx > idx) newRow[fIdx - 1] = v;
      });
      newAlloc[pKey] = newRow;
    });
    onChange({ ...data, phases: next, metadata: { ...(data.metadata || {}), allocation: newAlloc } });
  };

  const totalWeeks = phases.reduce((sum, p) => sum + Number(p.weeks || 0), 0);

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 15, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>📅 Fases del Proyecto</h3>
        <button type="button" style={s.btn('var(--teal-mid)')} onClick={addPhase}>+ Agregar fase</button>
      </div>
      <div className="table-wrapper">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              {['#','Nombre de Fase','Semanas','Descripción',''].map(h => (
                <th key={h} style={{ ...s.th, fontSize: 11, padding: '8px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {phases.map((p, i) => (
              <tr key={i}>
                <td style={{ ...s.td, textAlign: 'center', fontWeight: 600, width: 40 }}>{i + 1}</td>
                <td style={s.td}><input style={{ ...s.input, padding: 6 }} value={p.name || ''} onChange={e => updatePhase(i, 'name', e.target.value)} /></td>
                <td style={{ ...s.td, width: 110 }}>
                  <input style={{ ...s.input, padding: 6, textAlign: 'center' }} type="number" min={0} step={1} value={p.weeks || 0} onChange={e => updatePhase(i, 'weeks', Number(e.target.value))} aria-label={`Semanas fase ${i + 1}`} />
                </td>
                <td style={s.td}><input style={{ ...s.input, padding: 6 }} value={p.description || ''} onChange={e => updatePhase(i, 'description', e.target.value)} /></td>
                <td style={{ ...s.td, width: 30 }}>
                  <button type="button" aria-label={`Eliminar fase ${i + 1}`} onClick={() => removePhase(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ ...s.td, fontWeight: 700, textAlign: 'right', background: 'var(--bg)' }}>Total Semanas</td>
              <td style={{ ...s.td, fontWeight: 700, textAlign: 'center', background: 'var(--bg)', color: 'var(--purple-dark)' }}>{totalWeeks}</td>
              <td colSpan={2} style={{ ...s.td, background: 'var(--bg)' }}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ========== STEP 4 — ALLOCATION MATRIX ========== */
function StepAllocation({ data, onChange, params }) {
  const profiles = data.lines || [];
  const phases = data.phases || [];
  const allocation = data.metadata?.allocation || {};

  // Hard cap: nobody works more than 40 hours a week
  const MAX_HRS_PER_WEEK = 40;

  const setCell = useCallback((pIdx, fIdx, value) => {
    const next = { ...(data.metadata?.allocation || {}) };
    const row = { ...(next[pIdx] || {}) };
    // Clamp to [0, MAX_HRS_PER_WEEK] so pasted values or programmatic edits
    // can't exceed the weekly limit even if the native input is bypassed.
    const raw = Number(value) || 0;
    row[fIdx] = Math.max(0, Math.min(MAX_HRS_PER_WEEK, raw));
    next[pIdx] = row;
    onChange({ ...data, metadata: { ...(data.metadata || {}), allocation: next } });
  }, [data, onChange]);

  const summary = useMemo(() => calcAllocation(profiles, phases, allocation), [profiles, phases, allocation]);

  if (profiles.length === 0 || phases.length === 0) {
    return (
      <div style={s.card}>
        <h3 style={{ fontSize: 15, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>🧮 Asignación por Fase</h3>
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-light)' }}>
          Primero agrega perfiles (Paso 2) y fases (Paso 3) para poder asignar horas.
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <h3 style={{ fontSize: 15, color: 'var(--purple-dark)', fontFamily: 'Montserrat', marginBottom: 6 }}>🧮 Asignación por Fase (Hr/Semana)</h3>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 14 }}>
        Las celdas <b style={{ background: '#fef9c3', padding: '0 4px', borderRadius: 3 }}>amarillas</b> son editables (horas/semana, máx {MAX_HRS_PER_WEEK}). Las grises y lilas se calculan solas.
      </div>

      <div className="allocation-wrapper">
        <table className="allocation-matrix">
          <thead>
            <tr>
              <th className="alloc-sticky-0" rowSpan={2}>Perfil</th>
              <th className="alloc-sticky-1" rowSpan={2}>Costo/Hr</th>
              {phases.map((ph, fIdx) => (
                <th
                  key={fIdx}
                  colSpan={3}
                  style={{ background: PHASE_COLORS[fIdx % PHASE_COLORS.length], color: '#fff', textAlign: 'center' }}
                >
                  {ph.name || `Fase ${fIdx + 1}`} <span style={{ opacity: 0.8, fontWeight: 400 }}>({ph.weeks || 0} sem)</span>
                </th>
              ))}
              <th className="alloc-total-header" rowSpan={2}>TOTAL<br /><span style={{ fontWeight: 400, fontSize: 10 }}>Hrs · USD</span></th>
            </tr>
            <tr>
              {phases.map((_, fIdx) => (
                <React.Fragment key={fIdx}>
                  <th className="alloc-sub-header" style={{ background: PHASE_COLORS[fIdx % PHASE_COLORS.length] + 'cc' }}>Hr/Sem</th>
                  <th className="alloc-sub-header" style={{ background: PHASE_COLORS[fIdx % PHASE_COLORS.length] + '99' }}>Hrs</th>
                  <th className="alloc-sub-header" style={{ background: PHASE_COLORS[fIdx % PHASE_COLORS.length] + '66' }}>Costo</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((prof, pIdx) => (
              <tr key={pIdx}>
                <td className="alloc-sticky-0" style={{ fontWeight: 600 }}>
                  <div>{prof.role_title || `Perfil ${pIdx + 1}`}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-light)', fontWeight: 400 }}>{prof.specialty} · L{prof.level || '?'}</div>
                </td>
                <td className="alloc-sticky-1" style={{ fontWeight: 600, color: 'var(--purple-dark)' }}>{formatUSD2(prof.cost_hour)}</td>
                {phases.map((ph, fIdx) => {
                  const hw = Number(allocation?.[pIdx]?.[fIdx] || 0);
                  const hours = hw * Number(ph.weeks || 0);
                  const cost = hours * Number(prof.cost_hour || 0);
                  return (
                    <React.Fragment key={fIdx}>
                      <td className="alloc-input-cell">
                        <input
                          type="number"
                          min={0}
                          max={MAX_HRS_PER_WEEK}
                          step={1}
                          value={hw}
                          aria-label={`Horas por semana perfil ${pIdx + 1} fase ${fIdx + 1}`}
                          onChange={e => setCell(pIdx, fIdx, e.target.value)}
                          title={`Máximo ${MAX_HRS_PER_WEEK} hr/semana`}
                        />
                      </td>
                      <td className="alloc-calc-cell">{hours || 0}</td>
                      <td className="alloc-cost-cell">{formatUSD(cost)}</td>
                    </React.Fragment>
                  );
                })}
                <td className="alloc-total-cell">
                  <div style={{ fontWeight: 700 }}>{summary.byProfile[pIdx]?.hours || 0} hrs</div>
                  <div style={{ fontWeight: 600, color: 'var(--success)' }}>{formatUSD(summary.byProfile[pIdx]?.cost || 0)}</div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="alloc-sticky-0" style={{ fontWeight: 700, background: 'var(--bg)' }}>TOTAL</td>
              <td className="alloc-sticky-1" style={{ background: 'var(--bg)' }}></td>
              {phases.map((_, fIdx) => (
                <React.Fragment key={fIdx}>
                  <td className="alloc-foot-cell">{summary.byPhase[fIdx]?.hrWeek || 0}</td>
                  <td className="alloc-foot-cell">{summary.byPhase[fIdx]?.hours || 0}</td>
                  <td className="alloc-foot-cell" style={{ color: 'var(--success)' }}>{formatUSD(summary.byPhase[fIdx]?.cost || 0)}</td>
                </React.Fragment>
              ))}
              <td className="alloc-foot-cell" style={{ background: 'var(--purple-dark)', color: '#fff' }}>
                <div style={{ fontWeight: 700 }}>{summary.totalHours} hrs</div>
                <div style={{ fontWeight: 700 }}>{formatUSD(summary.totalCost)}</div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* US-5.2: summary cards */}
      <div className="summary-grid" style={{ marginTop: 20 }}>
        <div style={{ ...s.card, textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Montserrat', color: 'var(--purple-dark)' }}>{summary.totalHours}</div>
          <div style={{ fontSize: 11, color: 'var(--text-light)' }}>Total Horas Proyecto</div>
        </div>
        <div style={{ ...s.card, textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Montserrat', color: 'var(--success)' }}>{formatUSD(summary.totalCost)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-light)' }}>Costo Base del Equipo</div>
        </div>
        <div style={{ ...s.card, textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Montserrat', color: 'var(--teal-mid)' }}>{formatUSD2(summary.totalHours > 0 ? summary.totalCost / summary.totalHours : 0)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-light)' }}>Blend Rate Costo (USD/hr)</div>
        </div>
      </div>
    </div>
  );
}

/* ========== STEP 5 — EPICS (trazabilidad, opcional) ========== */
function StepEpics({ data, onChange }) {
  const profiles = data.lines || [];
  const phases = data.phases || [];
  const allocation = data.metadata?.allocation || {};
  const epics = data.epics || [];

  const devPhaseIdx = useMemo(() => {
    const i = phases.findIndex(p => (p.name || '').toLowerCase().includes('desarrollo'));
    return i >= 0 ? i : (phases.length > 1 ? 1 : 0);
  }, [phases]);

  const devHoursFromAlloc = useMemo(() => {
    let total = 0;
    profiles.forEach((_, pIdx) => {
      const hw = Number(allocation?.[pIdx]?.[devPhaseIdx] || 0);
      total += hw * Number(phases[devPhaseIdx]?.weeks || 0);
    });
    return total;
  }, [profiles, phases, allocation, devPhaseIdx]);

  const epicsTotalHours = useMemo(() => epics.reduce((sum, e) => sum + Number(e.total_hours || 0), 0), [epics]);
  const diffPct = devHoursFromAlloc > 0 ? Math.abs(epicsTotalHours - devHoursFromAlloc) / devHoursFromAlloc : 0;
  const warn = diffPct > 0.10 && epicsTotalHours > 0;

  const updateEpic = (idx, field, value) => {
    const next = [...epics];
    next[idx] = { ...next[idx], [field]: value };
    onChange({ ...data, epics: next });
  };
  const updateEpicHours = (idx, pIdx, hours) => {
    const next = [...epics];
    const hbp = { ...(next[idx]?.hours_by_profile || {}), [pIdx]: Number(hours) || 0 };
    const total = Object.values(hbp).reduce((s, v) => s + Number(v || 0), 0);
    next[idx] = { ...next[idx], hours_by_profile: hbp, total_hours: total };
    onChange({ ...data, epics: next });
  };
  const addEpic = () => {
    if (epics.length >= 20) return;
    onChange({ ...data, epics: [...epics, { name: '', priority: 'Media', hours_by_profile: {}, total_hours: 0 }] });
  };
  const removeEpic = (idx) => onChange({ ...data, epics: epics.filter((_, i) => i !== idx) });

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 15, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>🗂️ Desglose por Épicas ({epics.length}/20)</h3>
        <button type="button" style={s.btn('var(--teal-mid)')} onClick={addEpic} disabled={epics.length >= 20}>+ Agregar épica</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 14, fontStyle: 'italic' }}>
        Este desglose es <b>trazabilidad</b> — no afecta los cálculos de costo. Útil para justificar el costo ante el cliente y darle al PM un backlog inicial.
      </div>

      {epicsTotalHours > 0 && (
        <div style={{
          padding: '10px 14px', marginBottom: 14, borderRadius: 8,
          background: warn ? '#fef3c7' : '#e0f7fa',
          border: `1px solid ${warn ? '#f59e0b' : 'var(--teal-mid)'}`,
          fontSize: 13,
        }}>
          {warn && <span style={{ marginRight: 6 }}>⚠</span>}
          Total épicas: <b>{epicsTotalHours} hrs</b> &nbsp;|&nbsp; Total fase Desarrollo: <b>{devHoursFromAlloc} hrs</b>
          {warn && <span style={{ color: '#b45309', marginLeft: 6 }}>— difieren más de 10%, revisa</span>}
        </div>
      )}

      <div className="table-wrapper">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: Math.max(600, 400 + profiles.length * 100) }}>
          <thead>
            <tr>
              <th style={{ ...s.th, fontSize: 11, padding: '8px 10px' }}>#</th>
              <th style={{ ...s.th, fontSize: 11, padding: '8px 10px' }}>Nombre de Épica</th>
              <th style={{ ...s.th, fontSize: 11, padding: '8px 10px' }}>Prioridad</th>
              {profiles.map((p, i) => <th key={i} style={{ ...s.th, fontSize: 10, padding: '8px 6px', background: 'var(--teal-mid)' }}>{p.role_title || `P${i + 1}`}</th>)}
              <th style={{ ...s.th, fontSize: 11, padding: '8px 10px' }}>Total Hrs</th>
              <th style={{ ...s.th, fontSize: 11, padding: '8px 10px' }}></th>
            </tr>
          </thead>
          <tbody>
            {epics.map((e, i) => (
              <tr key={i}>
                <td style={{ ...s.td, textAlign: 'center', fontWeight: 600, width: 30 }}>{i + 1}</td>
                <td style={s.td}><input style={{ ...s.input, padding: 6, minWidth: 180 }} value={e.name || ''} onChange={ev => updateEpic(i, 'name', ev.target.value)} placeholder="Ej: Módulo de usuarios" /></td>
                <td style={s.td}>
                  <select style={{ ...s.select, fontSize: 11 }} value={e.priority || 'Media'} onChange={ev => updateEpic(i, 'priority', ev.target.value)}>
                    <option>Alta</option><option>Media</option><option>Baja</option>
                  </select>
                </td>
                {profiles.map((_, pIdx) => (
                  <td key={pIdx} style={s.td}>
                    <input style={{ ...s.input, padding: 6, width: 70, textAlign: 'center' }} type="number" min={0} step={1}
                      value={e.hours_by_profile?.[pIdx] || 0}
                      aria-label={`Horas épica ${i + 1} perfil ${pIdx + 1}`}
                      onChange={ev => updateEpicHours(i, pIdx, ev.target.value)} />
                  </td>
                ))}
                <td style={{ ...s.td, fontWeight: 700, color: 'var(--purple-dark)', textAlign: 'center' }}>{e.total_hours || 0}</td>
                <td style={s.td}>
                  <button type="button" aria-label={`Eliminar épica ${i + 1}`} onClick={() => removeEpic(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>✕</button>
                </td>
              </tr>
            ))}
            {epics.length === 0 && (
              <tr>
                <td colSpan={4 + profiles.length} style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  Sin épicas. Este paso es opcional — puedes saltar al resumen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========== STEP 6 — FINANCIAL SUMMARY + MILESTONES ========== */
function StepSummary({ data, onChange, params, onSave, saving, onStatusChange, onBack }) {
  const profiles = data.lines || [];
  const phases = data.phases || [];
  const allocation = data.metadata?.allocation || {};
  const milestones = data.milestones || [];
  const summary = useMemo(() => calcProjectSummary(profiles, phases, allocation, data.discount_pct || 0, params),
    [profiles, phases, allocation, data.discount_pct, params]);

  const setDiscount = (pct) => onChange({ ...data, discount_pct: Number(pct) / 100 });

  const updateMilestone = (idx, field, value) => {
    const next = [...milestones];
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'percentage') next[idx].amount = (Number(value) / 100) * summary.finalPrice;
    onChange({ ...data, milestones: next });
  };
  const addMilestone = () => {
    if (milestones.length >= 10) return;
    onChange({ ...data, milestones: [...milestones, { name: '', phase: phases[0]?.name || '', percentage: 0, amount: 0, expected_date: '' }] });
  };
  const removeMilestone = (idx) => onChange({ ...data, milestones: milestones.filter((_, i) => i !== idx) });

  const milestonesTotalPct = milestones.reduce((s, m) => s + Number(m.percentage || 0), 0);
  const milestonesOk = Math.abs(milestonesTotalPct - 100) < 0.01 || milestones.length === 0;

  const marginColor = summary.realMargin >= 0.50 ? 'var(--success)' : summary.realMargin >= 0.40 ? 'var(--warning)' : 'var(--danger)';

  return (
    <>
      {/* Cascada financiera */}
      <div style={s.card}>
        <h3 style={{ fontSize: 15, color: 'var(--purple-dark)', fontFamily: 'Montserrat', marginBottom: 16 }}>💰 Cascada Financiera</h3>
        <div className="cascade-table">
          <CascadeRow label="Costo base del equipo"            value={formatUSD(summary.totalCost)} />
          <CascadeRow label={`(+) Buffer de error (${formatPct(summary.buffer)})`}   value={formatUSD(summary.costWithBuffer - summary.totalCost)} indent />
          <CascadeRow label="Subtotal con buffer"              value={formatUSD(summary.costWithBuffer)} />
          <CascadeRow label={`(+) Garantía y soporte (${formatPct(summary.warranty)})`} value={formatUSD(summary.costProtected - summary.costWithBuffer)} indent />
          <CascadeRow label="COSTO TOTAL PROTEGIDO"            value={formatUSD(summary.costProtected)} highlight />
          <CascadeRow label={`Margen de contribución (${formatPct(summary.margin)})`} value={formatUSD(summary.salePrice - summary.costProtected)} indent />
          <CascadeRow label="PRECIO DE VENTA"                  value={formatUSD(summary.salePrice)} success />
          <div className="cascade-row">
            <div className="cascade-label">Descuento negociado (%)</div>
            <div className="cascade-value">
              <input style={{ ...s.input, width: 100, textAlign: 'right', padding: 6 }} type="number" min={0} max={50} step={1}
                value={Math.round((data.discount_pct || 0) * 100)} onChange={e => setDiscount(e.target.value)} aria-label="Descuento" />
              <span style={{ marginLeft: 6 }}>%</span>
            </div>
          </div>
          <CascadeRow label="PRECIO FINAL" value={formatUSD(summary.finalPrice)} final />
        </div>
      </div>

      {/* Métricas clave */}
      <div className="metrics-grid">
        <MetricCard value={summary.totalHours} label="Total horas" color="var(--purple-dark)" />
        <MetricCard value={summary.totalWeeks} label="Duración (semanas)" color="var(--teal-mid)" />
        <MetricCard value={formatUSD2(summary.blendRateSale)} label="Blend rate venta (USD/hr)" color="var(--orange)" sub="LATAM senior: $50-80/hr" />
        <MetricCard value={formatPct(summary.realMargin)} label="Margen real" color={marginColor} />
      </div>

      {/* Milestones */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: 15, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>💳 Plan de Pagos por Hitos ({milestones.length}/10)</h3>
          <button type="button" style={s.btn('var(--teal-mid)')} onClick={addMilestone} disabled={milestones.length >= 10}>+ Agregar hito</button>
        </div>
        <div className="table-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead><tr>
              {['#','Nombre','Fase','% del total','Monto','Fecha esperada',''].map(h => <th key={h} style={{ ...s.th, fontSize: 11, padding: '8px 10px' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {milestones.map((m, i) => (
                <tr key={i}>
                  <td style={{ ...s.td, textAlign: 'center', width: 30 }}>{i + 1}</td>
                  <td style={s.td}><input style={{ ...s.input, padding: 6 }} value={m.name || ''} onChange={e => updateMilestone(i, 'name', e.target.value)} placeholder="Ej: Kick-off firmado" /></td>
                  <td style={s.td}>
                    <select style={{ ...s.select, fontSize: 11 }} value={m.phase || ''} onChange={e => updateMilestone(i, 'phase', e.target.value)}>
                      <option value="">—</option>
                      {phases.map((p, pi) => <option key={pi} value={p.name}>{p.name}</option>)}
                    </select>
                  </td>
                  <td style={s.td}>
                    <input style={{ ...s.input, padding: 6, width: 80, textAlign: 'center' }} type="number" min={0} max={100} step={1}
                      value={m.percentage || 0} aria-label={`Porcentaje hito ${i + 1}`} onChange={e => updateMilestone(i, 'percentage', Number(e.target.value))} />
                  </td>
                  <td style={{ ...s.td, fontWeight: 600, color: 'var(--success)' }}>{formatUSD(m.amount || 0)}</td>
                  <td style={s.td}><input style={{ ...s.input, padding: 6 }} type="date" value={m.expected_date ? String(m.expected_date).slice(0, 10) : ''} onChange={e => updateMilestone(i, 'expected_date', e.target.value)} /></td>
                  <td style={s.td}>
                    <button type="button" aria-label={`Eliminar hito ${i + 1}`} onClick={() => removeMilestone(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ ...s.td, fontWeight: 700, textAlign: 'right', background: 'var(--bg)' }}>Total</td>
                <td style={{ ...s.td, fontWeight: 700, textAlign: 'center', background: 'var(--bg)', color: milestonesOk ? 'var(--success)' : 'var(--danger)' }}>{milestonesTotalPct.toFixed(0)}%</td>
                <td colSpan={3} style={{ ...s.td, background: 'var(--bg)' }}>
                  {!milestonesOk && <span style={{ color: 'var(--danger)', fontSize: 12 }}>⚠ Los porcentajes no suman 100%</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" style={s.btnOutline} onClick={onBack}>← Volver</button>
        <button type="button" style={s.btnOutline} onClick={() => alert('Exportar PDF — próximamente')}>📄 Exportar PDF</button>
        <button type="button" style={s.btnOutline} onClick={() => onSave('draft')} disabled={saving}>{saving ? 'Guardando...' : 'Guardar borrador'}</button>
        <button type="button" style={s.btn('var(--success)')} onClick={() => onStatusChange('sent')} disabled={saving}>Marcar como Enviada</button>
      </div>
    </>
  );
}

function CascadeRow({ label, value, indent, highlight, success, final }) {
  const style = {
    padding: '10px 14px',
    fontSize: 14,
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: indent ? 40 : 14,
    background: highlight ? '#faf5ff' : final ? 'linear-gradient(90deg, var(--purple-dark), var(--purple-mid))' : 'transparent',
    color: final ? '#fff' : success ? 'var(--success)' : highlight ? 'var(--purple-dark)' : 'var(--text)',
    fontWeight: (highlight || success || final) ? 700 : 500,
    fontSize: final ? 22 : highlight ? 16 : 14,
    borderRadius: final ? 8 : 0,
  };
  return <div style={style} className="cascade-row"><div>{label}</div><div>{value}</div></div>;
}

function MetricCard({ value, label, color, sub }) {
  return (
    <div style={{ ...s.card, textAlign: 'center', marginBottom: 0 }}>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Montserrat', color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--text-light)', marginTop: 2, fontStyle: 'italic' }}>{sub}</div>}
    </div>
  );
}

/* ========== MAIN PROJECT EDITOR ========== */
export default function ProjectEditor({ params, context }) {
  // Per-user preference: start in the unified editor unless the user opted
  // back to the classic stepper (localStorage flag). Toggle is exposed in
  // both views' headers so switching is reversible.
  const [classicView, setClassicView] = useState(() => {
    try { return localStorage.getItem(CLASSIC_PREF_KEY) === '1'; }
    catch (_) { return false; }
  });
  const switchToClassic = useCallback(() => {
    try { localStorage.setItem(CLASSIC_PREF_KEY, '1'); } catch (_) {}
    setClassicView(true);
  }, []);
  const switchToUnified = useCallback(() => {
    try { localStorage.removeItem(CLASSIC_PREF_KEY); } catch (_) {}
    setClassicView(false);
  }, []);

  if (!classicView) {
    return <ProjectEditorUnified params={params} context={context} onSwitchToClassic={switchToClassic} />;
  }
  return <ProjectEditorClassic params={params} context={context} onSwitchToUnified={switchToUnified} />;
}

function ProjectEditorClassic({ params, context, onSwitchToUnified }) {
  const nav = useNavigate();
  const { id: quotId } = useParams();
  const isNew = !quotId;

  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({
    type: 'fixed_scope',
    // EX-1: cliente+opp IDs from the pre-modal's context (new) or from the
    // GET response (edit). Both flow through to POST/PUT payloads below.
    client_id: context?.client_id || null,
    opportunity_id: context?.opportunity_id || null,
    project_name: '', client_name: context?.client_name || '', commercial_name: '', preventa_name: '',
    discount_pct: 0, notes: '', status: 'draft',
    lines: [],
    phases: [...DEFAULT_PHASES],
    epics: [],
    milestones: [],
    metadata: { allocation: {} },
  });

  useEffect(() => {
    if (!quotId) return;
    api.getQuotation(quotId).then(q => {
      // Recompute cost/rate hour in case params changed
      const lines = (q.lines || []).map(l => params ? calcProjectProfile(l, params) : l);
      setData({
        ...q,
        lines,
        phases: q.phases?.length ? q.phases : [...DEFAULT_PHASES],
        epics: q.epics || [],
        milestones: q.milestones || [],
        metadata: q.metadata || { allocation: {} },
      });
    }).catch(() => nav('/'));
  }, [quotId, nav, params]);

  /* ---- step gating ---- */
  const canAdvance = useMemo(() => {
    switch (current) {
      case 0: return !!(data.project_name?.trim() && data.client_name?.trim());
      case 1: return (data.lines || []).length > 0 && data.lines.every(l => l.level && l.country && l.stack);
      case 2: return (data.phases || []).some(p => Number(p.weeks || 0) > 0);
      case 3: return true;   // allocation never blocks (can be 0 hours)
      case 4: return true;   // epics optional
      case 5: return true;
      default: return true;
    }
  }, [current, data]);

  const completed = useMemo(() => {
    const set = new Set();
    if (data.project_name?.trim() && data.client_name?.trim()) set.add(0);
    if ((data.lines || []).length > 0 && data.lines.every(l => l.level)) set.add(1);
    if ((data.phases || []).some(p => Number(p.weeks || 0) > 0)) set.add(2);
    if (Object.keys(data.metadata?.allocation || {}).length > 0) set.add(3);
    if ((data.epics || []).length > 0) set.add(4);
    return set;
  }, [data]);

  const save = async (status) => {
    setSaving(true);
    try {
      const payload = { ...data, status: status || data.status };
      if (quotId) {
        await api.updateQuotation(quotId, payload);
      } else {
        const q = await api.createQuotation(payload);
        nav(`/quotation/${q.id}`, { replace: true });
      }
      // eslint-disable-next-line no-alert
      alert('Cotización guardada');
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error: ' + e.message);
    } finally { setSaving(false); }
  };
  const saveWithStatus = async (status) => {
    setData(d => ({ ...d, status }));
    await save(status);
  };

  const go = (n) => setCurrent(Math.max(0, Math.min(STEPS.length - 1, n)));

  return (
    <div>
      <div className="editor-header">
        <div>
          <button type="button" onClick={() => nav('/')} style={{ ...s.btnOutline, padding: '6px 12px', fontSize: 11, marginRight: 12 }}>← Dashboard</button>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
            {isNew ? 'Nuevo Proyecto' : 'Editar Proyecto'} — Alcance Fijo
          </span>
        </div>
        <div className="editor-actions">
          <button type="button" style={s.btnOutline} onClick={() => save('draft')} disabled={saving}>{saving ? 'Guardando...' : '💾 Guardar borrador'}</button>
          {onSwitchToUnified && (
            <button
              type="button"
              style={{ ...s.btnOutline, padding: '6px 12px', fontSize: 11, marginLeft: 8 }}
              onClick={onSwitchToUnified}
              title="Volver a la vista unificada (recomendada)"
            >
              Vista unificada
            </button>
          )}
        </div>
      </div>

      <Stepper current={current} completed={completed} onJump={go} />

      {current === 0 && <StepProject data={data} onChange={setData} />}
      {current === 1 && <StepTeam data={data} onChange={setData} params={params} />}
      {current === 2 && <StepPhases data={data} onChange={setData} />}
      {current === 3 && <StepAllocation data={data} onChange={setData} params={params} />}
      {current === 4 && <StepEpics data={data} onChange={setData} />}
      {current === 5 && <StepSummary data={data} onChange={setData} params={params} saving={saving} onSave={save} onStatusChange={saveWithStatus} onBack={() => go(current - 1)} />}

      {current < 5 && (
        <div className="stepper-nav">
          <button type="button" style={current === 0 ? s.btnDisabled : s.btnOutline} onClick={() => go(current - 1)} disabled={current === 0}>← Anterior</button>
          <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
            Paso {current + 1} de {STEPS.length}
          </div>
          <button
            type="button"
            style={canAdvance ? s.btn('var(--purple-dark)') : s.btnDisabled}
            onClick={() => canAdvance && go(current + 1)}
            disabled={!canAdvance}
            aria-label="Siguiente paso"
          >Siguiente →</button>
        </div>
      )}
    </div>
  );
}
