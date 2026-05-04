import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiV2';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';
import SortableTh from '../shell/SortableTh';
import { useSort } from '../utils/useSort';

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
  th:     dsTh,
  td:     dsTd,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  filters:{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'end' },
  modalBg:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 520, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

const SENIORITY_OPTIONS = [
  { value: '',         label: '—' },
  { value: 'c_level',  label: 'C-Level' },
  { value: 'vp',       label: 'VP' },
  { value: 'director', label: 'Director' },
  { value: 'manager',  label: 'Manager' },
  { value: 'senior',   label: 'Senior' },
  { value: 'mid',      label: 'Mid' },
  { value: 'junior',   label: 'Junior' },
  { value: 'intern',   label: 'Intern' },
];

const EMPTY = {
  client_id: '', first_name: '', last_name: '', job_title: '',
  email_primary: '', phone_mobile: '', seniority: '', notes: '',
};

function ContactForm({ initial, clients, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.first_name.trim()) return setErr('El nombre es requerido');
    if (!form.last_name.trim()) return setErr('El apellido es requerido');
    try {
      await onSave(form);
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar contacto' : 'Nuevo contacto'}
      </h2>
      <div>
        <label style={s.label}>Cliente</label>
        <select
          style={{ ...s.input, padding: '8px 10px' }}
          value={form.client_id || ''}
          onChange={(e) => set('client_id', e.target.value)}
        >
          <option value="">— Sin cliente —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Nombre *</label>
          <input style={s.input} value={form.first_name} onChange={(e) => set('first_name', e.target.value)} autoFocus required />
        </div>
        <div>
          <label style={s.label}>Apellido *</label>
          <input style={s.input} value={form.last_name} onChange={(e) => set('last_name', e.target.value)} required />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Cargo</label>
          <input style={s.input} value={form.job_title || ''} onChange={(e) => set('job_title', e.target.value)} placeholder="CTO, Director de TI…" />
        </div>
        <div>
          <label style={s.label}>Seniority</label>
          <select style={{ ...s.input, padding: '8px 10px' }} value={form.seniority || ''} onChange={(e) => set('seniority', e.target.value)}>
            {SENIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={form.email_primary || ''} onChange={(e) => set('email_primary', e.target.value)} placeholder="correo@ejemplo.com" />
        </div>
        <div>
          <label style={s.label}>Teléfono</label>
          <input style={s.input} value={form.phone_mobile || ''} onChange={(e) => set('phone_mobile', e.target.value)} placeholder="+52 55 1234 5678" />
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

export default function Contacts() {
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [seniority, setSeniority] = useState('');
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const sort = useSort({ field: 'first_name', dir: 'asc' });

  /* Load client list for dropdown */
  useEffect(() => {
    apiGet('/api/clients?limit=200')
      .then((r) => setClients(r.data || []))
      .catch(() => setClients([]));
  }, []);

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '20');
    if (search) qs.set('search', search);
    if (clientId) qs.set('client_id', clientId);
    if (seniority) qs.set('seniority', seniority);
    sort.applyToQs(qs);
    try {
      const r = await apiGet(`/api/contacts?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando contactos: ' + e.message);
    }
  }, [search, clientId, seniority, sort.field, sort.dir]);

  useEffect(() => { load(1); }, [load]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await apiPut(`/api/contacts/${editing.id}`, form);
      } else {
        await apiPost('/api/contacts', form);
      }
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (c) => {
    const name = `${c.first_name} ${c.last_name}`.trim();
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar contacto "${name}"? Esta acción es reversible (soft delete).`)) return;
    try {
      await apiDelete(`/api/contacts/${c.id}`);
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  const fmtDate = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return '—'; }
  };

  const seniorityLabel = (val) => {
    const found = SENIORITY_OPTIONS.find((o) => o.value === val);
    return found ? found.label : val || '—';
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>👤 Contactos</h1>
          <div style={s.sub}>Personas de contacto asociadas a clientes.</div>
        </div>
        <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nuevo Contacto
        </button>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input
              style={s.input}
              placeholder="Nombre o email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar contactos"
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Cliente</label>
            <select
              style={s.input}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Filtro por cliente"
            >
              <option value="">Todos</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Seniority</label>
            <select style={s.input} value={seniority} onChange={(e) => setSeniority(e.target.value)} aria-label="Filtro por seniority">
              {SENIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label || 'Todos'}</option>)}
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <SortableTh sort={sort} field="first_name" style={s.th}>Nombre</SortableTh>
                <SortableTh sort={sort} field="email_primary" style={s.th}>Email</SortableTh>
                <SortableTh sort={sort} field="job_title" style={s.th}>Cargo</SortableTh>
                <SortableTh sort={sort} field="seniority" style={s.th}>Seniority</SortableTh>
                <SortableTh sort={sort} field="client_name" style={s.th}>Cliente</SortableTh>
                <SortableTh sort={sort} field="created_at" style={s.th}>Creado</SortableTh>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay contactos que coincidan con los filtros.
                </td></tr>
              )}
              {state.data.map((c) => (
                <tr key={c.id} style={{ cursor: 'default' }}>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <Link to={`/contacts/${c.id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }} aria-label={`Ver ${c.first_name} ${c.last_name}`}>
                      {c.first_name} {c.last_name}
                    </Link>
                  </td>
                  <td style={s.td}>{c.email_primary || '—'}</td>
                  <td style={s.td}>{c.job_title || '—'}</td>
                  <td style={s.td}>
                    {c.seniority ? (
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                        background: ['c_level', 'vp'].includes(c.seniority) ? 'var(--purple-dark)' : ['director', 'manager'].includes(c.seniority) ? 'var(--teal-mid)' : 'var(--orange)',
                        color: '#fff',
                      }}>{seniorityLabel(c.seniority)}</span>
                    ) : '—'}
                  </td>
                  <td style={s.td}>
                    {c.client_id ? (
                      <Link to={`/clients/${c.client_id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }}>
                        {c.client_name || '—'}
                      </Link>
                    ) : '—'}
                  </td>
                  <td style={s.td}>{fmtDate(c.created_at)}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => { setEditing(c); setShowForm(true); }}
                            aria-label={`Editar ${c.first_name} ${c.last_name}`}>Editar</button>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={() => onDelete(c)}
                            aria-label={`Eliminar ${c.first_name} ${c.last_name}`}>Eliminar</button>
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
              Página {state.page} de {state.pages} · {state.total} contactos
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <ContactForm
              initial={editing}
              clients={clients}
              saving={saving}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSave={onSave}
            />
          </div>
        </div>
      )}
    </div>
  );
}
