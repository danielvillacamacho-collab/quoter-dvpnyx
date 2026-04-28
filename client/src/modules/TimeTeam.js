/*
 * TimeTeam (Time-MVP-00.1) — registro semanal del tiempo del empleado
 * por % de asignación. Bench se calcula como 100 - SUM(%).
 *
 * UX:
 *   - Selector de semana (Mon-Sun, default semana actual).
 *   - Lista de asignaciones activas en esa semana, una fila por asignación.
 *   - Input por fila: % (0-100), step 5.
 *   - Total en vivo + barra visual + bench derivado.
 *   - Si total > 100 → botón Guardar deshabilitado.
 *   - Si total < 100 → modal de confirmación al guardar avisando que el
 *     resto va a bench.
 *
 * El empleado se deriva del JWT (req.user) en el server.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPut } from '../utils/apiV2';

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtRangeES(monday) {
  const sun = addDays(monday, 6);
  const opts = { day: '2-digit', month: 'short' };
  return `${monday.toLocaleDateString('es-CO', opts)} – ${sun.toLocaleDateString('es-CO', opts)} ${monday.getFullYear()}`;
}

const s = {
  page: { padding: 18, maxWidth: 900, margin: '0 auto' },
  header: { marginBottom: 14 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: 0 },
  sub: { fontSize: 13, color: 'var(--text-light)' },
  banner: { background: '#fffbe6', border: '1px solid #facc15', color: '#92400e', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 },
  weekNav: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 },
  navBtn: { padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 },
  card: { background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-light)', borderBottom: '1px solid var(--border)' },
  td: { padding: '8px 10px', borderBottom: '1px solid var(--border)' },
  pctInput: { width: 100, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, textAlign: 'right' },
  bar: { display: 'flex', height: 24, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', background: '#f0f0f0', marginTop: 14 },
  buttons: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 8 },
  btn: { padding: '8px 18px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnPrimary: { background: 'var(--purple-dark)', color: '#fff' },
  btnGhost: { background: '#fff', color: 'var(--text)', border: '1px solid var(--border)' },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#fff', borderRadius: 10, padding: 20, maxWidth: 420, width: '90%' },
};

export default function TimeTeam() {
  const [weekStart, setWeekStart] = useState(() => isoDate(startOfWeek(new Date())));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // entries: { [assignment_id]: string del input }
  const [entries, setEntries] = useState({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setSuccess('');
    try {
      const result = await apiGet(`/api/time-allocations?week_start=${weekStart}`);
      setData(result);
      const seed = {};
      result.allocations.forEach((a) => { seed[a.assignment_id] = String(a.pct); });
      setEntries(seed);
    } catch (e) { setError(e.message || 'Error cargando semana'); }
    finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  const totalPct = useMemo(() => {
    if (!data) return 0;
    let sum = 0;
    data.active_assignments.forEach((a) => {
      const v = entries[a.id];
      if (v !== '' && v != null && !isNaN(Number(v))) sum += Number(v);
    });
    return sum;
  }, [data, entries]);

  const overCap = totalPct > 100.0001;
  const benchPct = Math.max(0, 100 - totalPct);
  const totalColor = overCap ? 'var(--danger)' : totalPct >= 100 ? 'var(--success)' : 'var(--warning)';

  const navWeek = (deltaWeeks) => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + 7 * deltaWeeks);
    setWeekStart(isoDate(startOfWeek(d)));
  };
  const goCurrent = () => setWeekStart(isoDate(startOfWeek(new Date())));

  const setPct = (assignmentId, value) => {
    setEntries((e) => ({ ...e, [assignmentId]: value }));
  };

  const buildPayloadAllocations = () => {
    if (!data) return [];
    return data.active_assignments.map((a) => {
      const v = entries[a.id];
      const pct = v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v);
      return { assignment_id: a.id, pct };
    }).filter((e) => e.pct > 0);
  };

  const persist = async () => {
    if (overCap) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const result = await apiPut('/api/time-allocations/bulk', {
        week_start_date: weekStart,
        allocations: buildPayloadAllocations(),
      });
      const benchMsg = (result.warnings || []).find((w) => w.code === 'bench')?.message;
      setSuccess(benchMsg || `Semana guardada (100% asignado).`);
      // Resync con server (refleja IDs y posibles snaps de fecha).
      await load();
    } catch (e) {
      setError(e.message || 'Error guardando');
    } finally { setSaving(false); setConfirmOpen(false); }
  };

  const handleSaveClick = () => {
    if (overCap) return;
    if (totalPct < 99.9999) {
      setConfirmOpen(true); // requiere confirmación por bench
    } else {
      persist();
    }
  };

  if (loading) return <div style={s.page}>Cargando…</div>;
  if (!data) return <div style={s.page}>{error || 'Error'}</div>;

  const monday = new Date(data.week_start_date + 'T00:00:00');

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h2 style={s.title}>⏱ Tiempo semanal</h2>
        <div style={s.sub}>
          {data.employee.name} · semana del <strong>{fmtRangeES(monday)}</strong>
        </div>
      </div>

      <div style={s.banner}>
        Asigna el % de tu semana a cada proyecto activo. La suma debe ser ≤ 100%.
        Lo que falte para llegar a 100% se considera <strong>bench</strong> (tiempo no asignado a un cliente facturable).
      </div>

      <div style={s.weekNav}>
        <button type="button" onClick={() => navWeek(-1)} style={s.navBtn}>← Semana anterior</button>
        <button type="button" onClick={goCurrent} style={{ ...s.navBtn, fontWeight: 600 }}>Hoy</button>
        <button type="button" onClick={() => navWeek(1)} style={s.navBtn}>Siguiente →</button>
        <input type="date"
               value={weekStart}
               onChange={(e) => setWeekStart(e.target.value && isoDate(startOfWeek(new Date(e.target.value + 'T00:00:00'))))}
               style={{ ...s.navBtn, padding: '5px 8px' }}
               aria-label="Saltar a semana" />
      </div>

      {error && <div style={{ ...s.banner, background: '#fde8eb', borderColor: '#ef4444', color: '#b00020' }}>{error}</div>}
      {success && <div style={{ ...s.banner, background: '#e8f5ec', borderColor: '#10b981', color: '#065f46' }}>{success}</div>}

      <div style={s.card}>
        {data.active_assignments.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>
            No tienes asignaciones activas en esta semana. Tu tiempo está 100% en bench.
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Proyecto / Asignación</th>
                <th style={s.th}>Rol</th>
                <th style={{ ...s.th, textAlign: 'right' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {data.active_assignments.map((a) => (
                <tr key={a.id}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600 }}>{a.contract_name || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                      {a.contract_type ? <span style={{ textTransform: 'capitalize' }}>{a.contract_type}</span> : ''}
                      {a.weekly_hours ? ` · ${a.weekly_hours} h/sem planeadas` : ''}
                    </div>
                  </td>
                  <td style={s.td}>{a.role_title || '—'}</td>
                  <td style={s.td}>
                    <input
                      type="number" min="0" max="100" step="5"
                      value={entries[a.id] ?? ''}
                      onChange={(e) => setPct(a.id, e.target.value)}
                      placeholder="0"
                      style={s.pctInput}
                      aria-label={`% para ${a.contract_name}`}
                    />
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ ...s.td, fontWeight: 700 }}>Bench (sin asignar)</td>
                <td style={s.td}><span style={{ fontSize: 11, color: 'var(--text-light)' }}>derivado</span></td>
                <td style={{ ...s.td, textAlign: 'right', color: benchPct > 0 ? 'var(--warning)' : 'var(--text-light)', fontWeight: 700 }}>
                  {benchPct.toFixed(0)}%
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ ...s.td, fontWeight: 700 }}>TOTAL</td>
                <td style={{ ...s.td, textAlign: 'right' }}>
                  <span style={{ fontWeight: 700, color: totalColor }}>{totalPct.toFixed(0)}%</span>
                  {overCap && <span style={{ color: 'var(--danger)', fontSize: 11, marginLeft: 6 }}>✕ excede 100%</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        <div style={s.bar} aria-label="Distribución de la semana">
          {data.active_assignments.map((a, idx) => {
            const pct = Number(entries[a.id] || 0);
            if (pct <= 0) return null;
            const colors = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#84cc16'];
            const color = colors[idx % colors.length];
            return (
              <div key={a.id}
                   title={`${a.contract_name}: ${pct}%`}
                   style={{ width: `${Math.min(100, (pct / 100) * 100)}%`, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, overflow: 'hidden' }}>
                {pct >= 8 ? `${pct.toFixed(0)}%` : ''}
              </div>
            );
          })}
          {benchPct > 0 && (
            <div title={`Bench: ${benchPct.toFixed(0)}%`}
                 style={{ width: `${benchPct}%`, background: 'repeating-linear-gradient(45deg, #d4d4d8, #d4d4d8 6px, #e4e4e7 6px, #e4e4e7 12px)', color: '#52525b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>
              {benchPct >= 8 ? `bench ${benchPct.toFixed(0)}%` : ''}
            </div>
          )}
        </div>

        <div style={s.buttons}>
          <Link to="/time/me" style={{ fontSize: 12, color: 'var(--text-light)' }}>Ver registro diario en horas →</Link>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={saving || overCap || data.active_assignments.length === 0}
            title={overCap ? `La suma es ${totalPct.toFixed(2)}% — ajusta antes de guardar` : undefined}
            style={{ ...s.btn, ...s.btnPrimary, opacity: (saving || overCap || data.active_assignments.length === 0) ? 0.5 : 1, cursor: overCap ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Guardando…' : 'Guardar semana'}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <div style={s.modalBackdrop} onClick={() => setConfirmOpen(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--purple-dark)' }}>⚠ Tiempo en bench</h3>
            <p style={{ marginTop: 10, fontSize: 13 }}>
              Solo asignaste <strong>{totalPct.toFixed(0)}%</strong> de tu semana. El <strong>{benchPct.toFixed(0)}%</strong> restante quedará marcado como <strong>bench</strong> (tiempo no facturable).
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 6 }}>
              ¿Es correcto? Si se te olvidó algún proyecto, cancela y ajústalo. Si estabas formación, vacaciones, o realmente sin asignación, confirma.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setConfirmOpen(false)} style={{ ...s.btn, ...s.btnGhost }}>Cancelar</button>
              <button type="button" onClick={persist} disabled={saving} style={{ ...s.btn, ...s.btnPrimary, opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Guardando…' : `Confirmar (${benchPct.toFixed(0)}% en bench)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
