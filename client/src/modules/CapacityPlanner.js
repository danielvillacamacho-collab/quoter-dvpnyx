import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPut } from '../utils/apiV2';
import CandidatesModal from './CandidatesModal';

/**
 * Capacity Planner — US-PLN-1 (timeline) + US-PLN-2 (metric cards).
 *
 * Weekly Runn/Clockify-style view:
 *   • Left column (sticky, 220px): employee identity + level + area
 *   • Right side: N week columns with colored bars per assignment and
 *     a utilization chip per week.
 *   • Header: 4 metric cards (active people, avg utilization,
 *     overbooked count, open requests). Filters + "← Hoy →" navigation.
 *
 * All data comes from GET /api/capacity/planner in a single call. This
 * component only renders what the endpoint returns; the math lives
 * server-side in server/utils/capacity_planner.js so the AI layer can
 * consume the same contract later.
 */

const WEEK_COL_WIDTH = 110;
const LEFT_COL_WIDTH = 220;

/**
 * Utilization buckets. Visual language ported to the design-handoff
 * OKLCH tokens (--ds-*) so the Planner inherits the same accent /
 * semantic palette as the rest of the app shell. The legacy `--bg-soft`
 * fallback is kept so existing snapshots / downstream consumers that
 * predate the tokens don't silently break.
 */
// Paleta de colores por área — usada en la vista Proyectos para distinguir
// de un vistazo qué especialidad aporta cada persona a cada contrato.
const AREA_PALETTE = [
  '#2563EB', // azul    — Desarrollo
  '#7C3AED', // violeta — Diseño / UX
  '#059669', // verde   — QA / Testing
  '#D97706', // ámbar   — Data / Analytics
  '#DC2626', // rojo    — DevOps / Infra
  '#0891B2', // cian    — Producto
  '#9333EA', // púrpura — Mobile
  '#65A30D', // lima    — Backend
  '#EA580C', // naranja — Frontend
  '#4F46E5', // índigo  — FullStack
];
function areaColorFor(areaId) {
  if (!areaId) return '#6B7280'; // gris neutro para "sin área"
  // IDs de área son enteros pequeños; offset de 3 para no coincidir
  // con los colores de contrato en casos donde ambos aparecen juntos.
  const idx = ((Number(areaId) - 1 + 3) % AREA_PALETTE.length + AREA_PALETTE.length) % AREA_PALETTE.length;
  return AREA_PALETTE[idx];
}

const BUCKET_STYLES = {
  idle:       { bg: 'var(--ds-bg-soft, #f4f5f7)',  color: 'var(--ds-text-dim, #6b7280)' },
  light:      { bg: 'var(--ds-warn-soft, #fff4dd)', color: 'oklch(0.45 0.12 80)' },
  healthy:    { bg: 'var(--ds-ok-soft, #dff5e6)',   color: 'oklch(0.4 0.12 155)' },
  overbooked: { bg: 'var(--ds-bad-soft, #fbdcdc)',  color: 'oklch(0.45 0.18 25)' },
};

const s = {
  page: { padding: '20px 24px 40px', fontFamily: 'var(--font-ui, inherit)' },
  h1: { margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--ds-text, #1b1b1b)', letterSpacing: '-0.015em', fontFamily: 'var(--font-ui, inherit)' },
  sub: { margin: '4px 0 16px', fontSize: 13, color: 'var(--ds-text-dim, var(--text-light))' },

  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 },
  card: (accent) => ({
    background: 'var(--ds-surface, #fff)',
    borderLeft: `3px solid ${accent}`,
    border: '1px solid var(--ds-border, #eee)',
    borderLeftWidth: 3,
    borderRadius: 'var(--ds-radius-lg, 10px)',
    padding: '14px 16px',
    boxShadow: 'var(--ds-shadow-sm, 0 1px 3px rgba(0,0,0,.05))',
  }),
  cardLabel: { fontSize: 10.5, color: 'var(--ds-text-dim, var(--text-light))', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4, fontWeight: 500 },
  cardValue: { fontSize: 26, fontWeight: 500, color: 'var(--ds-text, #1b1b1b)', fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)', fontFeatureSettings: "'tnum'", letterSpacing: '-0.02em', lineHeight: 1.1 },
  cardHint: { fontSize: 11, color: 'var(--ds-text-dim, var(--text-light))', marginTop: 2 },

  toolbar: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' },
  select: { padding: '5px 10px', border: '1px solid var(--ds-border, #ddd)', borderRadius: 'var(--ds-radius, 6px)', fontSize: 12.5, background: 'var(--ds-surface, #fff)', color: 'var(--ds-text)', fontFamily: 'var(--font-ui, inherit)' },
  input: { padding: '5px 10px', border: '1px solid var(--ds-border, #ddd)', borderRadius: 'var(--ds-radius, 6px)', fontSize: 12.5, minWidth: 180, background: 'var(--ds-surface, #fff)', color: 'var(--ds-text)', fontFamily: 'var(--font-ui, inherit)' },
  btn: { padding: '5px 11px', border: '1px solid var(--ds-border, #ddd)', borderRadius: 'var(--ds-radius, 6px)', background: 'var(--ds-surface, #fff)', cursor: 'pointer', fontSize: 12.5, color: 'var(--ds-text)', fontWeight: 500 },

  frame: { border: '1px solid var(--ds-border, #e5e5e5)', borderRadius: 'var(--ds-radius-lg, 10px)', background: 'var(--ds-surface, #fff)', overflow: 'hidden' },
  scroller: { overflowX: 'auto', position: 'relative' },
  grid: { display: 'grid', gridAutoRows: 'min-content', minWidth: '100%' },

  headRow: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, minmax(${WEEK_COL_WIDTH}px, 1fr))`,
    position: 'sticky', top: 0, zIndex: 3,
    background: 'var(--ds-bg-soft, #f4f5f7)',
    color: 'var(--ds-text-dim, #6b7280)',
    borderBottom: '1px solid var(--ds-border, #e5e5e5)',
  }),
  headCell: { padding: '8px 8px', fontSize: 11, borderLeft: '1px solid var(--ds-border, #eee)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.04, fontWeight: 500 },
  headCellWeek: { fontWeight: 600, fontSize: 11.5, fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)', fontFeatureSettings: "'tnum'", color: 'var(--ds-text, #1b1b1b)', textTransform: 'none' },
  headCellDate: { fontSize: 10, opacity: 0.8, textTransform: 'none', letterSpacing: 0 },

  row: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, minmax(${WEEK_COL_WIDTH}px, 1fr))`,
    borderTop: '1px solid var(--ds-border, #eee)',
    minHeight: 72,
  }),
  empCell: { padding: '10px 12px', borderRight: '1px solid var(--ds-border, #eee)', background: 'var(--ds-bg-soft, #fafafa)', position: 'sticky', left: 0, zIndex: 2 },
  empName: { fontSize: 14.5, fontWeight: 600, color: 'var(--ds-text, #1b1b1b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  empMeta: { fontSize: 11, color: 'var(--ds-text-dim, var(--text-light))', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  empCap: { fontSize: 10.5, color: 'var(--ds-text-dim, var(--text-light))', marginTop: 4, fontFamily: 'var(--font-mono, inherit)' },

  weekCell: (bg) => ({
    borderLeft: '1px solid var(--ds-border, #f0f0f0)',
    padding: 6, position: 'relative',
    display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'flex-start',
    background: bg,
  }),
  bar: (color) => ({
    background: color, color: '#fff',
    borderRadius: 4, padding: '4px 6px',
    fontWeight: 600,
    display: 'flex', flexDirection: 'column', gap: 1,
    overflow: 'hidden',
    boxShadow: 'var(--ds-shadow-sm, 0 1px 2px rgba(0,0,0,.1))',
  }),
  barName: {
    fontSize: 11.5,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    whiteSpace: 'normal',
    lineHeight: 1.25,
    wordBreak: 'break-word',
  },
  barMeta: {
    fontSize: 9.5, fontWeight: 500, opacity: 0.85,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    lineHeight: 1.3,
    fontFamily: 'var(--font-ui, inherit)',
    fontVariantNumeric: 'tabular-nums',
  },
  chip: (bucket) => ({
    marginTop: 'auto',
    alignSelf: 'flex-start',
    fontSize: 10, fontWeight: 700,
    padding: '1px 7px', borderRadius: 10,
    background: BUCKET_STYLES[bucket]?.bg || BUCKET_STYLES.idle.bg,
    color:      BUCKET_STYLES[bucket]?.color || BUCKET_STYLES.idle.color,
    fontFamily: 'var(--font-mono, inherit)',
    fontFeatureSettings: "'tnum'",
  }),

  unassignedRow: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, minmax(${WEEK_COL_WIDTH}px, 1fr))`,
    borderTop: '2px dashed var(--ds-border, #ddd)',
    background: 'var(--ds-warn-soft, #fffbea)',
    minHeight: 56,
  }),
  unassignedCell: { padding: '8px 12px', borderRight: '1px solid var(--ds-border, #eee)', position: 'sticky', left: 0, background: 'var(--ds-warn-soft, #fff8e6)', zIndex: 2 },
  unassignedTitle: { fontSize: 13, fontWeight: 600, color: 'oklch(0.45 0.12 80)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  unassignedMeta: { fontSize: 10, color: 'oklch(0.5 0.1 80)', marginTop: 2 },
  unassignedBar: (color) => ({
    background: 'transparent',
    border: `1.5px dashed ${color}`,
    color,
    borderRadius: 4, padding: '3px 6px',
    fontSize: 10, fontWeight: 700,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  }),

  // Empleados inactivos (terminated) — separador + fila atenuada
  inactiveSeparator: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, minmax(${WEEK_COL_WIDTH}px, 1fr))`,
    borderTop: '2px solid var(--ds-border, #ddd)',
    background: 'var(--ds-bg-soft, #f4f5f7)',
    minHeight: 32,
  }),
  inactiveSeparatorCell: {
    padding: '6px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--ds-text-dim, #888)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    position: 'sticky',
    left: 0,
    background: 'var(--ds-bg-soft, #f4f5f7)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },

  empty: { padding: 40, textAlign: 'center', color: 'var(--ds-text-dim, var(--text-light))', fontSize: 14 },
  error: { padding: 16, background: 'var(--ds-bad-soft, #fff0f0)', color: 'oklch(0.45 0.18 25)', borderRadius: 'var(--ds-radius, 8px)', fontSize: 13 },
  loading: { padding: 40, textAlign: 'center', color: 'var(--ds-text-dim, var(--text-light))' },

  // US-PLN-6 alerts strip
  alertsBox: { marginBottom: 14, border: '1px solid var(--ds-border, #e5e5e5)', borderRadius: 'var(--ds-radius-lg, 10px)', background: 'var(--ds-surface, #fff)', overflow: 'hidden' },
  alertsHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--ds-accent-soft, #faf7ff)', borderBottom: '1px solid var(--ds-border, #eee)', fontSize: 12, color: 'var(--ds-accent-text, var(--purple-dark))', fontWeight: 600, letterSpacing: '0.02em' },
  alertsList: { maxHeight: 200, overflowY: 'auto' },
  alertItem: (sev) => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 14px', borderTop: '1px solid var(--ds-border, #f1f1f1)',
    cursor: 'pointer', fontSize: 12,
    background: sev === 'red' ? 'var(--ds-bad-soft, #fff5f5)' : 'var(--ds-warn-soft, #fffaf0)',
    color: sev === 'red' ? 'oklch(0.45 0.18 25)' : 'oklch(0.45 0.12 80)',
  }),
  alertDot: (sev) => ({
    width: 8, height: 8, borderRadius: '50%',
    background: sev === 'red' ? 'var(--ds-bad, #d9534f)' : 'var(--ds-warn, #e3a008)',
    flexShrink: 0,
  }),
  alertType: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.8, minWidth: 90 },
  alertMsg: { flex: 1 },
  rowFlash: { animation: 'dvpnyxAlertFlash 1.6s ease-out' },

  // US-PLN-4 projects view
  toggle: { display: 'inline-flex', border: '1px solid var(--ds-border, #ddd)', borderRadius: 'var(--ds-radius, 6px)', overflow: 'hidden', background: 'var(--ds-surface, #fff)' },
  toggleBtn: (active) => ({
    padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
    border: 'none',
    background: active ? 'var(--ds-accent-soft, #faf7ff)' : 'var(--ds-surface, #fff)',
    color:      active ? 'var(--ds-accent-text, var(--purple-dark))' : 'var(--ds-text-muted, #555)',
    fontWeight: active ? 600 : 500,
  }),
  contractRow: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, minmax(${WEEK_COL_WIDTH}px, 1fr))`,
    borderTop: '2px solid var(--ds-accent-border, var(--purple-dark, #3b1d52))',
    minHeight: 60,
    background: 'var(--ds-accent-soft, #faf7ff)',
    cursor: 'pointer',
    userSelect: 'none',
  }),
  contractCell: { padding: '10px 12px', borderRight: '1px solid var(--ds-border, #eee)', background: 'var(--ds-accent-soft, #faf7ff)', position: 'sticky', left: 0, zIndex: 2 },
  contractName: { fontSize: 14.5, fontWeight: 600, color: 'var(--ds-accent-text, var(--purple-dark))', fontFamily: 'var(--font-ui, inherit)', letterSpacing: '-0.005em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  contractClient: { fontSize: 11, color: 'var(--ds-text-dim, var(--text-light))', marginTop: 2 },
  contractChevron: { fontSize: 10, color: 'var(--ds-accent-text, var(--purple-dark))', flexShrink: 0, lineHeight: 1 },
  emptyRequests: { padding: '8px 12px 8px 28px', fontSize: 12, color: 'var(--ds-text-dim, #888)', fontStyle: 'italic' },
  requestSubRow: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, minmax(${WEEK_COL_WIDTH}px, 1fr))`,
    borderTop: '1px solid var(--ds-border, #eee)',
    minHeight: 52,
  }),
  requestSubCell: { padding: '8px 12px 8px 28px', borderRight: '1px solid var(--ds-border, #eee)', background: 'var(--ds-surface, #fff)', position: 'sticky', left: 0, zIndex: 2 },
  requestTitle: { fontSize: 13, fontWeight: 600, color: 'var(--ds-text, #1b1b1b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  requestMeta: { fontSize: 10, color: 'var(--ds-text-dim, var(--text-light))', marginTop: 2 },
};

const ALERT_TYPE_LABELS = {
  overbooked: 'Sobrecarga',
  level_mismatch: 'Nivel',
  open_request: 'Sin cubrir',
};

/* ── Helpers ─────────────────────────────────────────────────────── */

function todayMondayIso() {
  const d = new Date();
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = utc.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  utc.setUTCDate(utc.getUTCDate() + diff);
  return utc.toISOString().slice(0, 10);
}

function shiftIso(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build querystring from filter state, skipping empty values. */
function buildQuery({ start, weeks, contract_id, area_id, level_min, level_max, search }) {
  const p = new URLSearchParams();
  p.set('start', start);
  p.set('weeks', String(weeks));
  if (contract_id) p.set('contract_id', contract_id);
  if (area_id)     p.set('area_id', area_id);
  if (level_min)   p.set('level_min', level_min);
  if (level_max)   p.set('level_max', level_max);
  if (search)      p.set('search', search);
  return p.toString();
}

/* ── Components ──────────────────────────────────────────────────── */

function MetricCard({ label, value, hint, accent }) {
  return (
    <div style={s.card(accent)} role="figure" aria-label={label}>
      <div style={s.cardLabel}>{label}</div>
      <div style={s.cardValue}>{value}</div>
      {hint && <div style={s.cardHint}>{hint}</div>}
    </div>
  );
}

/* ── SPEC-006 / Spec 2.2: modal inline para editar asignación ────── */
const ASSIGNMENT_STATUSES = [
  { value: 'planned',   label: 'Planeada' },
  { value: 'active',    label: 'Activa' },
  { value: 'ended',     label: 'Finalizada' },
  { value: 'cancelled', label: 'Cancelada' },
];

const VALID_RATE_CURRENCIES = ['USD', 'COP', 'EUR', 'MXN', 'GBP'];

function AssignmentEditModal({ assignmentId, onClose, onSaved }) {
  const navigate = useNavigate();
  const [asg, setAsg]         = useState(null);
  const [form, setForm]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  // Rate history
  const [rateHistory, setRateHistory] = useState([]);
  const [showAddRate, setShowAddRate] = useState(false);
  const [newRate, setNewRate] = useState({ effective_date: '', client_rate: '', reason: '' });
  const [savingRate, setSavingRate] = useState(false);

  const loadRateHistory = useCallback(() => {
    apiGet(`/api/assignments/${assignmentId}/rate-history`)
      .then(setRateHistory)
      .catch(() => {});
  }, [assignmentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr('');
    apiGet(`/api/assignments/${assignmentId}`)
      .then((data) => {
        if (cancelled) return;
        setAsg(data);
        setForm({
          weekly_hours:         data.weekly_hours ?? '',
          start_date:           data.start_date   ? data.start_date.slice(0, 10)  : '',
          end_date:             data.end_date     ? data.end_date.slice(0, 10)    : '',
          role_title:           data.role_title   || '',
          notes:                data.notes        || '',
          status:               data.status       || 'planned',
          client_rate:          data.client_rate  != null ? String(data.client_rate) : '',
          client_rate_currency: data.client_rate_currency || data.contract_currency || 'USD',
        });
      })
      .catch((e) => { if (!cancelled) setErr(e.message || 'Error cargando asignación'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assignmentId]);

  useEffect(() => { loadRateHistory(); }, [loadRateHistory]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr('');
    const isCapacity = asg && asg.contract_type === 'capacity';
    try {
      await apiPut(`/api/assignments/${assignmentId}`, {
        weekly_hours: Number(form.weekly_hours),
        start_date:   form.start_date || undefined,
        end_date:     form.end_date   || undefined,
        role_title:   form.role_title || undefined,
        notes:        form.notes      || undefined,
        status:       form.status,
        ...(isCapacity && {
          client_rate:          form.client_rate !== '' ? Number(form.client_rate) : null,
          client_rate_currency: form.client_rate_currency || 'USD',
        }),
      });
      onSaved();
      onClose();
    } catch (ex) {
      setErr(ex.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const ms = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 },
    box:     { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 10px)', border: '1px solid var(--ds-border)', padding: 24, width: 420, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
    title:   { fontSize: 15, fontWeight: 700, marginBottom: 16, color: 'var(--ds-text)' },
    label:   { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 4, display: 'block' },
    input:   { width: '100%', padding: '7px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', fontSize: 13, background: 'var(--ds-surface)', color: 'var(--ds-text)', boxSizing: 'border-box' },
    row:     { marginBottom: 12 },
    foot:    { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 },
    btnPrimary: { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost:   { background: 'transparent', color: 'var(--ds-text)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 14px', fontSize: 13, cursor: 'pointer' },
  };

  return (
    <div style={ms.overlay} role="dialog" aria-modal="true" aria-label="Editar asignación" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={ms.box}>
        <div style={ms.title}>
          Editar asignación
          {asg && (
            <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginLeft: 8 }}>
              {asg.contract_name} · {asg.employee_first_name} {asg.employee_last_name}
              {asg.contract_type === 'capacity' && (
                <button
                  type="button"
                  onClick={() => navigate(`/revenue?contract_id=${asg.contract_id}`)}
                  style={{ marginLeft: 10, fontSize: 12, color: 'var(--ds-accent, var(--purple-dark))', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >
                  Ver proyección
                </button>
              )}
            </span>
          )}
        </div>
        {loading && <div style={{ fontSize: 13 }}>Cargando…</div>}
        {err && <div style={{ color: 'var(--ds-bad, #ef4444)', fontSize: 13, marginBottom: 8 }}>{err}</div>}
        {form && (
          <form onSubmit={save}>
            <div style={ms.row}>
              <label style={ms.label}>Horas / semana</label>
              <input style={ms.input} type="number" min="1" max="80" step="0.5" value={form.weekly_hours} onChange={(e) => set('weekly_hours', e.target.value)} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={ms.label}>Inicio</label>
                <input style={ms.input} type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
              </div>
              <div>
                <label style={ms.label}>Fin</label>
                <input style={ms.input} type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
              </div>
            </div>
            <div style={ms.row}>
              <label style={ms.label}>Rol</label>
              <input style={ms.input} type="text" value={form.role_title} onChange={(e) => set('role_title', e.target.value)} />
            </div>
            <div style={ms.row}>
              <label style={ms.label}>Estado</label>
              <select style={ms.input} value={form.status} onChange={(e) => set('status', e.target.value)}>
                {ASSIGNMENT_STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
              </select>
            </div>
            <div style={ms.row}>
              <label style={ms.label}>Notas</label>
              <textarea style={{ ...ms.input, minHeight: 56, resize: 'vertical' }} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
            {asg && asg.contract_type === 'capacity' && (
              <div style={{ background: 'var(--ds-accent-soft, #faf7ff)', border: '1px solid var(--ds-accent-border, #e0d4f5)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ds-accent-text, var(--purple-dark))', marginBottom: 8 }}>
                  Historial de tarifas
                </div>
                {rateHistory.length > 0 ? (
                  <div style={{ fontSize: 11, marginBottom: 8 }}>
                    {rateHistory.map((r) => (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--ds-border, #eee)' }}>
                        <div>
                          <strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: r.client_rate_currency || 'USD', maximumFractionDigits: 0 }).format(r.client_rate)}</strong>
                          <span style={{ color: 'var(--ds-text-soft, var(--text-light))', marginLeft: 6 }}>
                            desde {r.effective_date?.slice(0, 10)}
                          </span>
                          {r.reason && <span style={{ color: 'var(--ds-text-soft)', marginLeft: 6, fontStyle: 'italic' }}>({r.reason})</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 8 }}>
                    Sin historial de tarifas.
                  </div>
                )}
                {/* Tarifa actual (editable, se refleja en assignments.client_rate) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 6 }}>
                  <div>
                    <label style={ms.label}>Moneda</label>
                    <select style={ms.input} value={form.client_rate_currency} onChange={(e) => set('client_rate_currency', e.target.value)}>
                      {VALID_RATE_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={ms.label}>Tarifa actual</label>
                    <input style={ms.input} type="number" min="0" step="0.01" value={form.client_rate} onChange={(e) => set('client_rate', e.target.value)} placeholder="Tarifa mensual" />
                  </div>
                </div>
                {/* Agregar nueva tarifa futura */}
                {!showAddRate ? (
                  <button type="button" onClick={() => { setShowAddRate(true); setNewRate({ effective_date: '', client_rate: '', reason: '' }); }}
                    style={{ fontSize: 11, color: 'var(--ds-accent, var(--purple-dark))', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontWeight: 600 }}>
                    + Agregar cambio de tarifa
                  </button>
                ) : (
                  <div style={{ background: '#fff', borderRadius: 6, padding: 10, marginTop: 6, border: '1px solid var(--ds-border, #ddd)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Nueva tarifa</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
                      <div>
                        <label style={ms.label}>Desde</label>
                        <input style={ms.input} type="date" value={newRate.effective_date} onChange={(e) => setNewRate((r) => ({ ...r, effective_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={ms.label}>Tarifa</label>
                        <input style={ms.input} type="number" min="0" step="0.01" value={newRate.client_rate} onChange={(e) => setNewRate((r) => ({ ...r, client_rate: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <label style={ms.label}>Motivo</label>
                      <input style={ms.input} type="text" value={newRate.reason} onChange={(e) => setNewRate((r) => ({ ...r, reason: e.target.value }))} placeholder="Ej: Ascenso a L7, Incremento anual" />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" disabled={savingRate || !newRate.effective_date || !newRate.client_rate}
                        onClick={async () => {
                          setSavingRate(true);
                          try {
                            await apiPost(`/api/assignments/${assignmentId}/rate-history`, {
                              effective_date: newRate.effective_date,
                              client_rate: Number(newRate.client_rate),
                              client_rate_currency: form.client_rate_currency || 'USD',
                              reason: newRate.reason || null,
                            });
                            loadRateHistory();
                            set('client_rate', newRate.client_rate);
                            setShowAddRate(false);
                          } catch (ex) { setErr(ex.message); }
                          finally { setSavingRate(false); }
                        }}
                        style={{ ...ms.btnPrimary, fontSize: 11, padding: '5px 12px' }}>
                        {savingRate ? 'Guardando...' : 'Agregar'}
                      </button>
                      <button type="button" onClick={() => setShowAddRate(false)} style={{ ...ms.btnGhost, fontSize: 11, padding: '5px 12px' }}>Cancelar</button>
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--ds-text-soft, var(--text-light))', marginTop: 6 }}>
                  La proyección de ingresos usa el historial de tarifas para calcular el monto correcto por mes.
                </div>
              </div>
            )}
            <div style={ms.foot}>
              <button type="button" style={ms.btnGhost} onClick={onClose}>Cancelar</button>
              <button type="submit" style={ms.btnPrimary} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function AssignmentBar({ a, onOpen, capacity }) {
  const cap = Number(capacity) || 0;
  const pctVal = cap > 0 ? Math.round((Number(a.weekly_hours) / cap) * 100) : null;
  const pctStr = pctVal !== null ? `${pctVal}%` : '—';
  return (
    <div
      style={{ ...s.bar(a.color), cursor: onOpen ? 'pointer' : 'default' }}
      title={`${a.contract_name} · ${a.weekly_hours}h/sem`}
      onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(a.id); } : undefined}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(a.id); } } : undefined}
    >
      <span style={s.barName}>{a.contract_name}</span>
      <span style={s.barMeta}>{a.weekly_hours}h · {pctStr}</span>
    </div>
  );
}

function UnassignedBar({ r }) {
  return (
    <div style={s.unassignedBar(r.color)} title={`Sin asignar · ${r.role_title} · ${r.weekly_hours}h/sem · faltan ${r.missing}`}>
      Sin asignar · {r.role_title} · {r.weekly_hours}h
    </div>
  );
}

function EmployeeRow({ emp, weeks, onOpen, inactive }) {
  // Index assignments by week for O(1) lookup when rendering.
  const byWeek = useMemo(() => {
    const map = new Map();
    for (const a of emp.assignments) {
      if (!a.week_range) continue;
      for (let i = a.week_range[0]; i <= a.week_range[1]; i += 1) {
        if (!map.has(i)) map.set(i, []);
        map.get(i).push(a);
      }
    }
    return map;
  }, [emp.assignments]);

  const rowStyle = inactive
    ? { ...s.row(weeks.length), opacity: 0.6, background: 'var(--ds-bg-soft, #f9f9f9)' }
    : s.row(weeks.length);

  const empCellStyle = inactive
    ? { ...s.empCell, background: 'var(--ds-bg-soft, #f4f4f4)' }
    : s.empCell;

  return (
    <div style={rowStyle} data-testid={`emp-row-${emp.id}`}>
      <div style={empCellStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div style={s.empName} title={emp.full_name}>{emp.full_name}</div>
          {inactive && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
              background: 'var(--ds-text-dim, #888)', color: '#fff',
              textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0,
            }}>
              Inactivo
            </span>
          )}
        </div>
        <div style={s.empMeta}>{emp.level} · {emp.area_name || '—'}</div>
        <div style={s.empCap}>{emp.weekly_capacity_hours}h/sem</div>
      </div>
      {weeks.map((w, i) => {
        const weekInfo = emp.weekly[i] || { hours: 0, utilization_pct: 0, bucket: 'idle' };
        const asgs = byWeek.get(i) || [];
        const cellBg = weekInfo.bucket === 'overbooked' ? 'rgba(251, 220, 220, 0.25)' : (inactive ? 'var(--ds-bg-soft, #f9f9f9)' : '#fff');
        return (
          <div key={w.index} style={s.weekCell(cellBg)} data-testid={`cell-${emp.id}-${i}`}>
            {asgs.map((a) => <AssignmentBar key={a.id} a={a} onOpen={onOpen} capacity={emp.weekly_capacity_hours} />)}
            <div style={s.chip(weekInfo.bucket)}>
              {weekInfo.hours > 0 ? `${weekInfo.utilization_pct}%` : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UnassignedRow({ request, weeks, onOpen }) {
  // US-PLN-5: clicking any part of the row jumps to the resource-requests
  // module filtered to this row's contract so the user can resolve it.
  const clickable = { cursor: 'pointer' };
  const open = () => onOpen && onOpen(request);
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  return (
    <div
      style={{ ...s.unassignedRow(weeks.length), ...clickable }}
      data-testid={`unassigned-row-${request.id}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
      title="Ir a Solicitudes"
    >
      <div style={s.unassignedCell}>
        <div style={s.unassignedTitle} title={request.role_title}>{request.role_title} <span style={{ opacity: 0.6 }}>(faltan {request.missing})</span></div>
        <div style={s.unassignedMeta}>{request.contract_name} · {request.level} · {request.area_name || '—'}</div>
      </div>
      {weeks.map((w, i) => {
        const inRange = request.week_range && i >= request.week_range[0] && i <= request.week_range[1];
        return (
          <div key={w.index} style={s.weekCell('transparent')}>
            {inRange && <UnassignedBar r={request} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * US-PLN-6 alerts strip.
 *
 * Renders a collapsible panel that lists every alert returned by the backend.
 * Clicking an alert scrolls the matching employee/unassigned row into view and
 * briefly flashes it, so the operator can jump from "cosa que revisar" to
 * "dónde está en el timeline" without losing context.
 */
function AlertsStrip({ alerts }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!alerts || alerts.length === 0) return null;

  const redCount = alerts.filter((a) => a.severity === 'red').length;
  const amberCount = alerts.length - redCount;

  const focusRow = (testId) => {
    if (typeof document === 'undefined') return;
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // Brief highlight so users visually confirm the jump.
    const prev = el.style.boxShadow;
    el.style.boxShadow = 'inset 0 0 0 2px #6B5B95';
    setTimeout(() => { el.style.boxShadow = prev; }, 1400);
  };

  const onAlertClick = (a) => {
    if (a.type === 'open_request' && a.request_id) {
      focusRow(`unassigned-row-${a.request_id}`);
    } else if (a.employee_id) {
      focusRow(`emp-row-${a.employee_id}`);
    }
  };

  return (
    <div style={s.alertsBox} data-testid="alerts-strip">
      <div style={s.alertsHead}>
        <span>
          Alertas
          {' · '}
          <span style={{ color: '#9a1e1e' }}>{redCount} críticas</span>
          {' · '}
          <span style={{ color: '#8a5a00' }}>{amberCount} advertencias</span>
        </span>
        <button
          type="button"
          style={{ ...s.btn, fontSize: 11, padding: '3px 8px' }}
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-controls="alerts-list"
        >
          {collapsed ? 'Mostrar' : 'Ocultar'}
        </button>
      </div>
      {!collapsed && (
        <div id="alerts-list" style={s.alertsList}>
          {alerts.map((a, i) => (
            <div
              key={`${a.type}-${a.employee_id || a.request_id || i}-${i}`}
              style={s.alertItem(a.severity)}
              role="button"
              tabIndex={0}
              onClick={() => onAlertClick(a)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAlertClick(a); } }}
              data-testid={`alert-${a.type}-${a.employee_id || a.request_id || i}`}
            >
              <span style={s.alertDot(a.severity)} aria-hidden />
              <span style={s.alertType}>{ALERT_TYPE_LABELS[a.type] || a.type}</span>
              <span style={s.alertMsg}>{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── US-PLN-4: projects view ─────────────────────────────────────── */

/**
 * Transform the planner payload (employee-centric) into a contract-centric
 * shape:
 *
 *   [
 *     {
 *       contract: { id, name, client_name, color },
 *       summary: Assignment[],      // all filled assignments for this contract
 *       requests: [                 // one entry per resource_request
 *         { request: RR|null, assignments: Assignment[] },
 *       ],
 *       unkeyed: Assignment[],      // assignments without a request (edge case)
 *     },
 *     ...
 *   ]
 *
 * Contracts that have neither assignments nor open requests in the viewport
 * are dropped so the screen only shows what's actually visible.
 */
function buildProjectsView(data) {
  if (!data) return [];
  const byId = new Map();
  for (const c of data.contracts || []) {
    byId.set(c.id, {
      contract: c,
      summary: [],
      requests: new Map(),
      unkeyed: [],
    });
  }
  // Filled assignments come nested under employees.
  for (const e of data.employees || []) {
    for (const a of e.assignments || []) {
      const bucket = byId.get(a.contract_id);
      if (!bucket) continue;
      const enriched = { ...a, employee_id: e.id, employee_name: e.full_name, employee_capacity: e.weekly_capacity_hours, employee_area_id: e.area_id, employee_area_name: e.area_name };
      bucket.summary.push(enriched);
      const rid = a.resource_request_id;
      if (rid) {
        if (!bucket.requests.has(rid)) bucket.requests.set(rid, { request: null, assignments: [] });
        bucket.requests.get(rid).assignments.push(enriched);
      } else {
        bucket.unkeyed.push(enriched);
      }
    }
  }
  // Merge in the open (unfilled / partially filled) requests.
  for (const rr of data.open_requests || []) {
    const bucket = byId.get(rr.contract_id);
    if (!bucket) continue;
    if (!bucket.requests.has(rr.id)) {
      bucket.requests.set(rr.id, { request: rr, assignments: [] });
    } else {
      bucket.requests.get(rr.id).request = rr;
    }
  }
  // Drop empty contracts and stabilize the order.
  const out = [];
  for (const bucket of byId.values()) {
    if (bucket.summary.length === 0 && bucket.requests.size === 0 && bucket.unkeyed.length === 0) continue;
    out.push({
      ...bucket,
      requests: Array.from(bucket.requests.values()),
    });
  }
  out.sort((a, b) => (a.contract.name || '').localeCompare(b.contract.name || ''));
  return out;
}

/**
 * One row per contract. Always shows assigned employee bars; the chevron
 * controls whether the RequestSubRow breakdown below is visible.
 */
function ContractRow({ bucket, weeks, onOpen, isExpanded, onToggle }) {
  const byWeek = useMemo(() => {
    const m = new Map();
    for (const a of bucket.summary) {
      if (!a.week_range) continue;
      for (let i = a.week_range[0]; i <= a.week_range[1]; i += 1) {
        if (!m.has(i)) m.set(i, []);
        m.get(i).push(a);
      }
    }
    return m;
  }, [bucket.summary]);

  const handleToggle = () => onToggle(bucket.contract.id);
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); }
  };

  return (
    <div
      style={s.contractRow(weeks.length)}
      data-testid={`contract-row-${bucket.contract.id}`}
      role="button"
      tabIndex={0}
      onClick={handleToggle}
      onKeyDown={onKeyDown}
      aria-expanded={isExpanded}
    >
      <div style={s.contractCell}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={s.contractChevron} aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
          <div style={s.contractName} title={bucket.contract.name}>{bucket.contract.name}</div>
        </div>
        <div style={s.contractClient}>{bucket.contract.client_name || '—'}</div>
      </div>
      {weeks.map((w, i) => {
        const items = byWeek.get(i) || [];
        return (
          <div key={w.index} style={s.weekCell('transparent')} data-testid={`contract-cell-${bucket.contract.id}-${i}`}>
            {items.map((a) => {
              const cap = Number(a.employee_capacity) || 0;
              const pctVal = cap > 0 ? Math.round((Number(a.weekly_hours) / cap) * 100) : null;
              const pctStr = pctVal !== null ? `${pctVal}%` : '—';
              const barColor = areaColorFor(a.employee_area_id);
              return (
                <div
                  key={`${a.id}-${i}`}
                  style={{ ...s.bar(barColor), cursor: onOpen ? 'pointer' : 'default' }}
                  title={`${a.employee_name} · ${a.weekly_hours}h/sem`}
                  role={onOpen ? 'button' : undefined}
                  tabIndex={onOpen ? 0 : undefined}
                  onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(a.id); } : undefined}
                  onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(a.id); } } : undefined}
                >
                  <span style={s.barName}>{a.employee_name}</span>
                  <span style={s.barMeta}>{a.weekly_hours}h · {pctStr}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Sub-row per resource_request: either shows the employee(s) filling it, or
 * a dashed "Sin asignar" bar across the request's week range.
 */
function RequestSubRow({ bucket, entry, weeks, onOpenCandidates, onOpen }) {
  const { request, assignments } = entry;
  const assignByWeek = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (!a.week_range) continue;
      for (let i = a.week_range[0]; i <= a.week_range[1]; i += 1) {
        if (!m.has(i)) m.set(i, []);
        m.get(i).push(a);
      }
    }
    return m;
  }, [assignments]);

  const rid = request?.id || assignments[0]?.resource_request_id || 'unknown';
  const title = request?.role_title || assignments[0]?.role_title || 'Solicitud';
  const level = request?.level || assignments[0]?.request_level || '';
  const missing = request?.missing || 0;

  const open = () => {
    if (missing > 0 && onOpenCandidates) onOpenCandidates(rid);
  };
  const clickable = missing > 0 ? { cursor: 'pointer' } : {};

  return (
    <div
      style={{ ...s.requestSubRow(weeks.length), ...clickable }}
      data-testid={`project-request-row-${rid}`}
      role={missing > 0 ? 'button' : undefined}
      tabIndex={missing > 0 ? 0 : undefined}
      onClick={open}
      onKeyDown={(e) => { if (missing > 0 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
    >
      <div style={s.requestSubCell}>
        <div style={s.requestTitle} title={title}>
          {title}
          {missing > 0 && <span style={{ opacity: 0.6, fontWeight: 400 }}> · faltan {missing}</span>}
        </div>
        <div style={s.requestMeta}>{level}{level && ' · '}{request?.weekly_hours || assignments[0]?.weekly_hours || 0}h/sem</div>
      </div>
      {weeks.map((w, i) => {
        const items = assignByWeek.get(i) || [];
        const inOpenRange = request && request.week_range && i >= request.week_range[0] && i <= request.week_range[1];
        const showUnassigned = items.length === 0 && inOpenRange && missing > 0;
        const cellStyle = showUnassigned
          ? { ...s.weekCell('repeating-linear-gradient(45deg, #fffbea, #fffbea 10px, #fff7d6 10px, #fff7d6 20px)') }
          : s.weekCell('transparent');
        return (
          <div key={w.index} style={cellStyle}>
            {items.map((a) => {
              const cap = Number(a.employee_capacity) || 0;
              const pctVal = cap > 0 ? Math.round((Number(a.weekly_hours) / cap) * 100) : null;
              const pctStr = pctVal !== null ? `${pctVal}%` : '—';
              const barColor = areaColorFor(a.employee_area_id);
              return (
                <div
                  key={`${a.id}-${i}`}
                  style={{ ...s.bar(barColor), cursor: onOpen ? 'pointer' : 'default' }}
                  title={`${a.employee_name} · ${a.weekly_hours}h/sem`}
                  role={onOpen ? 'button' : undefined}
                  tabIndex={onOpen ? 0 : undefined}
                  onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(a.id); } : undefined}
                  onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(a.id); } } : undefined}
                >
                  <span style={s.barName}>{a.employee_name}</span>
                  <span style={s.barMeta}>{a.weekly_hours}h · {pctStr}</span>
                </div>
              );
            })}
            {showUnassigned && (
              <div style={s.unassignedBar(request.color || bucket.contract.color || '#e98b3f')} title={`Sin asignar · ${title}`}>
                Sin asignar
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProjectsView({ projects, weeks, onOpenCandidates, onOpen, projectSearch, expandedProjects, onToggleProject }) {
  // Filtro client-side por nombre de contrato o cliente.
  const needle = (projectSearch || '').toLowerCase().trim();
  const visible = needle
    ? projects.filter((b) =>
        (b.contract.name || '').toLowerCase().includes(needle) ||
        (b.contract.client_name || '').toLowerCase().includes(needle)
      )
    : projects;

  if (visible.length === 0) {
    return <div style={s.empty}>{needle ? `Sin resultados para "${projectSearch}".` : 'No hay proyectos en el rango seleccionado.'}</div>;
  }

  // Leyenda de áreas: recoge las áreas únicas visibles en este viewport.
  const areaMap = new Map();
  for (const bucket of visible) {
    for (const a of bucket.summary) {
      if (a.employee_area_id && !areaMap.has(a.employee_area_id)) {
        areaMap.set(a.employee_area_id, a.employee_area_name || `Área ${a.employee_area_id}`);
      }
    }
    for (const entry of bucket.requests) {
      for (const a of entry.assignments) {
        if (a.employee_area_id && !areaMap.has(a.employee_area_id)) {
          areaMap.set(a.employee_area_id, a.employee_area_name || `Área ${a.employee_area_id}`);
        }
      }
    }
  }
  const areaLegend = Array.from(areaMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <>
      {areaLegend.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '6px 0 10px', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--ds-text-dim, #888)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Áreas:</span>
          {areaLegend.map(([areaId, areaName]) => (
            <div key={areaId} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: areaColorFor(areaId), display: 'inline-block', flexShrink: 0 }} />
              <span style={{ color: 'var(--ds-text, #1b1b1b)' }}>{areaName}</span>
            </div>
          ))}
        </div>
      )}
      {visible.map((bucket) => {
        const isExpanded = !!(expandedProjects && expandedProjects[bucket.contract.id]);
        return (
          <React.Fragment key={bucket.contract.id}>
            <ContractRow
              bucket={bucket}
              weeks={weeks}
              onOpen={onOpen}
              isExpanded={isExpanded}
              onToggle={onToggleProject}
            />
            {isExpanded && (
              bucket.requests.length === 0
                ? (
                  <div style={s.emptyRequests} data-testid={`empty-requests-${bucket.contract.id}`}>
                    Sin cargos asignados en este período
                  </div>
                )
                : bucket.requests.map((entry) => (
                  <RequestSubRow
                    key={entry.request?.id || entry.assignments[0]?.id}
                    bucket={bucket}
                    entry={entry}
                    weeks={weeks}
                    onOpenCandidates={onOpenCandidates}
                    onOpen={onOpen}
                  />
                ))
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

/* ── Main ────────────────────────────────────────────────────────── */

export default function CapacityPlanner() {
  // US-PLN-3: the URL is the single source of truth for the planner view.
  // That makes the page shareable ("mándame el link con esos filtros") and
  // keeps Back/Forward working naturally. `start` defaults to this week's
  // Monday; `weeks` defaults to 4 (SPEC-006 / Spec 3).
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const start      = searchParams.get('start')     || todayMondayIso();
  const weeksParam = Number(searchParams.get('weeks'));
  const weeks      = Number.isFinite(weeksParam) && weeksParam > 0 ? Math.min(26, Math.trunc(weeksParam)) : 4;
  const contractId = searchParams.get('contract_id') || '';
  const areaId     = searchParams.get('area_id')     || '';
  const levelMin   = searchParams.get('level_min')   || '';
  const levelMax   = searchParams.get('level_max')   || '';
  const search        = searchParams.get('search')         || '';
  const projectSearch = searchParams.get('project_search') || '';
  // US-PLN-4: view toggle. 'employees' (default) or 'projects'. The param
  // rides along with the other filters so sharing a link keeps the angle.
  const view       = searchParams.get('view') === 'projects' ? 'projects' : 'employees';

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState([]);
  // Ordenamiento de la vista Personas por utilización de una semana.
  // sortWeek: índice de columna (0-based) | null = orden alfabético.
  // sortDir: 'asc' (menor carga primero) | 'desc' (mayor carga primero).
  const [sortWeek, setSortWeek] = useState(null);
  const [sortDir, setSortDir]   = useState('asc');
  // US-RR-3: when an unassigned row is clicked we open the candidates
  // modal here instead of navigating away — the user stays in-context.
  const [openCandidatesFor, setOpenCandidatesFor] = useState(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignToast, setAssignToast] = useState(null); // { ok, msg }
  // SPEC-006 / Spec 2.2: clic en barra de asignación → modal de edición
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  // SPEC-009: accordion state — keyed by contract_id, true = expanded
  const [expandedProjects, setExpandedProjects] = useState({});

  const toggleProject = useCallback((contractId) => {
    setExpandedProjects((prev) => ({ ...prev, [contractId]: !prev[contractId] }));
  }, []);

  // Ciclo: sin orden → asc (↑ menor carga) → desc (↓ mayor carga) → sin orden.
  const handleSortWeek = useCallback((weekIdx) => {
    setSortWeek((prev) => {
      if (prev !== weekIdx) { setSortDir('asc');  return weekIdx; }
      if (sortDir === 'asc') { setSortDir('desc'); return weekIdx; }
      setSortDir('asc'); return null;
    });
  }, [sortDir]);

  // Resetear sort si cambia el número de semanas (el índice puede quedar fuera de rango).
  useEffect(() => {
    setSortWeek(null);
    setSortDir('asc');
  }, [weeks]);

  // When a single contract is filtered, show it expanded by default.
  const effectiveExpandedProjects = useMemo(() => {
    if (contractId) {
      const filtered = (data?.contracts || []).filter((c) => String(c.id) === String(contractId));
      if (filtered.length === 1) {
        const id = filtered[0].id;
        return { ...expandedProjects, [id]: expandedProjects[id] !== false };
      }
    }
    return expandedProjects;
  }, [contractId, data, expandedProjects]);

  // Small helper so every control mutates the URL, not component state.
  // Passing '' removes the key (keeps the URL tidy when a filter is cleared).
  const patchParams = useCallback((patch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === '' || v == null) next.delete(k);
        else next.set(k, String(v));
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const filters = useMemo(() => ({
    start, weeks,
    contract_id: contractId, area_id: areaId,
    level_min: levelMin, level_max: levelMax, search,
  }), [start, weeks, contractId, areaId, levelMin, levelMax, search]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const qs = buildQuery(filters);
      const res = await apiGet(`/api/capacity/planner?${qs}`);
      setData(res);
    } catch (ex) {
      setErr(ex.message || 'Error cargando el planner');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Areas are a small lookup; fetch once for the filter dropdown.
    apiGet('/api/areas').then((r) => setAreas((r && r.data) || [])).catch(() => {});
  }, []);

  const contracts = data?.contracts || [];
  const wks = data?.weeks || [];
  const projects = useMemo(() => buildProjectsView(data), [data]);

  // Empleados separados en activos (cualquier status salvo terminated) e inactivos.
  // Los inactivos siempre van al fondo en su propia sección, nunca se mezclan con el sort.
  const { sortedEmployees, inactiveEmployees } = useMemo(() => {
    const all = data?.employees || [];
    const active   = all.filter((e) => e.status !== 'terminated');
    const inactive = all.filter((e) => e.status === 'terminated')
                        .sort((a, b) => a.full_name.localeCompare(b.full_name));

    const sorted = (sortWeek === null || sortWeek === undefined)
      ? active
      : [...active].sort((a, b) => {
          const pctA = a.weekly?.[sortWeek]?.utilization_pct ?? 0;
          const pctB = b.weekly?.[sortWeek]?.utilization_pct ?? 0;
          return sortDir === 'asc' ? pctA - pctB : pctB - pctA;
        });

    return { sortedEmployees: sorted, inactiveEmployees: inactive };
  }, [data, sortWeek, sortDir]);

  return (
    <div style={s.page}>
      <h1 style={s.h1}>📅 Capacity Planner</h1>
      <p style={s.sub}>Vista semanal del equipo. Barras por contrato, utilización semana a semana, y solicitudes sin asignar.</p>

      {assignToast && (
        <div
          role="status"
          style={{
            marginBottom: 10,
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 13,
            background: assignToast.ok ? '#e8f5ec' : '#fde8eb',
            border: `1px solid ${assignToast.ok ? '#10b981' : '#ef4444'}`,
            color: assignToast.ok ? '#065f46' : '#b00020',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>{assignToast.msg}</span>
          <button type="button" onClick={() => setAssignToast(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit' }} aria-label="Cerrar">×</button>
        </div>
      )}

      {/* Metric cards */}
      <div style={s.metrics}>
        <MetricCard label="Personas activas" value={data?.meta?.active_employees ?? '—'} hint={`de ${data?.meta?.total_employees ?? 0} total`} accent="var(--ds-accent, #6B5B95)" />
        <MetricCard label="Utilización promedio" value={`${data?.meta?.avg_utilization_pct ?? 0}%`} hint="entre personas con carga" accent="var(--ds-ok, #4B9F6B)" />
        <MetricCard label="Sobre-asignados" value={data?.meta?.overbooked_count ?? 0} hint="al menos una semana > 100%" accent={(data?.meta?.overbooked_count || 0) > 0 ? 'var(--ds-bad, #c0392b)' : 'var(--ds-text-dim, #888)'} />
        <MetricCard label="Requests sin cubrir" value={data?.meta?.open_request_count ?? 0} hint="open / partially_filled" accent={(data?.meta?.open_request_count || 0) > 0 ? 'var(--ds-warn, #e98b3f)' : 'var(--ds-text-dim, #888)'} />
      </div>

      {/* Toolbar */}
      <div style={s.toolbar}>
        {/* US-PLN-4: view toggle (Personas | Proyectos). */}
        <div style={s.toggle} role="group" aria-label="Vista">
          <button
            type="button"
            style={s.toggleBtn(view === 'employees')}
            onClick={() => patchParams({ view: '', project_search: '' })}
            data-testid="view-toggle-employees"
            aria-pressed={view === 'employees'}
          >
            Personas
          </button>
          <button
            type="button"
            style={s.toggleBtn(view === 'projects')}
            onClick={() => patchParams({ view: 'projects', search: '' })}
            data-testid="view-toggle-projects"
            aria-pressed={view === 'projects'}
          >
            Proyectos
          </button>
        </div>

        {/* SPEC-006 / Spec 3: selector de rango + flechas dinámicas */}
        <select
          style={s.select}
          value={weeks}
          onChange={(e) => patchParams({ weeks: e.target.value })}
          aria-label="Rango de semanas"
          data-testid="weeks-range-select"
        >
          <option value="1">1 semana</option>
          <option value="2">2 semanas</option>
          <option value="4">4 semanas</option>
          <option value="8">8 semanas</option>
        </select>

        <button type="button" style={s.btn} onClick={() => patchParams({ start: shiftIso(start, -(weeks * 7)) })} aria-label={`${weeks} semanas atrás`}>←</button>
        <button type="button" style={s.btn} onClick={() => patchParams({ start: todayMondayIso() })}>Hoy</button>
        <button type="button" style={s.btn} onClick={() => patchParams({ start: shiftIso(start, weeks * 7) })} aria-label={`${weeks} semanas adelante`}>→</button>

        <select style={s.select} value={contractId} onChange={(e) => patchParams({ contract_id: e.target.value })} aria-label="Filtro contrato">
          <option value="">Todos los contratos</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select style={s.select} value={areaId} onChange={(e) => patchParams({ area_id: e.target.value })} aria-label="Filtro área">
          <option value="">Todas las áreas</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <select style={s.select} value={levelMin} onChange={(e) => patchParams({ level_min: e.target.value })} aria-label="Nivel mínimo">
          <option value="">Nivel min</option>
          {['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select style={s.select} value={levelMax} onChange={(e) => patchParams({ level_max: e.target.value })} aria-label="Nivel máximo">
          <option value="">Nivel max</option>
          {['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>

        {(contractId || areaId || levelMin || levelMax || search || projectSearch) && (
          <button type="button" style={s.btn} onClick={() => patchParams({ contract_id: '', area_id: '', level_min: '', level_max: '', search: '', project_search: '' })}>Limpiar filtros</button>
        )}

        {view === 'employees' && (
          <input style={s.input} type="search" placeholder="Buscar por nombre…" value={search} onChange={(e) => patchParams({ search: e.target.value })} aria-label="Buscar empleado" />
        )}
        {view === 'projects' && (
          <input style={s.input} type="search" placeholder="Buscar proyecto…" value={projectSearch} onChange={(e) => patchParams({ project_search: e.target.value })} aria-label="Buscar proyecto" />
        )}
      </div>

      {err && <div style={s.error} role="alert">{err}</div>}
      {loading && !data && <div style={s.loading}>Cargando planner…</div>}

      {data && <AlertsStrip alerts={data.alerts || []} />}

      {data && (
        <div style={s.frame}>
          <div style={s.scroller}>
            <div style={s.grid}>
              {/* Header row */}
              <div style={s.headRow(wks.length)}>
                <div style={{ ...s.headCell, textAlign: 'left', borderLeft: 'none', fontSize: 11, fontWeight: 500 }}>
                  {view === 'projects' ? 'Proyecto / solicitud' : 'Empleado'}
                </div>
                {wks.map((w, i) => {
                  const isActive = view === 'employees' && sortWeek === i;
                  return (
                    <div
                      key={w.index}
                      style={{
                        ...s.headCell,
                        ...(view === 'employees' ? {
                          cursor: 'pointer',
                          userSelect: 'none',
                          background: isActive ? 'var(--ds-accent-soft, #f0ebff)' : undefined,
                          color: isActive ? 'var(--ds-accent-text, var(--purple-dark))' : undefined,
                        } : {}),
                      }}
                      data-testid={`week-${w.iso_week}`}
                      onClick={view === 'employees' ? () => handleSortWeek(i) : undefined}
                      title={view === 'employees' ? (isActive ? (sortDir === 'asc' ? 'Menor carga primero — click para invertir' : 'Mayor carga primero — click para quitar orden') : 'Click para ordenar por carga esta semana') : undefined}
                      role={view === 'employees' ? 'button' : undefined}
                      tabIndex={view === 'employees' ? 0 : undefined}
                      onKeyDown={view === 'employees' ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSortWeek(i); } } : undefined}
                    >
                      <div style={s.headCellWeek}>
                        {w.label}
                        {isActive && (
                          <span style={{ marginLeft: 4, fontSize: 10 }} aria-label={sortDir === 'asc' ? 'menor primero' : 'mayor primero'}>
                            {sortDir === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                      <div style={s.headCellDate}>
                        {w.short_label}
                        {!isActive && view === 'employees' && (
                          <span style={{ marginLeft: 3, opacity: 0.35, fontSize: 9 }}>↕</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {view === 'employees' ? (
                <>
                  {/* Empleados activos */}
                  {sortedEmployees.length === 0 && inactiveEmployees.length === 0 && (
                    <div style={s.empty}>No hay empleados que cumplan los filtros.</div>
                  )}
                  {sortedEmployees.map((emp) => (
                    <EmployeeRow key={emp.id} emp={emp} weeks={wks} onOpen={setEditingAssignmentId} />
                  ))}

                  {/* Separador + empleados inactivos (terminated con historial en el viewport) */}
                  {inactiveEmployees.length > 0 && (
                    <>
                      <div style={s.inactiveSeparator(wks.length)}>
                        <div style={s.inactiveSeparatorCell}>
                          <span>⚠ Ya no en la empresa</span>
                          <span style={{ fontWeight: 400, fontSize: 10.5 }}>({inactiveEmployees.length})</span>
                        </div>
                        {wks.map((w) => (
                          <div key={w.index} style={{ borderLeft: '1px solid var(--ds-border, #eee)' }} />
                        ))}
                      </div>
                      {inactiveEmployees.map((emp) => (
                        <EmployeeRow key={emp.id} emp={emp} weeks={wks} onOpen={setEditingAssignmentId} inactive />
                      ))}
                    </>
                  )}

                  {/* Unassigned requests (US-PLN-5 + US-RR-3: click → candidates modal) */}
                  {data.open_requests.map((r) => (
                    <UnassignedRow
                      key={r.id}
                      request={r}
                      weeks={wks}
                      onOpen={(req) => setOpenCandidatesFor(req.id)}
                    />
                  ))}
                </>
              ) : (
                <ProjectsView
                  projects={projects}
                  weeks={wks}
                  onOpenCandidates={(rid) => setOpenCandidatesFor(rid)}
                  onOpen={setEditingAssignmentId}
                  projectSearch={projectSearch}
                  expandedProjects={effectiveExpandedProjects}
                  onToggleProject={toggleProject}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {openCandidatesFor && (
        <CandidatesModal
          requestId={openCandidatesFor}
          onClose={() => setOpenCandidatesFor(null)}
          onPick={async (candidate, request) => {
            // Crear la asignación in-place: el usuario se queda en el planner
            // y vemos el resultado refrescado. Los validadores del backend
            // (overbooking, área, level, etc.) deciden si aceptar o rechazar.
            // Si falla por validación dura → mostramos mensaje. Si la
            // validación pide override (admin), abrimos el flujo manual con
            // prefill para que el usuario pueda decidir conscientemente.
            if (assignBusy) return;
            setAssignBusy(true);
            setAssignToast(null);
            try {
              await apiPost('/api/assignments', {
                resource_request_id: request.id,
                employee_id: candidate.employee_id,
                contract_id: request.contract_id,
                weekly_hours: request.weekly_hours,
                start_date: request.start_date || new Date().toISOString().slice(0, 10),
                end_date: request.end_date || null,
                role_title: request.role_title,
              });
              setAssignToast({ ok: true, msg: `✓ ${candidate.full_name} asignado a ${request.role_title}` });
              setOpenCandidatesFor(null);
              await load();
            } catch (e) {
              const msg = e.message || 'Error al asignar';
              // Si el backend pide override (overbooking u otra validación
              // soft) o falla por algo no resoluble en un click, llevamos al
              // usuario al formulario manual con prefill para que decida.
              if (/override|reason|409|justific/i.test(msg)) {
                const qs = new URLSearchParams({
                  new: '1',
                  request_id: request.id,
                  employee_id: candidate.employee_id,
                  weekly_hours: String(request.weekly_hours),
                  contract_id: request.contract_id,
                }).toString();
                setAssignToast({ ok: false, msg: `${msg} — abriendo formulario manual…` });
                setOpenCandidatesFor(null);
                setTimeout(() => navigate(`/assignments?${qs}`), 800);
              } else {
                setAssignToast({ ok: false, msg });
              }
            } finally {
              setAssignBusy(false);
            }
          }}
        />
      )}

      {/* SPEC-006 / Spec 2.2: modal de edición de asignación */}
      {editingAssignmentId && (
        <AssignmentEditModal
          assignmentId={editingAssignmentId}
          onClose={() => setEditingAssignmentId(null)}
          onSaved={() => { setEditingAssignmentId(null); load(); }}
        />
      )}
    </div>
  );
}
