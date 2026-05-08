/**
 * ProjectHealth — Portfolio-level EVM health listing (SPEC-PRJ-HEALTH-01).
 *
 * Shows all fixed_scope contracts with baseline status, latest KPIs
 * and health traffic light. Clicking a row navigates to detail view.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../utils/apiV2';
import { th, td, TABLE_CLASS } from '../shell/tableStyles';

/* ────────── styles (DS tokens) ────────── */
const ds = {
  page:     { maxWidth: 1200, margin: '0 auto', padding: 16 },
  h1:       { fontSize: 24, fontFamily: 'Montserrat', margin: '0 0 6px', color: 'var(--ds-text)' },
  sub:      { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 16 },
  card:     { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  kpiGrid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 },
  kpi:      { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16 },
  kpiLabel: { fontSize: 11, color: 'var(--ds-text-soft, var(--text-light))', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiValue: { fontSize: 26, fontWeight: 700, color: 'var(--ds-accent, var(--purple-dark))', marginTop: 4, fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)', fontFeatureSettings: "'tnum'" },
  row:      { cursor: 'pointer', transition: 'background .12s' },
};

const healthColors = {
  green:  { bg: '#dcfce7', text: '#166534', label: '🟢 Saludable' },
  yellow: { bg: '#fef9c3', text: '#854d0e', label: '🟡 En riesgo' },
  red:    { bg: '#fee2e2', text: '#991b1b', label: '🔴 Crítico' },
  null:   { bg: '#f3f4f6', text: '#6b7280', label: '⚪ Sin datos' },
};

function HealthBadge({ health }) {
  const h = healthColors[health] || healthColors['null'];
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: h.bg, color: h.text }}>
      {h.label}
    </span>
  );
}

function fmtUsd(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtIdx(n) {
  if (n == null) return '—';
  return Number(n).toFixed(3);
}

export default function ProjectHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGet('/api/projects/portfolio-health');
      setData(res);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={ds.page}><p>Cargando…</p></div>;
  if (err) return <div style={ds.page}><p style={{ color: 'red' }}>{err}</p></div>;
  if (!data) return null;

  const { projects } = data;

  // Summary KPIs
  const total = projects.length;
  const withBaseline = projects.filter(p => p.has_baseline).length;
  const red = projects.filter(p => p.overall_health === 'red').length;
  const yellow = projects.filter(p => p.overall_health === 'yellow').length;
  const green = projects.filter(p => p.overall_health === 'green').length;

  return (
    <div style={ds.page}>
      <h1 style={ds.h1}>Salud de Proyectos</h1>
      <p style={ds.sub}>Earned Value Management (PMI) — Vista de portafolio</p>

      {/* KPI summary cards */}
      <div style={ds.kpiGrid}>
        <div style={ds.kpi}>
          <div style={ds.kpiLabel}>Proyectos activos</div>
          <div style={ds.kpiValue}>{total}</div>
        </div>
        <div style={ds.kpi}>
          <div style={ds.kpiLabel}>Con baseline</div>
          <div style={ds.kpiValue}>{withBaseline}</div>
        </div>
        <div style={{ ...ds.kpi, borderLeft: '3px solid #16a34a' }}>
          <div style={ds.kpiLabel}>Saludables</div>
          <div style={{ ...ds.kpiValue, color: '#16a34a' }}>{green}</div>
        </div>
        <div style={{ ...ds.kpi, borderLeft: '3px solid #d97706' }}>
          <div style={ds.kpiLabel}>En riesgo</div>
          <div style={{ ...ds.kpiValue, color: '#d97706' }}>{yellow}</div>
        </div>
        <div style={{ ...ds.kpi, borderLeft: '3px solid #dc2626' }}>
          <div style={ds.kpiLabel}>Críticos</div>
          <div style={{ ...ds.kpiValue, color: '#dc2626' }}>{red}</div>
        </div>
      </div>

      {/* Projects table */}
      <div style={ds.card}>
        <table className={TABLE_CLASS} style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Proyecto</th>
              <th style={th}>Cliente</th>
              <th style={th}>BAC (USD)</th>
              <th style={{ ...th, textAlign: 'center' }}>Salud</th>
              <th style={{ ...th, textAlign: 'right' }}>CPI</th>
              <th style={{ ...th, textAlign: 'right' }}>SPI</th>
              <th style={th}>Último reporte</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--ds-text-soft)' }}>
                No hay proyectos fixed_scope activos
              </td></tr>
            )}
            {projects.map(p => {
              const kpis = p.kpis || {};
              return (
                <tr key={p.contract_id}
                    style={ds.row}
                    onClick={() => nav(`/project-health/${p.contract_id}`)}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--ds-hover, #f9fafb)'}
                    onMouseOut={e => e.currentTarget.style.background = ''}
                >
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{p.contract_name || '—'}</div>
                    {!p.has_baseline && <span style={{ fontSize: 11, color: 'var(--ds-text-soft)' }}>Sin baseline</span>}
                  </td>
                  <td style={td}>{p.client_name || '—'}</td>
                  <td style={td}>{fmtUsd(p.bac_cost_usd)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <HealthBadge health={p.overall_health} />
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}>
                    {fmtIdx(kpis.cpi)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}>
                    {fmtIdx(kpis.spi)}
                  </td>
                  <td style={td}>{p.last_report_date || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
