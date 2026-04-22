/**
 * ET-1 — Weekly time-tracking calendar for "me".
 * ET-3 — Copy previous week button.
 *
 * Renders a Mon–Sun week grid, one row per active assignment. Each
 * cell is a numeric input that auto-saves on blur via POST/PUT/DELETE
 * against /api/time-entries. Totals shown per row, per column, and
 * for the whole week.
 *
 * UI refresh Phase 6 (DVPNYX design handoff, Timesheet spec):
 *  - DS token palette via `theme.css` (no more purple-dark/Montserrat)
 *  - Cell states today / miss / future / weekend (visual cues for
 *    retroactive gaps, forward blocking, and weekend de-emphasis)
 *  - Contract color swatch on the row label
 *  - Mono + tabular-numerals on every totals cell
 *  - Week nav as a compact chevron-pill-chevron with "Hoy" shortcut
 *  - Right-side mini stats (esta semana, cumplimiento 7d)
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiV2';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';

const DAYS_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAILY_MAX = 16;
const WEEK_CAP = 40;

/** Find the Monday of the week containing date d. */
function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** Deterministic hue from a contract id — keeps the swatch stable per contract. */
function hueFrom(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/* Styles — split so inline overrides stay surgical and DS tokens do the heavy lifting. */
const s = {
  page:  { maxWidth: 1300, margin: '0 auto' },
  ph:    { padding: '20px 24px 12px', display: 'flex', alignItems: 'flex-end', gap: 16, borderBottom: '1px solid var(--ds-border)' },
  h1:    { fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ds-text)', margin: 0 },
  sub:   { fontSize: 12.5, color: 'var(--ds-text-dim)', marginTop: 2 },
  phActions: { marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, border: '1px solid var(--ds-border)', background: 'var(--ds-surface)', color: 'var(--ds-text)', cursor: 'pointer', whiteSpace: 'nowrap' },
  btnPrimary: { border: '1px solid transparent', background: 'var(--ds-accent)', color: '#fff' },
  btnGhost:   { border: '1px solid transparent', background: 'transparent', color: 'var(--ds-text-muted)' },
  btnSm:      { padding: '3px 8px', fontSize: 12 },

  body: { padding: '16px 24px' },
  metaRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' },
  weekNav: { display: 'flex', alignItems: 'center', gap: 6 },
  weekPill: { minWidth: 180, justifyContent: 'center', fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" },

  statWrap: { marginLeft: 'auto', display: 'flex', gap: 18, alignItems: 'center' },
  statLabel: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.04, fontWeight: 500, color: 'var(--ds-text-dim)' },
  statValue: { fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'", fontSize: 15, fontWeight: 500 },

  card: { background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 10, overflow: 'hidden' },
  tableWrap: { overflowX: 'auto' },
  errBox: { padding: '8px 12px', background: 'var(--ds-bad-soft)', color: 'oklch(0.45 0.18 25)', fontSize: 12.5, borderBottom: '1px solid var(--ds-border)' },

  rowLabelTd: { padding: '10px 12px', borderBottom: '1px solid var(--ds-border)', verticalAlign: 'middle' },
  swatch: (hue) => ({ display: 'inline-block', width: 8, height: 20, borderRadius: 2, background: `oklch(0.65 0.14 ${hue})`, marginRight: 9, verticalAlign: 'middle', flexShrink: 0 }),
  contractName: { fontWeight: 500, fontSize: 12.5, color: 'var(--ds-text)' },
  roleHint: { fontSize: 11, color: 'var(--ds-text-dim)' },

  cellTd: { padding: 0, borderBottom: '1px solid var(--ds-border)', borderLeft: '1px solid var(--ds-border)', textAlign: 'center', position: 'relative', minWidth: 72, minHeight: 44 },
  cellInput: (states) => ({
    width: '100%', height: '100%', minHeight: 44, border: 0, background: 'transparent',
    textAlign: 'center', padding: '10px 8px', fontSize: 13.5,
    color: 'var(--ds-text)', outline: 'none',
    cursor: states.future ? 'not-allowed' : 'text',
    fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'",
  }),
  cellBg: {
    base: { background: 'var(--ds-surface)' },
    today: { background: 'oklch(0.98 0.02 var(--ds-accent-hue, 270))' },
    miss: { background: 'var(--ds-bad-soft)' },
    weekend: { background: 'var(--ds-bg-soft)' },
    future: { background: 'repeating-linear-gradient(135deg, var(--ds-bg-soft) 0 6px, transparent 6px 12px)', cursor: 'not-allowed' },
  },

  rowTotal: { padding: '10px 12px', textAlign: 'right', background: 'var(--ds-bg-soft)', borderBottom: '1px solid var(--ds-border)', borderLeft: '1px solid var(--ds-border)', fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'", fontWeight: 500 },
  footTd: { padding: '10px 12px', background: 'var(--ds-bg-soft)', textAlign: 'center', fontWeight: 500, borderLeft: '1px solid var(--ds-border)', color: 'var(--ds-text-muted)', fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" },
  grandTd: { background: 'var(--ds-accent-soft)', color: 'var(--ds-accent-text)', fontSize: 13.5 },
};

function toneForWeek(total) {
  if (total >= WEEK_CAP) return 'var(--ds-ok)';
  if (total >= 32) return 'var(--ds-warn)';
  return 'var(--ds-bad)';
}

export default function TimeMe() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [assignments, setAssignments] = useState([]);
  const [entries, setEntries] = useState([]); // entries for this week
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({}); // keyed by `${assignmentId}-${dateIso}`
  const [errorMsg, setErrorMsg] = useState('');

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekFromIso = iso(weekStart);
  const weekToIso = iso(addDays(weekStart, 6));

  // Today state (recomputed on each render — cheap, avoids stale-cursor bugs at midnight).
  const now = new Date();
  const todayWeekStart = startOfWeek(now);
  const isCurrentWeek = iso(todayWeekStart) === weekFromIso;
  const todayIdx = isCurrentWeek ? ((now.getDay() + 6) % 7) : -1; // Mon=0..Sun=6, -1 if not current week
  const weekIsFuture = weekStart > todayWeekStart;

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [ra, re] = await Promise.all([
        apiGet('/api/assignments?status=active&limit=50'),
        apiGet(`/api/time-entries?from=${weekFromIso}&to=${weekToIso}&limit=500`),
      ]);
      setAssignments((ra?.data || []).filter((a) => !['cancelled'].includes(a.status)));
      setEntries(re?.data || []);
    } catch (e) {
      setErrorMsg('Error cargando la semana: ' + e.message);
      setAssignments([]); setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [weekFromIso, weekToIso]);

  useEffect(() => { load(); }, [load]);

  const findEntry = (assignmentId, dateIso) =>
    entries.find((e) => e.assignment_id === assignmentId && String(e.work_date).slice(0, 10) === dateIso) || null;

  const saveCell = async (assignment, dateIso, rawValue) => {
    const hours = Number(rawValue);
    const key = `${assignment.id}-${dateIso}`;
    setSaving((x) => ({ ...x, [key]: true }));
    setErrorMsg('');
    try {
      const existing = findEntry(assignment.id, dateIso);
      if (!rawValue || !Number.isFinite(hours) || hours <= 0) {
        if (existing) await apiDelete(`/api/time-entries/${existing.id}`);
      } else if (existing) {
        await apiPut(`/api/time-entries/${existing.id}`, { hours });
      } else {
        await apiPost('/api/time-entries', {
          assignment_id: assignment.id,
          work_date: dateIso,
          hours,
        });
      }
      await load();
    } catch (e) {
      setErrorMsg(e.message || 'Error guardando');
    } finally {
      setSaving((x) => ({ ...x, [key]: false }));
    }
  };

  const copyPreviousWeek = async () => {
    const prev = addDays(weekStart, -7);
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Copiar horas de la semana del ${iso(prev)} a esta semana?`)) return;
    try {
      const myEmployeeId = assignments[0]?.employee_id;
      if (!myEmployeeId) { setErrorMsg('No se encontró tu employee_id'); return; }
      const r = await apiPost('/api/time-entries/copy-week', {
        employee_id: myEmployeeId,
        source_week_start: iso(prev),
      });
      if (r?.skipped?.length) {
        // eslint-disable-next-line no-alert
        alert(`Copiados ${r.copied} entries. ${r.skipped.length} saltados (cap, ventana o asignación).`);
      }
      await load();
    } catch (e) {
      setErrorMsg(e.message || 'Error copiando');
    }
  };

  // Totals
  const rowTotal = (assignmentId) =>
    weekDates.reduce((sum, d) => {
      const e = findEntry(assignmentId, iso(d));
      return sum + Number(e?.hours || 0);
    }, 0);
  const colTotal = (dateIso) =>
    assignments.reduce((sum, a) => {
      const e = findEntry(a.id, dateIso);
      return sum + Number(e?.hours || 0);
    }, 0);
  const weekTotal = weekDates.reduce((sum, d) => sum + colTotal(iso(d)), 0);

  /** Resolve per-cell visual state. */
  const stateFor = (dayIdx) => {
    const future = weekIsFuture || (isCurrentWeek && dayIdx > todayIdx);
    const today = isCurrentWeek && dayIdx === todayIdx;
    const weekend = dayIdx >= 5;
    return { future, today, weekend };
  };

  return (
    <div style={s.page}>
      <div style={s.ph}>
        <div>
          <h1 style={s.h1}>⏱ Mis horas</h1>
          <div style={s.sub}>Registra tus horas por asignación y día. Autosave al salir del campo.</div>
        </div>
        <div style={s.phActions}>
          <button
            style={{ ...s.btn, ...s.btnPrimary }}
            onClick={copyPreviousWeek}
            aria-label="Copiar semana anterior"
          >
            📋 Copiar semana anterior
          </button>
        </div>
      </div>

      <div style={s.body}>
        <div style={s.metaRow}>
          <div style={s.weekNav}>
            <button style={{ ...s.btn, ...s.btnSm }} onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior">‹</button>
            <button
              style={{ ...s.btn, ...s.btnSm, ...s.weekPill }}
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              title="Ir a la semana actual"
            >
              {weekFromIso} — {weekToIso}
            </button>
            <button style={{ ...s.btn, ...s.btnSm }} onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Semana siguiente">›</button>
            {!isCurrentWeek && (
              <button style={{ ...s.btn, ...s.btnSm, ...s.btnGhost }} onClick={() => setWeekStart(startOfWeek(new Date()))}>Hoy</button>
            )}
          </div>

          <div style={s.statWrap}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
              <div style={s.statLabel}>Esta semana</div>
              <div style={{ ...s.statValue, color: toneForWeek(weekTotal) }}>
                {weekTotal.toFixed(0)} / {WEEK_CAP}h
              </div>
            </div>
          </div>
        </div>

        <div style={s.card}>
          {errorMsg && <div style={s.errBox}>{errorMsg}</div>}

          <div style={s.tableWrap}>
            <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ ...dsTh, textAlign: 'left', minWidth: 260 }}>Asignación</th>
                  {weekDates.map((d, i) => {
                    const st = stateFor(i);
                    return (
                      <th
                        key={iso(d)}
                        style={{
                          ...dsTh,
                          textAlign: 'center',
                          ...(st.today ? { background: 'var(--ds-accent-soft)', color: 'var(--ds-accent-text)' } : {}),
                          ...(st.weekend && !st.today ? { opacity: 0.7 } : {}),
                        }}
                      >
                        <div>{DAYS_LABELS[i]}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'", fontSize: 12.5, color: st.today ? 'var(--ds-accent-text)' : 'var(--ds-text)', fontWeight: 500, marginTop: 1, textTransform: 'none', letterSpacing: 0 }}>
                          {iso(d).slice(5)}
                        </div>
                      </th>
                    );
                  })}
                  <th style={{ ...dsTh, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={9} style={{ ...dsTd, textAlign: 'center', color: 'var(--ds-text-dim)' }}>Cargando…</td></tr>
                )}
                {!loading && assignments.length === 0 && (
                  <tr><td colSpan={9} style={{ ...dsTd, textAlign: 'center', padding: 40, color: 'var(--ds-text-dim)' }}>
                    No tienes asignaciones activas para esta semana.
                  </td></tr>
                )}
                {assignments.map((a) => {
                  const hue = hueFrom(a.contract_id || a.id);
                  return (
                    <tr key={a.id}>
                      <td style={s.rowLabelTd}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={s.swatch(hue)} aria-hidden="true" />
                          <div style={{ minWidth: 0 }}>
                            <div style={s.contractName}>{a.contract_name || '—'}</div>
                            <div style={s.roleHint}>{a.request_role_title || a.role_title || ''}</div>
                          </div>
                        </div>
                      </td>
                      {weekDates.map((d, i) => {
                        const dIso = iso(d);
                        const key = `${a.id}-${dIso}`;
                        const existing = findEntry(a.id, dIso);
                        const st = stateFor(i);
                        const pastEmpty = !st.future && !st.today && !st.weekend && !existing;
                        const bg = st.future ? s.cellBg.future
                          : st.today ? s.cellBg.today
                          : pastEmpty ? s.cellBg.miss
                          : st.weekend ? s.cellBg.weekend
                          : s.cellBg.base;
                        return (
                          <td key={dIso} style={{ ...s.cellTd, ...bg }}>
                            <input
                              style={s.cellInput(st)}
                              type="number"
                              min={0}
                              max={24}
                              step={0.5}
                              defaultValue={existing?.hours ?? ''}
                              onBlur={(e) => {
                                const v = e.target.value;
                                const current = existing?.hours ?? '';
                                if (String(v) === String(current)) return;
                                saveCell(a, dIso, v);
                              }}
                              disabled={!!saving[key] || st.future}
                              aria-label={`Horas ${a.contract_name} ${dIso}`}
                              placeholder={st.future ? '' : '—'}
                            />
                          </td>
                        );
                      })}
                      <td style={s.rowTotal}>{rowTotal(a.id).toFixed(1)}h</td>
                    </tr>
                  );
                })}
                {!loading && assignments.length > 0 && (
                  <tr>
                    <td style={{ ...s.footTd, textAlign: 'left', color: 'var(--ds-text-dim)', textTransform: 'uppercase', letterSpacing: 0.04, fontSize: 11, fontFamily: 'var(--font-ui)' }}>Total día</td>
                    {weekDates.map((d, i) => {
                      const total = colTotal(iso(d));
                      const st = stateFor(i);
                      return (
                        <td
                          key={iso(d)}
                          style={{
                            ...s.footTd,
                            color: total > DAILY_MAX ? 'var(--ds-bad)' : s.footTd.color,
                            ...(st.weekend ? { opacity: 0.6 } : {}),
                          }}
                        >
                          {total ? total.toFixed(1) : '—'}
                        </td>
                      );
                    })}
                    <td style={{ ...s.footTd, ...s.grandTd }}>{weekTotal.toFixed(1)}h</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick-fill 8h row — one chip per assignment, saves Mon-Fri at 8h each. */}
        {!loading && assignments.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {assignments.map((a) => {
              const hue = hueFrom(a.contract_id || a.id);
              return (
                <button
                  key={`qf-${a.id}`}
                  style={{ ...s.btn, ...s.btnSm }}
                  onClick={async () => {
                    // Fill Mon–Fri (up to today if current week, full Mon-Fri if past week)
                    // with 8h. Skip weekends, skip future, skip already-set cells.
                    for (let i = 0; i < 5; i += 1) {
                      const st = stateFor(i);
                      if (st.future) continue;
                      const dIso = iso(weekDates[i]);
                      const existing = findEntry(a.id, dIso);
                      if (existing) continue;
                      // eslint-disable-next-line no-await-in-loop
                      await saveCell(a, dIso, '8');
                    }
                  }}
                  title="Rellena L–V con 8h en esta asignación (salta celdas ya registradas)"
                >
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: `oklch(0.65 0.14 ${hue})` }} />
                  Rellenar 8h · {a.contract_name || '—'}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
