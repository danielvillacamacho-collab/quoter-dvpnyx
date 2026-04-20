/**
 * ET-1 — Weekly time-tracking calendar for "me".
 * ET-3 — Copy previous week button.
 *
 * Renders a week (Mon-Sun) with one row per active assignment. Each
 * cell is a numeric input that autosaves on blur via POST or PUT.
 * Totals are shown per row, per column, and for the whole week.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiV2';

const s = {
  page:   { maxWidth: 1300, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  th:     { padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'center', whiteSpace: 'nowrap' },
  td:     { padding: '8px 8px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  cellInput: {
    width: 60, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6,
    fontSize: 13, textAlign: 'center', outline: 'none',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  weekNav: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-light)' },
};

const DAYS_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAILY_MAX = 16;

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

export default function TimeMe() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [assignments, setAssignments] = useState([]);
  const [entries, setEntries] = useState([]); // all entries for this week
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({}); // keyed by `${assignmentId}-${dateIso}`
  const [errorMsg, setErrorMsg] = useState('');

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekFromIso = iso(weekStart);
  const weekToIso = iso(addDays(weekStart, 6));

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [ra, re] = await Promise.all([
        // User's active + planned assignments (backend scopes to actor by default)
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

  /** Look up the entry for a given assignment + date. Returns null if none exists. */
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
        // Empty input means delete the entry if one exists
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

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>⏱ Mis horas</h1>
          <div style={s.sub}>Registra tus horas por asignación y día. Autosave al salir del campo.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={s.btnOutline} onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior">← Semana anterior</button>
          <button style={s.btnOutline} onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Semana siguiente">Semana siguiente →</button>
          <button style={s.btn('var(--teal-mid)')} onClick={copyPreviousWeek} aria-label="Copiar semana anterior">📋 Copiar semana anterior</button>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.weekNav}>
          <strong>Semana del {weekFromIso}</strong> al {weekToIso} · total semanal <strong>{weekTotal.toFixed(1)}h</strong>
        </div>
        {errorMsg && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{errorMsg}</div>}

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...s.th, textAlign: 'left', minWidth: 220 }}>Asignación</th>
                {weekDates.map((d, i) => (
                  <th key={iso(d)} style={s.th}>
                    <div>{DAYS_LABELS[i]}</div>
                    <div style={{ fontWeight: 400, fontSize: 10, opacity: 0.9 }}>{iso(d).slice(5)}</div>
                  </th>
                ))}
                <th style={s.th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!loading && assignments.length === 0 && (
                <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No tienes asignaciones activas para esta semana.
                </td></tr>
              )}
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <div>{a.contract_name || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{a.request_role_title || a.role_title || ''}</div>
                  </td>
                  {weekDates.map((d) => {
                    const dIso = iso(d);
                    const key = `${a.id}-${dIso}`;
                    const existing = findEntry(a.id, dIso);
                    return (
                      <td key={dIso} style={{ ...s.td, textAlign: 'center' }}>
                        <input
                          style={s.cellInput}
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
                          disabled={!!saving[key]}
                          aria-label={`Horas ${a.contract_name} ${dIso}`}
                        />
                      </td>
                    );
                  })}
                  <td style={{ ...s.td, textAlign: 'center', fontWeight: 700 }}>{rowTotal(a.id).toFixed(1)}h</td>
                </tr>
              ))}
              {!loading && assignments.length > 0 && (
                <tr style={{ background: 'var(--bg-soft, #f7f5f8)' }}>
                  <td style={{ ...s.td, fontWeight: 700 }}>Total día</td>
                  {weekDates.map((d) => {
                    const total = colTotal(iso(d));
                    return (
                      <td key={iso(d)} style={{ ...s.td, textAlign: 'center', fontWeight: 700, color: total > DAILY_MAX ? 'var(--danger)' : 'inherit' }}>
                        {total.toFixed(1)}h
                      </td>
                    );
                  })}
                  <td style={{ ...s.td, textAlign: 'center', fontWeight: 800, fontSize: 14 }}>{weekTotal.toFixed(1)}h</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
