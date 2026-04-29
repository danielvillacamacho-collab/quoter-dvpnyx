import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from '../utils/apiV2';
import { useAuth } from '../AuthContext';

/**
 * Idle Time Dashboard — SPEC-II-00.
 *
 * Vista del CFO: % facturable, % iniciativas internas, % festivos,
 * % novedades, % idle, costo USD del bench. Drilldown por país.
 * Botón admin para correr el cálculo del período (en lugar de cron real).
 */

const ds = {
  page: { maxWidth: 1200, margin: '0 auto', padding: 16 },
  h1: { fontSize: 24, fontFamily: 'Montserrat', margin: '0 0 6px', color: 'var(--ds-text)' },
  sub: { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 16 },
  card: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 },
  kpi: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16 },
  kpiLabel: { fontSize: 11, color: 'var(--ds-text-soft, var(--text-light))', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiValue: { fontSize: 26, fontWeight: 700, color: 'var(--ds-accent, var(--purple-dark))', marginTop: 4 },
  kpiSub: { fontSize: 12, color: 'var(--ds-text-soft, var(--text-light))', marginTop: 2 },
  input: { padding: '6px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13 },
  btn: { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: 'var(--ds-accent)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  bar: { display: 'flex', height: 24, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  barSeg: (color, pct, label) => ({ background: color, flex: pct, minWidth: pct > 0 ? 2 : 0, color: '#fff', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }),
  legend: { display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, marginBottom: 16 },
  legendItem: (color) => ({ display: 'flex', alignItems: 'center', gap: 6 }),
  legendDot: (color) => ({ width: 10, height: 10, borderRadius: 2, background: color }),
};

const COLOR = {
  billable: '#3B82F6',  // azul = contratos
  internal: '#A855F7',  // morado = iniciativas internas
  holidays: '#F59E0B',  // amarillo = festivo
  novelty: '#10B981',   // verde = novedad
  idle: '#9CA3AF',      // gris = idle
};

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function fmtPct(n) {
  return `${(Number(n || 0) * 100).toFixed(1)}%`;
}

function defaultPeriod() {
  // Mes anterior al actual (mes "cerrado" para análisis).
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function IdleTime() {
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const [period, setPeriod] = useState(defaultPeriod());
  const [util, setUtil] = useState(null);
  const [aggregate, setAggregate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [u, a] = await Promise.all([
        apiGet(`/api/idle-time/capacity-utilization?period=${period}`).catch(() => null),
        apiGet(`/api/idle-time/aggregate?period=${period}&group_by=country`).catch(() => null),
      ]);
      setUtil(u); setAggregate(a);
    } catch (ex) {
      setErr(ex.message || 'Error');
    } finally { setLoading(false); }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const runCalculation = async () => {
    setRunning(true); setRunMsg('');
    try {
      const r = await apiPost('/api/idle-time/calculate', { period_yyyymm: period });
      setRunMsg(`✓ ${r.processed} empleados procesados${r.missing_rate ? `, ${r.missing_rate} sin tarifa` : ''}${r.skipped_final ? `, ${r.skipped_final} ya finales (skipped)` : ''}`);
      load();
    } catch (ex) {
      setRunMsg(`✗ ${ex.message || 'Error'}`);
    } finally { setRunning(false); }
  };

  const finalize = async () => {
    if (!window.confirm(`Marcar como FINAL los snapshots de ${period}? No se podrán modificar después.`)) return;
    try {
      const r = await apiPost('/api/idle-time/finalize', { period_yyyymm: period });
      setRunMsg(`✓ ${r.finalized_count} snapshots marcados como final`);
      load();
    } catch (ex) {
      setRunMsg(`✗ ${ex.message || 'Error'}`);
    }
  };

  const total = util?.total_capacity_hours || 0;
  const b = util?.breakdown || {};

  return (
    <div style={ds.page}>
      <h1 style={ds.h1}>📊 Capacidad y Bench</h1>
      <div style={ds.sub}>
        Distribución de la capacidad total de la empresa entre asignaciones
        facturables, iniciativas internas, festivos, novedades e idle. El
        costo USD del idle es el "costo del bench" del CFO.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))' }}>Período</label>
        <input style={ds.input} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <>
            <button style={ds.btnGhost} onClick={runCalculation} disabled={running}>
              {running ? 'Calculando…' : '↻ Calcular período'}
            </button>
            <button style={ds.btnGhost} onClick={finalize}>🔒 Finalizar</button>
          </>
        )}
      </div>

      {runMsg && (
        <div style={{ ...ds.card, fontSize: 13 }}>{runMsg}</div>
      )}

      {loading && <div>Cargando…</div>}
      {err && <div style={{ color: 'var(--ds-bad, #ef4444)' }}>{err}</div>}

      {util && total > 0 && (
        <>
          <div style={ds.kpiGrid}>
            <div style={ds.kpi}>
              <div style={ds.kpiLabel}>Idle Total</div>
              <div style={ds.kpiValue}>{fmtPct(util.indicators.true_idle_pct)}</div>
              <div style={ds.kpiSub}>{Number(b.idle?.hours || 0).toFixed(0)} h</div>
            </div>
            <div style={ds.kpi}>
              <div style={ds.kpiLabel}>Costo del Bench</div>
              <div style={ds.kpiValue}>{fmtMoney(b.idle?.cost_usd)}</div>
              <div style={ds.kpiSub}>USD del período</div>
            </div>
            <div style={ds.kpi}>
              <div style={ds.kpiLabel}>Utilización Facturable</div>
              <div style={ds.kpiValue}>{fmtPct(util.indicators.utilization_rate_billable_pct)}</div>
              <div style={ds.kpiSub}>{Number(b.billable_assignments?.hours || 0).toFixed(0)} h</div>
            </div>
            <div style={ds.kpi}>
              <div style={ds.kpiLabel}>Inversión Interna</div>
              <div style={ds.kpiValue}>{fmtPct(util.indicators.internal_investment_pct)}</div>
              <div style={ds.kpiSub}>{Number(b.internal_initiatives?.hours || 0).toFixed(0)} h</div>
            </div>
          </div>

          <div style={ds.card}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Distribución de capacidad ({Number(total).toFixed(0)} h)</div>
            <div style={ds.bar}>
              <div style={ds.barSeg(COLOR.billable, b.billable_assignments?.pct || 0)}>
                {(b.billable_assignments?.pct || 0) > 0.05 ? fmtPct(b.billable_assignments?.pct) : ''}
              </div>
              <div style={ds.barSeg(COLOR.internal, b.internal_initiatives?.pct || 0)}>
                {(b.internal_initiatives?.pct || 0) > 0.05 ? fmtPct(b.internal_initiatives?.pct) : ''}
              </div>
              <div style={ds.barSeg(COLOR.holidays, b.holidays?.pct || 0)}>
                {(b.holidays?.pct || 0) > 0.05 ? fmtPct(b.holidays?.pct) : ''}
              </div>
              <div style={ds.barSeg(COLOR.novelty, b.novelties?.pct || 0)}>
                {(b.novelties?.pct || 0) > 0.05 ? fmtPct(b.novelties?.pct) : ''}
              </div>
              <div style={ds.barSeg(COLOR.idle, b.idle?.pct || 0)}>
                {(b.idle?.pct || 0) > 0.05 ? fmtPct(b.idle?.pct) : ''}
              </div>
            </div>
            <div style={ds.legend}>
              <div style={ds.legendItem(COLOR.billable)}><div style={ds.legendDot(COLOR.billable)} /> Facturable</div>
              <div style={ds.legendItem(COLOR.internal)}><div style={ds.legendDot(COLOR.internal)} /> Iniciativa interna</div>
              <div style={ds.legendItem(COLOR.holidays)}><div style={ds.legendDot(COLOR.holidays)} /> Festivos</div>
              <div style={ds.legendItem(COLOR.novelty)}><div style={ds.legendDot(COLOR.novelty)} /> Novedades</div>
              <div style={ds.legendItem(COLOR.idle)}><div style={ds.legendDot(COLOR.idle)} /> Idle</div>
            </div>
          </div>
        </>
      )}

      {aggregate && aggregate.groups && aggregate.groups.length > 0 && (
        <div style={ds.card}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🌎 Idle por país</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>País</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>Personas</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)', textAlign: 'right' }}>Idle %</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)', textAlign: 'right' }}>Idle USD</th>
              </tr>
            </thead>
            <tbody>
              {aggregate.groups.map((g) => (
                <tr key={g.country_id || g.country}>
                  <td style={{ padding: '6px 4px' }}>{g.country_id || g.country || '—'}</td>
                  <td style={{ padding: '6px 4px' }}>{g.users_count}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtPct(g.idle_pct)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtMoney(g.idle_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (!util || total === 0) && (
        <div style={ds.card}>
          <div style={{ fontSize: 14, marginBottom: 4 }}>Sin snapshots para {period}.</div>
          {isAdmin && (
            <div style={{ fontSize: 12, color: 'var(--ds-text-soft)' }}>
              Usá el botón <b>↻ Calcular período</b> para correr el motor de idle time.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
