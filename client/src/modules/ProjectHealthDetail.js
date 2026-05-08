/**
 * ProjectHealthDetail — Single-project EVM dashboard (SPEC-PRJ-HEALTH-01).
 *
 * KPI cards, progress bars per WBS package, trend chart (CPI/SPI over time),
 * baseline info, and status report submission.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/apiV2';
import { th, td, TABLE_CLASS } from '../shell/tableStyles';
import NumberInput from '../shell/NumberInput';

/* ────────── DS tokens ────────── */
const ds = {
  page:     { maxWidth: 1200, margin: '0 auto', padding: 16 },
  h1:       { fontSize: 24, fontFamily: 'Montserrat', margin: '0 0 6px', color: 'var(--ds-text)' },
  sub:      { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 16 },
  backBtn:  { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ds-accent)', fontWeight: 600, padding: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 },
  card:     { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  kpiGrid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 },
  kpi:      { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 12 },
  kpiLabel: { fontSize: 10, color: 'var(--ds-text-soft)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiValue: { fontSize: 22, fontWeight: 700, color: 'var(--ds-accent, var(--purple-dark))', marginTop: 2, fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" },
  kpiSub:   { fontSize: 11, color: 'var(--ds-text-soft)', marginTop: 2 },
  sectionH: { fontSize: 16, fontWeight: 700, margin: '16px 0 8px', color: 'var(--ds-text)' },
  btn:      { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: 'var(--ds-accent)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 14px', cursor: 'pointer', fontSize: 13 },
  input:    { padding: '6px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13, width: '100%', boxSizing: 'border-box' },
  label:    { fontSize: 11, fontWeight: 600, color: 'var(--ds-text-soft)', display: 'block', marginBottom: 4 },
  grid2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
};

const healthColors = {
  green:  { bg: '#dcfce7', text: '#166534', label: '🟢 Saludable' },
  yellow: { bg: '#fef9c3', text: '#854d0e', label: '🟡 En riesgo' },
  red:    { bg: '#fee2e2', text: '#991b1b', label: '🔴 Crítico' },
};

function HealthBadge({ health }) {
  const h = healthColors[health] || { bg: '#f3f4f6', text: '#6b7280', label: '⚪ Sin datos' };
  return <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 12, fontSize: 13, fontWeight: 700, background: h.bg, color: h.text }}>{h.label}</span>;
}

function fmtUsd(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtIdx(n) { return n == null ? '—' : Number(n).toFixed(3); }
function fmtPct(n) { return n == null ? '—' : (Number(n) * 100).toFixed(1) + '%'; }

function idxColor(v, threshold = 0.95) {
  if (v == null) return 'var(--ds-text)';
  if (v >= threshold) return '#16a34a';
  if (v >= 0.85) return '#d97706';
  return '#dc2626';
}

/* ────────── Progress Bar ────────── */
function ProgressBar({ pct, color = 'var(--ds-accent)' }) {
  const p = Math.max(0, Math.min(100, Number(pct || 0)));
  return (
    <div style={{ background: 'var(--ds-border, #e5e7eb)', borderRadius: 4, height: 8, width: '100%', overflow: 'hidden' }}>
      <div style={{ width: `${p}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .3s' }} />
    </div>
  );
}

/* ────────── Simple SVG Trend chart ────────── */
function TrendChart({ trend }) {
  if (!trend || trend.length < 2) return <p style={{ color: 'var(--ds-text-soft)', fontSize: 13 }}>Se necesitan al menos 2 reportes para ver tendencia.</p>;

  const W = 500, H = 140, PAD = 30;
  const n = trend.length;
  const xStep = (W - PAD * 2) / (n - 1);

  const clamp = (v) => Math.max(0, Math.min(2, Number(v || 1)));
  const y = (v) => PAD + (H - PAD * 2) * (1 - (clamp(v) - 0.5) / 1.0);

  const linePath = (vals) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${PAD + i * xStep},${y(v)}`).join(' ');

  const cpiVals = trend.map(t => t.cpi);
  const spiVals = trend.map(t => t.spi);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 500, height: 140, display: 'block' }}>
      {/* 1.0 reference line */}
      <line x1={PAD} y1={y(1)} x2={W - PAD} y2={y(1)} stroke="#ddd" strokeDasharray="4 2" />
      <text x={PAD - 4} y={y(1) + 4} fontSize={9} fill="#999" textAnchor="end">1.0</text>
      {/* 0.85 threshold */}
      <line x1={PAD} y1={y(0.85)} x2={W - PAD} y2={y(0.85)} stroke="#fee2e2" strokeDasharray="2 2" />
      <text x={PAD - 4} y={y(0.85) + 4} fontSize={9} fill="#dc2626" textAnchor="end">0.85</text>
      {/* CPI line */}
      <path d={linePath(cpiVals)} fill="none" stroke="#2563eb" strokeWidth={2} />
      {/* SPI line */}
      <path d={linePath(spiVals)} fill="none" stroke="#16a34a" strokeWidth={2} strokeDasharray="6 3" />
      {/* X axis labels */}
      {trend.map((t, i) => (
        <text key={i} x={PAD + i * xStep} y={H - 4} fontSize={8} fill="#999" textAnchor="middle">
          {String(t.cutoff_date || '').slice(5)}
        </text>
      ))}
      {/* Legend */}
      <line x1={W - 120} y1={10} x2={W - 100} y2={10} stroke="#2563eb" strokeWidth={2} />
      <text x={W - 96} y={13} fontSize={9} fill="#2563eb">CPI</text>
      <line x1={W - 70} y1={10} x2={W - 50} y2={10} stroke="#16a34a" strokeWidth={2} strokeDasharray="4 2" />
      <text x={W - 46} y={13} fontSize={9} fill="#16a34a">SPI</text>
    </svg>
  );
}

/* ────────── Status Report Form ────────── */
function StatusReportForm({ contractId, wbs, onCreated }) {
  const [cutoff, setCutoff] = useState(new Date().toISOString().slice(0, 10));
  const [progress, setProgress] = useState({});
  const [narrative, setNarrative] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const phasePkgs = (wbs || []).filter(w => w.kind === 'phase');

  const handlePct = (pkgId, val) => {
    setProgress(prev => ({ ...prev, [pkgId]: Math.max(0, Math.min(100, Number(val || 0))) }));
  };

  const handleSubmit = async () => {
    try {
      setSaving(true);
      setError('');
      const wbs_progress = phasePkgs.map(pkg => ({
        wbs_package_id: pkg.id,
        percent_complete: (progress[pkg.id] || 0) / 100, // API expects 0..1
      }));
      await apiPost(`/api/projects/${contractId}/status-reports`, {
        cutoff_date: cutoff,
        wbs_progress,
        narrative: narrative || undefined,
      });
      if (onCreated) onCreated();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={ds.card}>
      <h3 style={ds.sectionH}>Nuevo status report</h3>

      <div style={{ ...ds.grid2, marginBottom: 12 }}>
        <div>
          <label style={ds.label}>Fecha de corte</label>
          <input type="date" value={cutoff} onChange={e => setCutoff(e.target.value)} style={ds.input} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={ds.label}>Avance por fase (%)</label>
        <table className={TABLE_CLASS} style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Fase</th>
              <th style={{ ...th, width: 100 }}>Peso</th>
              <th style={{ ...th, width: 120 }}>% completado</th>
            </tr>
          </thead>
          <tbody>
            {phasePkgs.map(pkg => (
              <tr key={pkg.id}>
                <td style={td}>{pkg.name}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtPct(pkg.weight_pct)}</td>
                <td style={td}>
                  <input
                    type="number" min={0} max={100} step={1}
                    value={progress[pkg.id] ?? Math.round((pkg.percent_complete || 0) * 100)}
                    onChange={e => handlePct(pkg.id, e.target.value)}
                    style={{ ...ds.input, width: 80, textAlign: 'right' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={ds.label}>Narrativa (opcional)</label>
        <textarea value={narrative} onChange={e => setNarrative(e.target.value)} rows={3} style={{ ...ds.input, resize: 'vertical' }} placeholder="Resumen del avance semanal…" />
      </div>

      {error && <p style={{ color: 'red', fontSize: 13, marginBottom: 8 }}>{error}</p>}

      <button style={ds.btn} onClick={handleSubmit} disabled={saving}>
        {saving ? 'Guardando…' : 'Crear status report'}
      </button>
    </div>
  );
}

/* ────────── Baseline Creation Form ────────── */
function BaselineForm({ contractId, onCreated }) {
  const [reason, setReason] = useState('Baseline inicial al kick-off');
  const [method, setMethod] = useState('weighted_milestones');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    try {
      setSaving(true);
      setError('');
      await apiPost(`/api/projects/${contractId}/baseline`, {
        reason,
        measurement_method: method,
      });
      if (onCreated) onCreated();
    } catch (e) { setError(e.body?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={ds.card}>
      <h3 style={ds.sectionH}>Crear baseline</h3>
      <p style={{ fontSize: 13, color: 'var(--ds-text-soft)', marginBottom: 12 }}>
        Este proyecto no tiene baseline activo. Crea uno a partir de la cotización ganadora para comenzar a medir EVM.
      </p>
      <div style={{ marginBottom: 12 }}>
        <label style={ds.label}>Razón</label>
        <input value={reason} onChange={e => setReason(e.target.value)} style={ds.input} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={ds.label}>Método de medición</label>
        <select value={method} onChange={e => setMethod(e.target.value)} style={{ ...ds.input, width: 'auto' }}>
          <option value="weighted_milestones">Weighted Milestones</option>
          <option value="percent_complete">Percent Complete</option>
          <option value="level_of_effort">Level of Effort</option>
        </select>
        <p style={{ fontSize: 12, color: 'var(--ds-text-soft)', marginTop: 6, lineHeight: 1.5 }}>
          {method === 'weighted_milestones' && '🎯 Weighted Milestones — El avance se calcula según el peso asignado a cada fase/hito del proyecto. Ideal para proyectos con entregables claros y diferenciados en complejidad.'}
          {method === 'percent_complete' && '📊 Percent Complete — El PM estima directamente el porcentaje de avance de cada paquete de trabajo. Más flexible pero depende del criterio subjetivo del equipo.'}
          {method === 'level_of_effort' && '⏱️ Level of Effort — El avance se mide proporcionalmente al tiempo transcurrido. Útil para actividades de soporte continuo (QA, PM, soporte) donde no hay entregables discretos.'}
        </p>
      </div>
      {error && <p style={{ color: 'red', fontSize: 13, marginBottom: 8 }}>{error}</p>}
      <button style={ds.btn} onClick={handleCreate} disabled={saving}>
        {saving ? 'Creando…' : 'Congelar baseline'}
      </button>
    </div>
  );
}

/* ────────── Main Detail Component ────────── */
export default function ProjectHealthDetail() {
  const { contract_id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [noBaseline, setNoBaseline] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr('');
      setNoBaseline(false);
      const res = await apiGet(`/api/projects/${contract_id}/health`);
      setData(res);
    } catch (e) {
      if (e.status === 404) {
        setNoBaseline(true);
      } else if (e.status === 422) {
        setErr('Este contrato no es fixed_scope. Solo proyectos fixed_scope soportan Project Health.');
      } else {
        setErr(e.message);
      }
    }
    finally { setLoading(false); }
  }, [contract_id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={ds.page}><p>Cargando…</p></div>;

  return (
    <div style={ds.page}>
      <button style={ds.backBtn} onClick={() => nav('/project-health')}>← Portafolio</button>

      {err && <div style={{ ...ds.card, borderColor: '#dc2626', color: '#991b1b' }}>{err}</div>}

      {noBaseline && (
        <BaselineForm contractId={contract_id} onCreated={load} />
      )}

      {data && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <h1 style={ds.h1}>{data.contract_name}</h1>
            <HealthBadge health={data.health?.overall} />
          </div>
          <p style={ds.sub}>
            Baseline v{data.baseline?.version} · {data.baseline?.measurement_method} ·
            {' '}{data.baseline?.planned_start} → {data.baseline?.planned_end} ·
            BAC: {fmtUsd(data.baseline?.bac_cost_usd)}
          </p>

          {/* Health drivers */}
          {data.health?.drivers?.length > 0 && (
            <div style={{ ...ds.card, borderLeft: `3px solid ${data.health.overall === 'red' ? '#dc2626' : data.health.overall === 'yellow' ? '#d97706' : '#16a34a'}` }}>
              <strong style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ds-text-soft)' }}>Drivers</strong>
              <ul style={{ margin: '4px 0 0 16px', fontSize: 13 }}>
                {data.health.drivers.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}

          {/* KPI cards */}
          <div style={ds.kpiGrid}>
            {[
              { label: 'PV', value: fmtUsd(data.kpis?.pv) },
              { label: 'EV', value: fmtUsd(data.kpis?.ev) },
              { label: 'AC', value: fmtUsd(data.kpis?.ac) },
              { label: 'SV', value: fmtUsd(data.kpis?.sv), color: Number(data.kpis?.sv) < 0 ? '#dc2626' : '#16a34a' },
              { label: 'CV', value: fmtUsd(data.kpis?.cv), color: Number(data.kpis?.cv) < 0 ? '#dc2626' : '#16a34a' },
              { label: 'SPI', value: fmtIdx(data.kpis?.spi), color: idxColor(data.kpis?.spi) },
              { label: 'CPI', value: fmtIdx(data.kpis?.cpi), color: idxColor(data.kpis?.cpi) },
              { label: 'EAC (típico)', value: fmtUsd(data.kpis?.eac_typical) },
              { label: 'VAC', value: fmtUsd(data.kpis?.vac), color: Number(data.kpis?.vac) < 0 ? '#dc2626' : '#16a34a' },
              { label: 'TCPI (BAC)', value: fmtIdx(data.kpis?.tcpi_bac) },
            ].map((k, i) => (
              <div key={i} style={ds.kpi}>
                <div style={ds.kpiLabel}>{k.label}</div>
                <div style={{ ...ds.kpiValue, fontSize: 20, color: k.color || 'var(--ds-accent, var(--purple-dark))' }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Trend chart */}
          <div style={ds.card}>
            <h3 style={ds.sectionH}>Tendencia CPI / SPI</h3>
            <TrendChart trend={data.trend} />
          </div>

          {/* WBS progress table */}
          <div style={ds.card}>
            <h3 style={ds.sectionH}>EDT / WBS</h3>
            <table className={TABLE_CLASS} style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Paquete</th>
                  <th style={th}>Tipo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Peso</th>
                  <th style={{ ...th, width: 200 }}>Avance</th>
                  <th style={th}>Inicio</th>
                  <th style={th}>Fin</th>
                </tr>
              </thead>
              <tbody>
                {(data.wbs || []).map(w => {
                  const pct = Number(w.percent_complete || 0) * 100;
                  const barColor = pct >= 100 ? '#16a34a' : pct > 0 ? 'var(--ds-accent)' : 'var(--ds-border)';
                  return (
                    <tr key={w.id}>
                      <td style={{ ...td, fontWeight: w.kind === 'phase' ? 600 : 400, paddingLeft: w.kind !== 'phase' ? 28 : undefined }}>{w.name}</td>
                      <td style={td}><span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--ds-text-soft)' }}>{w.kind}</span></td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtPct(w.weight_pct)}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ProgressBar pct={pct} color={barColor} />
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', minWidth: 40, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td style={{ ...td, fontSize: 12 }}>{w.planned_start}</td>
                      <td style={{ ...td, fontSize: 12 }}>{w.planned_end}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Status report form toggle */}
          <button style={ds.btn} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cerrar formulario' : '+ Nuevo status report'}
          </button>
          {showForm && <StatusReportForm contractId={contract_id} wbs={data.wbs} onCreated={() => { setShowForm(false); load(); }} />}
        </>
      )}
    </div>
  );
}
