import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '../utils/apiV2';
import AssignmentValidationModal from './AssignmentValidationModal';
import AssignmentValidationInline from './AssignmentValidationInline';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';
import StatusBadge from '../shell/StatusBadge';

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

const STATUSES = [
  { value: 'planned',   label: 'Planeada' },
  { value: 'active',    label: 'Activa' },
  { value: 'ended',     label: 'Finalizada' },
  { value: 'cancelled', label: 'Cancelada' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((x) => [x.value, x.label]));
const STATUS_COLOR = {
  planned: 'var(--purple-dark)', active: 'var(--success)',
  ended: 'var(--teal-mid)', cancelled: 'var(--text-light)',
};

const EMPTY = {
  resource_request_id: '', employee_id: '', contract_id: '',
  weekly_hours: 20, start_date: '', end_date: '',
  role_title: '', notes: '', status: 'planned',
};

function AssignmentForm({ initial, requests, employees, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // When the user picks a request, auto-fill contract_id.
  const selectedRequest = requests.find((r) => r.id === form.resource_request_id);

  /* --- US-VAL-4: live pre-validation --------------------------------
   * Debounce-call GET /api/assignments/validate whenever the four
   * inputs (employee, request, hours, start_date) are populated. The
   * response drives <AssignmentValidationInline /> so the user sees
   * area/level/capacity/date feedback before hitting Save.
   *
   * On edit we pass `ignore_assignment_id` so the endpoint excludes
   * the current assignment from the committed-hours sum — otherwise
   * we'd double-count the user's own hours and report false positives.
   */
  const [preVal, setPreVal] = useState({
    loading: false, validation: null, error: null,
  });
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
      employee_id: form.employee_id,
      request_id:  form.resource_request_id,
      weekly_hours: String(form.weekly_hours),
      start_date: String(form.start_date).slice(0, 10),
    });
    if (form.end_date) qs.set('end_date', String(form.end_date).slice(0, 10));
    if (initial?.id) qs.set('ignore_assignment_id', initial.id);
    const timer = setTimeout(async () => {
      try {
        const v = await apiGet(`/api/assignments/validate?${qs.toString()}`);
        if (!cancelled) setPreVal({ loading: false, validation: v, error: null });
      } catch (ex) {
        if (!cancelled) {
          setPreVal({ loading: false, validation: null, error: ex.message || 'Error' });
        }
      }
    }, 350); // debounce
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
        <label style={s.label}>Solicitud *</label>
        <select style={s.input} value={form.resource_request_id || ''} onChange={(e) => set('resource_request_id', e.target.value)} aria-label="Solicitud" required disabled={!!initial?.id}>
          <option value="">— Selecciona —</option>
          {requests.map((r) => <option key={r.id} value={r.id}>{r.role_title} · {r.contract_name} · {r.level}</option>)}
        </select>
        {selectedRequest && (
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>
            Contrato: {selectedRequest.contract_name} · Cantidad: {selectedRequest.quantity} · Activos: {selectedRequest.active_assignments_count ?? 0}
          </div>
        )}
      </div>
      <div>
        <label style={s.label}>Empleado *</label>
        <select style={s.input} value={form.employee_id || ''} onChange={(e) => set('employee_id', e.target.value)} aria-label="Empleado" required disabled={!!initial?.id}>
          <option value="">— Selecciona —</option>
          {employees.filter((e) => e.status !== 'terminated').map((e) => (
            <option key={e.id} value={e.id}>
              {e.first_name} {e.last_name} · {e.level} · {e.weekly_capacity_hours}h cap.
            </option>
          ))}
        </select>
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

export default function Assignments() {
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [statusFilter, setStatusFilter] = useState('');
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [validationModal, setValidationModal] = useState(null); // { validation, advisories, pendingForm }

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (statusFilter) qs.set('status', statusFilter);
    try {
      const r = await apiGet(`/api/assignments?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando asignaciones: ' + e.message);
    }
  }, [statusFilter]);

  const loadLookups = useCallback(async () => {
    try {
      const [rr, re] = await Promise.all([
        apiGet('/api/resource-requests?limit=200'),
        apiGet('/api/employees?limit=200'),
      ]);
      setRequests((rr?.data || []).filter((r) => !['filled', 'cancelled'].includes(r.status)));
      setEmployees(re?.data || []);
    } catch {
      setRequests([]); setEmployees([]);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadLookups(); }, [loadLookups]);

  /**
   * Submit the form. On a validation 409 we surface the modal with the
   * structured checklist so the user can either close (non-overridable)
   * or provide a justification (overridable → retry with override_reason).
   */
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
        // Derive a validation payload compatible with the modal.
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
      throw e; // Let the form surface the message
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
    if (!window.confirm(`¿Eliminar asignación? (si tiene time entries, se convertirá en cancelación + soft delete para preservar historia)`)) return;
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
            onClick={async () => {
              try {
                const qs = new URLSearchParams();
                if (statusFilter) qs.set('status', statusFilter);
                await apiDownload(`/api/assignments/export.csv${qs.toString() ? `?${qs}` : ''}`, 'asignaciones.csv');
              } catch (e) {
                // eslint-disable-next-line no-alert
                alert(`No se pudo descargar: ${e.message}`);
              }
            }}
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
        <div style={s.filters}>
          <div style={{ minWidth: 160 }}>
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
                {['Empleado', 'Contrato', 'Role (solicitud)', 'h/sem', 'Inicio', 'Fin', 'Estado', ''].map((h) => (
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
                  Sin asignaciones todavía.
                </td></tr>
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
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => { setEditing(a); setShowForm(true); }}
                            aria-label={`Editar asignación de ${a.employee_first_name} ${a.employee_last_name}`}>Editar</button>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={() => onDelete(a)}
                            aria-label={`Eliminar asignación de ${a.employee_first_name} ${a.employee_last_name}`}>Eliminar</button>
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
              Página {state.page} de {state.pages} · {state.total} asignaciones
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

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
