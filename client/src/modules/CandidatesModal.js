import React, { useEffect, useState } from 'react';
import { apiGet } from '../utils/apiV2';

/**
 * US-RR-3 — Inline candidates panel.
 *
 * Given a resource_request_id, fetches ranked candidates from
 * GET /api/resource-requests/:id/candidates and renders them as a
 * sortable list with match breakdown and an "Asignar" action that
 * hands control to the parent (which decides whether to open the
 * Assignment form pre-filled or navigate).
 *
 * Kept intentionally dumb: no data mutation happens here. The ranking
 * is server-side so two clients see the same order.
 */

const bucket = (pct) => {
  if (pct >= 80) return { bg: '#dff5e6', fg: '#106b34', label: 'Alto match' };
  if (pct >= 50) return { bg: '#fff4dd', fg: '#8a5a00', label: 'Match parcial' };
  return { bg: '#fbdcdc', fg: '#9a1e1e', label: 'Bajo match' };
};

const s = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    zIndex: 1000, padding: '40px 16px', overflowY: 'auto',
  },
  panel: {
    background: '#fff', borderRadius: 10, width: 'min(820px, 100%)',
    boxShadow: '0 10px 40px rgba(0,0,0,.25)', padding: '20px 24px 24px',
  },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { margin: 0, fontSize: 18, color: 'var(--purple-dark)', fontFamily: 'Montserrat' },
  sub: { margin: '4px 0 0', fontSize: 12, color: 'var(--text-light)' },
  closeBtn: { border: 'none', background: 'transparent', fontSize: 22, cursor: 'pointer', color: '#888' },

  meta: { display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-light)', marginBottom: 12 },
  list: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 },
  row: (dim) => ({
    display: 'grid', gridTemplateColumns: '1fr auto',
    padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--border, #e5e5e5)',
    background: dim ? '#fafafa' : '#fff',
    opacity: dim ? 0.7 : 1,
  }),
  name: { fontSize: 14, fontWeight: 600, color: 'var(--text, #1b1b1b)' },
  meta2: { fontSize: 11, color: 'var(--text-light)', marginTop: 2 },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  chip: (bg, fg) => ({ background: bg, color: fg, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }),
  scoreBox: (bg, fg) => ({
    background: bg, color: fg,
    minWidth: 72, textAlign: 'center',
    padding: '6px 10px', borderRadius: 8,
    fontWeight: 700, fontSize: 14, alignSelf: 'start',
  }),
  btn: { marginTop: 8, padding: '6px 12px', border: 'none', borderRadius: 6, background: 'var(--teal-mid, #2a8fa0)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  loading: { padding: 24, textAlign: 'center', color: 'var(--text-light)' },
  error: { padding: 12, background: '#fff0f0', color: '#9a1e1e', borderRadius: 6, fontSize: 13 },
  empty: { padding: 24, textAlign: 'center', color: 'var(--text-light)', fontStyle: 'italic' },
};

function Chip({ label, ok }) {
  const bg = ok ? '#dff5e6' : '#fbdcdc';
  const fg = ok ? '#106b34' : '#9a1e1e';
  return <span style={s.chip(bg, fg)}>{label}</span>;
}

function skillNames(ids, lookup) {
  return (ids || []).map((id) => lookup[id] || `#${id}`);
}

export default function CandidatesModal({ requestId, onClose, onPick }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [areaOnly, setAreaOnly] = useState(false);

  useEffect(() => {
    if (!requestId) return undefined;
    let cancelled = false;
    setLoading(true); setErr('');
    apiGet(`/api/resource-requests/${requestId}/candidates?area_only=${areaOnly ? 'true' : 'false'}`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((ex) => { if (!cancelled) setErr(ex.message || 'Error cargando candidatos'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId, areaOnly]);

  if (!requestId) return null;
  const req = data?.request;
  const lookup = data?.skills_lookup || {};

  return (
    <div style={s.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="Candidatos">
      <div style={s.panel} onClick={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <div>
            <h2 style={s.title}>Candidatos sugeridos</h2>
            {req && (
              <p style={s.sub}>
                {req.role_title} · {req.level} · {req.weekly_hours}h/sem · {req.area_name || '—'}
              </p>
            )}
          </div>
          <button type="button" style={s.closeBtn} onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <div style={s.meta}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={areaOnly} onChange={(e) => setAreaOnly(e.target.checked)} />
            Solo mi área
          </label>
          {data?.meta && (
            <span>Pool: {data.meta.employee_pool_size} · Mostrados: {data.meta.returned}</span>
          )}
        </div>

        {err && <div style={s.error} role="alert">{err}</div>}
        {loading && <div style={s.loading}>Buscando candidatos…</div>}

        {!loading && data && data.candidates.length === 0 && (
          <div style={s.empty}>No se encontraron candidatos.</div>
        )}

        {!loading && data && data.candidates.length > 0 && (
          <div style={s.list}>
            {data.candidates.map((c) => {
              const b = bucket(c.score);
              const avail = c.match.availability;
              const reqSk = c.match.required_skills;
              return (
                <div key={c.employee_id} style={s.row(c.score < 30)} data-testid={`candidate-${c.employee_id}`}>
                  <div>
                    <div style={s.name}>{c.full_name}</div>
                    <div style={s.meta2}>
                      {c.level} · {c.area_name || 'Sin área'} · {c.weekly_capacity_hours}h/sem
                    </div>
                    <div style={s.chips}>
                      <Chip ok={c.match.area.status === 'match'} label={c.match.area.status === 'match' ? 'Mismo área' : 'Área distinta'} />
                      <Chip ok={['perfect','close'].includes(c.match.level.status)} label={`Nivel ${c.match.level.employee_level}`} />
                      <Chip ok={reqSk.fraction >= 0.66} label={`${reqSk.matched}/${reqSk.required} skills`} />
                      <Chip ok={avail.status === 'full'} label={avail.status === 'full' ? `Libre ${avail.available_hours}h` : (avail.status === 'partial' ? `Parcial ${avail.available_hours}h` : 'Sin capacidad')} />
                    </div>
                    {reqSk.missing_ids?.length > 0 && (
                      <div style={{ ...s.meta2, marginTop: 4 }}>
                        Faltan: {skillNames(reqSk.missing_ids, lookup).join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={s.scoreBox(b.bg, b.fg)} title={b.label}>{c.score}</div>
                    <button type="button" style={s.btn} onClick={() => onPick && onPick(c, data.request)} data-testid={`assign-${c.employee_id}`}>
                      Asignar →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
