import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiGet, apiPost } from '../utils/apiV2';
import FilterableSelect from '../shell/FilterableSelect';

/**
 * SPEC-RM-00 — Bulk Assignment Modal.
 *
 * Allows admin/lead to assign multiple employees to a contract in one
 * operation. Workflow: pick contract → select employees → set hours/dates
 * → preview (dry_run) → confirm.
 */

const ms = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    zIndex: 1000, padding: '40px 16px', overflowY: 'auto',
  },
  panel: {
    background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius-lg, 10px)',
    width: 'min(720px, 100%)', padding: '20px 24px 24px',
    boxShadow: '0 10px 40px rgba(0,0,0,.25)',
  },
  title: { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--ds-text)' },
  sub: { fontSize: 12, color: 'var(--ds-text-dim)', marginTop: 4, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-soft, var(--text-light))', display: 'block', marginBottom: 4 },
  input: { width: '100%', padding: '7px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', fontSize: 13, background: 'var(--ds-surface)', color: 'var(--ds-text)', boxSizing: 'border-box' },
  row: { marginBottom: 14 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 },
  btn: { padding: '8px 16px', border: 'none', borderRadius: 'var(--ds-radius, 6px)', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnPrimary: { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff' },
  btnGhost: { background: 'transparent', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' },
  btnDanger: { background: 'var(--ds-bad, #dc2626)', color: '#fff' },
  foot: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 },
  err: { color: 'var(--ds-bad, #ef4444)', fontSize: 13, marginBottom: 8, padding: '6px 10px', background: 'var(--ds-bad-soft, #fff0f0)', borderRadius: 6 },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
    borderBottom: '1px solid var(--ds-border, #eee)', fontSize: 13,
  },
  previewBox: {
    border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 8px)',
    padding: 14, marginTop: 12, background: 'var(--ds-bg-soft, #fafafa)',
  },
  previewStat: { display: 'flex', gap: 20, fontSize: 13, marginBottom: 8 },
  warningItem: {
    padding: '4px 8px', fontSize: 12, borderRadius: 4,
    background: 'var(--ds-warn-soft, #fffbea)',
    color: 'oklch(0.45 0.12 80)',
    marginTop: 4,
  },
};

export default function BulkAssignModal({ onClose, onDone, plannerData }) {
  const [step, setStep] = useState(1); // 1: configure, 2: select employees, 3: preview
  const [contracts, setContracts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Form
  const [contractId, setContractId] = useState('');
  const [requestId, setRequestId] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('40');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState(new Set());
  const [empSearch, setEmpSearch] = useState('');

  // Preview
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet('/api/rm/contracts/active')
      .then((d) => setContracts(d.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiGet('/api/employees?limit=500&status=active')
      .then((d) => setEmployees((d.data || d || []).filter((e) => e.status === 'active' || !e.status)))
      .catch(() => {});
  }, []);

  const filteredEmployees = useMemo(() => {
    const q = empSearch.toLowerCase().trim();
    if (!q) return employees;
    return employees.filter((e) => {
      const name = `${e.first_name || ''} ${e.last_name || ''}`.toLowerCase();
      return name.includes(q) || (e.area_name || '').toLowerCase().includes(q);
    });
  }, [employees, empSearch]);

  const toggleEmployee = useCallback((id) => {
    setSelectedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedEmployees(new Set(filteredEmployees.map((e) => e.id)));
  }, [filteredEmployees]);

  const clearAll = useCallback(() => {
    setSelectedEmployees(new Set());
  }, []);

  const canPreview = contractId && selectedEmployees.size > 0 && weeklyHours && startDate;

  const runPreview = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const assignments = [...selectedEmployees].map((empId) => ({
        employee_id: empId,
        contract_id: contractId,
        resource_request_id: requestId || undefined,
        weekly_hours: Number(weeklyHours),
        start_date: startDate,
        end_date: endDate || undefined,
        role_title: roleTitle || undefined,
      }));
      const res = await apiPost('/api/rm/assignments/bulk', { assignments, dry_run: true });
      setPreview(res);
      setStep(3);
    } catch (ex) {
      setErr(ex.message || 'Error en preview');
    } finally {
      setLoading(false);
    }
  }, [selectedEmployees, contractId, requestId, weeklyHours, startDate, endDate, roleTitle]);

  const confirm = useCallback(async () => {
    setSubmitting(true);
    setErr('');
    try {
      const assignments = [...selectedEmployees].map((empId) => ({
        employee_id: empId,
        contract_id: contractId,
        resource_request_id: requestId || undefined,
        weekly_hours: Number(weeklyHours),
        start_date: startDate,
        end_date: endDate || undefined,
        role_title: roleTitle || undefined,
      }));
      await apiPost('/api/rm/assignments/bulk', { assignments, dry_run: false });
      onDone();
      onClose();
    } catch (ex) {
      setErr(ex.message || 'Error al crear asignaciones');
    } finally {
      setSubmitting(false);
    }
  }, [selectedEmployees, contractId, requestId, weeklyHours, startDate, endDate, roleTitle, onDone, onClose]);

  const contractName = contracts.find((c) => String(c.id) === String(contractId))?.name || '';

  return (
    <div style={ms.overlay} role="dialog" aria-modal="true" aria-label="Asignacion en lote"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={ms.panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={ms.title}>Asignacion en lote</h2>
            <p style={ms.sub}>
              {step === 1 && 'Paso 1: Configura el contrato, horas y fechas.'}
              {step === 2 && 'Paso 2: Selecciona los empleados a asignar.'}
              {step === 3 && 'Paso 3: Revisa el resultado antes de confirmar.'}
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--ds-text-dim)' }} aria-label="Cerrar">&times;</button>
        </div>

        {err && <div style={ms.err}>{err}</div>}

        {/* Step 1: Configure */}
        {step === 1 && (
          <>
            <div style={ms.row}>
              <label style={ms.label}>Contrato</label>
              <FilterableSelect
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                inputStyle={ms.input}
                placeholder="Seleccionar contrato..."
                options={contracts.map((c) => ({ id: String(c.id), label: `${c.name}${c.client_name ? ` (${c.client_name})` : ''}` }))}
              />
            </div>
            <div style={ms.grid3}>
              <div>
                <label style={ms.label}>Horas / semana</label>
                <input style={ms.input} type="number" min="1" max="80" step="0.5"
                  value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value)} />
              </div>
              <div>
                <label style={ms.label}>Inicio</label>
                <input style={ms.input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label style={ms.label}>Fin (opcional)</label>
                <input style={ms.input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div style={ms.row}>
              <label style={ms.label}>Rol (opcional)</label>
              <input style={ms.input} type="text" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Ej: Frontend Developer" />
            </div>
            <div style={ms.foot}>
              <button type="button" style={{ ...ms.btn, ...ms.btnGhost }} onClick={onClose}>Cancelar</button>
              <button type="button" style={{ ...ms.btn, ...ms.btnPrimary }}
                disabled={!contractId || !startDate || !weeklyHours}
                onClick={() => setStep(2)}>
                Siguiente: Seleccionar empleados
              </button>
            </div>
          </>
        )}

        {/* Step 2: Select employees */}
        {step === 2 && (
          <>
            <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={{ ...ms.input, flex: 1 }} type="search" placeholder="Buscar por nombre o area..."
                value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
              <button type="button" style={{ ...ms.btn, ...ms.btnGhost, fontSize: 12, padding: '6px 10px' }} onClick={selectAll}>Todos</button>
              <button type="button" style={{ ...ms.btn, ...ms.btnGhost, fontSize: 12, padding: '6px 10px' }} onClick={clearAll}>Ninguno</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ds-text-dim)', marginBottom: 6 }}>
              {selectedEmployees.size} seleccionado{selectedEmployees.size !== 1 ? 's' : ''} de {employees.length}
            </div>
            <div style={{ maxHeight: 350, overflowY: 'auto', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)' }}>
              {filteredEmployees.map((emp) => {
                const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
                const checked = selectedEmployees.has(emp.id);
                return (
                  <label key={emp.id} style={{ ...ms.checkRow, background: checked ? 'var(--ds-accent-soft, #faf7ff)' : undefined, cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleEmployee(emp.id)} />
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <span style={{ fontSize: 11, color: 'var(--ds-text-dim)', marginLeft: 'auto' }}>
                      {emp.level || ''} {emp.area_name ? `· ${emp.area_name}` : ''}
                    </span>
                  </label>
                );
              })}
              {filteredEmployees.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ds-text-dim)', fontSize: 13 }}>
                  Sin resultados
                </div>
              )}
            </div>
            <div style={ms.foot}>
              <button type="button" style={{ ...ms.btn, ...ms.btnGhost }} onClick={() => setStep(1)}>Atras</button>
              <button type="button" style={{ ...ms.btn, ...ms.btnPrimary }}
                disabled={!canPreview || loading}
                onClick={runPreview}>
                {loading ? 'Verificando...' : `Preview (${selectedEmployees.size} empleados)`}
              </button>
            </div>
          </>
        )}

        {/* Step 3: Preview & confirm */}
        {step === 3 && preview && (
          <>
            <div style={ms.previewBox}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                Resultado del preview
              </div>
              <div style={ms.previewStat}>
                <span><strong>{preview.created}</strong> asignaciones a crear</span>
                {preview.skipped_locked > 0 && (
                  <span style={{ color: 'var(--ds-warn)' }}><strong>{preview.skipped_locked}</strong> omitidas (bloqueadas)</span>
                )}
              </div>
              {preview.warnings?.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Advertencias de capacidad:</div>
                  {preview.warnings.map((w, i) => {
                    const emp = employees.find((e) => e.id === w.employee_id);
                    const empName = emp ? `${emp.first_name} ${emp.last_name}` : w.employee_id;
                    return (
                      <div key={i} style={ms.warningItem}>
                        {empName}: {w.new_total}h/sem (umbral {w.threshold}h)
                      </div>
                    );
                  })}
                </div>
              )}
              {preview.errors?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-bad)', marginBottom: 4 }}>Errores:</div>
                  {preview.errors.map((e, i) => (
                    <div key={i} style={{ ...ms.warningItem, background: 'var(--ds-bad-soft, #fff0f0)', color: 'var(--ds-bad)' }}>
                      {e.detail || e.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ fontSize: 13, marginTop: 12, color: 'var(--ds-text)' }}>
              <strong>Contrato:</strong> {contractName}<br />
              <strong>Horas:</strong> {weeklyHours}h/sem<br />
              <strong>Periodo:</strong> {startDate}{endDate ? ` — ${endDate}` : ' (abierto)'}
            </div>

            <div style={ms.foot}>
              <button type="button" style={{ ...ms.btn, ...ms.btnGhost }} onClick={() => setStep(2)}>Atras</button>
              <button type="button"
                style={{ ...ms.btn, ...ms.btnPrimary }}
                disabled={submitting || preview.created === 0}
                onClick={confirm}>
                {submitting ? 'Creando...' : `Confirmar ${preview.created} asignaciones`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
