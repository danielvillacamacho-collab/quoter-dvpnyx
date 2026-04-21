import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiV2';

/* ========== styles ========== */
const s = {
  page:   { maxWidth: 1200, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  input:  { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none' },
  label:  { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th:     { padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:     { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  filters:{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'end' },
  modalBg:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 520, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

const TIERS = [
  { value: '',           label: '—' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'mid_market', label: 'Mid Market' },
  { value: 'smb',        label: 'SMB' },
];

// Países de Latinoamérica en orden alfabético (incluye Caribe hispano + Brasil).
const LATAM_COUNTRIES = [
  'Argentina', 'Belice', 'Bolivia', 'Brasil', 'Chile', 'Colombia', 'Costa Rica',
  'Cuba', 'Ecuador', 'El Salvador', 'Guatemala', 'Guyana', 'Haití', 'Honduras',
  'México', 'Nicaragua', 'Panamá', 'Paraguay', 'Perú', 'Puerto Rico',
  'República Dominicana', 'Surinam', 'Uruguay', 'Venezuela',
];

const EMPTY = {
  name: '', legal_name: '', country: '', industry: '', tier: '',
  preferred_currency: 'USD', notes: '', tags: [],
};

function ClientForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) return setErr('El nombre es requerido');
    try {
      await onSave(form);
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar cliente' : 'Nuevo cliente'}
      </h2>
      <div>
        <label style={s.label}>Nombre *</label>
        <input style={s.input} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus required />
      </div>
      <div>
        <label style={s.label}>Nombre legal</label>
        <input style={s.input} value={form.legal_name || ''} onChange={(e) => set('legal_name', e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>País</label>
          <select
            style={{ ...s.input, padding: '8px 10px' }}
            value={form.country || ''}
            onChange={(e) => set('country', e.target.value)}
          >
            <option value="">—</option>
            {LATAM_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Industria</label>
          <input style={s.input} value={form.industry || ''} onChange={(e) => set('industry', e.target.value)} placeholder="Banca, Retail…" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Tier</label>
          <select style={{ ...s.input, padding: '8px 10px' }} value={form.tier || ''} onChange={(e) => set('tier', e.target.value)}>
            {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Moneda</label>
          <input style={s.input} value={form.preferred_currency || 'USD'} onChange={(e) => set('preferred_currency', e.target.value.toUpperCase())} maxLength={3} />
        </div>
      </div>
      <div>
        <label style={s.label}>Notas</label>
        <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

export default function Clients() {
  const nav = useNavigate();
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [tier, setTier] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (search) qs.set('search', search);
    if (country) qs.set('country', country);
    if (tier) qs.set('tier', tier);
    if (activeOnly) qs.set('active', 'true');
    try {
      const r = await apiGet(`/api/clients?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando clientes: ' + e.message);
    }
  }, [search, country, tier, activeOnly]);

  useEffect(() => { load(1); }, [load]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await apiPut(`/api/clients/${editing.id}`, form);
      } else {
        await apiPost('/api/clients', form);
      }
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (c) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar cliente "${c.name}"? Esta acción es reversible (soft delete).`)) return;
    try {
      await apiDelete(`/api/clients/${c.id}`);
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  const onToggleActive = async (c) => {
    const endpoint = c.active ? 'deactivate' : 'activate';
    try {
      await apiPost(`/api/clients/${c.id}/${endpoint}`, {});
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>🏢 Clientes</h1>
          <div style={s.sub}>Cuentas a las que DVPNYX presta servicios.</div>
        </div>
        <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nuevo Cliente
        </button>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input
              style={s.input}
              placeholder="Nombre o razón social"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar clientes"
            />
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>País</label>
            <select
              style={s.input}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              aria-label="Filtro por país"
            >
              <option value="">Todos</option>
              {LATAM_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Tier</label>
            <select style={s.input} value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Filtro por tier">
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label || 'Todos'}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-light)' }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Sólo activos
          </label>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                {['Nombre', 'País', 'Industria', 'Tier', 'Oportunidades', 'Contratos activos', 'Estado', ''].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay clientes que coincidan con los filtros.
                </td></tr>
              )}
              {state.data.map((c) => (
                <tr key={c.id} style={{ cursor: 'default' }}>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <Link to={`/clients/${c.id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }} aria-label={`Ver ${c.name}`}>{c.name}</Link>
                    {c.legal_name && <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{c.legal_name}</div>}
                  </td>
                  <td style={s.td}>{c.country || '—'}</td>
                  <td style={s.td}>{c.industry || '—'}</td>
                  <td style={s.td}>
                    {c.tier ? (
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                        background: c.tier === 'enterprise' ? 'var(--purple-dark)' : c.tier === 'mid_market' ? 'var(--teal-mid)' : 'var(--orange)',
                        color: '#fff',
                      }}>{c.tier}</span>
                    ) : '—'}
                  </td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{c.opportunities_count ?? 0}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{c.active_contracts_count ?? 0}</td>
                  <td style={s.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: c.active ? 'var(--success)' : 'var(--text-light)', color: '#fff',
                    }}>{c.active ? 'Activo' : 'Inactivo'}</span>
                  </td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => { setEditing(c); setShowForm(true); }}
                            aria-label={`Editar ${c.name}`}>Editar</button>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => onToggleActive(c)}
                            aria-label={`${c.active ? 'Desactivar' : 'Activar'} ${c.name}`}>
                      {c.active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={() => onDelete(c)}
                            aria-label={`Eliminar ${c.name}`}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {state.pages > 1 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <button style={s.btnOutline} disabled={state.page <= 1} onClick={() => load(state.page - 1)}>← Anterior</button>
            <span style={{ fontSize: 13, color: 'var(--text-light)' }}>
              Página {state.page} de {state.pages} · {state.total} clientes
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <ClientForm
              initial={editing}
              saving={saving}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSave={onSave}
            />
          </div>
        </div>
      )}

      {/* Keep nav hint alive (breadcrumb handles its own link) */}
      <button type="button" onClick={() => nav('/')} style={{ display: 'none' }} aria-hidden="true" />
    </div>
  );
}
