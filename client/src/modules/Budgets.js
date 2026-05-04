import React, { useEffect, useState, useCallback } from 'react';
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

const STATUS_COLORS = { draft: '#9CA3AF', active: '#10B981', closed: '#3B82F6' };
const STATUS_LABELS = { draft: 'Borrador', active: 'Activo', closed: 'Cerrado' };
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const fmtUSD = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);

const EMPTY = {
  period_year: new Date().getFullYear(), period_quarter: '', period_month: '',
  country: '', owner_id: '', service_line: '', target_usd: '', status: 'draft', notes: '',
};

/* ========== Summary cards ========== */
function SummaryBar({ year }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!year) return;
    apiGet(`/api/budgets/summary?period_year=${year}`)
      .then((r) => setData(r))
      .catch(() => setData(null));
  }, [year]);

  if (!data) return null;
  const target = (data.targets && data.targets[0]?.total_target) || 0;
  const actual = (data.actuals && data.actuals[0]?.total_actual) || 0;
  const pct = target > 0 ? Math.min((actual / target) * 100, 100) : 0;

  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
      <div style={{ ...s.card, flex: 1, minWidth: 200, marginBottom: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text-light)', fontWeight: 600, marginBottom: 4 }}>Target {year}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>{fmtUSD(target)}</div>
      </div>
      <div style={{ ...s.card, flex: 1, minWidth: 200, marginBottom: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text-light)', fontWeight: 600, marginBottom: 4 }}>Real (Closed Won) {year}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#10B981', fontFamily: 'Montserrat' }}>{fmtUSD(actual)}</div>
      </div>
      <div style={{ ...s.card, flex: 2, minWidth: 280, marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-light)', fontWeight: 600, marginBottom: 6 }}>Avance {pct.toFixed(1)}%</div>
        <div style={{ height: 14, background: '#E5E7EB', borderRadius: 7, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#10B981' : 'var(--purple-dark)', borderRadius: 7, transition: 'width 0.4s' }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>{fmtUSD(actual)} / {fmtUSD(target)}</div>
      </div>
    </div>
  );
}

/* ========== Form modal ========== */
function BudgetForm({ initial, users, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.period_year) return setErr('El ano es requerido');
    if (!form.target_usd && form.target_usd !== 0) return setErr('El target USD es requerido');
    try {
      const payload = {
        ...form,
        period_year: Number(form.period_year),
        period_quarter: form.period_quarter ? Number(form.period_quarter) : null,
        period_month: form.period_month ? Number(form.period_month) : null,
        target_usd: Number(form.target_usd),
        owner_id: form.owner_id || null,
      };
      await onSave(payload);
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar presupuesto' : 'Nuevo presupuesto'}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Ano *</label>
          <input style={s.input} type="number" min={2020} max={2099} value={form.period_year} onChange={(e) => set('period_year', e.target.value)} required />
        </div>
        <div>
          <label style={s.label}>Trimestre</label>
          <select style={{ ...s.input, padding: '8px 10px' }} value={form.period_quarter || ''} onChange={(e) => set('period_quarter', e.target.value)}>
            <option value="">--</option>
            <option value="1">Q1</option>
            <option value="2">Q2</option>
            <option value="3">Q3</option>
            <option value="4">Q4</option>
          </select>
        </div>
        <div>
          <label style={s.label}>Mes</label>
          <select style={{ ...s.input, padding: '8px 10px' }} value={form.period_month || ''} onChange={(e) => set('period_month', e.target.value)}>
            <option value="">--</option>
            {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Pais</label>
          <input style={s.input} value={form.country || ''} onChange={(e) => set('country', e.target.value)} placeholder="Mexico, Colombia..." />
        </div>
        <div>
          <label style={s.label}>Linea de servicio</label>
          <input style={s.input} value={form.service_line || ''} onChange={(e) => set('service_line', e.target.value)} placeholder="Consulting, Dev..." />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Responsable</label>
          <select style={{ ...s.input, padding: '8px 10px' }} value={form.owner_id || ''} onChange={(e) => set('owner_id', e.target.value)}>
            <option value="">-- Sin asignar --</option>
            {(users || []).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Target USD *</label>
          <input style={s.input} type="number" min={0} step="0.01" value={form.target_usd} onChange={(e) => set('target_usd', e.target.value)} required />
        </div>
      </div>
      <div>
        <label style={s.label}>Estado</label>
        <select style={{ ...s.input, padding: '8px 10px' }} value={form.status} onChange={(e) => set('status', e.target.value)}>
          <option value="draft">Borrador</option>
          <option value="active">Activo</option>
          <option value="closed">Cerrado</option>
        </select>
      </div>
      <div>
        <label style={s.label}>Notas</label>
        <textarea style={{ ...s.input, minHeight: 70, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
      </div>
    </form>
  );
}

/* ========== Main component ========== */
export default function Budgets() {
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const sort = useSort({ field: 'period_year', dir: 'desc' });

  // Load users for owner selector
  useEffect(() => {
    apiGet('/api/users?limit=200')
      .then((r) => setUsers(r.data || r || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '20');
    if (yearFilter) qs.set('period_year', String(yearFilter));
    if (statusFilter) qs.set('status', statusFilter);
    if (countryFilter) qs.set('country', countryFilter);
    sort.applyToQs(qs);
    try {
      const r = await apiGet(`/api/budgets?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando presupuestos: ' + e.message);
    }
  }, [yearFilter, statusFilter, countryFilter, sort.field, sort.dir]);

  useEffect(() => { load(1); }, [load]);

  const onSave = async (payload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await apiPut(`/api/budgets/${editing.id}`, payload);
      } else {
        await apiPost('/api/budgets', payload);
      }
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (b) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Eliminar presupuesto ${b.country || ''} ${b.service_line || ''} ${b.period_year}?`)) return;
    try {
      await apiDelete(`/api/budgets/${b.id}`);
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
          <h1 style={s.h1}>Presupuestos</h1>
          <div style={s.sub}>Metas comerciales de booking por periodo, pais y linea de servicio.</div>
        </div>
        <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nuevo Presupuesto
        </button>
      </div>

      {/* Summary */}
      <SummaryBar year={yearFilter} />

      {/* Filters */}
      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ minWidth: 100 }}>
            <label style={s.label}>Ano</label>
            <input
              style={s.input}
              type="number"
              min={2020}
              max={2099}
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value ? Number(e.target.value) : '')}
              aria-label="Filtro por ano"
            />
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Estado</label>
            <select
              style={s.input}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filtro por estado"
            >
              <option value="">Todos</option>
              <option value="draft">Borrador</option>
              <option value="active">Activo</option>
              <option value="closed">Cerrado</option>
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Pais</label>
            <input
              style={s.input}
              placeholder="Filtrar pais..."
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              aria-label="Filtro por pais"
            />
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <SortableTh sort={sort} field="period_year" style={s.th}>Ano</SortableTh>
                <SortableTh sort={sort} field="period_quarter" style={s.th}>Trimestre</SortableTh>
                <SortableTh sort={sort} field="period_month" style={s.th}>Mes</SortableTh>
                <SortableTh sort={sort} field="country" style={s.th}>Pais</SortableTh>
                <SortableTh sort={sort} field="owner_name" style={s.th}>Responsable</SortableTh>
                <SortableTh sort={sort} field="service_line" style={s.th}>Linea de servicio</SortableTh>
                <SortableTh sort={sort} field="target_usd" style={s.th}>Target USD</SortableTh>
                <SortableTh sort={sort} field="status" style={s.th}>Estado</SortableTh>
                <th style={s.th}>Aprobado por</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={10} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando...</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={10} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay presupuestos que coincidan con los filtros.
                </td></tr>
              )}
              {state.data.map((b) => (
                <tr key={b.id}>
                  <td style={s.td}>{b.period_year}</td>
                  <td style={s.td}>{b.period_quarter ? `Q${b.period_quarter}` : '--'}</td>
                  <td style={s.td}>{b.period_month ? MONTH_NAMES[b.period_month - 1] : '--'}</td>
                  <td style={s.td}>{b.country || '--'}</td>
                  <td style={s.td}>{b.owner_name || '--'}</td>
                  <td style={s.td}>{b.service_line || '--'}</td>
                  <td style={{ ...s.td, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtUSD(b.target_usd)}</td>
                  <td style={s.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: STATUS_COLORS[b.status] || '#9CA3AF', color: '#fff',
                    }}>{STATUS_LABELS[b.status] || b.status}</span>
                  </td>
                  <td style={s.td}>{b.approved_by_name || '--'}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button
                      style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                      onClick={() => { setEditing(b); setShowForm(true); }}
                      aria-label={`Editar presupuesto ${b.id}`}
                    >Editar</button>
                    <button
                      style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => onDelete(b)}
                      aria-label={`Eliminar presupuesto ${b.id}`}
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {state.pages > 1 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <button style={s.btnOutline} disabled={state.page <= 1} onClick={() => load(state.page - 1)}>Anterior</button>
            <span style={{ fontSize: 13, color: 'var(--text-light)' }}>
              Pagina {state.page} de {state.pages} -- {state.total} registros
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente</button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <BudgetForm
              initial={editing}
              users={users}
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
