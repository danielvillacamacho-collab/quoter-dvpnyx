import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPut, apiPost, apiDelete } from '../utils/apiV2';
import StatusBadge from '../shell/StatusBadge';
import { useAuth } from '../AuthContext';
import {
  VALID_CURRENCIES, formatPeriod, normalizePeriod, currentPeriod,
  formatMoney, defaultCurrencyForCountry,
} from '../utils/cost';

const s = {
  page:   { maxWidth: 1100, margin: '0 auto' },
  h1:     { fontSize: 26, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 4px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  h2:     { fontSize: 16, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 12px' },
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  grid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 },
  label:  { fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 1 },
  value:  { fontSize: 14, color: 'var(--purple-dark)', fontWeight: 600, marginTop: 2 },
  th:     { padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left' },
  td:     { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
};

const STATUS_LABEL = { active: 'Activo', on_leave: 'De permiso', bench: 'En banca', terminated: 'Terminado' };
const STATUS_COLOR = { active: 'var(--success)', on_leave: 'var(--orange)', bench: 'var(--teal-mid)', terminated: 'var(--text-light)' };

function Field({ label, children }) {
  return (
    <div>
      <div style={s.label}>{label}</div>
      <div style={s.value}>{children || '—'}</div>
    </div>
  );
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  // useAuth() puede devolver undefined en tests que no envuelven con AuthProvider.
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const [emp, setEmp] = useState(null);
  const [skills, setSkills] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Lista de líderes posibles (admin/lead) para el picker de manager.
  const [managerCandidates, setManagerCandidates] = useState([]);
  const [savingManager, setSavingManager] = useState(false);

  // Costos: solo admin/superadmin cargan estos datos.
  const isSuperadmin = auth.user?.role === 'superadmin';
  const [costs, setCosts] = useState([]);
  const [costsLoaded, setCostsLoaded] = useState(false);
  const [costForm, setCostForm] = useState({
    period: currentPeriod(), currency: 'USD', gross_cost: '', notes: '',
  });
  const [costFormErr, setCostFormErr] = useState('');
  const [costSaving, setCostSaving] = useState(false);
  const [editingCostId, setEditingCostId] = useState(null);
  const [costWarnings, setCostWarnings] = useState([]);

  useEffect(() => {
    setLoading(true);
    const promises = [
      apiGet(`/api/employees/${id}`),
      apiGet(`/api/employees/${id}/skills`),
      apiGet(`/api/assignments?employee_id=${id}&limit=200`),
    ];
    if (isAdmin) {
      // Lista de usuarios con rol admin/lead/superadmin para el picker de manager.
      promises.push(apiGet('/api/users').catch(() => ({ data: [] })));
    }
    Promise.all(promises)
      .then(([e, sk, a, u]) => {
        setEmp(e || null);
        setSkills(sk?.data || []);
        setAssignments(a?.data || []);
        if (u) {
          const list = (u.data || u || []).filter((x) => ['admin', 'lead', 'superadmin'].includes(x.role));
          setManagerCandidates(list);
        }
        // Si el current user es admin/superadmin: pre-llenar moneda según país
        // del empleado (ahorra clicks a finanzas).
        if (e?.country) {
          setCostForm((f) => ({ ...f, currency: defaultCurrencyForCountry(e.country) }));
        }
      })
      .catch((e) => setErr(e.message || 'Error'))
      .finally(() => setLoading(false));
  }, [id, isAdmin]);

  // Carga separada de costos — sólo admin/superadmin (PII salarial).
  const loadCosts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await apiGet(`/api/employee-costs/employee/${id}`);
      setCosts(r?.history || []);
      setCostsLoaded(true);
    } catch (e) {
      setCosts([]);
      setCostsLoaded(true);
    }
  }, [id, isAdmin]);
  useEffect(() => { loadCosts(); }, [loadCosts]);

  const submitCost = async (e) => {
    e.preventDefault();
    setCostFormErr('');
    setCostWarnings([]);
    const period = normalizePeriod(costForm.period);
    if (!period) { setCostFormErr('Período inválido (formato YYYY-MM)'); return; }
    const gross = Number(costForm.gross_cost);
    if (!Number.isFinite(gross) || gross < 0) { setCostFormErr('Costo bruto debe ser un número >= 0'); return; }
    if (!VALID_CURRENCIES.includes(costForm.currency)) { setCostFormErr('Moneda inválida'); return; }
    setCostSaving(true);
    try {
      let result;
      if (editingCostId) {
        result = await apiPut(`/api/employee-costs/${editingCostId}`, {
          currency: costForm.currency, gross_cost: gross, notes: costForm.notes || null,
        });
      } else {
        result = await apiPost('/api/employee-costs', {
          employee_id: id, period, currency: costForm.currency,
          gross_cost: gross, notes: costForm.notes || null,
        });
      }
      setCostWarnings(result?.warnings || []);
      setEditingCostId(null);
      setCostForm({
        period: currentPeriod(),
        currency: emp?.country ? defaultCurrencyForCountry(emp.country) : 'USD',
        gross_cost: '', notes: '',
      });
      await loadCosts();
    } catch (ex) {
      setCostFormErr(ex.message || 'Error guardando');
    } finally { setCostSaving(false); }
  };

  const editCost = (c) => {
    setEditingCostId(c.id);
    setCostForm({
      period: formatPeriod(c.period),
      currency: c.currency,
      gross_cost: String(c.gross_cost),
      notes: c.notes || '',
    });
    setCostFormErr('');
    setCostWarnings([]);
  };

  const deleteCost = async (c) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar el costo de ${formatPeriod(c.period)}?`)) return;
    try {
      await apiDelete(`/api/employee-costs/${c.id}`);
      await loadCosts();
    } catch (ex) {
      // eslint-disable-next-line no-alert
      alert(ex.message);
    }
  };

  const updateManager = async (managerUserId) => {
    setSavingManager(true);
    try {
      const updated = await apiPut(`/api/employees/${id}`, { manager_user_id: managerUserId || null });
      setEmp(updated);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error guardando manager: ' + (e.message || ''));
    } finally { setSavingManager(false); }
  };

  if (loading) return <div style={s.page}><div style={{ color: 'var(--text-light)' }}>Cargando…</div></div>;
  if (err || !emp) return <div style={s.page}><div style={{ color: 'var(--danger)' }}>{err || 'Empleado no encontrado'}</div></div>;

  const activeHours = assignments
    .filter((a) => a.status === 'active')
    .reduce((sum, a) => sum + Number(a.weekly_hours || 0), 0);
  const utilization = emp.weekly_capacity_hours > 0 ? activeHours / Number(emp.weekly_capacity_hours) : 0;

  return (
    <div style={s.page}>
      <button type="button" style={{ ...s.btnOutline, marginBottom: 12 }} onClick={() => nav('/employees')}>← Empleados</button>

      <h1 style={s.h1}>🧑‍💻 {emp.first_name} {emp.last_name}</h1>
      <div style={s.sub}>
        {emp.area_name || '—'} · <strong>{emp.level}</strong> · {emp.country}
        {' · '}
        <StatusBadge domain="employee" value={emp.status} label={STATUS_LABEL[emp.status]} />
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Resumen</h2>
        <div style={s.grid}>
          <Field label="Email corporativo">{emp.corporate_email}</Field>
          <Field label="Email personal">{emp.personal_email}</Field>
          <Field label="Ciudad">{emp.city}</Field>
          <Field label="Tipo de contrato">{emp.employment_type}</Field>
          <Field label="Capacidad">{emp.weekly_capacity_hours ? `${Number(emp.weekly_capacity_hours)}h/sem` : null}</Field>
          <Field label="Inicio">{emp.start_date ? String(emp.start_date).slice(0, 10) : null}</Field>
          <Field label="Fin">{emp.end_date
            ? String(emp.end_date).slice(0, 10)
            : <span style={{ fontStyle: 'italic', color: 'var(--text-light)', fontWeight: 400 }}>Indefinida — proyectada al futuro</span>}
          </Field>
          <Field label="Seniority">{emp.seniority_label}</Field>
          <Field label="Cuenta de usuario">{emp.user_email || '—'}</Field>
        </div>
      </div>

      {isAdmin && (
        <div style={s.card}>
          <h2 style={s.h2}>Líder directo</h2>
          <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8 }}>
            Determina quién puede ver/editar el tiempo y los reportes plan-vs-real de este empleado (además de los admins).
          </div>
          <select
            value={emp.manager_user_id || ''}
            onChange={(e) => updateManager(e.target.value || null)}
            disabled={savingManager}
            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, minWidth: 280 }}
            aria-label="Líder directo"
          >
            <option value="">— Sin líder asignado —</option>
            {managerCandidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email} {u.role !== 'lead' ? `(${u.role})` : ''}
              </option>
            ))}
          </select>
          {savingManager && <span style={{ fontSize: 12, color: 'var(--text-light)', marginLeft: 10 }}>Guardando…</span>}
        </div>
      )}

      <div style={s.card}>
        <h2 style={s.h2}>Utilización</h2>
        <div style={s.grid}>
          <Field label="Asignadas">{activeHours.toFixed(1)}h / semana</Field>
          <Field label="Capacidad">{Number(emp.weekly_capacity_hours || 0)}h / semana</Field>
          <Field label="Utilización">
            <span style={{ color: utilization > 1 ? 'var(--danger)' : utilization > 0.7 ? 'var(--success)' : 'var(--orange)' }}>
              {(utilization * 100).toFixed(0)}%
            </span>
          </Field>
        </div>
      </div>

      {/* Costos: admin/superadmin only (PII salarial). */}
      {isAdmin && (
        <div style={s.card}>
          <h2 style={s.h2}>Costos {costs.length > 0 && `(${costs.length} períodos)`}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12 }}>
            Costo empresa mensual real. Visible solo para admin/superadmin. Los períodos cerrados (🔒) requieren superadmin para editar.
          </div>

          {!costsLoaded && <div style={{ color: 'var(--text-light)', fontSize: 13 }}>Cargando…</div>}

          {costsLoaded && costs.length > 0 && (
            <>
              {/* Card del último período */}
              {(() => {
                const latest = costs[0];
                return (
                  <div style={{
                    background: 'var(--ds-bg-soft, #fafafa)', borderRadius: 8, padding: 12,
                    marginBottom: 12, border: '1px solid var(--ds-border, #eee)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
                  }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-light)', textTransform: 'uppercase' }}>
                        Costo actual · {formatPeriod(latest.period)} {latest.locked && '🔒'}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--purple-dark)', marginTop: 2 }}>
                        {formatMoney(latest.gross_cost, latest.currency)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
                        {latest.currency !== 'USD' && (
                          <>≈ {formatMoney(latest.cost_usd, 'USD')} (tasa {latest.exchange_rate_used || '—'})</>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                <thead>
                  <tr>{['Período', 'Costo', 'Moneda', 'Costo USD', 'Tasa', 'Estado', 'Notas', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {costs.map((c) => (
                    <tr key={c.id}>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono, monospace)' }}>{formatPeriod(c.period)}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>{formatMoney(c.gross_cost, c.currency)}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>{c.currency}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>{c.cost_usd != null ? formatMoney(c.cost_usd, 'USD') : '—'}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 12 }}>{c.exchange_rate_used || '—'}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>
                        {c.locked ? '🔒 Cerrado' : '✏ Abierto'}
                        {c.source === 'projected' && (
                          <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#ede9fe', color: '#6b21a8' }} title="Proyectado automáticamente">📈</span>
                        )}
                      </td>
                      <td style={{ ...s.td, fontSize: 12 }}>{c.notes || '—'}</td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                          onClick={() => editCost(c)}
                          disabled={c.locked && !isSuperadmin}
                          aria-label={`Editar costo ${formatPeriod(c.period)}`}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger, #b00020)', borderColor: 'var(--danger, #b00020)' }}
                          onClick={() => deleteCost(c)}
                          disabled={c.locked && !isSuperadmin}
                          aria-label={`Eliminar costo ${formatPeriod(c.period)}`}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {costsLoaded && costs.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-light)', fontSize: 13, background: 'var(--ds-bg-soft, #fafafa)', borderRadius: 6, marginBottom: 12 }}>
              Sin costos registrados. Usa el formulario abajo para registrar el primero.
            </div>
          )}

          {/* Form de registrar/editar costo */}
          <form onSubmit={submitCost} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={s.label}>Período *</label>
              <input
                type="month"
                style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, width: '100%' }}
                value={formatPeriod(costForm.period)}
                onChange={(e) => setCostForm({ ...costForm, period: e.target.value })}
                disabled={!!editingCostId}
                required
                aria-label="Período"
              />
            </div>
            <div>
              <label style={s.label}>Moneda *</label>
              <select
                style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, width: '100%' }}
                value={costForm.currency}
                onChange={(e) => setCostForm({ ...costForm, currency: e.target.value })}
                aria-label="Moneda"
              >
                {VALID_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Costo bruto *</label>
              <input
                type="number"
                min="0"
                step="any"
                style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, width: '100%' }}
                value={costForm.gross_cost}
                onChange={(e) => setCostForm({ ...costForm, gross_cost: e.target.value })}
                placeholder="Ej: 12500000"
                aria-label="Costo bruto"
                required
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={s.label}>Notas (opcional)</label>
              <input
                type="text"
                style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, width: '100%' }}
                value={costForm.notes}
                onChange={(e) => setCostForm({ ...costForm, notes: e.target.value })}
                placeholder="Ej: incluye bono Q1, ajuste por ascenso"
                aria-label="Notas"
              />
            </div>
            {costFormErr && (
              <div style={{ gridColumn: '1 / -1', color: 'var(--danger)', fontSize: 13 }}>{costFormErr}</div>
            )}
            {costWarnings.length > 0 && (
              <div style={{ gridColumn: '1 / -1', background: '#fffbe6', border: '1px solid #facc15', color: '#92400e', padding: 8, borderRadius: 6, fontSize: 12 }}>
                {costWarnings.map((w, i) => <div key={i}>⚠ {w.message || `${w.code}${w.fallback_period ? ` (fallback: ${w.fallback_period})` : ''}`}</div>)}
              </div>
            )}
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {editingCostId && (
                <button type="button" style={s.btnOutline} onClick={() => {
                  setEditingCostId(null);
                  setCostForm({ period: currentPeriod(), currency: defaultCurrencyForCountry(emp?.country), gross_cost: '', notes: '' });
                  setCostFormErr(''); setCostWarnings([]);
                }}>Cancelar</button>
              )}
              <button
                type="submit"
                style={{
                  background: 'var(--purple-dark)', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: costSaving ? 'wait' : 'pointer',
                  opacity: costSaving ? 0.6 : 1,
                }}
                disabled={costSaving}
              >
                {costSaving ? 'Guardando…' : (editingCostId ? 'Actualizar' : '+ Registrar costo')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={s.card}>
        <h2 style={s.h2}>Skills ({skills.length})</h2>
        {skills.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin skills asignados. Edita al empleado desde la lista para agregar.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Skill', 'Categoría', 'Proficiency', 'Años', 'Notas'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {skills.map((sk) => (
                <tr key={sk.skill_id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{sk.skill_name}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{sk.skill_category || '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{sk.proficiency}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{sk.years_experience ?? '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{sk.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Asignaciones ({assignments.length})</h2>
        {assignments.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin asignaciones registradas.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Contrato', 'Role', 'h/sem', 'Inicio', 'Fin', 'Estado'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{a.contract_name || '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.request_role_title || a.role_title || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{Number(a.weekly_hours)}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.start_date ? String(a.start_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.end_date ? String(a.end_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
