import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiGet, apiPost, apiDelete } from '../utils/apiV2';
import { useAuth } from '../AuthContext';

/**
 * Iniciativa Interna — vista 360 con asignaciones, métricas y acciones.
 */

const ds = {
  page: { maxWidth: 1100, margin: '0 auto', padding: 16 },
  card: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  h1: { fontSize: 22, fontFamily: 'Montserrat', margin: '0 0 4px', color: 'var(--ds-text)' },
  badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: '#A855F7', color: '#fff', fontSize: 10, fontWeight: 700 },
  pill: (bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: bg, color: '#fff', fontSize: 11, fontWeight: 600 }),
  btn: { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: 'var(--ds-accent)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  btnDanger: { background: 'var(--ds-bad, #ef4444)', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 12 },
  input: { padding: '6px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13 },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 12px)', padding: 24, width: 480, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', color: 'var(--ds-text)' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 4, display: 'block' },
  row: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--ds-border)' },
  progressTrack: { width: '100%', height: 8, background: 'var(--ds-border)', borderRadius: 4, overflow: 'hidden' },
  progressFill: (pct) => ({ width: `${Math.min(100, Math.max(0, pct * 100))}%`, height: '100%', background: pct > 1 ? 'var(--ds-bad, #ef4444)' : pct > 0.8 ? 'var(--ds-warn, #f59e0b)' : 'var(--ds-accent, #A855F7)' }),
};

const STATUS_TONES = {
  active:    { bg: '#10b981', label: 'Activa' },
  paused:    { bg: '#f59e0b', label: 'En pausa' },
  completed: { bg: '#3b82f6', label: 'Completada' },
  cancelled: { bg: '#9ca3af', label: 'Cancelada' },
};

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function AssignModal({ initiativeId, onClose, onSaved }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employee_id: '', start_date: new Date().toISOString().slice(0, 10), end_date: '', weekly_hours: '', role_description: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet('/api/employees?limit=200').then((r) => {
      if (alive) setEmployees(r?.data || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const created = await apiPost(`/api/internal-initiatives/${initiativeId}/assignments`, {
        employee_id: form.employee_id,
        start_date: form.start_date,
        end_date: form.end_date || undefined,
        weekly_hours: Number(form.weekly_hours),
        role_description: form.role_description || undefined,
      });
      onSaved(created);
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    } finally { setSaving(false); }
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={ds.modalBg} onClick={onClose}>
      <div style={ds.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 16px' }}>Asignar persona</h2>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={ds.label}>Empleado *</label>
            <select style={ds.input} value={form.employee_id} onChange={(e) => set('employee_id', e.target.value)} required>
              <option value="">— seleccionar —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} · {e.level}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Inicio *</label>
              <input style={ds.input} type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
            </div>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Fin</label>
              <input style={ds.input} type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Horas/sem *</label>
              <input style={ds.input} type="number" min="0.5" max="80" step="0.5" value={form.weekly_hours} onChange={(e) => set('weekly_hours', e.target.value)} required />
            </div>
          </div>
          <div>
            <label style={ds.label}>Rol (opcional)</label>
            <input style={ds.input} value={form.role_description} onChange={(e) => set('role_description', e.target.value)} placeholder="Senior Backend Engineer" />
          </div>
          {err && <div style={{ color: 'var(--ds-bad, #ef4444)', fontSize: 12 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} style={ds.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={ds.btn}>{saving ? 'Guardando…' : 'Asignar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function InternalInitiativeDetail() {
  const { id } = useParams();
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d = await apiGet(`/api/internal-initiatives/${id}`);
      setData(d);
    } catch (ex) { setErr(ex.message || 'Error'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const transition = async (to_status) => {
    let reason = null;
    if (to_status === 'cancelled') {
      reason = window.prompt('Razón para cancelar (≥5 chars):');
      if (!reason || reason.length < 5) return;
    }
    try {
      await apiPost(`/api/internal-initiatives/${id}/transitions`, { to_status, reason });
      load();
    } catch (ex) { alert(ex.message || 'Error'); }
  };

  const remove = async () => {
    const reason = window.prompt('Razón de eliminación (auditoría):');
    if (reason == null) return;
    try {
      await apiDelete(`/api/internal-initiatives/${id}`);
      window.history.back();
    } catch (ex) { alert(ex.message || 'Error'); }
  };

  if (loading) return <div style={ds.page}>Cargando…</div>;
  if (err) return <div style={ds.page}><div style={ds.card}>{err}</div></div>;
  if (!data) return <div style={ds.page}>No encontrado</div>;

  const status = STATUS_TONES[data.status] || STATUS_TONES.active;
  const owner = data.operations_owner_id === auth.user?.id;
  const canEdit = isAdmin || owner;
  const isTerminal = ['completed', 'cancelled'].includes(data.status);
  const m = data.metrics || {};
  const pct = Number(m.budget_consumed_pct || 0);

  return (
    <div style={ds.page}>
      <Link to="/internal-initiatives" style={{ fontSize: 13, color: 'var(--ds-accent)' }}>← Volver</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4 }}>
        <span style={ds.badge}>{data.initiative_code}</span>
        <span style={ds.pill(status.bg)}>{status.label}</span>
      </div>
      <h1 style={ds.h1}>{data.name}</h1>
      <div style={{ fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 16 }}>
        {data.business_area_label} · Owner: <b>{data.operations_owner_name || '—'}</b>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {canEdit && !isTerminal && (
          <button style={ds.btn} onClick={() => setShowAssign(true)}>+ Asignar persona</button>
        )}
        {isAdmin && data.status === 'active' && (
          <button style={ds.btnGhost} onClick={() => transition('paused')}>Pausar</button>
        )}
        {isAdmin && data.status === 'paused' && (
          <button style={ds.btnGhost} onClick={() => transition('active')}>Reactivar</button>
        )}
        {isAdmin && !isTerminal && (
          <>
            <button style={ds.btnGhost} onClick={() => transition('completed')}>Marcar completada</button>
            <button style={ds.btnDanger} onClick={() => transition('cancelled')}>Cancelar</button>
            <button style={ds.btnDanger} onClick={remove}>Eliminar</button>
          </>
        )}
      </div>

      <div style={ds.card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--ds-text)' }}>💰 Presupuesto</h3>
        <div style={{ marginBottom: 8 }}>
          <b>{fmtMoney(m.consumed_usd)}</b> de {fmtMoney(data.budget_usd)} consumidos ({Math.round(pct * 100)}%)
        </div>
        <div style={ds.progressTrack}><div style={ds.progressFill(pct)} /></div>
        <div style={{ fontSize: 12, marginTop: 8, color: 'var(--ds-text-soft, var(--text-light))' }}>
          Restante: <b>{fmtMoney(m.budget_remaining_usd)}</b> · Horas: {Number(m.hours_consumed || 0).toFixed(1)}h consumidas / {Number(data.hours_estimated || 0)}h planeadas
        </div>
        {pct > 1 && (
          <div style={{ color: 'var(--ds-bad, #ef4444)', fontSize: 12, marginTop: 8, fontWeight: 600 }}>
            ⚠ Presupuesto superado. Considere aumentar budget_usd o cerrar la iniciativa.
          </div>
        )}
      </div>

      <div style={ds.card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>📅 Fechas</h3>
        <div style={ds.row}><span>Inicio</span><b>{data.start_date}</b></div>
        <div style={ds.row}><span>Target fin</span><b>{data.target_end_date || '—'}</b></div>
        <div style={ds.row}><span>Fin real</span><b>{data.actual_end_date || '—'}</b></div>
      </div>

      <div style={ds.card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>👥 Asignaciones ({(data.assignments || []).length})</h3>
        {(data.assignments || []).length === 0 ? (
          <div style={{ color: 'var(--ds-text-soft, var(--text-light))', fontSize: 13 }}>Sin asignaciones aún.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>Empleado</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>Rol</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>Periodo</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>h/sem</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>$/h</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {(data.assignments || []).map((a) => (
                <tr key={a.id}>
                  <td style={{ padding: '6px 4px' }}>
                    {a.first_name} {a.last_name}
                    {a.level && <span style={{ color: 'var(--ds-text-soft)', marginLeft: 6, fontSize: 11 }}>{a.level}</span>}
                  </td>
                  <td style={{ padding: '6px 4px' }}>{a.role_description || '—'}</td>
                  <td style={{ padding: '6px 4px' }}>{a.start_date} → {a.end_date || 'abierto'}</td>
                  <td style={{ padding: '6px 4px' }}>{Number(a.weekly_hours).toFixed(1)}</td>
                  <td style={{ padding: '6px 4px' }}>
                    {a.hourly_rate_usd != null
                      ? `$${Number(a.hourly_rate_usd).toFixed(2)}`
                      : <span style={{ color: 'var(--ds-warn, #f59e0b)' }}>sin tarifa</span>}
                  </td>
                  <td style={{ padding: '6px 4px' }}>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAssign && (
        <AssignModal
          initiativeId={id}
          onClose={() => setShowAssign(false)}
          onSaved={() => { setShowAssign(false); load(); }}
        />
      )}
    </div>
  );
}
