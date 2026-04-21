import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiV2';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';

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

const LEVELS = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];
const PRIORITIES = [
  { value: 'low',      label: 'Baja' },
  { value: 'medium',   label: 'Media' },
  { value: 'high',     label: 'Alta' },
  { value: 'critical', label: 'Crítica' },
];
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label]));
const PRIORITY_COLOR = { low: 'var(--text-light)', medium: 'var(--teal-mid)', high: 'var(--orange)', critical: 'var(--danger)' };

const STATUSES = [
  { value: 'open',              label: 'Abierta' },
  { value: 'partially_filled',  label: 'Parcialmente cubierta' },
  { value: 'filled',            label: 'Cubierta' },
  { value: 'cancelled',         label: 'Cancelada' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((st) => [st.value, st.label]));
const STATUS_COLOR = {
  open: 'var(--purple-dark)', partially_filled: 'var(--orange)',
  filled: 'var(--success)', cancelled: 'var(--text-light)',
};

const EMPTY = {
  contract_id: '', role_title: '', area_id: '', level: 'L3', country: '',
  weekly_hours: 40, start_date: '', end_date: '',
  quantity: 1, priority: 'medium', notes: '',
};

function ResourceRequestForm({ initial, contracts, areas, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.contract_id) return setErr('Contrato es requerido');
    if (!form.role_title.trim()) return setErr('Role title es requerido');
    if (!form.area_id) return setErr('Área es requerida');
    if (!form.level) return setErr('Level es requerido');
    if (!form.start_date) return setErr('Fecha de inicio es requerida');
    try { await onSave(form); }
    catch (ex) { setErr(ex.message || 'Error guardando'); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar solicitud' : 'Nueva solicitud'}
      </h2>
      <div>
        <label style={s.label}>Contrato *</label>
        <select style={s.input} value={form.contract_id || ''} onChange={(e) => set('contract_id', e.target.value)} aria-label="Contrato" required disabled={!!initial?.id}>
          <option value="">— Selecciona —</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
        </select>
      </div>
      <div>
        <label style={s.label}>Role title *</label>
        <input style={s.input} value={form.role_title} onChange={(e) => set('role_title', e.target.value)} placeholder="ej. Senior Backend Developer" aria-label="Role title" required autoFocus />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Área *</label>
          <select style={s.input} value={form.area_id || ''} onChange={(e) => set('area_id', Number(e.target.value) || '')} aria-label="Área" required>
            <option value="">— Selecciona —</option>
            {areas.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Level *</label>
          <select style={s.input} value={form.level} onChange={(e) => set('level', e.target.value)} aria-label="Level" required>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>País</label>
          <input style={s.input} value={form.country || ''} onChange={(e) => set('country', e.target.value)} placeholder="Colombia, cualquiera..." aria-label="País" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Cantidad *</label>
          <input type="number" min={1} style={s.input} value={form.quantity} onChange={(e) => set('quantity', Math.max(1, Number(e.target.value) || 1))} aria-label="Cantidad" />
        </div>
        <div>
          <label style={s.label}>Horas semanales</label>
          <input type="number" min={1} max={80} step={0.5} style={s.input} value={form.weekly_hours} onChange={(e) => set('weekly_hours', Number(e.target.value))} aria-label="Horas semanales" />
        </div>
        <div>
          <label style={s.label}>Prioridad</label>
          <select style={s.input} value={form.priority} onChange={(e) => set('priority', e.target.value)} aria-label="Prioridad">
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Fecha de inicio *</label>
          <input type="date" style={s.input} value={form.start_date ? String(form.start_date).slice(0, 10) : ''} onChange={(e) => set('start_date', e.target.value)} aria-label="Fecha de inicio" required />
        </div>
        <div>
          <label style={s.label}>Fecha de fin</label>
          <input type="date" style={s.input} value={form.end_date ? String(form.end_date).slice(0, 10) : ''} onChange={(e) => set('end_date', e.target.value || null)} aria-label="Fecha de fin" />
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

export default function ResourceRequests() {
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [contractFilter, setContractFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [contracts, setContracts] = useState([]);
  const [areas, setAreas] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (search) qs.set('search', search);
    if (contractFilter) qs.set('contract_id', contractFilter);
    if (statusFilter) qs.set('status', statusFilter);
    if (priorityFilter) qs.set('priority', priorityFilter);
    try {
      const r = await apiGet(`/api/resource-requests?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando solicitudes: ' + e.message);
    }
  }, [search, contractFilter, statusFilter, priorityFilter]);

  const loadFilters = useCallback(async () => {
    try {
      const [rc, ra] = await Promise.all([
        apiGet('/api/contracts?limit=200'),
        apiGet('/api/areas'),
      ]);
      setContracts((rc?.data || []).filter((c) => !['completed', 'cancelled'].includes(c.status)));
      setAreas(ra?.data || []);
    } catch {
      setContracts([]); setAreas([]);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadFilters(); }, [loadFilters]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      const payload = {
        contract_id: form.contract_id, role_title: form.role_title,
        area_id: form.area_id, level: form.level, country: form.country || null,
        weekly_hours: form.weekly_hours, start_date: form.start_date,
        end_date: form.end_date || null, quantity: form.quantity,
        priority: form.priority, notes: form.notes || null,
      };
      if (editing?.id) await apiPut(`/api/resource-requests/${editing.id}`, payload);
      else await apiPost('/api/resource-requests', payload);
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally { setSaving(false); }
  };

  const onCancel = async (r) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Cancelar solicitud "${r.role_title}"?`)) return;
    try {
      await apiPost(`/api/resource-requests/${r.id}/cancel`, {});
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  const onDelete = async (r) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar solicitud "${r.role_title}"? (soft delete)`)) return;
    try {
      await apiDelete(`/api/resource-requests/${r.id}`);
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
          <h1 style={s.h1}>🧾 Solicitudes de recurso</h1>
          <div style={s.sub}>Necesidades de contratación/asignación derivadas de los contratos.</div>
        </div>
        <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nueva Solicitud
        </button>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input style={s.input} placeholder="Role title" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar solicitudes" />
          </div>
          <div style={{ minWidth: 180 }}>
            <label style={s.label}>Contrato</label>
            <select style={s.input} value={contractFilter} onChange={(e) => setContractFilter(e.target.value)} aria-label="Filtro por contrato">
              <option value="">Cualquiera</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Estado</label>
            <select style={s.input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtro por estado">
              <option value="">Todos</option>
              {STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 130 }}>
            <label style={s.label}>Prioridad</label>
            <select style={s.input} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Filtro por prioridad">
              <option value="">Todas</option>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['Role', 'Contrato', 'Área', 'Level', 'Cantidad', 'Asignaciones', 'Prioridad', 'Estado', 'Inicio', ''].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={10} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={10} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay solicitudes que coincidan.
                </td></tr>
              )}
              {state.data.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{r.role_title}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{r.contract_name || '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{r.area_name || '—'}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{r.level}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{r.quantity}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{r.active_assignments_count ?? 0}</td>
                  <td style={s.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: PRIORITY_COLOR[r.priority] || 'var(--text-light)', color: '#fff',
                    }}>{PRIORITY_LABEL[r.priority] || r.priority}</span>
                  </td>
                  <td style={s.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: STATUS_COLOR[r.status] || 'var(--text-light)', color: '#fff',
                    }}>{STATUS_LABEL[r.status] || r.status}</span>
                  </td>
                  <td style={{ ...s.td, fontSize: 12 }}>{r.start_date ? String(r.start_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => { setEditing(r); setShowForm(true); }}
                            aria-label={`Editar ${r.role_title}`}>Editar</button>
                    {r.status !== 'cancelled' && (
                      <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                              onClick={() => onCancel(r)}
                              aria-label={`Cancelar ${r.role_title}`}>Cancelar</button>
                    )}
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={() => onDelete(r)}
                            aria-label={`Eliminar ${r.role_title}`}>Eliminar</button>
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
              Página {state.page} de {state.pages} · {state.total} solicitudes
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <ResourceRequestForm
              initial={editing}
              contracts={contracts}
              areas={areas}
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
