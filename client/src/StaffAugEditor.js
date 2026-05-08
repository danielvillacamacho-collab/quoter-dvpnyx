import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from './utils/api';
import StaffAugEditorUnified from './StaffAugEditorUnified';
import useQuotationLookups from './hooks/useQuotationLookups';
import { calcStaffAugLine, formatUSD, formatPct, SPECIALTIES, EMPTY_LINE } from './utils/calc';
import { TABLE_CLASS } from './shell/tableStyles';
import FilterableSelect from './shell/FilterableSelect';
import CreateClientOppModal from './modules/CreateClientOppModal';

/**
 * Spec 3 (spec_capacity_editor.docx, Abril 2026) — por defecto renderizamos
 * el editor single-page unificado; el editor clásico en tabla queda como
 * fallback accesible desde el toggle "Vista clásica" en el header. La
 * preferencia persiste en localStorage, igual que el editor de proyectos.
 */
const CLASSIC_PREF_KEY = 'dvpnyx_staff_aug_editor_classic';

export default function StaffAugEditor({ params, context }) {
  const [classicView, setClassicView] = useState(() => {
    try { return localStorage.getItem(CLASSIC_PREF_KEY) === '1'; }
    catch (_) { return false; }
  });
  const switchToClassic = useCallback(() => {
    try { localStorage.setItem(CLASSIC_PREF_KEY, '1'); } catch (_) {}
    setClassicView(true);
  }, []);
  const switchToUnified = useCallback(() => {
    try { localStorage.removeItem(CLASSIC_PREF_KEY); } catch (_) {}
    setClassicView(false);
  }, []);

  if (!classicView) {
    return <StaffAugEditorUnified params={params} context={context} onSwitchToClassic={switchToClassic} />;
  }
  return <StaffAugEditorClassic params={params} context={context} onSwitchToUnified={switchToUnified} />;
}

/* ========== CLASSIC VIEW (legacy inline table, preserved for fallback) ========== */
const css = {
  card: { background: '#fff', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid var(--border)' },
  btn: (color = 'var(--purple-dark)') => ({ background: color, color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnOutlineSm: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  input: { padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'white', outline: 'none', width: '100%' },
  select: { padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'white', cursor: 'pointer' },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text-light)', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'white', background: 'var(--purple-dark)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 },
  metric: { textAlign: 'center' },
  metricValue: { fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ds-text, var(--purple-dark))', fontFamily: 'var(--font-ui, inherit)' },
  metricLabel: { fontSize: 11, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 },
  inlineBtn: { background: 'transparent', color: 'var(--teal-mid)', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0, marginTop: 4 },
};

function StaffAugEditorClassic({ params, context, onSwitchToUnified }) {
  const nav = useNavigate();
  const { id: quotId, type: newType } = useParams();
  const isNew = !!newType;

  const [saving, setSaving] = useState(false);
  const [createModal, setCreateModal] = useState(null);
  const [data, setData] = useState({
    type: newType || 'staff_aug',
    client_id: context?.client_id || null,
    opportunity_id: context?.opportunity_id || null,
    project_name: '', client_name: context?.client_name || '',
    commercial_name: '', commercial_user_id: null, preventa_name: '',
    discount_pct: 0, notes: '', status: 'draft', lines: [{ ...EMPTY_LINE }], metadata: {},
  });

  const lookups = useQuotationLookups(data.client_id);

  useEffect(() => {
    if (quotId) {
      api.getQuotation(quotId).then(q => setData({ ...q, lines: q.lines?.length ? q.lines : [{ ...EMPTY_LINE }] })).catch(() => nav('/'));
    }
  }, [quotId, nav]);

  const updateField = (field, value) => setData(d => ({ ...d, [field]: value }));
  const updateMulti = (patch) => setData(d => ({ ...d, ...patch }));
  const updateLine = (idx, field, value) => {
    setData(d => {
      const lines = [...d.lines];
      lines[idx] = { ...lines[idx], [field]: value };
      if (params) lines[idx] = calcStaffAugLine(lines[idx], params);
      return { ...d, lines };
    });
  };
  const addLine = () => setData(d => ({ ...d, lines: [...d.lines, { ...EMPTY_LINE }] }));
  const removeLine = (idx) => setData(d => ({ ...d, lines: d.lines.filter((_, i) => i !== idx) }));

  const totalMonthly = data.lines.reduce((s, l) => s + (l.rate_month || 0) * (l.quantity || 1), 0);
  const totalContract = data.lines.reduce((s, l) => s + (l.total || 0), 0);

  const canSave = !!((data.project_name || '').trim() && data.client_id && data.opportunity_id);

  const save = async (status) => {
    if (!canSave) {
      // eslint-disable-next-line no-alert
      alert('Completa el nombre del proyecto, selecciona un cliente y una oportunidad antes de guardar.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...data, status: status || data.status };
      if (quotId) { await api.updateQuotation(quotId, payload); }
      else {
        const q = await api.createQuotation(payload);
        nav(`/quotation/${q.id}`, { replace: true });
      }
      // eslint-disable-next-line no-alert
      alert('Cotización guardada');
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreated = (result) => {
    setCreateModal(null);
    const patch = {};
    if (result.client_id) {
      patch.client_id = result.client_id;
      patch.client_name = result.client_name || '';
      lookups.addClient({ id: result.client_id, name: result.client_name });
    }
    if (result.opportunity_id) {
      patch.opportunity_id = result.opportunity_id;
      lookups.addOpportunity({ id: result.opportunity_id, name: result.opportunity_name, status: 'open' });
    }
    updateMulti(patch);
  };

  const countries = params?.geo?.map(p => p.key) || [];
  const stacks = params?.stack?.map(p => p.key) || [];
  const modalities = params?.modality?.map(p => p.key) || [];
  const toolsOpts = params?.tools?.map(p => p.key) || [];

  const clientOptions = (lookups.clients || []).map((c) => ({ id: String(c.id), label: c.name }));
  const oppOptions = (lookups.opportunities || []).map((o) => ({ id: String(o.id), label: `${o.name} (${o.status})` }));
  const commercialOptions = (lookups.commercials || []).map((u) => ({ id: String(u.id), label: u.name }));

  return (
    <div>
      <div className="editor-header">
        <div>
          <button onClick={() => nav('/')} style={{ ...css.btnOutline, padding: '6px 12px', fontSize: 11, marginRight: 12 }}>← Volver</button>
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ds-text, var(--purple-dark))', fontFamily: 'var(--font-ui, inherit)' }}>
            {isNew ? 'Nueva Cotización' : 'Editar Cotización'} — Staff Augmentation
          </span>
        </div>
        <div className="editor-actions">
          {onSwitchToUnified && (
            <button type="button" style={css.btnOutlineSm} onClick={onSwitchToUnified} title="Cambiar a la vista unificada (nueva)">Vista unificada</button>
          )}
          <button style={css.btnOutline} onClick={() => save()} disabled={saving || !canSave}>{saving ? 'Guardando...' : 'Guardar borrador'}</button>
          <button style={css.btn('var(--teal-mid)')} onClick={() => save('sent')} disabled={saving || !canSave}>Guardar como Enviada</button>
        </div>
      </div>

      <div style={css.card}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text, var(--purple-dark))', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.04 }}>Datos del Proyecto</h3>
        <div className="project-info-grid">
          <div>
            <label style={css.label}>Nombre del Proyecto *</label>
            <input style={css.input} value={data.project_name || ''} onChange={e => updateField('project_name', e.target.value)} />
          </div>
          <div>
            <label style={css.label}>Cliente *</label>
            <FilterableSelect
              aria-label="Cliente"
              inputStyle={css.input}
              value={data.client_id ? String(data.client_id) : ''}
              onChange={(e) => {
                const cid = e.target.value || null;
                const cl = lookups.clients.find((c) => String(c.id) === cid);
                updateMulti({ client_id: cid, client_name: cl?.name || '', opportunity_id: null });
              }}
              placeholder="— Buscar cliente —"
              options={clientOptions}
            />
            <button type="button" style={css.inlineBtn} onClick={() => setCreateModal('client')}>+ Crear cliente</button>
          </div>
          <div>
            <label style={css.label}>Oportunidad *</label>
            <FilterableSelect
              aria-label="Oportunidad"
              inputStyle={css.input}
              value={data.opportunity_id ? String(data.opportunity_id) : ''}
              onChange={(e) => updateField('opportunity_id', e.target.value || null)}
              placeholder={data.client_id ? '— Buscar oportunidad —' : '— Primero selecciona un cliente —'}
              disabled={!data.client_id}
              options={oppOptions}
            />
            {data.client_id && (
              <button type="button" style={css.inlineBtn} onClick={() => setCreateModal('opportunity')}>+ Crear oportunidad</button>
            )}
          </div>
          <div>
            <label style={css.label}>Responsable Comercial</label>
            <FilterableSelect
              aria-label="Responsable Comercial"
              inputStyle={css.input}
              value={data.commercial_user_id ? String(data.commercial_user_id) : ''}
              onChange={(e) => {
                const uid = e.target.value || null;
                const u = lookups.commercials.find((c) => String(c.id) === uid);
                updateMulti({ commercial_user_id: uid, commercial_name: u?.name || '' });
              }}
              placeholder="— Seleccionar —"
              options={commercialOptions}
            />
          </div>
          <div>
            <label style={css.label}>Ingeniero Pre-venta</label>
            <input style={css.input} value={data.preventa_name || ''} onChange={e => updateField('preventa_name', e.target.value)} />
          </div>
          <div>
            <label style={css.label}>Estado</label>
            <FilterableSelect
              value={data.status}
              onChange={e => updateField('status', e.target.value)}
              inputStyle={{ ...css.select, width: '100%' }}
              placeholder="— Selecciona —"
              options={[
                { id: 'draft', label: 'Borrador' },
                { id: 'sent', label: 'Enviada' },
                { id: 'approved', label: 'Aprobada' },
                { id: 'rejected', label: 'Rechazada' },
                { id: 'expired', label: 'Expirada' },
              ]}
            />
          </div>
          <div>
            <label style={css.label}>Descuento (%)</label>
            <input style={css.input} type="number" min={0} max={50} step={1} value={(data.discount_pct || 0) * 100} onChange={e => updateField('discount_pct', Number(e.target.value) / 100)} />
          </div>
        </div>
      </div>

      <div style={css.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text, var(--purple-dark))', margin: 0, textTransform: 'uppercase', letterSpacing: 0.04 }}>Recursos ({data.lines.length})</h3>
          <button style={css.btn('var(--teal-mid)')} onClick={addLine}>+ Agregar recurso</button>
        </div>
        <div className="table-wrapper">
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
            <thead><tr>
              {['#', 'Especialidad', 'Rol / Título', 'Nivel', 'País', 'Bilingüe', 'Herramientas', 'Stack', 'Modalidad', 'Cant', 'Meses', 'Tarifa/Mes', 'Total', ''].map(h => <th key={h} style={{ ...css.th, fontSize: 10, padding: '8px 6px' }}>{h}</th>)}
            </tr></thead>
            <tbody>{data.lines.map((line, idx) => (
              <tr key={idx}>
                <td style={{ ...css.td, textAlign: 'center', fontWeight: 600, width: 30 }}>{idx + 1}</td>
                <td style={css.td}><FilterableSelect inputStyle={{ ...css.select, width: 120, fontSize: 11 }} value={line.specialty} onChange={e => updateLine(idx, 'specialty', e.target.value)} placeholder="—" options={SPECIALTIES.map(sp => ({ id: sp, label: sp }))} /></td>
                <td style={css.td}><input style={{ ...css.input, width: 140, fontSize: 12, padding: 6 }} value={line.role_title || ''} onChange={e => updateLine(idx, 'role_title', e.target.value)} placeholder="Ej: Senior React Dev" /></td>
                <td style={css.td}><FilterableSelect inputStyle={{ ...css.select, width: 50, fontSize: 11 }} value={line.level ? String(line.level) : ''} onChange={e => updateLine(idx, 'level', Number(e.target.value))} placeholder="—" options={[1,2,3,4,5,6,7,8,9,10,11].map(n => ({ id: String(n), label: `L${n}` }))} /></td>
                <td style={css.td}><FilterableSelect inputStyle={{ ...css.select, width: 100, fontSize: 11 }} value={line.country} onChange={e => updateLine(idx, 'country', e.target.value)} placeholder="—" options={countries.map(c => ({ id: c, label: c }))} /></td>
                <td style={{ ...css.td, textAlign: 'center' }}><input type="checkbox" checked={line.bilingual || false} onChange={e => updateLine(idx, 'bilingual', e.target.checked)} /></td>
                <td style={css.td}><FilterableSelect inputStyle={{ ...css.select, width: 110, fontSize: 11 }} value={line.tools} onChange={e => updateLine(idx, 'tools', e.target.value)} placeholder="—" options={toolsOpts.map(t => ({ id: t, label: t }))} /></td>
                <td style={css.td}><FilterableSelect inputStyle={{ ...css.select, width: 110, fontSize: 11 }} value={line.stack} onChange={e => updateLine(idx, 'stack', e.target.value)} placeholder="—" options={stacks.map(st => ({ id: st, label: st }))} /></td>
                <td style={css.td}><FilterableSelect inputStyle={{ ...css.select, width: 100, fontSize: 11 }} value={line.modality} onChange={e => updateLine(idx, 'modality', e.target.value)} placeholder="—" options={modalities.map(m => ({ id: m, label: m }))} /></td>
                <td style={css.td}><input style={{ ...css.input, width: 45, fontSize: 12, padding: 6, textAlign: 'center' }} type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} /></td>
                <td style={css.td}><input style={{ ...css.input, width: 45, fontSize: 12, padding: 6, textAlign: 'center' }} type="number" min={1} value={line.duration_months} onChange={e => updateLine(idx, 'duration_months', Number(e.target.value))} /></td>
                <td style={{ ...css.td, fontWeight: 600, color: 'var(--ds-text, var(--purple-dark))', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)', fontFeatureSettings: "'tnum'" }}>{formatUSD(line.rate_month)}</td>
                <td style={{ ...css.td, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>{formatUSD(line.total)}</td>
                <td style={css.td}><button onClick={() => removeLine(idx)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="summary-grid">
        <div style={{ ...css.card, ...css.metric }}>
          <div style={css.metricValue}>{formatUSD(totalMonthly)}</div>
          <div style={css.metricLabel}>Valor mensual total</div>
        </div>
        <div style={{ ...css.card, ...css.metric }}>
          <div style={{ ...css.metricValue, color: 'var(--success)' }}>{formatUSD(totalContract)}</div>
          <div style={css.metricLabel}>Valor total del contrato</div>
        </div>
        <div style={{ ...css.card, ...css.metric }}>
          <div style={{ ...css.metricValue, color: 'var(--teal-mid)' }}>{formatUSD(totalContract * (1 - (data.discount_pct || 0)))}</div>
          <div style={css.metricLabel}>Con descuento ({formatPct(data.discount_pct)})</div>
        </div>
      </div>

      {createModal && (
        <CreateClientOppModal
          mode={createModal}
          clientId={data.client_id}
          clientName={data.client_name}
          onCreated={handleCreated}
          onCancel={() => setCreateModal(null)}
        />
      )}
    </div>
  );
}
