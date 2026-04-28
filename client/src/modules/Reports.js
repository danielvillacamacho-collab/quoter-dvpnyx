/**
 * Reports module — Sprint 6 (EI-1..7).
 *
 * One component renders both:
 *   - the /reports hub (cards listing every report), and
 *   - each individual /reports/:type page (a table with filters and
 *     CSV export).
 *
 * Reports are intentionally plain tables. Heatmaps/charts are polish
 * and ship later; the data is what delivery + capacity need today.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet } from '../utils/apiV2';

const s = {
  page:   { maxWidth: 1300, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  input:  { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none' },
  label:  { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th:     { padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:     { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  hubCard: {
    background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20,
    textAlign: 'left', cursor: 'pointer', transition: 'transform .15s, box-shadow .15s',
  },
};

const REPORTS = [
  { type: 'utilization',      label: '📊 Utilización',       description: 'Horas asignadas vs. capacidad por empleado.' },
  { type: 'bench',            label: '🪑 Banca',             description: 'Empleados con utilización por debajo del umbral.' },
  { type: 'pending-requests', label: '🧾 Solicitudes pendientes', description: 'Solicitudes abiertas por prioridad y antigüedad.' },
  { type: 'hiring-needs',     label: '🎯 Necesidades de contratación', description: 'Agregado por área, nivel y país.' },
  { type: 'coverage',         label: '🛡 Cobertura de contratos', description: 'Horas solicitadas vs. asignadas por contrato.' },
  { type: 'time-compliance',  label: '⏱ Cumplimiento time tracking', description: 'Horas registradas vs. esperadas por empleado.' },
  { type: 'plan-vs-real',     label: '🎯 Plan vs Real (semanal)', description: '% planeado por asignación vs % real registrado por el empleado.' },
];

function formatPct(v) {
  if (v == null || isNaN(Number(v))) return '—';
  return `${(Number(v) * 100).toFixed(1)}%`;
}
function formatNum(v, decimals = 1) {
  if (v == null || isNaN(Number(v))) return '—';
  return Number(v).toFixed(decimals);
}
function colorForPct(pct, inverted = false) {
  if (pct == null) return 'var(--text-light)';
  const v = Number(pct);
  if (inverted) {
    // Red when low (bad coverage), green when high
    if (v < 0.5) return 'var(--danger)';
    if (v < 0.8) return 'var(--orange)';
    return 'var(--success)';
  }
  // Default: red when too high (over-utilized), green when reasonable, gray when low
  if (v > 1.0) return 'var(--danger)';
  if (v >= 0.7) return 'var(--success)';
  if (v >= 0.3) return 'var(--orange)';
  return 'var(--text-light)';
}

function toCSV(rows, columns) {
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const body = rows.map((r) => columns.map((c) => {
    const v = c.get(r);
    if (v == null) return '';
    const str = String(v).replace(/"/g, '""');
    return `"${str}"`;
  }).join(',')).join('\n');
  return header + '\n' + body;
}
function downloadCSV(filename, rows, columns) {
  const csv = toCSV(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ---------- Report column definitions ---------- */
const COLUMNS = {
  utilization: [
    { label: 'Empleado',   get: (r) => `${r.first_name} ${r.last_name}` },
    { label: 'Área',       get: (r) => r.area_name || '—' },
    { label: 'Level',      get: (r) => r.level },
    { label: 'País',       get: (r) => r.country || '—' },
    { label: 'Capacidad',  get: (r) => formatNum(r.weekly_capacity_hours, 0) + 'h/sem' },
    { label: 'Asignadas',  get: (r) => formatNum(r.assigned_weekly_hours, 1) + 'h/sem' },
    { label: 'Utilización',get: (r) => formatPct(r.utilization), color: (r) => colorForPct(r.utilization) },
  ],
  bench: [
    { label: 'Empleado',   get: (r) => `${r.first_name} ${r.last_name}` },
    { label: 'Área',       get: (r) => r.area_name || '—' },
    { label: 'Level',      get: (r) => r.level },
    { label: 'País',       get: (r) => r.country || '—' },
    { label: 'Asignadas',  get: (r) => formatNum(r.assigned_weekly_hours, 1) + 'h/sem' },
    { label: 'Utilización',get: (r) => formatPct(r.utilization), color: (r) => 'var(--danger)' },
  ],
  'pending-requests': [
    { label: 'Role',       get: (r) => r.role_title },
    { label: 'Contrato',   get: (r) => r.contract_name || '—' },
    { label: 'Cliente',    get: (r) => r.client_name || '—' },
    { label: 'Level',      get: (r) => r.level },
    { label: 'País',       get: (r) => r.country || '—' },
    { label: 'Prioridad',  get: (r) => r.priority },
    { label: 'Inicio',     get: (r) => r.start_date ? String(r.start_date).slice(0, 10) : '—' },
    { label: 'Edad (días)',get: (r) => formatNum(r.age_days, 1) },
    { label: 'Activas',    get: (r) => r.active_assignments },
  ],
  'hiring-needs': [
    { label: 'Área',       get: (r) => r.area_name },
    { label: 'Level',      get: (r) => r.level },
    { label: 'País',       get: (r) => r.country },
    { label: 'Slots abiertos',   get: (r) => r.open_slots },
    { label: '# Solicitudes',    get: (r) => r.requests_count },
    { label: 'Prioridades',      get: (r) => (r.priorities || []).join(', ') },
  ],
  coverage: [
    { label: 'Contrato',   get: (r) => r.name },
    { label: 'Cliente',    get: (r) => r.client_name || '—' },
    { label: 'Tipo',       get: (r) => r.type },
    { label: 'Estado',     get: (r) => r.status },
    { label: 'Solicitadas',get: (r) => formatNum(r.requested_weekly_hours, 1) + 'h/sem' },
    { label: 'Asignadas',  get: (r) => formatNum(r.assigned_weekly_hours, 1) + 'h/sem' },
    { label: 'Cobertura',  get: (r) => formatPct(r.coverage_pct), color: (r) => colorForPct(r.coverage_pct, true) },
    { label: 'Solicitudes abiertas', get: (r) => r.open_requests_count },
  ],
  'time-compliance': [
    { label: 'Empleado',   get: (r) => `${r.first_name} ${r.last_name}` },
    { label: 'Área',       get: (r) => r.area_name || '—' },
    { label: 'Level',      get: (r) => r.level },
    { label: 'Logueadas',  get: (r) => formatNum(r.total_logged_hours, 1) + 'h' },
    { label: 'Esperadas',  get: (r) => formatNum(r.expected_hours, 1) + 'h' },
    { label: 'Cumplimiento', get: (r) => formatPct(r.compliance_pct), color: (r) => colorForPct(r.compliance_pct, true) },
  ],
};

/* Plan-vs-Real: tabla agrupada por empleado, una sub-fila por línea
 * (asignación). Color en la columna Estado:
 *   on_plan → verde, over → rojo, under → naranja, missing → gris,
 *   unplanned → púrpura (registró tiempo en algo que no estaba planeado),
 *   no_data → texto tenue (nadie registró tiempo aún).
 */
const STATUS_LABEL = {
  on_plan: '✓ En plan',
  over: '↑ Sobre-uso',
  under: '↓ Sub-uso',
  missing: '· Sin registro',
  unplanned: '⚠ No planeado',
  no_data: '— Sin data',
};
const STATUS_COLOR = {
  on_plan: 'var(--success)',
  over: 'var(--danger)',
  under: 'var(--orange)',
  missing: 'var(--text-light)',
  unplanned: 'var(--purple-dark)',
  no_data: 'var(--text-light)',
};
function PlanVsRealTable({ rows }) {
  if (!rows || rows.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Sin empleados visibles para esa semana.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
        <thead>
          <tr>
            {['Empleado', 'Contrato / Asignación', 'Rol', '% Plan', '% Real', 'Diff (pp)', 'Estado'].map((h) => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lines = r.lines.length > 0
              ? r.lines
              : [{ assignment_id: '__empty__', contract_name: '— sin asignaciones —', role_title: '', planned_pct: 0, actual_pct: r.has_actual_data ? 0 : null, diff_pct: null, status: r.has_actual_data ? 'on_plan' : 'no_data' }];
            return lines.map((l, idx) => (
              <tr key={r.employee_id + '_' + l.assignment_id + '_' + idx}>
                {idx === 0 && (
                  <td rowSpan={lines.length + 1} style={{ ...s.td, verticalAlign: 'top', background: '#fafafa' }}>
                    <div style={{ fontWeight: 700 }}>{r.employee_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                      {r.area_name || '—'} · {r.level} · cap {r.capacity_hours}h/sem
                    </div>
                  </td>
                )}
                <td style={s.td}>{l.contract_name || '—'}</td>
                <td style={s.td}>{l.role_title || '—'}</td>
                <td style={{ ...s.td, textAlign: 'right' }}>{(l.planned_pct ?? 0).toFixed(0)}%</td>
                <td style={{ ...s.td, textAlign: 'right' }}>{l.actual_pct == null ? '—' : `${l.actual_pct.toFixed(0)}%`}</td>
                <td style={{ ...s.td, textAlign: 'right', color: l.diff_pct == null ? 'var(--text-light)' : (l.diff_pct > 0 ? 'var(--danger)' : (l.diff_pct < 0 ? 'var(--orange)' : 'var(--success)')), fontWeight: 600 }}>
                  {l.diff_pct == null ? '—' : `${l.diff_pct > 0 ? '+' : ''}${l.diff_pct.toFixed(0)}`}
                </td>
                <td style={{ ...s.td, color: STATUS_COLOR[l.status] || 'inherit', fontWeight: 600, fontSize: 12 }}>
                  {STATUS_LABEL[l.status] || l.status}
                </td>
              </tr>
            )).concat([
              <tr key={r.employee_id + '_total'} style={{ background: '#f5f3ff' }}>
                <td style={{ ...s.td, fontWeight: 700 }}>Total semana</td>
                <td style={s.td}>—</td>
                <td style={{ ...s.td, textAlign: 'right', fontWeight: 700 }}>{(r.weekly_total_planned_pct ?? 0).toFixed(0)}%</td>
                <td style={{ ...s.td, textAlign: 'right', fontWeight: 700 }}>
                  {r.weekly_total_actual_pct == null ? '—' : `${r.weekly_total_actual_pct.toFixed(0)}%`}
                  {r.bench_pct != null && r.bench_pct > 0 ? <span style={{ fontSize: 11, color: 'var(--text-light)', marginLeft: 6 }}>(bench {r.bench_pct.toFixed(0)}%)</span> : null}
                </td>
                <td style={s.td}>—</td>
                <td style={{ ...s.td, fontSize: 12, color: 'var(--text-light)' }}>
                  {r.has_actual_data ? '' : 'No registró tiempo esta semana'}
                </td>
              </tr>
            ]);
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportTable({ type, data }) {
  const cols = COLUMNS[type] || [];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
        <thead>
          <tr>
            {cols.map((c) => <th key={c.label} style={s.th}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr><td colSpan={cols.length} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
              Sin datos para mostrar.
            </td></tr>
          )}
          {data.map((r, i) => (
            <tr key={r.id || i}>
              {cols.map((c) => (
                <td key={c.label} style={{ ...s.td, color: c.color ? c.color(r) : 'inherit', fontWeight: c.color ? 700 : 500 }}>
                  {c.get(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Reports() {
  const { type } = useParams();
  const nav = useNavigate();
  const report = REPORTS.find((r) => r.type === type);

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [extra, setExtra] = useState({}); // threshold / from / to

  const [thresholdInput, setThresholdInput] = useState('0.3');
  const [fromInput, setFromInput] = useState(() => new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10));
  const [toInput, setToInput] = useState(() => new Date().toISOString().slice(0, 10));
  // plan-vs-real semana actual (lunes).
  const [weekInput, setWeekInput] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  });
  // plan-vs-real shape distinto: rows en lugar de data, con lines anidadas.
  const [pvrRows, setPvrRows] = useState([]);

  const load = useCallback(async () => {
    if (!type) return;
    setLoading(true); setErr('');
    try {
      const qs = new URLSearchParams();
      if (type === 'bench') qs.set('threshold', String(thresholdInput));
      if (type === 'time-compliance') { qs.set('from', fromInput); qs.set('to', toInput); }
      if (type === 'plan-vs-real') qs.set('week_start', weekInput);
      const r = await apiGet(`/api/reports/${type}?${qs}`);
      if (type === 'plan-vs-real') {
        setPvrRows(r?.rows || []);
        setData([]);
        setExtra({ week_start_date: r?.week_start_date, week_end_date: r?.week_end_date });
      } else {
        setData(r?.data || []);
        setExtra({ threshold: r?.threshold, from: r?.from, to: r?.to });
      }
    } catch (e) {
      setErr(e.message || 'Error');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [type, thresholdInput, fromInput, toInput, weekInput]);

  useEffect(() => { load(); }, [load]);

  // -------- HUB (no :type) --------
  if (!type) {
    return (
      <div style={s.page}>
        <h1 style={s.h1}>📊 Reportes</h1>
        <div style={s.sub}>Vistas agregadas para capacidad, delivery y gente.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {REPORTS.map((r) => (
            <button
              type="button"
              key={r.type}
              style={s.hubCard}
              onClick={() => nav(`/reports/${r.type}`)}
              aria-label={`Abrir ${r.label}`}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat', marginBottom: 6 }}>{r.label}</div>
              <div style={{ fontSize: 13, color: 'var(--text-light)' }}>{r.description}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div style={s.page}>
        <button type="button" style={s.btnOutline} onClick={() => nav('/reports')}>← Volver a reportes</button>
        <div style={{ marginTop: 16 }}>Reporte no encontrado.</div>
      </div>
    );
  }

  const cols = COLUMNS[type] || [];

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <button type="button" style={{ ...s.btnOutline, marginBottom: 6 }} onClick={() => nav('/reports')}>← Reportes</button>
          <h1 style={s.h1}>{report.label}</h1>
          <div style={s.sub}>{report.description}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          {type === 'bench' && (
            <div>
              <label style={s.label}>Umbral de utilización</label>
              <input style={{ ...s.input, width: 100 }} type="number" min={0} max={1} step={0.05} value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} aria-label="Umbral" />
            </div>
          )}
          {type === 'time-compliance' && (
            <>
              <div>
                <label style={s.label}>Desde</label>
                <input style={s.input} type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} aria-label="Desde" />
              </div>
              <div>
                <label style={s.label}>Hasta</label>
                <input style={s.input} type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} aria-label="Hasta" />
              </div>
            </>
          )}
          {type === 'plan-vs-real' && (
            <div>
              <label style={s.label}>Semana (lunes)</label>
              <input style={s.input} type="date" value={weekInput} onChange={(e) => setWeekInput(e.target.value)} aria-label="Semana" />
            </div>
          )}
          <button type="button" style={s.btn('var(--teal-mid)')} onClick={() => {
            if (type === 'plan-vs-real') {
              const flat = [];
              pvrRows.forEach((r) => {
                if (r.lines.length === 0) {
                  flat.push({ employee: r.employee_name, area: r.area_name, level: r.level, contract: '—', role: '—',
                    planned_pct: r.weekly_total_planned_pct, actual_pct: r.weekly_total_actual_pct, diff_pct: '', status: r.has_actual_data ? '' : 'sin registro' });
                } else {
                  r.lines.forEach((l) => flat.push({
                    employee: r.employee_name, area: r.area_name, level: r.level,
                    contract: l.contract_name, role: l.role_title || '',
                    planned_pct: l.planned_pct, actual_pct: l.actual_pct, diff_pct: l.diff_pct, status: l.status,
                  }));
                }
              });
              const cols2 = [
                { label: 'Empleado',  get: (r) => r.employee },
                { label: 'Área',      get: (r) => r.area || '' },
                { label: 'Level',     get: (r) => r.level },
                { label: 'Contrato',  get: (r) => r.contract },
                { label: 'Rol',       get: (r) => r.role },
                { label: '% Plan',    get: (r) => r.planned_pct },
                { label: '% Real',    get: (r) => r.actual_pct ?? '' },
                { label: 'Diff (pp)', get: (r) => r.diff_pct ?? '' },
                { label: 'Estado',    get: (r) => r.status },
              ];
              return downloadCSV(`plan-vs-real-${weekInput}.csv`, flat, cols2);
            }
            return downloadCSV(`${type}-${new Date().toISOString().slice(0, 10)}.csv`, data, cols);
          }} aria-label="Exportar CSV">
            ⬇ Exportar CSV
          </button>
        </div>
      </div>

      <div style={s.card}>
        {extra.threshold != null && (
          <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8 }}>
            Umbral aplicado: {formatPct(extra.threshold)}
          </div>
        )}
        {extra.from && extra.to && (
          <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8 }}>
            Rango: {extra.from} → {extra.to}
          </div>
        )}
        {extra.week_start_date && extra.week_end_date && (
          <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8 }}>
            Semana: {extra.week_start_date} → {extra.week_end_date}
          </div>
        )}
        {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{err}</div>}
        {loading ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13 }}>Cargando…</div>
        ) : type === 'plan-vs-real' ? (
          <PlanVsRealTable rows={pvrRows} />
        ) : (
          <ReportTable type={type} data={data} />
        )}
      </div>
    </div>
  );
}
