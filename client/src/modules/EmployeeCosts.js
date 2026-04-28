/**
 * Vista masiva de costos del equipo (Configuración → Costos del equipo).
 *
 * Spec: spec_costos_empleado.docx — "Ubicación 2: Vista de gestión masiva".
 *
 * Acciones principales:
 *   - Seleccionar período (default mes actual).
 *   - Cargar costo por fila (input numérico) con cálculo USD en vivo.
 *   - "Copiar del mes anterior" (no guarda hasta que el usuario presione Guardar todo).
 *   - "Guardar todo" → bulk/commit en transacción.
 *   - "Cerrar período" → lock (admin); reapertura sólo superadmin.
 *   - Importar CSV (preview + commit).
 *   - Δ vs teórico con semáforo.
 *
 * Acceso: admin/superadmin only (PII salarial). Usuarios sin rol → mensaje.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/apiV2';
import { useAuth } from '../AuthContext';
import {
  VALID_CURRENCIES, formatPeriod, normalizePeriod, currentPeriod,
  previousPeriod, recentPeriods, formatMoney, defaultCurrencyForCountry,
  deltaZoneColor, deltaZoneLabel,
} from '../utils/cost';

const s = {
  page:   { maxWidth: 1500, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({
    background: c, color: '#fff', border: 'none', borderRadius: 8,
    padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat',
  }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  input:  { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, width: '100%', outline: 'none' },
  label:  { fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 0.5 },
  th:     { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:     { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  metric: { background: 'var(--ds-bg-soft, #fafafa)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, flex: 1, minWidth: 160 },
  metricLabel: { fontSize: 11, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue: { fontSize: 22, fontWeight: 600, color: 'var(--purple-dark)', marginTop: 2 },
};

export default function EmployeeCosts() {
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const isSuperadmin = auth.user?.role === 'superadmin';

  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState({ data: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Edición en memoria: rows que el usuario ha tocado pero NO guardado.
  // Map: employee_id → { currency, gross_cost, notes }
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  // Modal de proyección a futuro.
  const [projectModal, setProjectModal] = useState(null); // null | { monthsAhead, growthPct, basePeriod, preview }

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true); setErr('');
    try {
      const r = await apiGet(`/api/employee-costs?period=${period}`);
      setData({ data: r?.data || [], summary: r?.summary || null });
      setDrafts({});
    } catch (e) {
      setData({ data: [], summary: null });
      setErr(e.message || 'Error');
    } finally { setLoading(false); }
  }, [period, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const dirtyCount = Object.keys(drafts).length;

  const setDraft = (empId, patch) => {
    setDrafts((d) => ({ ...d, [empId]: { ...(d[empId] || {}), ...patch } }));
  };

  const effectiveRow = (row) => {
    // Une el costo guardado con el draft local (si lo hay).
    const draft = drafts[row.employee.id];
    if (!draft) return row;
    return {
      ...row,
      cost: {
        ...(row.cost || {}),
        currency: draft.currency ?? row.cost?.currency ?? defaultCurrencyForCountry(row.employee.country),
        gross_cost: draft.gross_cost ?? row.cost?.gross_cost,
        notes: draft.notes ?? row.cost?.notes,
        _dirty: true,
      },
    };
  };

  const saveAll = async () => {
    if (dirtyCount === 0) return;
    setBusy(true); setToast(null);
    try {
      const items = Object.entries(drafts).map(([employee_id, d]) => ({
        employee_id,
        currency: d.currency || (data.data.find((r) => r.employee.id === employee_id)?.cost?.currency)
          || defaultCurrencyForCountry(data.data.find((r) => r.employee.id === employee_id)?.employee.country),
        gross_cost: Number(d.gross_cost),
        notes: d.notes || null,
      })).filter((it) => Number.isFinite(it.gross_cost) && it.gross_cost >= 0);
      if (items.length === 0) {
        setToast({ ok: false, msg: 'No hay items con costo válido para guardar.' });
        return;
      }
      const result = await apiPost('/api/employee-costs/bulk/commit', { period, items });
      const created = result.applied?.filter((a) => a.action === 'created').length || 0;
      const updated = result.applied?.filter((a) => a.action === 'updated').length || 0;
      setToast({
        ok: true,
        msg: `✓ ${created} creados · ${updated} actualizados${result.warnings?.length ? ` · ${result.warnings.length} warnings FX` : ''}`,
      });
      await load();
    } catch (e) {
      setToast({ ok: false, msg: e.message || 'Error guardando' });
    } finally { setBusy(false); }
  };

  const copyFromPrev = async () => {
    setBusy(true); setToast(null);
    try {
      const result = await apiPost('/api/employee-costs/copy-from-previous', { period });
      setToast({
        ok: true,
        msg: `✓ ${result.copied} costos copiados desde ${formatPeriod(result.from_period)}${result.skipped ? ` · ${result.skipped} omitidos (ya existían o empleado no activo)` : ''}`,
      });
      await load();
    } catch (e) {
      setToast({ ok: false, msg: e.message || 'Error copiando' });
    } finally { setBusy(false); }
  };

  const lockPeriod = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(
      `¿Cerrar el período ${formatPeriod(period)}?\n\n` +
      `Una vez cerrado, solo un superadmin puede modificar los costos. ` +
      `Esta acción se registra en audit log.`
    )) return;
    setBusy(true);
    try {
      const result = await apiPost(`/api/employee-costs/lock/${period}`, {});
      setToast({ ok: true, msg: `✓ ${result.locked_count} costos cerrados en ${formatPeriod(period)}` });
      await load();
    } catch (e) {
      setToast({ ok: false, msg: e.message });
    } finally { setBusy(false); }
  };

  const unlockPeriod = async () => {
    if (!isSuperadmin) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Reabrir el período ${formatPeriod(period)}?\n\nSólo un superadmin puede hacer esto.`)) return;
    setBusy(true);
    try {
      const result = await apiPost(`/api/employee-costs/unlock/${period}`, {});
      setToast({ ok: true, msg: `✓ ${result.unlocked_count} costos reabiertos en ${formatPeriod(period)}` });
      await load();
    } catch (e) {
      setToast({ ok: false, msg: e.message });
    } finally { setBusy(false); }
  };

  const recalculate = async () => {
    setBusy(true);
    try {
      const result = await apiPost(`/api/employee-costs/recalculate-usd/${period}`, {});
      setToast({
        ok: true,
        msg: `✓ Recalculado en ${formatPeriod(period)}: ${result.updated} actualizados, ${result.unchanged} sin cambios`,
      });
      await load();
    } catch (e) {
      setToast({ ok: false, msg: e.message });
    } finally { setBusy(false); }
  };

  /* Proyección a futuro: 2 fases — preview, luego apply. */
  const openProjectModal = () => {
    setProjectModal({ monthsAhead: 6, growthPct: 0, basePeriod: '', preview: null, err: '' });
  };
  const updateProjectField = (k, v) => setProjectModal((m) => ({ ...m, [k]: v, preview: null, err: '' }));
  const projectPreview = async () => {
    if (!projectModal) return;
    setBusy(true);
    try {
      const result = await apiPost('/api/employee-costs/project-to-future', {
        base_period: projectModal.basePeriod || undefined,
        months_ahead: Number(projectModal.monthsAhead),
        growth_pct: Number(projectModal.growthPct) || 0,
        dry_run: true,
      });
      setProjectModal((m) => ({ ...m, preview: result, err: '' }));
    } catch (e) {
      setProjectModal((m) => ({ ...m, err: e.message || 'Error', preview: null }));
    } finally { setBusy(false); }
  };
  const projectApply = async () => {
    if (!projectModal?.preview) return;
    setBusy(true);
    try {
      const result = await apiPost('/api/employee-costs/project-to-future', {
        base_period: projectModal.preview.base_period,
        months_ahead: projectModal.preview.months_ahead,
        growth_pct: projectModal.preview.growth_pct,
        dry_run: false,
      });
      setToast({
        ok: true,
        msg: `✓ Proyección aplicada: ${result.created} creados, ${result.updated} actualizados, ${result.skipped_existing} preservados (manuales), ${result.skipped_locked} cerrados, ${result.skipped_inactive} inactivos.`,
      });
      setProjectModal(null);
      await load();
    } catch (e) {
      setProjectModal((m) => ({ ...m, err: e.message }));
    } finally { setBusy(false); }
  };

  const periodOptions = useMemo(() => recentPeriods(18), []);
  const withoutCostList = useMemo(
    () => data.data.filter((r) => !r.cost && !drafts[r.employee.id]),
    [data, drafts]
  );

  if (!isAdmin) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, background: '#fffbe6', borderColor: '#facc15', color: '#92400e' }}>
          <strong>Acceso restringido.</strong> Solo admin/superadmin pueden ver costos del equipo.
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={s.h1}>💰 Costos del equipo</h1>
          <div style={s.sub}>
            Costo empresa mensual real por empleado. Visible solo para admin/superadmin. Spec original:
            <code style={{ marginLeft: 6 }}>spec_costos_empleado.docx</code>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <div style={s.label}>Período</div>
            <select
              style={{ ...s.input, width: 140 }}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Período"
            >
              {periodOptions.map((p) => <option key={p} value={p}>{formatPeriod(p)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Métricas arriba */}
      {data.summary && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={s.metric}>
            <div style={s.metricLabel}>Empleados con costo</div>
            <div style={s.metricValue}>{data.summary.with_cost} <span style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 400 }}>/ {data.summary.total_employees}</span></div>
            {data.summary.total_employees > 0 && (
              <div style={{ height: 4, background: '#eee', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(data.summary.with_cost / data.summary.total_employees) * 100}%`,
                  background: 'var(--ds-ok, #16a34a)',
                }} />
              </div>
            )}
          </div>
          <div style={s.metric}>
            <div style={s.metricLabel}>Costo total USD</div>
            <div style={s.metricValue}>{formatMoney(data.summary.total_cost_usd, 'USD', { decimals: 0 })}</div>
          </div>
          <div style={s.metric}>
            <div style={s.metricLabel}>Promedio USD</div>
            <div style={s.metricValue}>{formatMoney(data.summary.avg_cost_usd, 'USD', { decimals: 0 })}</div>
          </div>
          <div style={s.metric}>
            <div style={s.metricLabel}>Cerrados (🔒)</div>
            <div style={s.metricValue}>{data.summary.locked_count}</div>
          </div>
        </div>
      )}

      {/* Empleados sin costo */}
      {withoutCostList.length > 0 && (
        <details style={{ ...s.card, padding: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--orange, #ca8a04)' }}>
            ⚠ {withoutCostList.length} empleado{withoutCostList.length === 1 ? '' : 's'} sin costo registrado en {formatPeriod(period)} (click para ver)
          </summary>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-light)' }}>
            {withoutCostList.map((r) => (
              <span key={r.employee.id} style={{ display: 'inline-block', margin: '4px 8px 4px 0', padding: '2px 8px', background: 'var(--ds-bg-soft, #fafafa)', borderRadius: 4 }}>
                {r.employee.first_name} {r.employee.last_name} ({r.employee.level})
              </span>
            ))}
          </div>
        </details>
      )}

      {/* Acciones masivas */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" style={s.btnOutline} onClick={copyFromPrev} disabled={busy}>
          📋 Copiar del mes anterior ({formatPeriod(previousPeriod(period))})
        </button>
        <button type="button" style={s.btnOutline} onClick={recalculate} disabled={busy}>
          🔄 Recalcular USD
        </button>
        <button type="button" style={s.btnOutline} onClick={openProjectModal} disabled={busy} title="Proyectar el último costo conocido a los próximos meses">
          📈 Proyectar a futuro
        </button>
        <button type="button" style={s.btnOutline} onClick={lockPeriod} disabled={busy} title="Marca todos los costos como cerrados">
          🔒 Cerrar período
        </button>
        {isSuperadmin && data.summary?.locked_count > 0 && (
          <button type="button" style={{ ...s.btnOutline, color: 'var(--danger, #b00020)', borderColor: 'var(--danger, #b00020)' }} onClick={unlockPeriod} disabled={busy}>
            🔓 Reabrir período (superadmin)
          </button>
        )}
        <Link to="/admin/employee-costs/import" style={{ ...s.btnOutline, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          ⤓ Importar CSV
        </Link>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          style={{ ...s.btn(dirtyCount > 0 ? 'var(--ds-ok, #16a34a)' : 'var(--ds-text-dim, #888)'), opacity: dirtyCount === 0 ? 0.6 : 1 }}
          onClick={saveAll}
          disabled={busy || dirtyCount === 0}
        >
          {busy ? 'Guardando…' : dirtyCount > 0 ? `💾 Guardar todo (${dirtyCount})` : '💾 Guardar todo'}
        </button>
      </div>

      {toast && (
        <div role="status" style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13,
          background: toast.ok ? '#e8f5ec' : '#fde8eb',
          border: `1px solid ${toast.ok ? '#10b981' : '#ef4444'}`,
          color: toast.ok ? '#065f46' : '#b00020',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{toast.msg}</span>
          <button type="button" onClick={() => setToast(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit' }} aria-label="Cerrar">×</button>
        </div>
      )}

      <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</div>}
        {err && <div style={{ padding: 20, color: 'var(--danger)' }}>{err}</div>}
        {!loading && !err && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
              <thead>
                <tr>{[
                  'Empleado', 'Nivel', 'Área', 'País', 'Teórico USD',
                  'Moneda', 'Costo bruto', 'Costo USD', 'Δ vs teórico',
                  'Estado', 'Notas',
                ].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr><td colSpan={11} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                    No hay empleados activos en {formatPeriod(period)}.
                  </td></tr>
                )}
                {data.data.map((row) => {
                  const eff = effectiveRow(row);
                  const empId = row.employee.id;
                  const draft = drafts[empId];
                  const isLocked = row.cost?.locked && !isSuperadmin;
                  const dirty = !!draft;
                  const currentCurrency = draft?.currency ?? row.cost?.currency ?? defaultCurrencyForCountry(row.employee.country);
                  const currentGross = draft?.gross_cost ?? row.cost?.gross_cost ?? '';
                  const currentNotes = draft?.notes ?? row.cost?.notes ?? '';
                  return (
                    <tr key={empId} style={dirty ? { background: 'rgba(var(--ds-ok-rgb, 22, 163, 74), 0.05)', boxShadow: 'inset 3px 0 0 var(--ds-ok, #16a34a)' } : {}}>
                      <td style={{ ...s.td, fontWeight: 600 }}>
                        <Link to={`/employees/${empId}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }}>
                          {row.employee.first_name} {row.employee.last_name}
                        </Link>
                        {row.is_new && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#dbeafe', color: '#1e40af' }}>Nuevo</span>}
                        {row.cost?.source === 'projected' && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#ede9fe', color: '#6b21a8' }} title="Costo proyectado automáticamente — edítalo si querés sobreescribir">📈 Proyectado</span>}
                        {row.cost?.source === 'copy_from_prev' && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#e0f2fe', color: '#075985' }}>📋 Copiado</span>}
                        {dirty && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#fef3c7', color: '#92400e' }}>Sin guardar</span>}
                      </td>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{row.employee.level}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>{row.employee.area_name || '—'}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>{row.employee.country}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: 'var(--text-light)' }}>
                        {row.theoretical_cost_usd != null ? formatMoney(row.theoretical_cost_usd, 'USD', { decimals: 0 }) : '—'}
                      </td>
                      <td style={s.td}>
                        <select
                          style={{ ...s.input, width: 80 }}
                          value={currentCurrency}
                          onChange={(e) => setDraft(empId, { currency: e.target.value })}
                          disabled={isLocked || busy}
                          aria-label={`Moneda ${row.employee.first_name}`}
                        >
                          {VALID_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td style={s.td}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          style={{ ...s.input, width: 130, textAlign: 'right' }}
                          value={currentGross}
                          onChange={(e) => setDraft(empId, { gross_cost: e.target.value })}
                          disabled={isLocked || busy}
                          placeholder={row.theoretical_cost_usd != null ? `~${row.theoretical_cost_usd}` : '0'}
                          aria-label={`Costo bruto ${row.employee.first_name}`}
                        />
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 12 }}>
                        {row.cost?.cost_usd != null ? formatMoney(row.cost.cost_usd, 'USD', { decimals: 0 }) : (dirty ? '—' : '—')}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: deltaZoneColor(row.delta?.zone), fontWeight: 600 }}>
                        {row.delta?.deltaPct != null ? `${row.delta.deltaPct > 0 ? '+' : ''}${row.delta.deltaPct.toFixed(1)}%` : ''}
                        <span style={{ display: 'block', fontSize: 10, fontWeight: 400 }}>{deltaZoneLabel(row.delta?.zone)}</span>
                      </td>
                      <td style={{ ...s.td, fontSize: 12 }}>
                        {row.cost?.locked ? '🔒 Cerrado' : (row.cost ? '✏ Abierto' : '—')}
                      </td>
                      <td style={s.td}>
                        <input
                          type="text"
                          style={{ ...s.input, fontSize: 12 }}
                          value={currentNotes}
                          onChange={(e) => setDraft(empId, { notes: e.target.value })}
                          disabled={isLocked || busy}
                          placeholder="Opcional"
                          aria-label={`Notas ${row.employee.first_name}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de proyección a futuro */}
      {projectModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Proyectar costos a futuro"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}
          onClick={() => setProjectModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, padding: 24, width: 640,
              maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
            }}
          >
            <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
              📈 Proyectar costos a futuro
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 6 }}>
              Toma el último costo conocido de cada empleado y crea entradas en los próximos meses.
              No sobrescribe entradas manuales ni períodos cerrados. Reproyectable cuantas veces sea necesario.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <div>
                <label style={s.label}>Período base (opcional)</label>
                <select
                  style={s.input}
                  value={projectModal.basePeriod}
                  onChange={(e) => updateProjectField('basePeriod', e.target.value)}
                  aria-label="Período base"
                >
                  <option value="">— Último período con costos (auto) —</option>
                  {periodOptions.map((p) => <option key={p} value={p}>{formatPeriod(p)}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
                  Si lo dejas vacío, el sistema usa el último período con datos.
                </div>
              </div>
              <div>
                <label style={s.label}>Meses a proyectar *</label>
                <select
                  style={s.input}
                  value={projectModal.monthsAhead}
                  onChange={(e) => updateProjectField('monthsAhead', e.target.value)}
                  aria-label="Meses a proyectar"
                >
                  <option value={3}>3 meses</option>
                  <option value={6}>6 meses</option>
                  <option value={9}>9 meses</option>
                  <option value={12}>12 meses</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={s.label}>Crecimiento anual % (opcional)</label>
                <input
                  type="number"
                  min="-50"
                  max="200"
                  step="0.5"
                  style={s.input}
                  value={projectModal.growthPct}
                  onChange={(e) => updateProjectField('growthPct', e.target.value)}
                  placeholder="0 = mantener costo igual"
                  aria-label="Crecimiento anual"
                />
                <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
                  Ej: 5 → +5% por año, repartido mensualmente. 0 → costo plano sin incremento.
                </div>
              </div>
            </div>

            {projectModal.err && (
              <div style={{ marginTop: 12, color: 'var(--danger)', fontSize: 13 }}>{projectModal.err}</div>
            )}

            {projectModal.preview && (
              <div style={{ marginTop: 16, background: 'var(--ds-bg-soft, #fafafa)', padding: 12, borderRadius: 8, fontSize: 13 }}>
                <strong>Preview</strong> (no se ha aplicado nada todavía):
                <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                  <li>Período base: <strong>{formatPeriod(projectModal.preview.base_period)}</strong></li>
                  <li>Períodos destino: {projectModal.preview.target_periods.map(formatPeriod).join(', ')}</li>
                  <li>Va a <strong>crear</strong>: {projectModal.preview.would_create} rows nuevos</li>
                  <li>Va a <strong>actualizar</strong>: {projectModal.preview.would_update} proyecciones existentes</li>
                  {projectModal.preview.skipped_existing > 0 && (
                    <li style={{ color: 'var(--text-light)' }}>
                      Preserva {projectModal.preview.skipped_existing} entradas manuales (no se tocan)
                    </li>
                  )}
                  {projectModal.preview.skipped_locked > 0 && (
                    <li style={{ color: 'var(--text-light)' }}>
                      Salta {projectModal.preview.skipped_locked} rows en períodos cerrados
                    </li>
                  )}
                  {projectModal.preview.skipped_inactive > 0 && (
                    <li style={{ color: 'var(--text-light)' }}>
                      Salta {projectModal.preview.skipped_inactive} (empleado terminado/inactivo en ese mes)
                    </li>
                  )}
                  {projectModal.preview.warnings?.length > 0 && (
                    <li style={{ color: 'var(--orange, #ca8a04)' }}>
                      ⚠ {projectModal.preview.warnings.length} warnings de FX (tasa fallback o faltante)
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" style={s.btnOutline} onClick={() => setProjectModal(null)} disabled={busy}>
                Cancelar
              </button>
              {!projectModal.preview ? (
                <button type="button" style={s.btn()} onClick={projectPreview} disabled={busy}>
                  {busy ? 'Calculando…' : 'Calcular preview'}
                </button>
              ) : (
                <>
                  <button type="button" style={s.btnOutline} onClick={() => setProjectModal((m) => ({ ...m, preview: null }))} disabled={busy}>
                    Ajustar parámetros
                  </button>
                  <button type="button" style={s.btn('var(--ds-ok, #16a34a)')} onClick={projectApply} disabled={busy || (projectModal.preview.would_create + projectModal.preview.would_update === 0)}>
                    {busy ? 'Aplicando…' : `Aplicar (${projectModal.preview.would_create + projectModal.preview.would_update} rows)`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
