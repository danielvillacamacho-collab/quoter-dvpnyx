import React, { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

/* ========== activity types ========== */
const ACTIVITY_TYPES = [
  { value: 'call',          label: 'Llamada' },
  { value: 'email',         label: 'Email' },
  { value: 'meeting',       label: 'Reunión' },
  { value: 'note',          label: 'Nota' },
  { value: 'proposal_sent', label: 'Propuesta enviada' },
  { value: 'demo',          label: 'Demo' },
  { value: 'follow_up',     label: 'Seguimiento' },
  { value: 'other',         label: 'Otro' },
];

const TYPE_LABEL = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.value, t.label]));

const TYPE_COLORS = {
  call:          '#4A90D9',
  email:         '#7B68EE',
  meeting:       '#2EAD7E',
  note:          '#8A8A8A',
  proposal_sent: '#E07C3A',
  demo:          '#C94A7B',
  follow_up:     '#D4A843',
  other:         '#6B6B6B',
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  activity_type: 'call',
  subject: '',
  notes: '',
  activity_date: today(),
  opportunity_id: '',
  client_id: '',
  contact_id: '',
};

/* ========== form ========== */
function ActivityForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const [opportunities, setOpportunities] = useState([]);
  const [clients, setClients] = useState([]);
  const [contacts, setContacts] = useState([]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /* Load opportunities + clients for selectors */
  useEffect(() => {
    apiGet('/api/opportunities?limit=200').then((r) => setOpportunities(r.data || [])).catch(() => {});
    apiGet('/api/clients?limit=200').then((r) => setClients(r.data || [])).catch(() => {});
  }, []);

  /* Load contacts when client changes */
  useEffect(() => {
    if (!form.client_id) { setContacts([]); return; }
    apiGet(`/api/contacts/by-client/${form.client_id}`).then((r) => setContacts(r.data || [])).catch(() => setContacts([]));
  }, [form.client_id]);

  /* Reset contact when client changes */
  const handleClientChange = (clientId) => {
    set('client_id', clientId);
    setForm((f) => ({ ...f, client_id: clientId, contact_id: '' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.activity_type) return setErr('Tipo de actividad es requerido');
    if (!form.subject.trim()) return setErr('Asunto es requerido');
    const payload = {
      activity_type: form.activity_type,
      subject: form.subject.trim(),
      notes: form.notes || '',
      activity_date: form.activity_date || today(),
      opportunity_id: form.opportunity_id || null,
      client_id: form.client_id || null,
      contact_id: form.contact_id || null,
    };
    try {
      await onSave(payload);
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar actividad' : 'Nueva actividad'}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Tipo *</label>
          <select
            style={{ ...s.input, padding: '8px 10px' }}
            value={form.activity_type}
            onChange={(e) => set('activity_type', e.target.value)}
            required
          >
            {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Fecha</label>
          <input
            type="date"
            style={s.input}
            value={form.activity_date || ''}
            onChange={(e) => set('activity_date', e.target.value)}
          />
        </div>
      </div>
      <div>
        <label style={s.label}>Asunto *</label>
        <input style={s.input} value={form.subject} onChange={(e) => set('subject', e.target.value)} autoFocus required />
      </div>
      <div>
        <label style={s.label}>Notas</label>
        <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Oportunidad</label>
          <select
            style={{ ...s.input, padding: '8px 10px' }}
            value={form.opportunity_id || ''}
            onChange={(e) => set('opportunity_id', e.target.value)}
          >
            <option value="">— Ninguna —</option>
            {opportunities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Cliente</label>
          <select
            style={{ ...s.input, padding: '8px 10px' }}
            value={form.client_id || ''}
            onChange={(e) => handleClientChange(e.target.value)}
          >
            <option value="">— Ninguno —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={s.label}>Contacto</label>
        <select
          style={{ ...s.input, padding: '8px 10px' }}
          value={form.contact_id || ''}
          onChange={(e) => set('contact_id', e.target.value)}
          disabled={!form.client_id}
        >
          <option value="">— {form.client_id ? 'Ninguno' : 'Selecciona un cliente primero'} —</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.job_title ? ` — ${c.job_title}` : ''}</option>
          ))}
        </select>
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

/* ========== badge helper ========== */
function TypeBadge({ type }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
      background: TYPE_COLORS[type] || TYPE_COLORS.other, color: '#fff', whiteSpace: 'nowrap',
    }}>
      {TYPE_LABEL[type] || type}
    </span>
  );
}

/* ========== date formatter ========== */
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ========== main component ========== */
export default function Activities() {
  const [searchParams] = useSearchParams();
  const urlOpportunityId = searchParams.get('opportunity_id') || '';

  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const sort = useSort({ field: 'activity_date', dir: 'desc' });

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '20');
    if (search) qs.set('search', search);
    if (typeFilter) qs.set('activity_type', typeFilter);
    if (urlOpportunityId) qs.set('opportunity_id', urlOpportunityId);
    sort.applyToQs(qs);
    try {
      const r = await apiGet(`/api/activities?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando actividades: ' + e.message);
    }
  }, [search, typeFilter, urlOpportunityId, sort.field, sort.dir]);

  useEffect(() => { load(1); }, [load]);

  const onSave = async (payload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await apiPut(`/api/activities/${editing.id}`, payload);
      } else {
        await apiPost('/api/activities', payload);
      }
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (a) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar actividad "${a.subject}"?`)) return;
    try {
      await apiDelete(`/api/activities/${a.id}`);
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  const COL_COUNT = 8;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>📋 Actividades</h1>
          <div style={s.sub}>Registro de llamadas, reuniones, emails y seguimiento comercial.</div>
        </div>
        <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nueva Actividad
        </button>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input
              style={s.input}
              placeholder="Por asunto"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar actividades"
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Tipo</label>
            <select
              style={s.input}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filtro por tipo"
            >
              <option value="">Todos</option>
              {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {urlOpportunityId && (
            <div style={{ fontSize: 12, color: 'var(--text-light)', alignSelf: 'center', paddingTop: 16 }}>
              Filtrado por oportunidad
            </div>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <SortableTh sort={sort} field="activity_date" style={s.th}>Fecha</SortableTh>
                <SortableTh sort={sort} field="activity_type" style={s.th}>Tipo</SortableTh>
                <SortableTh sort={sort} field="subject" style={s.th}>Asunto</SortableTh>
                <th style={s.th}>Oportunidad</th>
                <th style={s.th}>Cliente</th>
                <th style={s.th}>Usuario</th>
                <th style={s.th}>Contacto</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={COL_COUNT} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={COL_COUNT} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay actividades que coincidan con los filtros.
                </td></tr>
              )}
              {state.data.map((a) => (
                <tr key={a.id} style={{ cursor: 'default' }}>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtDate(a.activity_date)}</td>
                  <td style={s.td}><TypeBadge type={a.activity_type} /></td>
                  <td style={{ ...s.td, fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.subject}
                  </td>
                  <td style={s.td}>
                    {a.opportunity_id ? (
                      <Link to={`/opportunities/${a.opportunity_id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }}>
                        {a.opportunity_name || '—'}
                      </Link>
                    ) : '—'}
                  </td>
                  <td style={s.td}>
                    {a.client_id ? (
                      <Link to={`/clients/${a.client_id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }}>
                        {a.client_name || '—'}
                      </Link>
                    ) : '—'}
                  </td>
                  <td style={s.td}>{a.user_name || '—'}</td>
                  <td style={s.td}>{a.contact_name || '—'}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button
                      style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                      onClick={() => { setEditing(a); setShowForm(true); }}
                      aria-label={`Editar ${a.subject}`}
                    >Editar</button>
                    <button
                      style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => onDelete(a)}
                      aria-label={`Eliminar ${a.subject}`}
                    >Eliminar</button>
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
              Página {state.page} de {state.pages} · {state.total} actividades
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <ActivityForm
              initial={editing}
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
