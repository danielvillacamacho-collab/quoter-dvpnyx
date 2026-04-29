import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/apiV2';
import { useAuth } from '../AuthContext';

/**
 * Iniciativas Internas — SPEC-II-00.
 *
 * Lista filtrable + modal de creación (admin). Cada card linkea a
 * /internal-initiatives/:id (vista 360).
 */

const ds = {
  page:  { maxWidth: 1200, margin: '0 auto', padding: 16 },
  h1:    { fontSize: 24, color: 'var(--ds-accent, var(--purple-dark))', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:   { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 16 },
  card:  { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  filterRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 },
  input: { padding: '6px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13 },
  btn:   { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: 'var(--ds-accent)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  pill: (bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: bg, color: '#fff', fontSize: 11, fontWeight: 600 }),
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 12px)', padding: 24, width: 540, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', color: 'var(--ds-text)' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 4, display: 'block' },
  badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: '#A855F7', color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: 0.4 },
  progressTrack: { width: '100%', height: 6, background: 'var(--ds-border)', borderRadius: 3, overflow: 'hidden' },
  progressFill: (pct) => ({ width: `${Math.min(100, Math.max(0, pct * 100))}%`, height: '100%', background: pct > 1 ? 'var(--ds-bad, #ef4444)' : pct > 0.8 ? 'var(--ds-warn, #f59e0b)' : 'var(--ds-accent, #A855F7)' }),
};

const STATUS_TONES = {
  active:    { bg: '#10b981', label: 'Activa' },
  paused:    { bg: '#f59e0b', label: 'En pausa' },
  completed: { bg: '#3b82f6', label: 'Completada' },
  cancelled: { bg: '#9ca3af', label: 'Cancelada' },
};

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function CreateModal({ areas, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', description: '', business_area_id: 'product',
    budget_usd: '', hours_estimated: '', start_date: new Date().toISOString().slice(0, 10),
    target_end_date: '', operations_owner_id: '',
  });
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet('/api/users')
      .then((r) => { if (alive) setUsers(r?.data || r || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || undefined,
        business_area_id: form.business_area_id,
        budget_usd: Number(form.budget_usd),
        hours_estimated: form.hours_estimated ? Number(form.hours_estimated) : 0,
        start_date: form.start_date,
        target_end_date: form.target_end_date || undefined,
        operations_owner_id: form.operations_owner_id,
      };
      const created = await apiPost('/api/internal-initiatives', payload);
      onSaved(created);
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    } finally { setSaving(false); }
  };

  return (
    <div style={ds.modalBg} onClick={onClose}>
      <div style={ds.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 16px', color: 'var(--ds-accent)' }}>Nueva iniciativa interna</h2>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={ds.label}>Nombre *</label>
            <input style={ds.input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Construir el Quoter v3" required minLength={5} maxLength={255} />
          </div>
          <div>
            <label style={ds.label}>Descripción</label>
            <textarea style={{ ...ds.input, minHeight: 60, resize: 'vertical' }} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Área *</label>
              <select style={ds.input} value={form.business_area_id} onChange={(e) => set('business_area_id', e.target.value)}>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.label_es}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Operations owner *</label>
              <select style={ds.input} value={form.operations_owner_id} onChange={(e) => set('operations_owner_id', e.target.value)} required>
                <option value="">— seleccionar —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Presupuesto USD *</label>
              <input style={ds.input} type="number" min="0" step="100" value={form.budget_usd} onChange={(e) => set('budget_usd', e.target.value)} required />
            </div>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Horas estimadas</label>
              <input style={ds.input} type="number" min="0" step="10" value={form.hours_estimated} onChange={(e) => set('hours_estimated', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Inicio *</label>
              <input style={ds.input} type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
            </div>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Target fin</label>
              <input style={ds.input} type="date" value={form.target_end_date} onChange={(e) => set('target_end_date', e.target.value)} />
            </div>
          </div>
          {err && <div style={{ color: 'var(--ds-bad, #ef4444)', fontSize: 12 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={ds.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={ds.btn}>{saving ? 'Guardando…' : 'Crear'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function InternalInitiatives() {
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const [items, setItems] = useState([]);
  const [areas, setAreas] = useState([]);
  const [filter, setFilter] = useState({ status: 'active', business_area: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      if (filter.business_area) params.set('business_area', filter.business_area);
      if (filter.search) params.set('search', filter.search);
      params.set('limit', '50');
      const data = await apiGet(`/api/internal-initiatives?${params.toString()}`);
      setItems(data?.data || []);
    } catch (ex) {
      setErr(ex.message || 'Error');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    // Lookup business_areas vía un GET genérico — el backend no expone
    // /api/business-areas, pero la lista es estática (6 entries del seed).
    // Hardcodeamos el catálogo aquí; si crece, exponemos endpoint.
    if (alive) setAreas([
      { id: 'product',     label_es: 'Producto' },
      { id: 'operations',  label_es: 'Operaciones' },
      { id: 'hr',          label_es: 'RRHH' },
      { id: 'finance',     label_es: 'Finanzas' },
      { id: 'commercial',  label_es: 'Comercial' },
      { id: 'technology',  label_es: 'Tecnología' },
    ]);
    return () => { alive = false; };
  }, []);

  const totals = items.reduce((acc, ii) => {
    acc.budget += Number(ii.budget_usd || 0);
    acc.consumed += Number(ii.consumed_usd || 0);
    acc.assignments += Number(ii.assignments_count || 0);
    return acc;
  }, { budget: 0, consumed: 0, assignments: 0 });

  return (
    <div style={ds.page}>
      <h1 style={ds.h1}>
        <span style={{ ...ds.badge, marginRight: 8 }}>II</span>
        Iniciativas Internas
      </h1>
      <div style={ds.sub}>
        Iniciativas internas no facturables. Trazabilidad de costo USD y horas
        invertidas. Solo admins crean nuevas iniciativas.
      </div>

      {!loading && items.length > 0 && (
        <div style={{ ...ds.card, display: 'flex', gap: 24, fontSize: 13 }}>
          <div><b>{items.length}</b> iniciativas</div>
          <div>Presupuesto: <b>{fmtMoney(totals.budget)}</b></div>
          <div>Consumido: <b>{fmtMoney(totals.consumed)}</b></div>
          <div>Personas asignadas: <b>{totals.assignments}</b></div>
        </div>
      )}

      <div style={ds.filterRow}>
        <select style={ds.input} value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
          <option value="">Todos los estados</option>
          <option value="active">Activas</option>
          <option value="paused">En pausa</option>
          <option value="completed">Completadas</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <select style={ds.input} value={filter.business_area} onChange={(e) => setFilter((f) => ({ ...f, business_area: e.target.value }))}>
          <option value="">Todas las áreas</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.label_es}</option>)}
        </select>
        <input style={ds.input} placeholder="Buscar…" value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} />
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <button style={ds.btn} onClick={() => setShowCreate(true)}>+ Nueva iniciativa</button>
        )}
      </div>

      {loading && <div>Cargando…</div>}
      {err && <div style={{ color: 'var(--ds-bad, #ef4444)' }}>{err}</div>}
      {!loading && items.length === 0 && (
        <div style={ds.card}>
          <div style={{ fontSize: 14, color: 'var(--ds-text-soft, var(--text-light))' }}>
            No hay iniciativas que coincidan con los filtros.
          </div>
        </div>
      )}

      {items.map((ii) => {
        const status = STATUS_TONES[ii.status] || STATUS_TONES.active;
        const pct = Number(ii.budget_usd) > 0 ? Number(ii.consumed_usd) / Number(ii.budget_usd) : 0;
        return (
          <Link key={ii.id} to={`/internal-initiatives/${ii.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={ds.card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={ds.badge}>{ii.initiative_code}</span>
                <span style={ds.pill(status.bg)}>{status.label}</span>
                <span style={{ fontSize: 12, color: 'var(--ds-text-soft, var(--text-light))' }}>
                  {ii.business_area_label || ii.business_area_id}
                </span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{ii.name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <span>Owner: <b>{ii.operations_owner_name || '—'}</b></span>
                <span>Asignados: <b>{ii.assignments_count}</b></span>
              </div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                {fmtMoney(ii.consumed_usd)} de {fmtMoney(ii.budget_usd)} ({Math.round(pct * 100)}%)
              </div>
              <div style={ds.progressTrack}><div style={ds.progressFill(pct)} /></div>
            </div>
          </Link>
        );
      })}

      {showCreate && (
        <CreateModal
          areas={areas}
          onClose={() => setShowCreate(false)}
          onSaved={(_created) => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}
