import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from './utils/api';
import {
  calcStaffAugLine,
  formatUSD,
  formatUSD2,
  formatPct,
  SPECIALTIES,
  EMPTY_LINE,
} from './utils/calc';

/*
 * Single-page unified staff-augmentation (capacity) editor — Spec 3
 * (spec_capacity_editor.docx, Abril 2026, pre-venta).
 *
 * Mirrors the architecture of ProjectEditorUnified: project-info panel
 * (collapsible), single resource table in the main area, and a sticky
 * financial summary on the right (or pinned footer on narrow screens).
 *
 * Data shape (lines[]) is identical to the current classic editor, so
 * cotizaciones existentes abren sin migración.
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
  select: { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: '#fff', cursor: 'pointer' },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th: { padding: '8px 6px', fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '6px 6px', fontSize: 12, borderBottom: '1px solid var(--border)' },
  panelTitle: { fontSize: 14, color: 'var(--purple-dark)', fontFamily: 'Montserrat', fontWeight: 700, margin: 0 },
};

/* Short descriptions used by the level tooltip (pasada de ratón sobre L1-L11).
 * La idea es ayudar al pre-venta a asignar el nivel correcto sin ir a la Wiki. */
const LEVEL_BRIEF = {
  1: 'L1 — Trainee: en formación, requiere guía constante.',
  2: 'L2 — Junior 1: autónomo en tareas simples bajo supervisión.',
  3: 'L3 — Junior 2: resuelve tareas estándar con poca ayuda.',
  4: 'L4 — Semi Senior 1: cierra tareas end-to-end con revisión.',
  5: 'L5 — Semi Senior 2: resuelve problemas complejos, mentoriza juniors.',
  6: 'L6 — Semi Senior 3 / líder técnico junior.',
  7: 'L7 — Senior: autónomo, toma decisiones técnicas, lidera squads.',
  8: 'L8 — Senior Plus / Staff: referente técnico transversal.',
  9: 'L9 — Principal: arquitectura de dominio, cross-team.',
  10: 'L10 — Crack: referente de industria, impacto estratégico.',
  11: 'L11 — Distinguished: autoridad técnica máxima del equipo.',
};

function levelTooltip(level, params) {
  const base = LEVEL_BRIEF[level] || `L${level}`;
  const levelParam = params?.level?.find((p) => p.key === `L${level}`);
  if (levelParam) return `${base}\nCosto empresa: ${formatUSD(Number(levelParam.value))}/mes`;
  return base;
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
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggleCollapse()}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        aria-expanded={!collapsed}
        aria-controls="staff-aug-info-body"
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
        <div id="staff-aug-info-body" className="project-info-grid" style={{ marginTop: 14 }}>
          <div>
            <label style={s.label}>Nombre del Proyecto *</label>
            <input style={s.input} value={data.project_name || ''} onChange={(e) => set('project_name', e.target.value)} placeholder="Ej: Squad Data Platform" />
          </div>
          <div>
            <label style={s.label}>Cliente *</label>
            <input style={s.input} value={data.client_name || ''} onChange={(e) => set('client_name', e.target.value)} placeholder="Ej: Acme SA" />
          </div>
          <div>
            <label style={s.label}>Responsable Comercial</label>
            <input style={s.input} value={data.commercial_name || ''} onChange={(e) => set('commercial_name', e.target.value)} />
          </div>
          <div>
            <label style={s.label}>Ingeniero de Pre-venta</label>
            <input style={s.input} value={data.preventa_name || ''} onChange={(e) => set('preventa_name', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={s.label}>Notas / Observaciones</label>
            <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={data.notes || ''} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== RESOURCE TABLE ========== */
function ResourceTable({ data, onChange, params, marginOverride }) {
  const countries = params?.geo?.map((p) => p.key) || [];
  const stacks = params?.stack?.map((p) => p.key) || [];
  const modalities = params?.modality?.map((p) => p.key) || [];
  const toolsOpts = params?.tools?.map((p) => p.key) || [];
  const lines = data.lines || [];

  const updateLine = (idx, field, value) => {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    if (params) next[idx] = calcStaffAugLine(next[idx], params, marginOverride);
    onChange({ ...data, lines: next });
  };
  const addLine = () => {
    // Defaults inteligentes per spec: L5, Colombia, no bilingüe, Sin herramientas,
    // Estándar, Remoto, 1 recurso, 6 meses.
    const base = {
      ...EMPTY_LINE,
      level: 5,
      country: countries.includes('Colombia') ? 'Colombia' : (countries[0] || 'Colombia'),
      tools: toolsOpts.includes('Sin') ? 'Sin' : (toolsOpts[0] || 'Sin'),
      stack: stacks.includes('Estándar') ? 'Estándar' : (stacks[0] || 'Especializada'),
      modality: modalities.includes('Remoto') ? 'Remoto' : (modalities[0] || 'Remoto'),
      quantity: 1,
      duration_months: 6,
    };
    const draft = params ? calcStaffAugLine(base, params, marginOverride) : base;
    onChange({ ...data, lines: [...lines, draft] });
  };
  const removeLine = (idx) => onChange({ ...data, lines: lines.filter((_, i) => i !== idx) });
  const duplicateLine = (idx) => {
    const copy = { ...lines[idx] };
    const next = [...lines.slice(0, idx + 1), copy, ...lines.slice(idx + 1)];
    onChange({ ...data, lines: next });
  };

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={s.panelTitle}>👥 Recursos ({lines.length})</h3>
        <button type="button" style={s.btnSm('var(--teal-mid)')} onClick={addLine}>+ Agregar recurso</button>
      </div>
      <div className="table-wrapper">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead>
            <tr>
              {['#', 'Rol / Título', 'Especialidad', 'Nivel', 'País', 'Biling.', 'Herram.', 'Stack', 'Modalidad', 'Cant', 'Meses', 'Tarifa/Mes', 'Total', ''].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td style={{ ...s.td, textAlign: 'center', fontWeight: 600, width: 26 }}>{idx + 1}</td>
                <td style={s.td}>
                  <input style={{ ...s.inputSm, minWidth: 140 }} value={line.role_title || ''} onChange={(e) => updateLine(idx, 'role_title', e.target.value)} placeholder="Ej: Senior React Dev" aria-label={`Rol recurso ${idx + 1}`} />
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, minWidth: 120 }} value={line.specialty || ''} onChange={(e) => updateLine(idx, 'specialty', e.target.value)} aria-label={`Especialidad recurso ${idx + 1}`}>
                    <option value="">—</option>
                    {SPECIALTIES.map((sp) => <option key={sp}>{sp}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <select
                    style={{ ...s.select, width: 60 }}
                    value={line.level || ''}
                    onChange={(e) => updateLine(idx, 'level', Number(e.target.value))}
                    title={line.level ? levelTooltip(line.level, params) : 'Selecciona un nivel L1-L11'}
                    aria-label={`Nivel recurso ${idx + 1}`}
                  >
                    <option value="">—</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => <option key={n} value={n} title={LEVEL_BRIEF[n]}>L{n}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, minWidth: 110 }} value={line.country || 'Colombia'} onChange={(e) => updateLine(idx, 'country', e.target.value)} aria-label={`País recurso ${idx + 1}`}>
                    {countries.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ ...s.td, textAlign: 'center' }}>
                  <input type="checkbox" checked={line.bilingual || false} onChange={(e) => updateLine(idx, 'bilingual', e.target.checked)} aria-label={`Bilingüe recurso ${idx + 1}`} />
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, minWidth: 90 }} value={line.tools || 'Sin'} onChange={(e) => updateLine(idx, 'tools', e.target.value)} aria-label={`Herramientas recurso ${idx + 1}`}>
                    {toolsOpts.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, minWidth: 110 }} value={line.stack || 'Especializada'} onChange={(e) => updateLine(idx, 'stack', e.target.value)} aria-label={`Stack recurso ${idx + 1}`}>
                    {stacks.map((st) => <option key={st}>{st}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <select style={{ ...s.select, minWidth: 100 }} value={line.modality || 'Remoto'} onChange={(e) => updateLine(idx, 'modality', e.target.value)} aria-label={`Modalidad recurso ${idx + 1}`}>
                    {modalities.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <input
                    style={{ width: 46, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', textAlign: 'center', fontSize: 12 }}
                    type="number" min={1} step={1}
                    value={line.quantity || 1}
                    onChange={(e) => updateLine(idx, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                    aria-label={`Cantidad recurso ${idx + 1}`}
                  />
                </td>
                <td style={s.td}>
                  <input
                    style={{ width: 46, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', textAlign: 'center', fontSize: 12 }}
                    type="number" min={1} step={1}
                    value={line.duration_months || 1}
                    onChange={(e) => updateLine(idx, 'duration_months', Math.max(1, Number(e.target.value) || 1))}
                    aria-label={`Meses recurso ${idx + 1}`}
                  />
                </td>
                <td style={{ ...s.td, fontWeight: 600, color: 'var(--purple-dark)', whiteSpace: 'nowrap' }}>{formatUSD(line.rate_month)}</td>
                <td style={{ ...s.td, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>{formatUSD(line.total)}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                  <button type="button" aria-label={`Duplicar recurso ${idx + 1}`} title="Duplicar fila" onClick={() => duplicateLine(idx)} style={{ border: 'none', background: 'none', color: 'var(--text-light)', cursor: 'pointer', fontSize: 14, marginRight: 4 }}>⎘</button>
                  <button type="button" aria-label={`Eliminar recurso ${idx + 1}`} onClick={() => removeLine(idx)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 15 }}>✕</button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={14} style={{ textAlign: 'center', padding: 28, color: 'var(--text-light)' }}>
                  Aún no hay recursos. Usa "+ Agregar recurso" para comenzar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========== FINANCIAL SUMMARY (sticky right) ========== */
function FinancialSummaryPanel({ data, onChange, summary, defaultMargin }) {
  const setDiscount = (pct) => onChange({ ...data, discount_pct: Number(pct) / 100 });
  const currentMargin = data.metadata?.margin_pct != null ? Number(data.metadata.margin_pct) : Number(defaultMargin);
  const setMargin = (pct) => {
    const next = Math.min(95, Math.max(0, Number(pct) || 0)) / 100;
    onChange({ ...data, metadata: { ...(data.metadata || {}), margin_pct: next } });
  };

  const marginColor = currentMargin >= 0.35 ? 'var(--success)' : currentMargin >= 0.25 ? 'var(--warning)' : 'var(--danger)';
  const marginEmoji = currentMargin >= 0.35 ? '🟢' : currentMargin >= 0.25 ? '🟡' : '🔴';

  return (
    <div className="financial-summary-sticky" style={{ ...s.card, marginBottom: 0 }}>
      <h3 style={{ ...s.panelTitle, marginBottom: 12 }}>💰 Resumen Financiero</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <SmallMetric value={summary.totalResources} label="Total recursos" color="var(--purple-dark)" />
        <SmallMetric value={summary.avgDuration ? `${summary.avgDuration.toFixed(1)}m` : '—'} label="Duración prom." color="var(--teal-mid)" />
      </div>

      <CascadeRow label="Tarifa mensual total" value={formatUSD(summary.totalMonthly)} />
      <CascadeRow label="Total del contrato" value={formatUSD(summary.totalContract)} highlight />
      <CascadeRow label="Blend rate mensual" value={summary.blendMonthly ? `${formatUSD(summary.blendMonthly)}/rec` : '—'} />

      <OverrideRow
        label="Margen de contribución"
        suffix="%"
        inputValue={Math.round(currentMargin * 100)}
        onChange={(v) => setMargin(v)}
        ariaLabel="Margen de contribución porcentaje"
        testId="margen-input-capacity"
      />
      <OverrideRow
        label="Descuento"
        suffix="%"
        inputValue={Math.round((data.discount_pct || 0) * 100)}
        onChange={(v) => setDiscount(v)}
        ariaLabel="Descuento porcentaje"
      />

      <CascadeRow label="TOTAL CON DESCUENTO" value={formatUSD(summary.finalPrice)} final />

      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 6, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-light)' }}>Margen aplicado</span>
          <span style={{ fontWeight: 700, color: marginColor }} data-testid="semaforo-margen-capacity">
            {marginEmoji} {formatPct(currentMargin)}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-light)', fontStyle: 'italic' }}>
          Mínimo sugerido: {formatPct(defaultMargin)} (parámetro talento). Bajarlo reduce la tarifa y recalcula las líneas.
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

function CascadeRow({ label, value, highlight, final }) {
  const bg = final
    ? 'linear-gradient(90deg, var(--teal-mid), var(--teal))'
    : highlight ? '#faf5ff' : 'transparent';
  const color = final ? '#fff' : highlight ? 'var(--purple-dark)' : 'var(--text)';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: final ? '12px 14px' : '8px 10px',
      background: bg,
      color,
      fontWeight: (final || highlight) ? 700 : 500,
      fontSize: final ? 18 : highlight ? 13 : 12,
      borderRadius: final ? 8 : 0,
      borderBottom: final ? 'none' : '1px dashed var(--border)',
      margin: final ? '10px 0 0' : 0,
    }}>
      <span>{label}</span>
      <span data-testid={final ? 'precio-final-capacity' : undefined}>{value}</span>
    </div>
  );
}

function OverrideRow({ label, inputValue, onChange, ariaLabel, suffix, testId }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', fontSize: 12, borderBottom: '1px dashed var(--border)', color: 'var(--text)' }}>
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number" min={0} max={95} step={1}
          style={{ width: 54, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}
          value={inputValue}
          aria-label={ariaLabel}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        />
        <span style={{ color: 'var(--text-light)', fontSize: 11 }}>{suffix || ''}</span>
      </div>
    </div>
  );
}

/* ========== MOBILE FOOTER ========== */
function MobileFooter({ summary }) {
  return (
    <div className="project-editor-mobile-footer">
      <div><small>Recursos</small><strong>{summary.totalResources}</strong></div>
      <div><small>Total contrato</small><strong style={{ color: 'var(--teal-mid)' }}>{formatUSD(summary.finalPrice)}</strong></div>
      <div><small>Blend/rec</small><strong>{summary.blendMonthly ? formatUSD(summary.blendMonthly) : '—'}</strong></div>
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

  // Visual disabled state — claramente apagado para que el usuario no
  // dude. Background gris muy claro, texto gris, borde gris, opacidad
  // baja, cursor not-allowed, candado 🔒 al inicio. Sin esto algunos
  // monitores no muestran suficiente contraste.
  // OJO: NO usamos el atributo HTML `disabled` cuando el motivo es de
  // negocio (canExport=false), porque el browser bloquea los eventos de
  // mouse en `<button disabled>` y el tooltip nativo `title=` no se
  // dispara. En su lugar usamos `aria-disabled` + styling + click-guard.
  // Para `busy` (export en curso) sí mantenemos el `disabled` real porque
  // ahí queremos bloquear todo input.
  const disabledStyle = disabled ? {
    background: '#f0f0f0',
    color: '#999',
    borderColor: '#d0d0d0',
    opacity: 0.7,
    cursor: 'not-allowed',
  } : {};
  const label = busy
    ? `Generando ${busy}…`
    : disabled ? '🔒 Exportar ▾' : 'Exportar ▾';
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        style={{ ...s.btnOutline, display: 'inline-flex', alignItems: 'center', gap: 6, ...disabledStyle }}
        onClick={() => { if (disabled || busy) return; setOpen((o) => !o); }}
        disabled={!!busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled || !!busy}
        title={disabled ? disabledReason : undefined}
      >
        {label}
      </button>
      {open && !disabled && (
        <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 200 }}>
          <button role="menuitem" type="button" onClick={() => run('xlsx')} style={menuItemStyle}>📊 Exportar a Excel (.xlsx)</button>
          <button role="menuitem" type="button" onClick={() => run('pdf')} style={menuItemStyle}>📄 Exportar a PDF</button>
        </div>
      )}
    </div>
  );
}
const menuItemStyle = { width: '100%', textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' };

/* ========== calcCapacitySummary ========== *
 * Derives totals for the sticky financial panel. All per-line totals are
 * already stored on the line (calcStaffAugLine, which honors the editor's
 * margin override), so here we only aggregate. avgMargin is simply the
 * effective margin applied (editable in the summary panel).
 */
function calcCapacitySummary(lines, discountPct, params, marginOverride) {
  const rows = lines || [];
  const totalResources = rows.reduce((sum, l) => sum + Number(l.quantity || 1), 0);
  const totalMonthly = rows.reduce((sum, l) => sum + Number(l.rate_month || 0) * Number(l.quantity || 1), 0);
  const totalContract = rows.reduce((sum, l) => sum + Number(l.total || 0), 0);
  const weightedMonths = rows.reduce((sum, l) => sum + Number(l.duration_months || 0) * Number(l.quantity || 1), 0);
  const avgDuration = totalResources > 0 ? weightedMonths / totalResources : 0;
  const blendMonthly = totalResources > 0 ? totalMonthly / totalResources : 0;
  const discount = Number(discountPct || 0);
  const finalPrice = totalContract * (1 - discount);
  const defaultMargin = params ? (Number(params.margin?.find((p) => p.key === 'talent')?.value) || 0.35) : 0.35;
  const avgMargin = marginOverride != null ? Number(marginOverride) : defaultMargin;

  return { totalResources, totalMonthly, totalContract, avgDuration, blendMonthly, discount, finalPrice, avgMargin };
}

/* ========== MAIN ========== */
export default function StaffAugEditorUnified({ params, context, onSwitchToClassic }) {
  const nav = useNavigate();
  const { id: quotId } = useParams();
  const isNew = !quotId;

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [data, setData] = useState({
    type: 'staff_aug',
    client_id: context?.client_id || null,
    opportunity_id: context?.opportunity_id || null,
    project_name: '', client_name: context?.client_name || '',
    commercial_name: '', preventa_name: '',
    discount_pct: 0, notes: '', status: 'draft',
    lines: [],
    metadata: {},
  });

  const defaultMargin = useMemo(
    () => (params ? Number(params.margin?.find((p) => p.key === 'talent')?.value) || 0.35 : 0.35),
    [params]
  );
  const marginOverride = data.metadata?.margin_pct != null ? Number(data.metadata.margin_pct) : defaultMargin;

  // CRÍTICO: setDirty(false) al final — sin esto, después de un POST
  // (crear cotización nueva) el `dirty` queda true porque viene de las
  // ediciones previas, y el botón Exportar permanece deshabilitado hasta
  // un segundo Guardar. Reportado por preventa abr 22.
  useEffect(() => {
    if (!quotId) return;
    api.getQuotation(quotId).then((q) => {
      const mOverride = q.metadata?.margin_pct != null ? Number(q.metadata.margin_pct) : defaultMargin;
      const lines = (q.lines || []).map((l) => (params ? calcStaffAugLine(l, params, mOverride) : l));
      setData({ ...q, lines });
      if (q.project_name) setInfoCollapsed(true);
      setDirty(false);
    }).catch(() => nav('/'));
  }, [quotId, nav, params, defaultMargin]);

  const handleChange = useCallback((next) => {
    setDirty(true);
    // If margin changed, recalc all lines with the new override so the
    // cascade (rate/mes, total, blend, final price) updates in real time.
    const prevMargin = data.metadata?.margin_pct;
    const nextMargin = next.metadata?.margin_pct;
    if (params && prevMargin !== nextMargin) {
      const effective = nextMargin != null ? Number(nextMargin) : defaultMargin;
      const recalculated = (next.lines || []).map((l) => calcStaffAugLine(l, params, effective));
      setData({ ...next, lines: recalculated });
    } else {
      setData(next);
    }
  }, [params, defaultMargin, data.metadata]);

  const summary = useMemo(
    () => calcCapacitySummary(data.lines || [], data.discount_pct || 0, params, marginOverride),
    [data.lines, data.discount_pct, params, marginOverride]
  );

  const hasProfitableLines = (data.lines || []).some((l) => Number(l.rate_month || 0) > 0);
  const canSave = !!((data.project_name || '').trim() && (data.client_name || '').trim());
  const canExport = !isNew && hasProfitableLines && !dirty;
  const exportDisabledReason = isNew
    ? 'Guarda primero para poder exportar'
    : dirty
      ? 'Guarda los cambios para exportar la versión más reciente'
      : !hasProfitableLines
        ? 'Agrega al menos un recurso con tarifa > 0 para exportar'
        : '';

  const save = async (status) => {
    if (!canSave) {
      // eslint-disable-next-line no-alert
      alert('Completa al menos el nombre del proyecto y el cliente antes de guardar.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...data, status: status || data.status };
      if (quotId) {
        const resp = await api.updateQuotation(quotId, payload);
        setData((d) => ({ ...d, ...resp }));
        setDirty(false);
      } else {
        const resp = await api.createQuotation(payload);
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
      const res = await api.exportQuotation(quotId, format);
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
      <div className="editor-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={() => nav('/')} style={{ ...s.btnOutline, padding: '6px 12px', fontSize: 11 }}>← Dashboard</button>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
            {isNew ? 'Nueva Cotización' : 'Editar Cotización'} — Staff Augmentation
          </span>
          {dirty && <span style={{ fontSize: 11, color: 'var(--warning)', fontStyle: 'italic' }}>· cambios sin guardar</span>}
        </div>
        <div className="editor-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <ExportDropdown onExport={doExport} disabled={!canExport} disabledReason={exportDisabledReason} />
          <button type="button" style={canSave ? s.btnOutline : { ...s.btnOutline, opacity: 0.5, cursor: 'not-allowed' }} onClick={() => save('draft')} disabled={saving || !canSave}>
            {saving ? 'Guardando…' : '💾 Guardar borrador'}
          </button>
          {onSwitchToClassic && (
            <button type="button" style={{ ...s.btnOutlineSm, marginLeft: 4 }} onClick={onSwitchToClassic} title="Cambiar a la vista clásica">
              Vista clásica
            </button>
          )}
        </div>
      </div>

      <ProjectInfoPanel data={data} onChange={handleChange} collapsed={infoCollapsed} onToggleCollapse={() => setInfoCollapsed((c) => !c)} />

      <div className="project-editor-grid">
        <div className="project-editor-main">
          <ResourceTable data={data} onChange={handleChange} params={params} marginOverride={marginOverride} />
        </div>
        <div className="project-editor-side">
          <FinancialSummaryPanel data={data} onChange={handleChange} summary={summary} defaultMargin={defaultMargin} />
        </div>
      </div>

      <MobileFooter summary={summary} />
    </div>
  );
}

// exposed for tests
export { calcCapacitySummary };
