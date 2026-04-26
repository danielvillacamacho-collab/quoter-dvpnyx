import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from './utils/api';
import useAutosave from './hooks/useAutosave';
import AutosaveIndicator from './AutosaveIndicator';
import {
  calcProjectProfile,
  calcProjectSummary,
  formatUSD,
  formatUSD2,
  formatPct,
  SPECIALTIES,
  EMPTY_PROFILE,
  DEFAULT_PHASES,
  PHASE_COLORS,
} from './utils/calc';

/*
 * Single-page unified project editor (Spec URGENTE — Pre-venta, Abril 2026).
 *
 * Replaces the 6-step stepper with a layout that keeps ALL panels visible
 * and the financial cascade sticky on the right, so every edit shows its
 * impact on the final price in real time.
 *
 * The persistence shape (lines / phases / epics / milestones / metadata) is
 * IDENTICAL to the stepper — this is purely a UI reshape. Existing
 * quotations open without migration.
 *
 * Financial overrides (buffer / warranty / margin) live on
 * `metadata.financial_overrides` and shadow the global `parameters` values.
 * When a field is null, we fall back to params.
 */

/* ---------- shared tiny style helpers ---------- */
const s = {
  card: { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  cardTight: { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 12 },
  btn: (color = 'var(--purple-dark)') => ({ background: color, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }),
  btnSm: (color = 'var(--purple-dark)') => ({ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnOutlineSm: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, outline: 'none' },
  inputSm: { width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none' },
  select: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: '#fff', cursor: 'pointer' },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th: { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border)' },
  panelTitle: { fontSize: 14, color: 'var(--purple-dark)', fontFamily: 'Montserrat', fontWeight: 700, margin: 0 },
};

/*
 * Merge UI-driven financial overrides into the `parameters` payload so the
 * existing calc helpers (`calcProjectSummary` / `calcProjectFinancials`)
 * can be reused without signature changes. Overrides of `null`/`undefined`
 * fall back to the seeded parameters.
 */
function applyFinancialOverrides(params, overrides) {
  if (!params || !overrides) return params;
  const mapKey = { buffer: 'buffer', warranty: 'warranty', margin: 'min_margin' };
  const project = (params.project || []).map(p => {
    const overrideKey = Object.keys(mapKey).find(k => mapKey[k] === p.key);
    if (overrideKey && overrides[overrideKey] != null && !isNaN(overrides[overrideKey])) {
      return { ...p, value: Number(overrides[overrideKey]) };
    }
    return p;
  });
  return { ...params, project };
}

/* ========== ZONE 1 — PROJECT INFO (collapsible) ========== */
function ProjectInfoPanel({ data, onChange, collapsed, onToggleCollapse }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  const hasData = (data.project_name || '').trim() && (data.client_name || '').trim();
  return (
    <div style={s.cardTight}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onToggleCollapse()}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        aria-expanded={!collapsed}
        aria-controls="project-info-body"
      >
        <h3 style={s.panelTitle}>
          <span style={{ display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform .15s', marginRight: 6 }}>▾</span>
          📝 Datos del Proyecto
          {collapsed && hasData && (
            <span style={{ marginLeft: 10, fontWeight: 400, fontSize: 12, color: 'var(--text-light)' }}>
              · {data.project_name} · {data.client_name}
            </span>
          )}
        </h3>
      </div>
      {!collapsed && (
        <div id="project-info-body" className="project-info-grid" style={{ marginTop: 14 }}>
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
            <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={data.notes || ''} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== TEAM TABLE (perfiles inline) ========== */
function TeamPanel({ data, onChange, params }) {
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
    const draft = calcProjectProfile({ ...EMPTY_PROFILE, level: 5 }, params);
    onChange({ ...data, lines: [...profiles, draft] });
  };
  const removeProfile = (idx) => {
    const next = profiles.filter((_, i) => i !== idx);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={s.panelTitle}>👥 Equipo ({profiles.length}/15)</h3>
        <button type="button" style={s.btnSm('var(--teal-mid)')} onClick={addProfile} disabled={profiles.length >= 15} aria-label="Agregar perfil">+ Agregar perfil</button>
      </div>
      <div className="table-wrapper">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>
              {['#', 'Rol', 'Especialidad', 'Nivel', 'País', 'Biling.', 'Stack', 'Costo/Hr', 'Tarifa/Hr', ''].map(h => (
                <th key={h} style={{ ...s.th, fontSize: 10, padding: '6px 6px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p, i) => (
              <tr key={i}>
                <td style={{ ...s.td, textAlign: 'center', fontWeight: 600, width: 26 }}>{i + 1}</td>
                <td style={s.td}>
                  <input style={{ ...s.inputSm, minWidth: 130 }} value={p.role_title || ''} onChange={e => updateProfile(i, 'role_title', e.target.value)} placeholder="Ej: Senior Data Eng." />
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, minWidth: 120 }} value={p.specialty || ''} onChange={e => updateProfile(i, 'specialty', e.target.value)} aria-label={`Especialidad perfil ${i + 1}`}>
                    <option value="">—</option>
                    {SPECIALTIES.map(sp => <option key={sp}>{sp}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, width: 56 }} value={p.level || ''} onChange={e => updateProfile(i, 'level', Number(e.target.value))} aria-label={`Nivel perfil ${i + 1}`}>
                    <option value="">—</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(n => <option key={n} value={n}>L{n}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, minWidth: 100 }} value={p.country || 'Colombia'} onChange={e => updateProfile(i, 'country', e.target.value)} aria-label={`País perfil ${i + 1}`}>
                    {countries.map(c => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ ...s.td, textAlign: 'center' }}>
                  <input type="checkbox" checked={p.bilingual || false} onChange={e => updateProfile(i, 'bilingual', e.target.checked)} aria-label={`Bilingüe perfil ${i + 1}`} />
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, minWidth: 110 }} value={p.stack || 'Especializada'} onChange={e => updateProfile(i, 'stack', e.target.value)} aria-label={`Stack perfil ${i + 1}`}>
                    {stacks.map(st => <option key={st}>{st}</option>)}
                  </select>
                </td>
                <td style={{ ...s.td, fontWeight: 600, color: 'var(--purple-dark)', whiteSpace: 'nowrap' }}>{formatUSD2(p.cost_hour)}</td>
                <td style={{ ...s.td, fontWeight: 600, color: 'var(--teal-mid)', whiteSpace: 'nowrap' }}>{formatUSD2(p.rate_hour)}</td>
                <td style={s.td}>
                  <button type="button" aria-label={`Eliminar perfil ${i + 1}`} onClick={() => removeProfile(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 15 }}>✕</button>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 28, color: 'var(--text-light)' }}>
                Aún no hay perfiles. Usa "+ Agregar perfil" para comenzar.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========== ALLOCATION MATRIX with editable phase headers ========== */
function AllocationPanel({ data, onChange }) {
  const profiles = data.lines || [];
  const phases = data.phases || [];
  const allocation = data.metadata?.allocation || {};
  const MAX_HRS_PER_WEEK = 40;

  const setCell = useCallback((pIdx, fIdx, value) => {
    const next = { ...(data.metadata?.allocation || {}) };
    const row = { ...(next[pIdx] || {}) };
    const raw = Number(value) || 0;
    row[fIdx] = Math.max(0, Math.min(MAX_HRS_PER_WEEK, raw));
    next[pIdx] = row;
    onChange({ ...data, metadata: { ...(data.metadata || {}), allocation: next } });
  }, [data, onChange]);

  const updatePhase = (idx, field, value) => {
    const next = [...phases];
    next[idx] = { ...next[idx], [field]: value };
    onChange({ ...data, phases: next });
  };
  const addPhase = () => onChange({ ...data, phases: [...phases, { name: 'Nueva fase', weeks: 0, description: '' }] });
  const removePhase = (idx) => {
    const ph = phases[idx];
    const hasData = Object.values(allocation).some(row => Number(row?.[idx] || 0) > 0) || Number(ph?.weeks || 0) > 0;
    // eslint-disable-next-line no-alert
    if (hasData && !window.confirm(`¿Eliminar la fase "${ph?.name || 'sin nombre'}" y sus datos?`)) return;
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

  // Per-row / per-column totals
  const totals = useMemo(() => {
    const byProfile = {};
    const byPhase = {};
    let grandHours = 0;
    let grandCost = 0;
    profiles.forEach((prof, pIdx) => {
      byProfile[pIdx] = { hours: 0, cost: 0 };
      phases.forEach((ph, fIdx) => {
        byPhase[fIdx] = byPhase[fIdx] || { hrWeek: 0, hours: 0, cost: 0 };
        const hw = Number(allocation?.[pIdx]?.[fIdx] || 0);
        const h = hw * Number(ph.weeks || 0);
        const c = h * Number(prof.cost_hour || 0);
        byProfile[pIdx].hours += h;
        byProfile[pIdx].cost += c;
        byPhase[fIdx].hrWeek += hw;
        byPhase[fIdx].hours += h;
        byPhase[fIdx].cost += c;
        grandHours += h;
        grandCost += c;
      });
    });
    return { byProfile, byPhase, grandHours, grandCost };
  }, [profiles, phases, allocation]);

  if (profiles.length === 0) {
    return (
      <div style={s.card}>
        <h3 style={s.panelTitle}>🧮 Matriz de Asignación</h3>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>
          Agrega al menos un perfil arriba para ver la matriz.
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={s.panelTitle}>🧮 Matriz de Asignación (Hr/Semana por fase)</h3>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 10 }}>
        Celdas <b style={{ background: '#fef9c3', padding: '0 4px', borderRadius: 3 }}>amarillas</b> = horas/semana editables (máx {MAX_HRS_PER_WEEK}). Edita el nombre y las semanas de cada fase en su header.
      </div>

      <div className="allocation-wrapper" style={{ overflowX: 'auto' }}>
        <table className="allocation-matrix" style={{ minWidth: 780 }}>
          <thead>
            <tr>
              <th className="alloc-sticky-0" rowSpan={2} style={{ minWidth: 160 }}>Perfil</th>
              <th className="alloc-sticky-1" rowSpan={2}>Costo/Hr</th>
              {phases.map((ph, fIdx) => (
                <th
                  key={fIdx}
                  style={{ background: PHASE_COLORS[fIdx % PHASE_COLORS.length], color: '#fff', textAlign: 'center', padding: '6px 8px', minWidth: 130 }}
                >
                  <input
                    style={{ width: '100%', background: 'transparent', color: '#fff', border: '1px dashed rgba(255,255,255,0.35)', borderRadius: 4, padding: '2px 4px', fontWeight: 700, fontSize: 12, textAlign: 'center' }}
                    value={ph.name || ''}
                    onChange={e => updatePhase(fIdx, 'name', e.target.value)}
                    aria-label={`Nombre fase ${fIdx + 1}`}
                    placeholder={`Fase ${fIdx + 1}`}
                  />
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', marginTop: 4, fontSize: 11 }}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      style={{ width: 48, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 4, padding: '2px 4px', textAlign: 'center', fontSize: 11 }}
                      value={ph.weeks || 0}
                      onChange={e => updatePhase(fIdx, 'weeks', Number(e.target.value))}
                      aria-label={`Semanas fase ${fIdx + 1}`}
                    />
                    <span style={{ opacity: 0.85 }}>sem</span>
                    <button type="button" onClick={() => removePhase(fIdx)} aria-label={`Eliminar fase ${fIdx + 1}`} style={{ border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>✕</button>
                  </div>
                </th>
              ))}
              <th className="alloc-total-header" rowSpan={2} style={{ minWidth: 90 }}>TOTAL<br /><span style={{ fontWeight: 400, fontSize: 10 }}>Hrs · USD</span></th>
              <th rowSpan={2} style={{ background: 'var(--bg)', width: 28 }}>
                <button type="button" onClick={addPhase} aria-label="Agregar fase" style={{ border: '1px dashed var(--purple-dark)', background: 'transparent', color: 'var(--purple-dark)', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((prof, pIdx) => (
              <tr key={pIdx}>
                <td className="alloc-sticky-0" style={{ fontWeight: 600 }}>
                  <div>{prof.role_title || `Perfil ${pIdx + 1}`}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-light)', fontWeight: 400 }}>{prof.specialty || '—'} · L{prof.level || '?'}</div>
                </td>
                <td className="alloc-sticky-1" style={{ fontWeight: 600, color: 'var(--purple-dark)' }}>{formatUSD2(prof.cost_hour)}</td>
                {phases.map((_, fIdx) => {
                  const hw = Number(allocation?.[pIdx]?.[fIdx] || 0);
                  return (
                    <td key={fIdx} className="alloc-input-cell" style={{ textAlign: 'center' }}>
                      <input
                        type="number"
                        min={0}
                        max={MAX_HRS_PER_WEEK}
                        step={1}
                        value={hw}
                        aria-label={`Horas/sem perfil ${pIdx + 1} fase ${fIdx + 1}`}
                        onChange={e => setCell(pIdx, fIdx, e.target.value)}
                        style={{ width: 54, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', background: '#fef9c3', textAlign: 'center', fontSize: 12 }}
                        title={`Máx ${MAX_HRS_PER_WEEK} hr/sem`}
                      />
                    </td>
                  );
                })}
                <td className="alloc-total-cell">
                  <div style={{ fontWeight: 700 }}>{totals.byProfile[pIdx]?.hours || 0} hrs</div>
                  <div style={{ fontWeight: 600, color: 'var(--success)' }}>{formatUSD(totals.byProfile[pIdx]?.cost || 0)}</div>
                </td>
                <td />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="alloc-sticky-0" style={{ fontWeight: 700, background: 'var(--bg)' }}>TOTAL</td>
              <td className="alloc-sticky-1" style={{ background: 'var(--bg)' }}></td>
              {phases.map((_, fIdx) => (
                <td key={fIdx} className="alloc-foot-cell" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{totals.byPhase[fIdx]?.hours || 0} h</div>
                  <div style={{ fontSize: 10, color: 'var(--success)' }}>{formatUSD(totals.byPhase[fIdx]?.cost || 0)}</div>
                </td>
              ))}
              <td className="alloc-foot-cell" style={{ background: 'var(--purple-dark)', color: '#fff' }}>
                <div style={{ fontWeight: 700 }}>{totals.grandHours} hrs</div>
                <div style={{ fontWeight: 700 }}>{formatUSD(totals.grandCost)}</div>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ========== EPICS — optional collapsible ========== */
function EpicsPanel({ data, onChange, open, onToggle }) {
  const profiles = data.lines || [];
  const epics = data.epics || [];

  const updateEpic = (idx, field, value) => {
    const next = [...epics];
    next[idx] = { ...next[idx], [field]: value };
    onChange({ ...data, epics: next });
  };
  const updateEpicHours = (idx, pIdx, hours) => {
    const next = [...epics];
    const hbp = { ...(next[idx]?.hours_by_profile || {}), [pIdx]: Number(hours) || 0 };
    const total = Object.values(hbp).reduce((sum, v) => sum + Number(v || 0), 0);
    next[idx] = { ...next[idx], hours_by_profile: hbp, total_hours: total };
    onChange({ ...data, epics: next });
  };
  const addEpic = () => {
    if (epics.length >= 20) return;
    onChange({ ...data, epics: [...epics, { name: '', priority: 'Media', hours_by_profile: {}, total_hours: 0 }] });
  };
  const removeEpic = (idx) => onChange({ ...data, epics: epics.filter((_, i) => i !== idx) });

  const epicsTotal = epics.reduce((s, e) => s + Number(e.total_hours || 0), 0);

  return (
    <div style={s.cardTight}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onToggle()}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        aria-expanded={open}
        aria-controls="epics-body"
      >
        <h3 style={s.panelTitle}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s', marginRight: 6 }}>▾</span>
          🗂️ Desglose por Épicas ({epics.length}/20)
          {epicsTotal > 0 && <span style={{ marginLeft: 10, fontWeight: 400, fontSize: 12, color: 'var(--text-light)' }}>· {epicsTotal} hrs</span>}
        </h3>
      </div>
      {open && (
        <div id="epics-body" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 8, fontStyle: 'italic' }}>
            Trazabilidad — no afecta el costo, ayuda a justificar horas de desarrollo ante el cliente.
          </div>
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead>
                <tr>
                  <th style={{ ...s.th, fontSize: 10, padding: '6px 8px' }}>#</th>
                  <th style={{ ...s.th, fontSize: 10, padding: '6px 8px' }}>Épica</th>
                  <th style={{ ...s.th, fontSize: 10, padding: '6px 8px' }}>Prioridad</th>
                  {profiles.map((p, i) => (
                    <th key={i} style={{ ...s.th, fontSize: 10, padding: '6px 6px', background: 'var(--teal-mid)' }}>
                      {p.role_title || `P${i + 1}`}
                    </th>
                  ))}
                  <th style={{ ...s.th, fontSize: 10, padding: '6px 8px' }}>Total</th>
                  <th style={{ ...s.th, fontSize: 10, padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {epics.map((e, i) => (
                  <tr key={i}>
                    <td style={{ ...s.td, textAlign: 'center', width: 26 }}>{i + 1}</td>
                    <td style={s.td}>
                      <input style={{ ...s.inputSm, minWidth: 160 }} value={e.name || ''} onChange={ev => updateEpic(i, 'name', ev.target.value)} placeholder="Ej: Módulo de usuarios" />
                    </td>
                    <td style={s.td}>
                      <select style={s.select} value={e.priority || 'Media'} onChange={ev => updateEpic(i, 'priority', ev.target.value)} aria-label={`Prioridad épica ${i + 1}`}>
                        <option>Alta</option><option>Media</option><option>Baja</option>
                      </select>
                    </td>
                    {profiles.map((_, pIdx) => (
                      <td key={pIdx} style={{ ...s.td, textAlign: 'center' }}>
                        <input
                          style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', textAlign: 'center', fontSize: 12 }}
                          type="number" min={0} step={1}
                          value={e.hours_by_profile?.[pIdx] || 0}
                          aria-label={`Horas épica ${i + 1} perfil ${pIdx + 1}`}
                          onChange={ev => updateEpicHours(i, pIdx, ev.target.value)}
                        />
                      </td>
                    ))}
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--purple-dark)', textAlign: 'center' }}>{e.total_hours || 0}</td>
                    <td style={s.td}>
                      <button type="button" aria-label={`Eliminar épica ${i + 1}`} onClick={() => removeEpic(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                    </td>
                  </tr>
                ))}
                {epics.length === 0 && (
                  <tr><td colSpan={4 + profiles.length} style={{ textAlign: 'center', padding: 20, color: 'var(--text-light)', fontSize: 12 }}>
                    Sin épicas — opcional.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8 }}>
            <button type="button" style={s.btnOutlineSm} onClick={addEpic} disabled={epics.length >= 20}>+ Agregar épica</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== MILESTONES panel ========== */
function MilestonesPanel({ data, onChange, finalPrice }) {
  const phases = data.phases || [];
  const milestones = data.milestones || [];

  const updateMilestone = (idx, field, value) => {
    const next = [...milestones];
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'percentage') next[idx].amount = (Number(value) / 100) * finalPrice;
    onChange({ ...data, milestones: next });
  };
  const addMilestone = () => {
    if (milestones.length >= 10) return;
    onChange({ ...data, milestones: [...milestones, { name: '', phase: phases[0]?.name || '', percentage: 0, amount: 0, expected_date: '' }] });
  };
  const removeMilestone = (idx) => onChange({ ...data, milestones: milestones.filter((_, i) => i !== idx) });

  const totalPct = milestones.reduce((sum, m) => sum + Number(m.percentage || 0), 0);
  const ok = Math.abs(totalPct - 100) < 0.01 || milestones.length === 0;

  return (
    <div style={s.cardTight}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={s.panelTitle}>💳 Plan de Pagos ({milestones.length}/10)</h3>
        <button type="button" style={s.btnSm('var(--teal-mid)')} onClick={addMilestone} disabled={milestones.length >= 10}>+ Agregar hito</button>
      </div>
      {milestones.length > 0 && (
        <div className="table-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead><tr>
              {['#', 'Nombre', 'Fase', '% del total', 'Monto', 'Fecha', ''].map(h => <th key={h} style={{ ...s.th, fontSize: 10, padding: '6px 8px' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {milestones.map((m, i) => (
                <tr key={i}>
                  <td style={{ ...s.td, textAlign: 'center', width: 26 }}>{i + 1}</td>
                  <td style={s.td}><input style={s.inputSm} value={m.name || ''} onChange={e => updateMilestone(i, 'name', e.target.value)} placeholder="Ej: Kick-off firmado" /></td>
                  <td style={s.td}>
                    <select style={s.select} value={m.phase || ''} onChange={e => updateMilestone(i, 'phase', e.target.value)} aria-label={`Fase hito ${i + 1}`}>
                      <option value="">—</option>
                      {phases.map((p, pi) => <option key={pi} value={p.name}>{p.name}</option>)}
                    </select>
                  </td>
                  <td style={s.td}>
                    <input
                      style={{ ...s.inputSm, width: 70, textAlign: 'center' }} type="number" min={0} max={100} step={1}
                      value={m.percentage || 0} aria-label={`Porcentaje hito ${i + 1}`}
                      onChange={e => updateMilestone(i, 'percentage', Number(e.target.value))}
                    />
                  </td>
                  <td style={{ ...s.td, fontWeight: 600, color: 'var(--success)' }}>{formatUSD(m.amount || 0)}</td>
                  <td style={s.td}>
                    <input style={s.inputSm} type="date" value={m.expected_date ? String(m.expected_date).slice(0, 10) : ''} onChange={e => updateMilestone(i, 'expected_date', e.target.value)} />
                  </td>
                  <td style={s.td}>
                    <button type="button" aria-label={`Eliminar hito ${i + 1}`} onClick={() => removeMilestone(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ ...s.td, fontWeight: 700, textAlign: 'right', background: 'var(--bg)' }}>Total</td>
                <td style={{ ...s.td, fontWeight: 700, textAlign: 'center', background: 'var(--bg)', color: ok ? 'var(--success)' : 'var(--danger)' }}>{totalPct.toFixed(0)}%</td>
                <td colSpan={3} style={{ ...s.td, background: 'var(--bg)' }}>
                  {!ok && <span style={{ color: 'var(--danger)', fontSize: 11 }}>⚠ No suma 100%</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ========== FINANCIAL SUMMARY (sticky right) ========== */
function FinancialSummaryPanel({ data, onChange, summary }) {
  const overrides = data.metadata?.financial_overrides || {};

  const setOverride = (k, v) => {
    const num = v === '' || v == null ? null : Number(v) / 100;
    const next = { ...overrides };
    if (num == null || isNaN(num)) delete next[k];
    else next[k] = num;
    onChange({ ...data, metadata: { ...(data.metadata || {}), financial_overrides: next } });
  };
  const setDiscount = (pct) => onChange({ ...data, discount_pct: Number(pct) / 100 });

  const currentBuffer = (overrides.buffer != null) ? overrides.buffer : summary.buffer;
  const currentWarranty = (overrides.warranty != null) ? overrides.warranty : summary.warranty;
  const currentMargin = (overrides.margin != null) ? overrides.margin : summary.margin;

  const marginColor = summary.realMargin >= 0.50 ? 'var(--success)' : summary.realMargin >= 0.40 ? 'var(--warning)' : 'var(--danger)';
  const marginEmoji = summary.realMargin >= 0.50 ? '🟢' : summary.realMargin >= 0.40 ? '🟡' : '🔴';

  return (
    <div className="financial-summary-sticky" style={{ ...s.card, marginBottom: 0 }}>
      <h3 style={{ ...s.panelTitle, marginBottom: 12 }}>💰 Resumen Financiero</h3>

      {/* Totals up top */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <SmallMetric value={summary.totalHours} label="Total horas" color="var(--purple-dark)" />
        <SmallMetric value={summary.totalWeeks} label="Total semanas" color="var(--teal-mid)" />
      </div>

      {/* Cascade */}
      <CascadeRow label="Costo base equipo" value={formatUSD(summary.totalCost)} />

      <OverrideRow
        label="(+) Buffer"
        suffix="%"
        valueText={formatUSD(summary.costWithBuffer - summary.totalCost)}
        inputValue={currentBuffer == null ? '' : Math.round(Number(currentBuffer) * 100)}
        onChange={v => setOverride('buffer', v)}
        ariaLabel="Buffer porcentaje"
      />
      <CascadeRow label="Subtotal con buffer" value={formatUSD(summary.costWithBuffer)} indent />

      <OverrideRow
        label="(+) Garantía"
        suffix="%"
        valueText={formatUSD(summary.costProtected - summary.costWithBuffer)}
        inputValue={currentWarranty == null ? '' : Math.round(Number(currentWarranty) * 100)}
        onChange={v => setOverride('warranty', v)}
        ariaLabel="Garantía porcentaje"
      />
      <CascadeRow label="= Costo protegido" value={formatUSD(summary.costProtected)} highlight />

      <OverrideRow
        label="Margen contribución"
        suffix="%"
        valueText=""
        inputValue={currentMargin == null ? '' : Math.round(Number(currentMargin) * 100)}
        onChange={v => setOverride('margin', v)}
        ariaLabel="Margen porcentaje"
      />

      <CascadeRow label="= Precio de venta" value={formatUSD(summary.salePrice)} success />

      <OverrideRow
        label="Descuento"
        suffix="%"
        valueText=""
        inputValue={Math.round((data.discount_pct || 0) * 100)}
        onChange={v => setDiscount(v)}
        ariaLabel="Descuento porcentaje"
      />

      <CascadeRow label="PRECIO FINAL" value={formatUSD(summary.finalPrice)} final />

      {/* Bottom metrics with semaforo */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 6, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-light)' }}>Blend rate venta</span>
          <span style={{ fontWeight: 600, color: 'var(--teal-mid)' }}>{formatUSD2(summary.blendRateSale)}/hr</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-light)' }}>Margen real post-descuento</span>
          <span style={{ fontWeight: 700, color: marginColor }} data-testid="semaforo-margen">{marginEmoji} {formatPct(summary.realMargin)}</span>
        </div>
      </div>
    </div>
  );
}

function SmallMetric({ value, label, color }) {
  return (
    <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'Montserrat' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-light)' }}>{label}</div>
    </div>
  );
}

function CascadeRow({ label, value, indent, highlight, success, final }) {
  const bg = final
    ? 'linear-gradient(90deg, var(--purple-dark), var(--purple-mid))'
    : highlight ? '#faf5ff' : 'transparent';
  const color = final ? '#fff' : success ? 'var(--success)' : highlight ? 'var(--purple-dark)' : 'var(--text)';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: final ? '12px 14px' : '8px 10px',
      paddingLeft: indent ? 22 : (final ? 14 : 10),
      background: bg,
      color,
      fontWeight: (final || highlight || success) ? 700 : 500,
      fontSize: final ? 18 : highlight ? 13 : 12,
      borderRadius: final ? 8 : 0,
      borderBottom: final ? 'none' : '1px dashed var(--border)',
      margin: final ? '10px 0 0' : 0,
    }}>
      <span>{label}</span>
      <span data-testid={final ? 'precio-final' : undefined}>{value}</span>
    </div>
  );
}

function OverrideRow({ label, inputValue, onChange, valueText, ariaLabel, suffix }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', paddingLeft: 22, fontSize: 12, borderBottom: '1px dashed var(--border)', color: 'var(--text)' }}>
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          style={{ width: 54, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}
          value={inputValue}
          aria-label={ariaLabel}
          onChange={e => onChange(e.target.value)}
        />
        <span style={{ color: 'var(--text-light)', fontSize: 11, minWidth: 10 }}>{suffix || ''}</span>
        {valueText && <span style={{ color: 'var(--text-light)', fontSize: 11, minWidth: 70, textAlign: 'right' }}>{valueText}</span>}
      </div>
    </div>
  );
}

/* ========== MOBILE FOOTER (< 1024px) ========== */
function MobileFooter({ summary }) {
  const marginColor = summary.realMargin >= 0.50 ? 'var(--success)' : summary.realMargin >= 0.40 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div className="project-editor-mobile-footer">
      <div><small>Total horas</small><strong>{summary.totalHours}</strong></div>
      <div><small>Precio final</small><strong style={{ color: 'var(--teal-mid)' }}>{formatUSD(summary.finalPrice)}</strong></div>
      <div><small>Margen</small><strong style={{ color: marginColor }}>{formatPct(summary.realMargin)}</strong></div>
    </div>
  );
}

/* ========== EXPORT DROPDOWN ========== */
function ExportDropdown({ onExport, disabled, disabledReason }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const run = async (fmt) => {
    setBusy(fmt);
    setOpen(false);
    try { await onExport(fmt); }
    finally { setBusy(null); }
  };

  // Estilo muted cuando disabled, gemelo al de "Guardar borrador" cuando
  // !canSave. NO usamos HTML `disabled` por motivo de negocio (sólo para
  // `busy`) para que el tooltip nativo `title=` se dispare en hover —
  // algunos browsers bloquean mouseenter en `<button disabled>`.
  const disabledStyle = disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {};
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        style={{ ...s.btnOutline, display: 'inline-flex', alignItems: 'center', gap: 6, ...disabledStyle }}
        onClick={() => { if (disabled || busy) return; setOpen(o => !o); }}
        disabled={!!busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled || !!busy}
        title={disabled ? disabledReason : undefined}
      >
        {busy ? `Generando ${busy}…` : 'Exportar ▾'}
      </button>
      {open && !disabled && (
        <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 180 }}>
          <button role="menuitem" type="button" onClick={() => run('xlsx')} style={menuItemStyle}>📊 Exportar a Excel (.xlsx)</button>
          <button role="menuitem" type="button" onClick={() => run('pdf')} style={menuItemStyle}>📄 Exportar a PDF</button>
        </div>
      )}
    </div>
  );
}
const menuItemStyle = { width: '100%', textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' };

/* ========== MAIN ========== */
export default function ProjectEditorUnified({ params, context, onSwitchToClassic }) {
  const nav = useNavigate();
  const { id: quotId } = useParams();
  const isNew = !quotId;

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [epicsOpen, setEpicsOpen] = useState(false);
  const [data, setData] = useState({
    type: 'fixed_scope',
    client_id: context?.client_id || null,
    opportunity_id: context?.opportunity_id || null,
    project_name: '', client_name: context?.client_name || '',
    commercial_name: '', preventa_name: '',
    discount_pct: 0, notes: '', status: 'draft',
    lines: [],
    phases: [...DEFAULT_PHASES],
    epics: [],
    milestones: [],
    metadata: { allocation: {}, financial_overrides: {} },
  });

  // Autosave hook — declarado antes del load useEffect para poder llamar
  // resetBaseline justo después del fetch y evitar que la transición
  // defaults→loaded dispare un PUT espurio.
  const autosaveRef = useRef(null);

  // Load existing quotation if editing
  useEffect(() => {
    if (!quotId) return;
    api.getQuotation(quotId).then(q => {
      const lines = (q.lines || []).map(l => params ? calcProjectProfile(l, params) : l);
      const loaded = {
        ...q,
        lines,
        phases: q.phases?.length ? q.phases : [...DEFAULT_PHASES],
        epics: q.epics || [],
        milestones: q.milestones || [],
        metadata: { allocation: {}, financial_overrides: {}, ...(q.metadata || {}) },
      };
      setData(loaded);
      // Reset autosave baseline al estado recién cargado, así el hook NO
      // interpreta la transición defaults→loaded como "edit del usuario".
      if (autosaveRef.current) autosaveRef.current.resetBaseline(loaded);
      // Collapse project info by default if we already have data
      if (q.project_name) setInfoCollapsed(true);
      if ((q.epics || []).length > 0) setEpicsOpen(true);
    }).catch(() => nav('/'));
  }, [quotId, nav, params]);

  // Wrap setData to track dirty state
  const handleChange = useCallback((next) => {
    setDirty(true);
    setData(next);
  }, []);

  // Effective params with UI-driven financial overrides applied
  const effectiveParams = useMemo(
    () => applyFinancialOverrides(params, data.metadata?.financial_overrides || {}),
    [params, data.metadata?.financial_overrides]
  );

  // Real-time financial cascade — recomputed on every data change
  const summary = useMemo(
    () => calcProjectSummary(data.lines || [], data.phases || [], data.metadata?.allocation || {}, data.discount_pct || 0, effectiveParams),
    [data.lines, data.phases, data.metadata?.allocation, data.discount_pct, effectiveParams]
  );

  const canSave = !!((data.project_name || '').trim() && (data.client_name || '').trim());
  // Export ya NO depende de !dirty: con autosave activo, los cambios se
  // persisten solos; con autosave inactivo, doExport hace flush manual al
  // PUT antes de generar el archivo. La condición de export queda sólo
  // sobre datos fundamentalmente requeridos (ya guardado, ≥1 perfil,
  // ≥1 fase con horas).
  const canExport = !isNew
    && (data.lines || []).length > 0
    && (data.phases || []).some(p => Number(p.weeks || 0) > 0);
  const exportDisabledReason = isNew
    ? 'Debes guardar cambios para exportar'
    : (data.lines || []).length === 0 || !(data.phases || []).some(p => Number(p.weeks || 0) > 0)
      ? 'La cotización necesita al menos 1 perfil y 1 fase con horas > 0'
      : '';

  // ──────── Autosave (debounced PUT) ────────
  // Sólo aplica a cotizaciones ya creadas. Para nuevas, el primer Guardar
  // crea el registro y de ahí en adelante el autosave hace su trabajo.
  const autosave = useAutosave({
    quotId,
    data,
    onSaved: () => setDirty(false),
  });
  // Expose autosave handle to load useEffect via ref so we can resetBaseline
  // right after fetch completes.
  autosaveRef.current = autosave;

  const save = async (status) => {
    if (!canSave) {
      // eslint-disable-next-line no-alert
      alert('Completa al menos el nombre del proyecto y el cliente antes de guardar.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...data, status: status || data.status };
      let resp;
      if (quotId) {
        resp = await api.updateQuotation(quotId, payload);
        const nextData = { ...data, ...resp, metadata: { allocation: {}, financial_overrides: {}, ...(data.metadata || {}) } };
        setData(nextData);
        autosave.resetBaseline(nextData);
        setDirty(false);
      } else {
        resp = await api.createQuotation(payload);
        nav(`/quotation/${resp.id}`, { replace: true });
      }
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error al guardar: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const doExport = async (format) => {
    if (!quotId) return;
    try {
      // Flush antes de exportar: si autosave está activo, persiste los
      // cambios pendientes; si está inactivo, mandamos el `state` actual
      // como override en el body para que el server use lo que ve el
      // usuario en pantalla (no la versión en BD potencialmente vieja).
      if (autosave.enabled) {
        await autosave.flush();
      }
      const overrideState = autosave.enabled ? null : data;
      const res = await api.exportQuotation(quotId, format, overrideState);
      // res is a Blob; trigger download
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error al exportar: ' + e.message);
    }
  };

  return (
    <div className="project-editor-unified">
      {/* Header */}
      <div className="editor-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={() => nav('/')} style={{ ...s.btnOutline, padding: '6px 12px', fontSize: 11 }}>← Dashboard</button>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
            {isNew ? 'Nuevo Proyecto' : 'Editar Proyecto'} — Alcance Fijo
          </span>
          {dirty && !autosave.enabled && <span style={{ fontSize: 11, color: 'var(--warning)', fontStyle: 'italic' }}>· cambios sin guardar</span>}
        </div>
        <div className="editor-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <AutosaveIndicator enabled={autosave.enabled && !isNew} status={autosave.status} lastSavedAt={autosave.lastSavedAt} />
          <ExportDropdown onExport={doExport} disabled={!canExport} disabledReason={exportDisabledReason} />
          <button
            type="button"
            style={canSave ? s.btnOutline : { ...s.btnOutline, opacity: 0.5, cursor: 'not-allowed' }}
            onClick={() => { if (!canSave || saving) return; save('draft'); }}
            disabled={saving}
            aria-disabled={!canSave || saving}
            title={!canSave ? 'Campos pendientes de diligenciar para guardar' : undefined}
          >
            {saving ? 'Guardando…' : '💾 Guardar borrador'}
          </button>
          {onSwitchToClassic && (
            <button type="button" style={{ ...s.btnOutlineSm, marginLeft: 4 }} onClick={onSwitchToClassic} title="Cambiar a la vista clásica por pasos">
              Vista clásica
            </button>
          )}
        </div>
      </div>

      {/* Zone 1: project info */}
      <ProjectInfoPanel data={data} onChange={handleChange} collapsed={infoCollapsed} onToggleCollapse={() => setInfoCollapsed(c => !c)} />

      {/* Zone 2 + 3: main grid */}
      <div className="project-editor-grid">
        <div className="project-editor-main">
          <TeamPanel data={data} onChange={handleChange} params={params} />
          <AllocationPanel data={data} onChange={handleChange} />
          <EpicsPanel data={data} onChange={handleChange} open={epicsOpen} onToggle={() => setEpicsOpen(o => !o)} />
          <MilestonesPanel data={data} onChange={handleChange} finalPrice={summary.finalPrice} />
        </div>
        <div className="project-editor-side">
          <FinancialSummaryPanel data={data} onChange={handleChange} summary={summary} />
        </div>
      </div>

      <MobileFooter summary={summary} />
    </div>
  );
}
