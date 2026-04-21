import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet } from '../utils/apiV2';
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

const BUCKET_STYLES = {
  idle:       { bg: 'var(--bg-soft, #f4f5f7)', color: '#6b7280' },
  light:      { bg: '#fff4dd', color: '#8a5a00' },
  healthy:    { bg: '#dff5e6', color: '#106b34' },
  overbooked: { bg: '#fbdcdc', color: '#9a1e1e' },
};

const s = {
  page: { padding: '20px 24px 40px', fontFamily: 'inherit' },
  h1: { margin: 0, fontSize: 22, color: 'var(--purple-dark)', fontFamily: 'Montserrat' },
  sub: { margin: '4px 0 16px', fontSize: 13, color: 'var(--text-light)' },

  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 },
  card: (accent) => ({ background: '#fff', borderLeft: `4px solid ${accent}`, borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }),
  cardLabel: { fontSize: 11, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  cardValue: { fontSize: 24, fontWeight: 700, color: 'var(--text, #1b1b1b)', fontFamily: 'Montserrat' },
  cardHint: { fontSize: 11, color: 'var(--text-light)', marginTop: 2 },

  toolbar: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' },
  select: { padding: '6px 10px', border: '1px solid var(--border, #ddd)', borderRadius: 6, fontSize: 13, background: '#fff' },
  input: { padding: '6px 10px', border: '1px solid var(--border, #ddd)', borderRadius: 6, fontSize: 13, minWidth: 180 },
  btn: { padding: '6px 12px', border: '1px solid var(--border, #ddd)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 },

  frame: { border: '1px solid var(--border, #e5e5e5)', borderRadius: 10, background: '#fff', overflow: 'hidden' },
  scroller: { overflowX: 'auto', position: 'relative' },
  grid: { display: 'grid', gridAutoRows: 'min-content', minWidth: '100%' },

  headRow: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, ${WEEK_COL_WIDTH}px)`,
    position: 'sticky', top: 0, zIndex: 3,
    background: 'var(--purple-dark, #3b1d52)',
    color: '#fff',
  }),
  headCell: { padding: '10px 8px', fontSize: 11, borderLeft: '1px solid rgba(255,255,255,.1)', textAlign: 'center' },
  headCellWeek: { fontWeight: 700, fontSize: 12 },
  headCellDate: { fontSize: 10, opacity: 0.8 },

  row: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, ${WEEK_COL_WIDTH}px)`,
    borderTop: '1px solid var(--border, #eee)',
    minHeight: 72,
  }),
  empCell: { padding: '10px 12px', borderRight: '1px solid var(--border, #eee)', background: '#fafafa', position: 'sticky', left: 0, zIndex: 2 },
  empName: { fontSize: 13, fontWeight: 600, color: 'var(--text, #1b1b1b)' },
  empMeta: { fontSize: 11, color: 'var(--text-light)', marginTop: 2 },
  empCap: { fontSize: 10, color: 'var(--text-light)', marginTop: 4 },

  weekCell: (bg) => ({
    borderLeft: '1px solid var(--border, #f0f0f0)',
    padding: 6, position: 'relative',
    display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'flex-start',
    background: bg,
  }),
  bar: (color, left, width) => ({
    background: color, color: '#fff',
    borderRadius: 4, padding: '3px 6px',
    fontSize: 10, fontWeight: 600,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    boxShadow: '0 1px 2px rgba(0,0,0,.1)',
  }),
  chip: (bucket) => ({
    marginTop: 'auto',
    alignSelf: 'flex-start',
    fontSize: 10, fontWeight: 700,
    padding: '2px 6px', borderRadius: 10,
    background: BUCKET_STYLES[bucket]?.bg || BUCKET_STYLES.idle.bg,
    color:      BUCKET_STYLES[bucket]?.color || BUCKET_STYLES.idle.color,
  }),

  unassignedRow: (weeksLen) => ({
    display: 'grid',
    gridTemplateColumns: `${LEFT_COL_WIDTH}px repeat(${weeksLen}, ${WEEK_COL_WIDTH}px)`,
    borderTop: '2px dashed var(--border, #ddd)',
    background: 'repeating-linear-gradient(45deg, #fffbea, #fffbea 10px, #fff7d6 10px, #fff7d6 20px)',
    minHeight: 56,
  }),
  unassignedCell: { padding: '8px 12px', borderRight: '1px solid var(--border, #eee)', position: 'sticky', left: 0, background: '#fff8e6', zIndex: 2 },
  unassignedTitle: { fontSize: 12, fontWeight: 600, color: '#8a5a00' },
  unassignedMeta: { fontSize: 10, color: '#a07000', marginTop: 2 },
  unassignedBar: (color) => ({
    background: 'transparent',
    border: `1.5px dashed ${color}`,
    color,
    borderRadius: 4, padding: '3px 6px',
    fontSize: 10, fontWeight: 700,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  }),

  empty: { padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 14 },
  error: { padding: 16, background: '#fff0f0', color: '#9a1e1e', borderRadius: 8, fontSize: 13 },
  loading: { padding: 40, textAlign: 'center', color: 'var(--text-light)' },
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

function AssignmentBar({ a }) {
  const label = `${a.contract_name}${a.weekly_hours ? ` · ${a.weekly_hours}h` : ''}`;
  return (
    <div style={s.bar(a.color)} title={`${a.contract_name} · ${a.role_title || ''} · ${a.weekly_hours}h/sem`}>
      {label}
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

function EmployeeRow({ emp, weeks }) {
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

  return (
    <div style={s.row(weeks.length)} data-testid={`emp-row-${emp.id}`}>
      <div style={s.empCell}>
        <div style={s.empName}>{emp.full_name}</div>
        <div style={s.empMeta}>{emp.level} · {emp.area_name || '—'}</div>
        <div style={s.empCap}>{emp.weekly_capacity_hours}h/sem</div>
      </div>
      {weeks.map((w, i) => {
        const weekInfo = emp.weekly[i] || { hours: 0, utilization_pct: 0, bucket: 'idle' };
        const asgs = byWeek.get(i) || [];
        const cellBg = weekInfo.bucket === 'overbooked' ? 'rgba(251, 220, 220, 0.25)' : '#fff';
        return (
          <div key={w.index} style={s.weekCell(cellBg)} data-testid={`cell-${emp.id}-${i}`}>
            {asgs.map((a) => <AssignmentBar key={a.id} a={a} />)}
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
        <div style={s.unassignedTitle}>{request.role_title} <span style={{ opacity: 0.6 }}>(faltan {request.missing})</span></div>
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

/* ── Main ────────────────────────────────────────────────────────── */

export default function CapacityPlanner() {
  // US-PLN-3: the URL is the single source of truth for the planner view.
  // That makes the page shareable ("mándame el link con esos filtros") and
  // keeps Back/Forward working naturally. `start` defaults to this week's
  // Monday; `weeks` defaults to 12.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const start      = searchParams.get('start')     || todayMondayIso();
  const weeksParam = Number(searchParams.get('weeks'));
  const weeks      = Number.isFinite(weeksParam) && weeksParam > 0 ? Math.min(26, Math.trunc(weeksParam)) : 12;
  const contractId = searchParams.get('contract_id') || '';
  const areaId     = searchParams.get('area_id')     || '';
  const levelMin   = searchParams.get('level_min')   || '';
  const levelMax   = searchParams.get('level_max')   || '';
  const search     = searchParams.get('search')      || '';

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState([]);
  // US-RR-3: when an unassigned row is clicked we open the candidates
  // modal here instead of navigating away — the user stays in-context.
  const [openCandidatesFor, setOpenCandidatesFor] = useState(null);

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

  return (
    <div style={s.page}>
      <h1 style={s.h1}>📅 Capacity Planner</h1>
      <p style={s.sub}>Vista semanal del equipo. Barras por contrato, utilización semana a semana, y solicitudes sin asignar.</p>

      {/* Metric cards */}
      <div style={s.metrics}>
        <MetricCard label="Personas activas" value={data?.meta?.active_employees ?? '—'} hint={`de ${data?.meta?.total_employees ?? 0} total`} accent="var(--teal-mid, #2a8fa0)" />
        <MetricCard label="Utilización promedio" value={`${data?.meta?.avg_utilization_pct ?? 0}%`} hint="entre personas con carga" accent="#4B9F6B" />
        <MetricCard label="Sobre-asignados" value={data?.meta?.overbooked_count ?? 0} hint="al menos una semana > 100%" accent={(data?.meta?.overbooked_count || 0) > 0 ? '#c0392b' : '#888'} />
        <MetricCard label="Requests sin cubrir" value={data?.meta?.open_request_count ?? 0} hint="open / partially_filled" accent={(data?.meta?.open_request_count || 0) > 0 ? '#e98b3f' : '#888'} />
      </div>

      {/* Toolbar */}
      <div style={s.toolbar}>
        <button type="button" style={s.btn} onClick={() => patchParams({ start: shiftIso(start, -28) })} aria-label="4 semanas atrás">← 4 sem</button>
        <button type="button" style={s.btn} onClick={() => patchParams({ start: todayMondayIso() })}>Hoy</button>
        <button type="button" style={s.btn} onClick={() => patchParams({ start: shiftIso(start, 28) })} aria-label="4 semanas adelante">4 sem →</button>

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

        {(contractId || areaId || levelMin || levelMax || search) && (
          <button type="button" style={s.btn} onClick={() => patchParams({ contract_id: '', area_id: '', level_min: '', level_max: '', search: '' })}>Limpiar filtros</button>
        )}

        <input style={s.input} type="search" placeholder="Buscar por nombre…" value={search} onChange={(e) => patchParams({ search: e.target.value })} aria-label="Buscar empleado" />
      </div>

      {err && <div style={s.error} role="alert">{err}</div>}
      {loading && !data && <div style={s.loading}>Cargando planner…</div>}

      {data && (
        <div style={s.frame}>
          <div style={s.scroller}>
            <div style={s.grid}>
              {/* Header row */}
              <div style={s.headRow(wks.length)}>
                <div style={{ ...s.headCell, textAlign: 'left', borderLeft: 'none', fontSize: 12, fontWeight: 700 }}>
                  Empleado
                </div>
                {wks.map((w) => (
                  <div key={w.index} style={s.headCell} data-testid={`week-${w.iso_week}`}>
                    <div style={s.headCellWeek}>{w.label}</div>
                    <div style={s.headCellDate}>{w.short_label}</div>
                  </div>
                ))}
              </div>

              {/* Employees */}
              {data.employees.length === 0 && (
                <div style={s.empty}>No hay empleados que cumplan los filtros.</div>
              )}
              {data.employees.map((emp) => <EmployeeRow key={emp.id} emp={emp} weeks={wks} />)}

              {/* Unassigned requests (US-PLN-5 + US-RR-3: click → candidates modal) */}
              {data.open_requests.map((r) => (
                <UnassignedRow
                  key={r.id}
                  request={r}
                  weeks={wks}
                  onOpen={(req) => setOpenCandidatesFor(req.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {openCandidatesFor && (
        <CandidatesModal
          requestId={openCandidatesFor}
          onClose={() => setOpenCandidatesFor(null)}
          onPick={(candidate, request) => {
            // Hand the user off to the Assignments module with a prefill hint
            // in the URL — that module will read it and open the create form
            // with employee + request + hours prefilled.
            const qs = new URLSearchParams({
              new: '1',
              request_id: request.id,
              employee_id: candidate.employee_id,
              weekly_hours: String(request.weekly_hours),
            }).toString();
            navigate(`/assignments?${qs}`);
          }}
        />
      )}
    </div>
  );
}
