import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '../utils/apiV2';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';
import StatusBadge from '../shell/StatusBadge';
import SortableTh from '../shell/SortableTh';
import { useSort } from '../utils/useSort';
import {
  SUBTYPES_BY_TYPE, SUBTYPE_LABEL, formatSubtype, typeRequiresSubtype, subtypesFor,
} from '../utils/contractSubtype';

const s = {
  page:   { maxWidth: 1300, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  input:  { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none' },
  label:  { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  // UI refresh Phase 2 — table styles come from the shared design-tokens
  // helper so every list page adopts the same density + palette at once.
  th:     dsTh,
  td:     dsTd,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  filters:{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'end' },
  modalBg:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 640, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

const TYPES = [
  { value: 'capacity', label: 'Capacidad' },
  { value: 'project',  label: 'Proyecto' },
  { value: 'resell',   label: 'Reventa' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

const STATUSES = [
  { value: 'planned',   label: 'Planeado' },
  { value: 'active',    label: 'Activo' },
  { value: 'paused',    label: 'Pausado' },
  { value: 'completed', label: 'Completado' },
  { value: 'cancelled', label: 'Cancelado' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s2) => [s2.value, s2.label]));
const STATUS_COLOR = {
  planned: 'var(--purple-dark)', active: 'var(--success)',
  paused: 'var(--orange)', completed: 'var(--teal-mid)', cancelled: 'var(--danger)',
};
const TRANSITIONS = {
  planned:   ['active', 'cancelled'],
  active:    ['paused', 'completed', 'cancelled'],
  paused:    ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const EMPTY = {
  name: '', client_id: '', opportunity_id: '', winning_quotation_id: '',
  type: 'project', contract_subtype: '', start_date: '', end_date: '',
  delivery_manager_id: '', notes: '',
};

function ContractForm({ initial, clients, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const [subtypeError, setSubtypeError] = useState('');

  // Cuando el usuario cambia el TYPE, reseteamos el subtype (cumple SPEC:
  // "el campo Subtipo se resetea a vacío y muestra las opciones del nuevo
  // tipo"). Excepción: si estamos editando y el contrato ya venía con un
  // subtype válido para el type actual, lo preservamos.
  const set = (k, v) => {
    setForm((f) => {
      if (k === 'type') {
        const validForNew = (SUBTYPES_BY_TYPE[v] || []).some((s) => s.value === f.contract_subtype);
        return { ...f, type: v, contract_subtype: validForNew ? f.contract_subtype : '' };
      }
      return { ...f, [k]: v };
    });
    if (k === 'contract_subtype') setSubtypeError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setSubtypeError('');
    if (!form.name.trim()) return setErr('Nombre es requerido');
    if (!form.client_id) return setErr('Cliente es requerido');
    if (!form.type) return setErr('Tipo es requerido');
    if (!form.start_date) return setErr('Fecha de inicio es requerida');
    // SPEC: subtype obligatorio cuando type es capacity/project. Excepción
    // legacy: si estamos editando un contrato que YA estaba sin subtype y
    // el usuario no cambió el type ni tocó el campo, dejamos pasar (otros
    // campos editables siguen funcionando).
    const editingWithoutSubtype =
      initial?.id && !initial.contract_subtype && form.type === initial.type;
    if (typeRequiresSubtype(form.type) && !form.contract_subtype && !editingWithoutSubtype) {
      setSubtypeError('Debes seleccionar un subtipo para continuar');
      return;
    }
    try { await onSave(form); }
    catch (ex) { setErr(ex.message || 'Error guardando'); }
  };

  const subtypeOptions = subtypesFor(form.type);
  const showSubtype = typeRequiresSubtype(form.type);

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar contrato' : 'Nuevo contrato'}
      </h2>
      <div>
        <label style={s.label}>Nombre *</label>
        <input style={s.input} value={form.name} onChange={(e) => set('name', e.target.value)} aria-label="Nombre" required autoFocus />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Cliente *</label>
          <select style={s.input} value={form.client_id || ''} onChange={(e) => set('client_id', e.target.value)} aria-label="Cliente" required disabled={!!initial?.id}>
            <option value="">— Selecciona —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Tipo *</label>
          <select style={s.input} value={form.type} onChange={(e) => set('type', e.target.value)} aria-label="Tipo" required>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>
      {showSubtype && (
        <div>
          <label style={s.label}>Subtipo *</label>
          <select
            style={{
              ...s.input,
              borderColor: subtypeError ? 'var(--danger, #b00020)' : s.input.border,
            }}
            value={form.contract_subtype || ''}
            onChange={(e) => set('contract_subtype', e.target.value)}
            aria-label="Subtipo"
            required
          >
            <option value="">Selecciona un subtipo</option>
            {subtypeOptions.map((sub) => (
              <option key={sub.value} value={sub.value}>{sub.label}</option>
            ))}
          </select>
          {subtypeError && (
            <div role="alert" style={{ color: 'var(--danger, #b00020)', fontSize: 12, marginTop: 4 }}>
              {subtypeError}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Fecha inicio *</label>
          <input type="date" style={s.input} value={form.start_date ? String(form.start_date).slice(0, 10) : ''} onChange={(e) => set('start_date', e.target.value)} aria-label="Fecha inicio" required />
        </div>
        <div>
          <label style={s.label}>Fecha fin</label>
          <input type="date" style={s.input} value={form.end_date ? String(form.end_date).slice(0, 10) : ''} onChange={(e) => set('end_date', e.target.value || null)} aria-label="Fecha fin" />
        </div>
      </div>
      <div>
        <label style={s.label}>Notas</label>
        <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

export default function Contracts() {
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const sort = useSort({ field: 'updated_at', dir: 'desc' });
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [subtypeFilter, setSubtypeFilter] = useState('');
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (search) qs.set('search', search);
    if (clientFilter) qs.set('client_id', clientFilter);
    if (statusFilter) qs.set('status', statusFilter);
    if (typeFilter) qs.set('type', typeFilter);
    if (subtypeFilter) qs.set('subtype', subtypeFilter);
    sort.applyToQs(qs);
    try {
      const r = await apiGet(`/api/contracts?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando contratos: ' + e.message);
    }
  }, [search, clientFilter, statusFilter, typeFilter, subtypeFilter, sort.field, sort.dir]);

  const loadClients = useCallback(async () => {
    try {
      const r = await apiGet('/api/clients?limit=200&active=true');
      setClients(r?.data || []);
    } catch { setClients([]); }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadClients(); }, [loadClients]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      const payload = {
        name: form.name, client_id: form.client_id, type: form.type,
        // contract_subtype: empty string → null (resell) o sin tocar para
        // legacy edits sin cambio de type; el server diferencia los casos.
        contract_subtype: form.contract_subtype || null,
        start_date: form.start_date, end_date: form.end_date || null,
        notes: form.notes,
        opportunity_id: form.opportunity_id || null,
        winning_quotation_id: form.winning_quotation_id || null,
      };
      if (editing?.id) await apiPut(`/api/contracts/${editing.id}`, payload);
      else await apiPost('/api/contracts', payload);
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally { setSaving(false); }
  };

  const onTransition = async (c, target) => {
    if (!window.confirm(`¿Mover "${c.name}" a ${STATUS_LABEL[target]}? ${['completed', 'cancelled'].includes(target) ? 'Se cancelarán asignaciones y solicitudes abiertas.' : ''}`)) return;
    try {
      await apiPost(`/api/contracts/${c.id}/status`, { new_status: target });
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  const onDelete = async (c) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar contrato "${c.name}"? (soft delete)`)) return;
    try {
      await apiDelete(`/api/contracts/${c.id}`);
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
          <h1 style={s.h1}>📑 Contratos</h1>
          <div style={s.sub}>Compromisos de entrega con clientes. Generan solicitudes y asignaciones.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={{
              background: 'transparent',
              color: 'var(--ds-text, #222)',
              border: '1px solid var(--ds-border, #ccc)',
              borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'Montserrat',
            }}
            onClick={async () => {
              try {
                const qs = new URLSearchParams();
                if (search)        qs.set('search', search);
                if (clientFilter)  qs.set('client_id', clientFilter);
                if (statusFilter)  qs.set('status', statusFilter);
                if (typeFilter)    qs.set('type', typeFilter);
                if (subtypeFilter) qs.set('subtype', subtypeFilter);
                await apiDownload(`/api/contracts/export.csv${qs.toString() ? `?${qs}` : ''}`, 'contratos.csv');
              } catch (e) {
                // eslint-disable-next-line no-alert
                alert(`No se pudo descargar: ${e.message}`);
              }
            }}
            data-testid="contracts-export-csv"
          >
            ⤓ Descargar CSV
          </button>
          <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
            + Nuevo Contrato
          </button>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input style={s.input} placeholder="Nombre del contrato" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar contratos" />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Cliente</label>
            <select style={s.input} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Filtro por cliente">
              <option value="">Cualquiera</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Tipo</label>
            <select
              style={s.input}
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                // SPEC: si el subtipo filtrado no es válido para el nuevo
                // tipo, lo limpiamos (evita filtros vacíos por inconsistencia).
                if (subtypeFilter) {
                  const validList = SUBTYPES_BY_TYPE[e.target.value] || Object.values(SUBTYPES_BY_TYPE).flat();
                  if (!validList.some((sub) => sub.value === subtypeFilter)) {
                    setSubtypeFilter('');
                  }
                }
              }}
              aria-label="Filtro por tipo"
            >
              <option value="">Todos</option>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 200 }}>
            <label style={s.label}>Subtipo</label>
            <select
              style={s.input}
              value={subtypeFilter}
              onChange={(e) => setSubtypeFilter(e.target.value)}
              aria-label="Filtro por subtipo"
            >
              <option value="">Todos</option>
              {/* Si hay un type filtrado, mostrar sólo los subtipos de ese type;
                  sin type, mostrar todos. 'none' permite filtrar contratos sin subtipo (legacy). */}
              {(typeFilter ? subtypesFor(typeFilter) : Object.values(SUBTYPES_BY_TYPE).flat()).map((sub) => (
                <option key={sub.value} value={sub.value}>{sub.label}</option>
              ))}
              <option value="none">— Sin especificar —</option>
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Estado</label>
            <select style={s.input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtro por estado">
              <option value="">Todos</option>
              {STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <SortableTh sort={sort} field="name" style={s.th}>Nombre</SortableTh>
                <SortableTh sort={sort} field="client_name" style={s.th}>Cliente</SortableTh>
                <SortableTh sort={sort} field="type" style={s.th}>Tipo</SortableTh>
                <SortableTh sort={sort} field="contract_subtype" style={s.th}>Subtipo</SortableTh>
                <SortableTh sort={sort} field="status" style={s.th}>Estado</SortableTh>
                <SortableTh sort={sort} field="start_date" style={s.th}>Inicio</SortableTh>
                <th style={s.th}>Solicitudes abiertas</th>
                <th style={s.th}>Asig. activas</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay contratos que coincidan con los filtros.
                </td></tr>
              )}
              {state.data.map((c) => {
                const nextStates = TRANSITIONS[c.status] || [];
                return (
                  <tr key={c.id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>
                      <Link to={`/contracts/${c.id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }} aria-label={`Ver ${c.name}`}>{c.name}</Link>
                    </td>
                    <td style={s.td}>{c.client_name || '—'}</td>
                    <td style={{ ...s.td, fontSize: 12 }}>{TYPE_LABEL[c.type] || c.type}</td>
                    <td style={{ ...s.td, fontSize: 12, color: c.contract_subtype ? 'inherit' : 'var(--text-light)' }}>
                      {formatSubtype(c.contract_subtype, { fallback: 'Sin especificar' })}
                    </td>
                    <td style={s.td}>
                      <StatusBadge domain="contract" value={c.status} label={STATUS_LABEL[c.status]} />
                    </td>
                    <td style={{ ...s.td, fontSize: 12 }}>{c.start_date ? String(c.start_date).slice(0, 10) : '—'}</td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{c.open_requests_count ?? 0}</td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{c.active_assignments_count ?? 0}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                              onClick={() => { setEditing(c); setShowForm(true); }}
                              aria-label={`Editar ${c.name}`}>Editar</button>
                      {nextStates.map((ns) => (
                        <button key={ns}
                                style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                                onClick={() => onTransition(c, ns)}
                                aria-label={`Mover ${c.name} a ${STATUS_LABEL[ns]}`}>
                          {STATUS_LABEL[ns]}
                        </button>
                      ))}
                      <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                              onClick={() => onDelete(c)}
                              aria-label={`Eliminar ${c.name}`}>Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {state.pages > 1 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <button style={s.btnOutline} disabled={state.page <= 1} onClick={() => load(state.page - 1)}>← Anterior</button>
            <span style={{ fontSize: 13, color: 'var(--text-light)' }}>
              Página {state.page} de {state.pages} · {state.total} contratos
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <ContractForm
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
