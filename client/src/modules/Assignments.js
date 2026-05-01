import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '../utils/apiV2';
import AssignmentValidationModal from './AssignmentValidationModal';
import AssignmentValidationInline from './AssignmentValidationInline';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';
import StatusBadge from '../shell/StatusBadge';
import SearchableSelect from '../shell/SearchableSelect';
import SortableTh from '../shell/SortableTh';
import { useSort } from '../utils/useSort';

const s = {
  page:   { maxWidth: 1300, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  input:  { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  label:  { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th:     dsTh,
  td:     dsTd,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  filters:{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' },
  modalBg:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 640, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
  chip:   {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: 'var(--ds-accent-soft, #ede9f6)',
    color: 'var(--ds-text, #222)',
    borderRadius: 20, padding: '2px 8px 2px 10px',
    fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
  },
  chipBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    padding: '0 2px', color: 'var(--text-light)', fontSize: 15,
    lineHeight: 1, display: 'flex', alignItems: 'center',
  },
};

const STATUSES = [
  { value: 'planned',   label: 'Planeada' },
  { value: 'active',    label: 'Activa' },
  { value: 'ended',     label: 'Finalizada' },
  { value: 'cancelled', label: 'Cancelada' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((x) => [x.value, x.label]));

const EMPTY = {
  resource_request_id: '', employee_id: '', contract_id: '',
  weekly_hours: 20, start_date: '', end_date: '',
  role_title: '', notes: '', status: 'planned',
};

// ─────────────────────────────────────────────────────────────────────────────
// EmployeeMultiSelect — SPEC-007 Spec 1
//
// Autocomplete multi-select para el filtro de empleados. Soporta:
//   - Búsqueda por nombre en tiempo real
//   - Selección múltiple con chips removibles (✕)
//   - Empleados terminados visibles (para historial)
//   - Cierre al click afuera y con Escape
// ─────────────────────────────────────────────────────────────────────────────
function EmployeeMultiSelect({ allEmployees, selectedIds, onChange }) {
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const wrapperRef          = useRef(null);
  const inputRef            = useRef(null);

  const selectedEmployees = useMemo(
    () => allEmployees.filter((e) => selectedIds.includes(e.id)),
    [allEmployees, selectedIds],
  );

  // Excluye ya-seleccionados; filtra por query si hay texto.
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allEmployees
      .filter((e) => !selectedIds.includes(e.id))
      .filter((e) => !q || `${e.first_name} ${e.last_name}`.toLowerCase().includes(q))
      .slice(0, 60);
  }, [allEmployees, selectedIds, query]);

  // Cierra el dropdown al click afuera.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (ev) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const add = (id) => {
    onChange([...selectedIds, id]);
    setQuery('');
    // Keep open so the user can add more without re-focusing.
    inputRef.current?.focus();
  };

  const remove = (id) => onChange(selectedIds.filter((x) => x !== id));

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {selectedEmployees.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {selectedEmployees.map((emp) => (
            <span key={emp.id} style={s.chip}>
              {emp.first_name} {emp.last_name}
              <button
                type="button"
                style={s.chipBtn}
                onClick={() => remove(emp.id)}
                aria-label={`Quitar ${emp.first_name} ${emp.last_name}`}
              >×</button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={selectedIds.length ? 'Agregar empleado…' : 'Buscar empleado…'}
        aria-label="Filtro por empleado"
        aria-haspopup="listbox"
        aria-expanded={open}
        autoComplete="off"
        style={s.input}
      />
      {open && (
        <ul
          role="listbox"
          aria-label="Empleados"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            zIndex: 50, margin: '4px 0 0', padding: 0, listStyle: 'none',
            background: 'var(--ds-surface, #fff)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            maxHeight: 220, overflowY: 'auto',
          }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-light)' }}>
              {query.trim() ? 'Sin coincidencias' : 'Sin empleados disponibles'}
            </li>
          )}
          {filtered.map((emp) => (
            <li
              key={emp.id}
              role="option"
              aria-selected={false}
              // mousedown (no click) para que el blur del input no cierre el
              // dropdown antes de que se procese la selección.
              onMouseDown={(e) => { e.preventDefault(); add(emp.id); }}
              style={{
                padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                borderTop: '1px solid var(--border)',
              }}
            >
              {emp.first_name} {emp.last_name}
              {emp.status === 'terminated' && (
                <span style={{ fontSize: 11, color: 'var(--text-light)', marginLeft: 6 }}>
                  (terminado)
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AssignmentForm
// ─────────────────────────────────────────────────────────────────────────────
function AssignmentForm({ initial, requests, employees, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const selectedRequest = requests.find((r) => r.id === form.resource_request_id);

  /* --- US-VAL-4: live pre-validation --------------------------------
   * Debounce-call GET /api/assignments/validate whenever the four
   * inputs (employee, request, hours, start_date) are populated. The
   * response drives <AssignmentValidationInline /> so the user sees
   * area/level/capacity/date feedback before hitting Save.
   */
  const [preVal, setPreVal] = useState({ loading: false, validation: null, error: null });
  const hasInputs = Boolean(
    form.resource_request_id && form.employee_id &&
    Number(form.weekly_hours) > 0 && form.start_date,
  );
  useEffect(() => {
    if (!hasInputs) {
      setPreVal({ loading: false, validation: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setPreVal((p) => ({ ...p, loading: true, error: null }));
    const qs = new URLSearchParams({
      employee_id:  form.employee_id,
      request_id:   form.resource_request_id,
      weekly_hours: String(form.weekly_hours),
      start_date:   String(form.start_date).slice(0, 10),
    });
    if (form.end_date) qs.set('end_date', String(form.end_date).slice(0, 10));
    if (initial?.id) qs.set('ignore_assignment_id', initial.id);
    const timer = setTimeout(async () => {
      try {
        const v = await apiGet(`/api/assignments/validate?${qs.toString()}`);
        if (!cancelled) setPreVal({ loading: false, validation: v, error: null });
      } catch (ex) {
        if (!cancelled) setPreVal({ loading: false, validation: null, error: ex.message || 'Error' });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [
    hasInputs,
    form.employee_id,
    form.resource_request_id,
    form.weekly_hours,
    form.start_date,
    form.end_date,
    initial?.id,
  ]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.resource_request_id) return setErr('Solicitud es requerida');
    if (!form.employee_id) return setErr('Empleado es requerido');
    if (!form.weekly_hours || form.weekly_hours <= 0) return setErr('Horas semanales inválidas');
    if (!form.start_date) return setErr('Fecha de inicio es requerida');
    try {
      await onSave({
        ...form,
        contract_id: selectedRequest?.contract_id || form.contract_id,
      });
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar asignación' : 'Nueva asignación'}
      </h2>
      <div>
        <label style={s.label} htmlFor="assignment-request">Solicitud *</label>
        <SearchableSelect
          id="assignment-request"
          aria-label="Solicitud"
          value={form.resource_request_id || ''}
          onChange={(v) => set('resource_request_id', v)}
          required
          disabled={!!initial?.id}
          options={requests.map((r) => ({
            id: r.id,
            label: `${r.role_title} · ${r.contract_name}`,
            hint: `Nivel ${r.level} · ${r.quantity} cupos · ${r.active_assignments_count ?? 0} activos`,
            searchText: `${r.role_title} ${r.contract_name} ${r.level}`,
          }))}
        />
        {selectedRequest && (
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>
            Contrato: {selectedRequest.contract_name} · Cantidad: {selectedRequest.quantity} · Activos: {selectedRequest.active_assignments_count ?? 0}
          </div>
        )}
      </div>
      <div>
        <label style={s.label} htmlFor="assignment-employee">Empleado *</label>
        <SearchableSelect
          id="assignment-employee"
          aria-label="Empleado"
          value={form.employee_id || ''}
          onChange={(v) => set('employee_id', v)}
          required
          disabled={!!initial?.id}
          options={employees
            .filter((e) => e.status !== 'terminated')
            .map((e) => ({
              id: e.id,
              label: `${e.first_name} ${e.last_name}`,
              hint: `${e.level} · ${e.weekly_capacity_hours}h cap.`,
              searchText: `${e.first_name} ${e.last_name} ${e.level}`,
            }))}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Horas semanales *</label>
          <input type="number" min={1} max={80} step={0.5} style={s.input} value={form.weekly_hours} onChange={(e) => set('weekly_hours', Number(e.target.value))} aria-label="Horas semanales" required />
        </div>
        <div>
          <label style={s.label}>Estado</label>
          <select style={s.input} value={form.status} onChange={(e) => set('status', e.target.value)} aria-label="Estado">
            {STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
          </select>
        </div>
      </div>
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
        <label style={s.label}>Role title</label>
        <input style={s.input} value={form.role_title || ''} onChange={(e) => set('role_title', e.target.value)} aria-label="Role title" />
      </div>
      <div>
        <label style={s.label}>Notas</label>
        <textarea style={{ ...s.input, minHeight: 50, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <AssignmentValidationInline
        validation={preVal.validation}
        loading={preVal.loading}
        error={preVal.error}
      />
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Assignments — página principal
// ─────────────────────────────────────────────────────────────────────────────
export default function Assignments() {
  const [state, setState]               = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [statusFilter, setStatusFilter] = useState('');

  // SPEC-007: nuevos filtros
  const [employeeIds, setEmployeeIds]   = useState([]);   // Spec 1: multi-empleado
  const [dateFrom, setDateFrom]         = useState('');   // Spec 2: fecha desde
  const [dateTo, setDateTo]             = useState('');   // Spec 2: fecha hasta
  const [dateError, setDateError]       = useState('');

  const [requests, setRequests]               = useState([]);
  const [employees, setEmployees]             = useState([]);   // para el form (sin terminados)
  const [filterEmployees, setFilterEmployees] = useState([]);   // para el filtro (todos, inc. terminados)
  const [showForm, setShowForm]               = useState(false);
  const [editing, setEditing]                 = useState(null);
  const [saving, setSaving]                   = useState(false);
  const sort = useSort({ field: 'start_date', dir: 'desc' });
  const [validationModal, setValidationModal] = useState(null);

  // ── Validación de rango de fechas ─────────────────────────────────────────
  const validateDateRange = useCallback((from, to) => {
    if (from && to && from > to) {
      setDateError('La fecha de inicio no puede ser posterior a la fecha de fin');
      return false;
    }
    setDateError('');
    return true;
  }, []);

  const handleDateFrom = (v) => {
    setDateFrom(v);
    validateDateRange(v, dateTo);
  };

  const handleDateTo = (v) => {
    setDateTo(v);
    validateDateRange(dateFrom, v);
  };

  // ── Carga de datos ────────────────────────────────────────────────────────
  const load = useCallback(async (page = 1) => {
    // No ejecutar si el rango de fechas es inválido.
    if (dateFrom && dateTo && dateFrom > dateTo) return;

    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (statusFilter)         qs.set('status', statusFilter);
    if (employeeIds.length)   qs.set('employee_ids', employeeIds.join(','));
    if (dateFrom)             qs.set('date_from', dateFrom);
    if (dateTo)               qs.set('date_to', dateTo);
    sort.applyToQs(qs);
    try {
      const r = await apiGet(`/api/assignments?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando asignaciones: ' + e.message);
    }
  }, [statusFilter, employeeIds, dateFrom, dateTo, sort.field, sort.dir]);

  // INC-003: usar /lookup (sin paginación) para los combobox del formulario
  // y para la lista de empleados del filtro. Separamos ambos usos:
  //   - filterEmployees → todos (inc. terminados) para consultar historial
  //   - employees       → activos únicamente para el formulario de asignación
  const loadLookups = useCallback(async () => {
    try {
      const [rr, re] = await Promise.all([
        apiGet('/api/resource-requests/lookup'),
        apiGet('/api/employees/lookup'),
      ]);
      setRequests((rr?.data || []).filter((r) => !['filled', 'cancelled'].includes(r.status)));
      const allEmps = re?.data || [];
      setFilterEmployees(allEmps);
      setEmployees(allEmps.filter((e) => e.status !== 'terminated'));
    } catch {
      setRequests([]); setEmployees([]); setFilterEmployees([]);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadLookups(); }, [loadLookups]);

  // ── Limpiar todos los filtros ──────────────────────────────────────────────
  const clearFilters = () => {
    setStatusFilter('');
    setEmployeeIds([]);
    setDateFrom('');
    setDateTo('');
    setDateError('');
  };

  const hasActiveFilters = statusFilter || employeeIds.length || dateFrom || dateTo;

  // ── Guardado / override ───────────────────────────────────────────────────
  const persist = useCallback(async (form, editingId) => {
    if (editingId) return apiPut(`/api/assignments/${editingId}`, form);
    return apiPost('/api/assignments', form);
  }, []);

  const onSave = async (form) => {
    setSaving(true);
    try {
      await persist(form, editing?.id);
      setShowForm(false);
      setEditing(null);
      setValidationModal(null);
      await load(state.page);
    } catch (e) {
      const isValidation409 = e?.status === 409 && e?.body && Array.isArray(e.body.checks);
      if (isValidation409) {
        const validation = {
          valid: false,
          can_override: e.body.code === 'OVERRIDE_REQUIRED',
          requires_justification: !!e.body.requires_justification,
          checks: e.body.checks,
          summary: e.body.summary || {},
        };
        setValidationModal({ validation, advisories: e.body.advisories || [], pendingForm: form });
        return;
      }
      throw e;
    } finally { setSaving(false); }
  };

  const onConfirmOverride = async (reason) => {
    if (!validationModal?.pendingForm) return;
    setSaving(true);
    try {
      await persist({ ...validationModal.pendingForm, override_reason: reason }, editing?.id);
      setShowForm(false);
      setEditing(null);
      setValidationModal(null);
      await load(state.page);
    } finally { setSaving(false); }
  };

  const onDelete = async (a) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('¿Eliminar asignación? (si tiene time entries, se convertirá en cancelación + soft delete para preservar historia)')) return;
    try {
      const res = await apiDelete(`/api/assignments/${a.id}`);
      // eslint-disable-next-line no-alert
      if (res?.mode === 'soft') alert(`Asignación cancelada; ${res.preserved_time_entries} time entries preservados.`);
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  // ── Descarga CSV: propaga los filtros activos ──────────────────────────────
  const onExportCsv = async () => {
    try {
      const qs = new URLSearchParams();
      if (statusFilter)       qs.set('status', statusFilter);
      if (employeeIds.length) qs.set('employee_ids', employeeIds.join(','));
      if (dateFrom)           qs.set('date_from', dateFrom);
      if (dateTo)             qs.set('date_to', dateTo);
      await apiDownload(
        `/api/assignments/export.csv${qs.toString() ? `?${qs}` : ''}`,
        'asignaciones.csv',
      );
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(`No se pudo descargar: ${e.message}`);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>🗓 Asignaciones</h1>
          <div style={s.sub}>Compromiso entre empleado, contrato y solicitud. Chequeo de overbooking automático.</div>
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
            onClick={onExportCsv}
            data-testid="assignments-export-csv"
          >
            ⤓ Descargar CSV
          </button>
          <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
            + Nueva Asignación
          </button>
        </div>
      </div>

      <div style={s.card}>
        {/* ── Barra de filtros ────────────────────────────────────────────── */}
        <div style={s.filters}>

          {/* Filtro por estado (existente) */}
          <div style={{ minWidth: 150 }}>
            <label style={s.label}>Estado</label>
            <select
              style={s.input}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filtro por estado"
            >
              <option value="">Todos</option>
              {STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
            </select>
          </div>

          {/* SPEC-007 Spec 1: Filtro por empleado (multi-select) */}
          <div style={{ minWidth: 220, flex: 2 }}>
            <label style={s.label}>Empleado</label>
            <EmployeeMultiSelect
              allEmployees={filterEmployees}
              selectedIds={employeeIds}
              onChange={setEmployeeIds}
            />
          </div>

          {/* SPEC-007 Spec 2: Fecha desde */}
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Desde</label>
            <input
              type="date"
              style={s.input}
              value={dateFrom}
              onChange={(e) => handleDateFrom(e.target.value)}
              aria-label="Filtro fecha desde"
            />
          </div>

          {/* SPEC-007 Spec 2: Fecha hasta */}
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Hasta</label>
            <input
              type="date"
              style={s.input}
              value={dateTo}
              onChange={(e) => handleDateTo(e.target.value)}
              aria-label="Filtro fecha hasta"
            />
          </div>

          {/* Limpiar filtros */}
          {hasActiveFilters && (
            <div style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                style={{ ...s.btnOutline, fontSize: 12, padding: '7px 12px' }}
                onClick={clearFilters}
                aria-label="Limpiar filtros"
              >
                ✕ Limpiar filtros
              </button>
            </div>
          )}
        </div>

        {/* Error de rango de fechas */}
        {dateError && (
          <div
            role="alert"
            style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}
          >
            {dateError}
          </div>
        )}

        {/* ── Tabla ───────────────────────────────────────────────────────── */}
        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <SortableTh sort={sort} field="employee_name" style={s.th}>Empleado</SortableTh>
                <SortableTh sort={sort} field="contract_name" style={s.th}>Contrato</SortableTh>
                <SortableTh sort={sort} field="role_title" style={s.th}>Role (solicitud)</SortableTh>
                <SortableTh sort={sort} field="weekly_hours" style={s.th}>h/sem</SortableTh>
                <SortableTh sort={sort} field="start_date" style={s.th}>Inicio</SortableTh>
                <SortableTh sort={sort} field="end_date" style={s.th}>Fin</SortableTh>
                <SortableTh sort={sort} field="status" style={s.th}>Estado</SortableTh>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                    No se encontraron asignaciones con los filtros aplicados.
                  </td>
                </tr>
              )}
              {state.data.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{a.employee_first_name} {a.employee_last_name}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.contract_name || '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.request_role_title || a.role_title || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{Number(a.weekly_hours)}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.start_date ? String(a.start_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.end_date ? String(a.end_date).slice(0, 10) : '—'}</td>
                  <td style={s.td}>
                    <StatusBadge domain="assignment" value={a.status} label={STATUS_LABEL[a.status]} />
                  </td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button
                      style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                      onClick={() => { setEditing(a); setShowForm(true); }}
                      aria-label={`Editar asignación de ${a.employee_first_name} ${a.employee_last_name}`}
                    >Editar</button>
                    <button
                      style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => onDelete(a)}
                      aria-label={`Eliminar asignación de ${a.employee_first_name} ${a.employee_last_name}`}
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Paginación ─────────────────────────────────────────────────── */}
        {state.pages > 1 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <button style={s.btnOutline} disabled={state.page <= 1} onClick={() => load(state.page - 1)}>← Anterior</button>
            <span style={{ fontSize: 13, color: 'var(--text-light)' }}>
              Página {state.page} de {state.pages} · {state.total} asignaciones
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {/* ── Modal de formulario ──────────────────────────────────────────── */}
      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <AssignmentForm
              initial={editing}
              requests={requests}
              employees={employees}
              saving={saving}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSave={onSave}
            />
          </div>
        </div>
      )}

      {/* ── Modal de validación con override ────────────────────────────── */}
      {validationModal && (
        <AssignmentValidationModal
          validation={validationModal.validation}
          advisories={validationModal.advisories}
          saving={saving}
          onConfirm={onConfirmOverride}
          onClose={() => setValidationModal(null)}
        />
      )}
    </div>
  );
}
