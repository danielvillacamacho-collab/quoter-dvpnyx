import React, { useEffect, useState, useCallback } from 'react';
import { apiGet } from '../utils/apiV2';
import { th, td, TABLE_CLASS } from '../shell/tableStyles';
import FilterableSelect from '../shell/FilterableSelect';

/**
 * Desviaciones — Planned hours vs actual logged hours.
 *
 * Shows a comparison table grouped by person or by project with
 * color-coded deviation indicators. Supports date range filtering,
 * area filtering, and CSV export.
 */

const ds = {
  page: { maxWidth: 1200, margin: '0 auto', padding: 16 },
  h1: { fontSize: 24, fontFamily: 'Montserrat', margin: '0 0 6px', color: 'var(--ds-text)' },
  sub: { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 16 },
  card: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 },
  kpi: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16 },
  kpiLabel: { fontSize: 11, color: 'var(--ds-text-soft, var(--text-light))', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiValue: { fontSize: 26, fontWeight: 700, color: 'var(--ds-accent, var(--purple-dark))', marginTop: 4, fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)', fontFeatureSettings: "'tnum'" },
  kpiSub: { fontSize: 12, color: 'var(--ds-text-soft, var(--text-light))', marginTop: 2 },
  input: { padding: '6px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13 },
  btn: { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: 'var(--ds-accent)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  toggle: (active) => ({
    background: active ? 'var(--ds-accent, var(--purple-dark))' : 'transparent',
    color: active ? '#fff' : 'var(--ds-text)',
    border: '1px solid var(--ds-border)',
    borderRadius: 'var(--ds-radius, 6px)',
    padding: '7px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    transition: 'all .15s',
  }),
};

function defaultFrom() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultTo() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

/** Color for deviation: green (<=10%), yellow (10-25%), red (>25%). */
function deviationColor(pct) {
  const abs = Math.abs(pct);
  if (abs <= 10) return 'var(--ds-ok, #16a34a)';
  if (abs <= 25) return 'var(--ds-warn, #d97706)';
  return 'var(--ds-danger, #dc2626)';
}

function deviationBg(pct) {
  const abs = Math.abs(pct);
  if (abs <= 10) return 'rgba(22, 163, 74, 0.08)';
  if (abs <= 25) return 'rgba(217, 119, 6, 0.08)';
  return 'rgba(220, 38, 38, 0.08)';
}

function fmtHours(n) {
  return `${Number(n || 0).toFixed(1)}h`;
}

function fmtPct(n) {
  const v = Number(n || 0);
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/** Build CSV string and trigger download. */
function exportCSV(rows, groupBy) {
  let header, lines;
  if (groupBy === 'person') {
    header = ['Empleado', 'Area', 'Nivel', 'Horas planeadas', 'Horas reales', 'Desviacion (h)', 'Desviacion (%)'];
    lines = rows.map((r) => [
      r.employee_name, r.area_name || '', r.level || '',
      r.planned_hours, r.actual_hours, r.deviation_hours, r.deviation_pct,
    ]);
  } else {
    header = ['Contrato', 'Cliente', 'Horas planeadas', 'Horas reales', 'Desviacion (h)', 'Desviacion (%)'];
    lines = rows.map((r) => [
      r.contract_name, r.client_name || '',
      r.planned_hours, r.actual_hours, r.deviation_hours, r.deviation_pct,
    ]);
  }
  const csv = [header, ...lines].map((row) =>
    row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `desviaciones_${groupBy}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function WeeklyBreakdownTable({ data, groupBy }) {
  const { weeks, rows, summary } = data;
  if (!rows || rows.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--ds-text-soft)' }}>Sin datos semanales.</div>;
  }

  const weekLabels = (weeks || []).map((w) => {
    const d = new Date(w + 'T00:00:00Z');
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });

  const mono = { fontFamily: 'var(--font-mono, monospace)', fontFeatureSettings: "'tnum'" };

  return (
    <div>
      {summary && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
          <span>En plan: <strong>{summary.employees_on_plan ?? 0}</strong></span>
          <span style={{ color: 'var(--ds-warn)' }}>Sobre plan: <strong>{summary.employees_over_plan ?? 0}</strong></span>
          <span style={{ color: 'var(--ds-danger)' }}>Bajo plan: <strong>{summary.employees_under_plan ?? 0}</strong></span>
          <span style={mono}>Total: {fmtHours(summary.total_actual_hours)} / {fmtHours(summary.total_planned_hours)} ({fmtPct(summary.total_variance_pct)})</span>
        </div>
      )}
      <div className="table-wrapper">
        <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{groupBy === 'person' ? 'Empleado' : 'Contrato'}</th>
              {weekLabels.map((lbl, i) => (
                <th key={i} style={{ ...th, textAlign: 'center', fontSize: 11, minWidth: 80 }}>
                  S{i + 1}<br /><span style={{ fontWeight: 400, fontSize: 10 }}>{lbl}</span>
                </th>
              ))}
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = groupBy === 'person' ? row.employee_id : row.contract_id;
              const label = groupBy === 'person' ? row.employee_name : row.contract_name;
              const totalVar = row.totals?.variance_pct ?? 0;
              return (
                <tr key={key}>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {label}
                    {groupBy === 'person' && row.area_name && (
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--ds-text-dim)', marginLeft: 6 }}>{row.area_name}</span>
                    )}
                  </td>
                  {(weeks || []).map((w, i) => {
                    const wk = row.weeks?.[w];
                    if (!wk) return <td key={i} style={{ ...td, textAlign: 'center', color: 'var(--ds-text-dim)' }}>—</td>;
                    const vPct = wk.variance_pct ?? 0;
                    const color = deviationColor(vPct);
                    const bg = deviationBg(vPct);
                    return (
                      <td key={i} style={{ ...td, textAlign: 'center', background: bg, ...mono, fontSize: 12 }}>
                        <span style={{ color, fontWeight: 600 }}>{fmtHours(wk.actual_hours)}</span>
                        <br />
                        <span style={{ fontSize: 10, color: 'var(--ds-text-dim)' }}>{fmtHours(wk.planned_hours)}</span>
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: 'right', ...mono }}>
                    <span style={{ color: deviationColor(totalVar), fontWeight: 600 }}>
                      {fmtPct(totalVar)}
                    </span>
                    <br />
                    <span style={{ fontSize: 11, color: 'var(--ds-text-dim)' }}>
                      {fmtHours(row.totals?.actual ?? 0)} / {fmtHours(row.totals?.planned ?? 0)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Deviations() {
  const [groupBy, setGroupBy] = useState('person');
  const [viewMode, setViewMode] = useState('aggregate'); // 'aggregate' | 'weekly'
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [areaId, setAreaId] = useState('');
  const [areas, setAreas] = useState([]);
  const [rows, setRows] = useState([]);
  const [weeklyData, setWeeklyData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // Load areas for filter
  useEffect(() => {
    apiGet('/api/areas').then((d) => {
      const list = Array.isArray(d) ? d : (d && d.data ? d.data : []);
      setAreas(list.map((a) => ({ id: String(a.id), label: a.name })));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      if (viewMode === 'weekly') {
        const params = new URLSearchParams({ week_from: from, week_to: to, group_by: groupBy });
        if (areaId) params.set('area_id', areaId);
        const res = await apiGet(`/api/rm/deviations/weekly?${params}`);
        setWeeklyData(res);
        setRows([]);
      } else {
        const params = new URLSearchParams({ from, to, group_by: groupBy });
        if (areaId) params.set('area_id', areaId);
        const res = await apiGet(`/api/reports/deviations?${params}`);
        setRows(res?.data || []);
        setWeeklyData(null);
      }
    } catch (ex) {
      setErr(ex.message || 'Error al cargar datos');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, groupBy, areaId, viewMode]);

  useEffect(() => { load(); }, [load]);

  // Summary calculations
  const totalPlanned = rows.reduce((s, r) => s + (r.planned_hours || 0), 0);
  const totalActual = rows.reduce((s, r) => s + (r.actual_hours || 0), 0);
  const totalDeviation = totalActual - totalPlanned;
  const totalDeviationPct = totalPlanned > 0 ? (totalDeviation / totalPlanned) * 100 : 0;

  return (
    <div style={ds.page}>
      <h1 style={ds.h1}>Desviaciones</h1>
      <p style={ds.sub}>Comparacion de horas planeadas vs horas reales registradas.</p>

      {/* Controls */}
      <div style={{ ...ds.card, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ds-text-dim)', display: 'block', marginBottom: 4 }}>Vista</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={ds.toggle(groupBy === 'person')} onClick={() => setGroupBy('person')}>Por persona</button>
            <button style={ds.toggle(groupBy === 'project')} onClick={() => setGroupBy('project')}>Por proyecto</button>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ds-text-dim)', display: 'block', marginBottom: 4 }}>Detalle</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={ds.toggle(viewMode === 'aggregate')} onClick={() => setViewMode('aggregate')}>Agregado</button>
            <button style={ds.toggle(viewMode === 'weekly')} onClick={() => setViewMode('weekly')}>Semanal</button>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ds-text-dim)', display: 'block', marginBottom: 4 }}>Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={ds.input} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ds-text-dim)', display: 'block', marginBottom: 4 }}>Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={ds.input} />
        </div>
        <div style={{ minWidth: 200 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ds-text-dim)', display: 'block', marginBottom: 4 }}>Area</label>
          <FilterableSelect
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            options={[{ id: '', label: 'Todas las areas' }, ...areas]}
            placeholder="Todas las areas"
          />
        </div>
        <button style={ds.btnGhost} onClick={() => exportCSV(rows, groupBy)} disabled={!rows.length}>
          Exportar CSV
        </button>
      </div>

      {/* Summary KPIs */}
      <div style={ds.kpiGrid}>
        <div style={ds.kpi}>
          <div style={ds.kpiLabel}>Total planeado</div>
          <div style={ds.kpiValue}>{fmtHours(totalPlanned)}</div>
        </div>
        <div style={ds.kpi}>
          <div style={ds.kpiLabel}>Total real</div>
          <div style={ds.kpiValue}>{fmtHours(totalActual)}</div>
        </div>
        <div style={ds.kpi}>
          <div style={ds.kpiLabel}>Desviacion total</div>
          <div style={{ ...ds.kpiValue, color: deviationColor(totalDeviationPct) }}>
            {totalDeviation >= 0 ? '+' : ''}{fmtHours(totalDeviation)}
          </div>
        </div>
        <div style={ds.kpi}>
          <div style={ds.kpiLabel}>% desviacion</div>
          <div style={{ ...ds.kpiValue, color: deviationColor(totalDeviationPct) }}>
            {fmtPct(totalDeviationPct)}
          </div>
        </div>
      </div>

      {/* Data table */}
      <div style={ds.card}>
        {err && <div style={{ color: 'var(--ds-danger, #dc2626)', marginBottom: 12 }}>{err}</div>}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ds-text-soft)' }}>Cargando...</div>
        ) : viewMode === 'weekly' ? (
          weeklyData ? <WeeklyBreakdownTable data={weeklyData} groupBy={groupBy} /> : <div style={{ textAlign: 'center', padding: 40, color: 'var(--ds-text-soft)' }}>Sin datos semanales.</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ds-text-soft)' }}>Sin datos para el periodo seleccionado.</div>
        ) : (
          <div className="table-wrapper">
            <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {groupBy === 'person' ? (
                    <>
                      <th style={th}>Empleado</th>
                      <th style={th}>Area</th>
                      <th style={th}>Nivel</th>
                    </>
                  ) : (
                    <>
                      <th style={th}>Contrato</th>
                      <th style={th}>Cliente</th>
                    </>
                  )}
                  <th style={{ ...th, textAlign: 'right' }}>Planeado</th>
                  <th style={{ ...th, textAlign: 'right' }}>Real</th>
                  <th style={{ ...th, textAlign: 'right' }}>Desviacion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const color = deviationColor(r.deviation_pct);
                  const bg = deviationBg(r.deviation_pct);
                  return (
                    <tr key={groupBy === 'person' ? r.employee_id : r.contract_id || i}>
                      {groupBy === 'person' ? (
                        <>
                          <td style={{ ...td, fontWeight: 600 }}>{r.employee_name}</td>
                          <td style={td}>{r.area_name || '-'}</td>
                          <td style={td}>{r.level || '-'}</td>
                        </>
                      ) : (
                        <>
                          <td style={{ ...td, fontWeight: 600 }}>{r.contract_name}</td>
                          <td style={td}>{r.client_name || '-'}</td>
                        </>
                      )}
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', fontFeatureSettings: "'tnum'" }}>
                        {fmtHours(r.planned_hours)}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', fontFeatureSettings: "'tnum'" }}>
                        {fmtHours(r.actual_hours)}
                      </td>
                      <td style={{ ...td, textAlign: 'right', background: bg, borderRadius: 4 }}>
                        <span style={{ color, fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', fontFeatureSettings: "'tnum'" }}>
                          {r.deviation_hours >= 0 ? '+' : ''}{fmtHours(r.deviation_hours)}
                        </span>
                        <span style={{ color, fontSize: 11, marginLeft: 6 }}>
                          ({fmtPct(r.deviation_pct)})
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--ds-text-soft)', padding: '4px 0' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--ds-ok, #16a34a)', marginRight: 4, verticalAlign: 'middle' }} /> Dentro de +/-10%</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--ds-warn, #d97706)', marginRight: 4, verticalAlign: 'middle' }} /> Entre 10-25%</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--ds-danger, #dc2626)', marginRight: 4, verticalAlign: 'middle' }} /> Mayor a 25%</span>
      </div>
    </div>
  );
}
