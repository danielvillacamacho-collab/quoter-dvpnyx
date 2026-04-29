import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from '../utils/apiV2';
import { useAuth } from '../AuthContext';

/**
 * Novedades — SPEC-II-00.
 *
 * Lista + creación. Roles permitidos para crear: admin, lead, capacity.
 * Empleados solo ven las propias.
 */

const ds = {
  page: { maxWidth: 1100, margin: '0 auto', padding: 16 },
  h1: { fontSize: 24, fontFamily: 'Montserrat', margin: '0 0 6px', color: 'var(--ds-text)' },
  sub: { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 16 },
  card: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  filterRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 },
  input: { padding: '6px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13 },
  btn: { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: 'var(--ds-accent)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 12px)', padding: 24, width: 540, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', color: 'var(--ds-text)' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 4, display: 'block' },
  pill: (bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: bg, color: '#fff', fontSize: 11, fontWeight: 600 }),
};

const TYPE_ICONS = {
  vacation: '🏖', sick_leave: '🏥', parental_leave: '👶', unpaid_leave: '💼',
  bereavement: '💔', legal_leave: '⚖️', corporate_training: '🎓', unavailable_other: '❓',
};

function fmtDateRange(s, e) {
  if (!s) return '—';
  if (!e || s === e) return s;
  return `${s} → ${e}`;
}

function dayCount(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start + 'T00:00:00Z');
  const b = new Date(end + 'T00:00:00Z');
  return Math.round((b - a) / 86400000) + 1;
}

function CreateModal({ types, onClose, onSaved }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    employee_id: '', novelty_type_id: 'vacation',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    reason: '', attachment_url: '', attachment_note: '',
  });
  const [warnings, setWarnings] = useState([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet('/api/employees?limit=200').then((r) => {
      if (alive) setEmployees(r?.data || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Cuando cambia empleado o fechas, traemos calendario para detectar overlaps.
  useEffect(() => {
    if (!form.employee_id || !form.start_date || !form.end_date) return;
    let alive = true;
    apiGet(`/api/novelties/calendar/${form.employee_id}?from=${form.start_date}&to=${form.end_date}`)
      .then((r) => {
        if (!alive || !r) return;
        const w = [];
        if ((r.novelties || []).length) {
          w.push(`Ya tiene ${r.novelties.length} novedad(es) aprobada(s) en este rango — el sistema rechazará el overlap.`);
        }
        const totalAssign = (r.contract_assignments || []).length + (r.internal_assignments || []).length;
        if (totalAssign > 0) {
          w.push(`Tiene ${totalAssign} asignación(es) activa(s) en este período. Considera reasignar.`);
        }
        setWarnings(w);
      }).catch(() => {});
    return () => { alive = false; };
  }, [form.employee_id, form.start_date, form.end_date]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const selectedType = types.find((t) => t.id === form.novelty_type_id);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const payload = {
        employee_id: form.employee_id,
        novelty_type_id: form.novelty_type_id,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason || undefined,
        attachment_url: form.attachment_url || undefined,
        attachment_note: form.attachment_note || undefined,
      };
      const created = await apiPost('/api/novelties', payload);
      onSaved(created);
    } catch (ex) {
      if (ex.body && ex.body.error === 'overlap_detected') {
        setErr('Esta persona ya tiene una novedad aprobada en este rango.');
      } else {
        setErr(ex.message || 'Error guardando');
      }
    } finally { setSaving(false); }
  };

  return (
    <div style={ds.modalBg} onClick={onClose}>
      <div style={ds.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 16px' }}>Registrar novedad</h2>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={ds.label}>Empleado *</label>
            <select style={ds.input} value={form.employee_id} onChange={(e) => set('employee_id', e.target.value)} required>
              <option value="">— seleccionar —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} · {e.country}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={ds.label}>Tipo *</label>
            <select style={ds.input} value={form.novelty_type_id} onChange={(e) => set('novelty_type_id', e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{TYPE_ICONS[t.id] || ''} {t.label_es}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Inicio *</label>
              <input style={ds.input} type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
            </div>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Fin *</label>
              <input style={ds.input} type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} required min={form.start_date} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ds-text-soft, var(--text-light))' }}>
            {dayCount(form.start_date, form.end_date)} días calendario
          </div>
          {selectedType && selectedType.requires_attachment_recommended && (
            <div style={{ fontSize: 12, color: 'var(--ds-warn, #f59e0b)' }}>
              ℹ Para este tipo de novedad se recomienda adjuntar certificado.
            </div>
          )}
          {warnings.length > 0 && (
            <div style={{ background: 'var(--ds-warn-soft, rgba(245,158,11,0.1))', border: '1px solid var(--ds-warn, #f59e0b)', padding: 8, borderRadius: 6, fontSize: 12 }}>
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          <div>
            <label style={ds.label}>Razón (opcional)</label>
            <textarea style={{ ...ds.input, minHeight: 50, resize: 'vertical' }} value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          </div>
          <div>
            <label style={ds.label}>URL de adjunto (Drive/SharePoint)</label>
            <input style={ds.input} type="url" value={form.attachment_url} onChange={(e) => set('attachment_url', e.target.value)} placeholder="https://drive.google.com/..." />
          </div>
          {err && <div style={{ color: 'var(--ds-bad, #ef4444)', fontSize: 12 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} style={ds.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={ds.btn}>{saving ? 'Guardando…' : 'Crear y aprobar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Novelties() {
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const canMutate = isAdmin || auth.user?.role === 'lead' || auth.user?.function === 'capacity';
  const [items, setItems] = useState([]);
  const [types, setTypes] = useState([]);
  const [filter, setFilter] = useState({ status: 'approved', novelty_type_id: '', from_date: '', to_date: '' });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      if (filter.novelty_type_id) params.set('novelty_type_id', filter.novelty_type_id);
      if (filter.from_date) params.set('from_date', filter.from_date);
      if (filter.to_date) params.set('to_date', filter.to_date);
      params.set('limit', '50');
      const data = await apiGet(`/api/novelties?${params.toString()}`);
      setItems(data?.data || []);
    } catch (ex) { setErr(ex.message || 'Error'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => {
    let alive = true;
    apiGet('/api/novelties/_meta/types').then((r) => {
      if (alive) setTypes(r?.data || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id) => {
    const reason = window.prompt('Razón de cancelación (≥5 chars):');
    if (!reason || reason.length < 5) return;
    try {
      await apiPost(`/api/novelties/${id}/cancel`, { cancellation_reason: reason });
      load();
    } catch (ex) { alert(ex.message || 'Error'); }
  };

  return (
    <div style={ds.page}>
      <h1 style={ds.h1}>🟢 Novedades</h1>
      <div style={ds.sub}>
        Vacaciones, incapacidades, capacitaciones y demás ausencias del equipo.
        Solo lead/capacity/admin pueden registrar.
      </div>

      <div style={ds.filterRow}>
        <select style={ds.input} value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
          <option value="">Todos</option>
          <option value="approved">Aprobadas</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <select style={ds.input} value={filter.novelty_type_id} onChange={(e) => setFilter((f) => ({ ...f, novelty_type_id: e.target.value }))}>
          <option value="">Todos los tipos</option>
          {types.map((t) => <option key={t.id} value={t.id}>{TYPE_ICONS[t.id] || ''} {t.label_es}</option>)}
        </select>
        <input style={ds.input} type="date" value={filter.from_date} onChange={(e) => setFilter((f) => ({ ...f, from_date: e.target.value }))} />
        <input style={ds.input} type="date" value={filter.to_date} onChange={(e) => setFilter((f) => ({ ...f, to_date: e.target.value }))} />
        <div style={{ flex: 1 }} />
        {canMutate && (
          <button style={ds.btn} onClick={() => setShowCreate(true)}>+ Registrar novedad</button>
        )}
      </div>

      {loading && <div>Cargando…</div>}
      {err && <div style={{ color: 'var(--ds-bad, #ef4444)' }}>{err}</div>}
      {!loading && items.length === 0 && (
        <div style={ds.card}><div style={{ color: 'var(--ds-text-soft)' }}>Sin novedades.</div></div>
      )}

      {items.map((n) => (
        <div key={n.id} style={ds.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {TYPE_ICONS[n.novelty_type_id] || ''} {n.novelty_type_label}
                {n.status === 'cancelled' && <span style={{ ...ds.pill('#9ca3af'), marginLeft: 8 }}>cancelada</span>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginTop: 2 }}>
                <b>{n.first_name} {n.last_name}</b> · {fmtDateRange(n.start_date, n.end_date)} ({dayCount(n.start_date, n.end_date)} días)
                {n.country && <span> · {n.country}</span>}
              </div>
              {n.reason && (
                <div style={{ fontSize: 12, marginTop: 4, color: 'var(--ds-text-soft, var(--text-light))' }}>{n.reason}</div>
              )}
              {n.attachment_url && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  📎 <a href={n.attachment_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ds-accent)' }}>
                    Adjunto
                  </a>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--ds-text-soft)', marginTop: 4 }}>
                Aprobada por {n.approved_by_name || '—'} el {(n.approved_at || '').slice(0, 10)}
              </div>
            </div>
            {canMutate && n.status === 'approved' && (
              <button style={ds.btnGhost} onClick={() => cancel(n.id)}>Cancelar</button>
            )}
          </div>
        </div>
      ))}

      {showCreate && (
        <CreateModal types={types} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />
      )}
    </div>
  );
}
