import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from './utils/api';
import StaffAugEditorUnified from './StaffAugEditorUnified';
import { calcStaffAugLine, formatUSD, formatPct, SPECIALTIES, EMPTY_LINE } from './utils/calc';
import { TABLE_CLASS } from './shell/tableStyles';

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
/* Style object copied from App.js' `css` to keep the classic look-and-feel. */
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
};

function StaffAugEditorClassic({ params, context, onSwitchToUnified }) {
  const nav = useNavigate();
  const { id: quotId, type: newType } = useParams();
  const isNew = !!newType;

  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({
    type: newType || 'staff_aug',
    client_id: context?.client_id || null,
    opportunity_id: context?.opportunity_id || null,
    project_name: '', client_name: context?.client_name || '', commercial_name: '', preventa_name: '',
    discount_pct: 0, notes: '', status: 'draft', lines: [{ ...EMPTY_LINE }], metadata: {},
  });

  useEffect(() => {
    if (quotId) {
      api.getQuotation(quotId).then(q => setData({ ...q, lines: q.lines?.length ? q.lines : [{ ...EMPTY_LINE }] })).catch(() => nav('/'));
    }
  }, [quotId, nav]);

  const updateField = (field, value) => setData(d => ({ ...d, [field]: value }));
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

  const save = async (status) => {
    setSaving(true);
    try {
      const payload = { ...data, status: status || data.status };
      if (quotId) { await api.updateQuotation(quotId, payload); }
      else { const q = await api.createQuotation(payload); nav(`/quotation/${q.id}`, { replace: true }); }
      // eslint-disable-next-line no-alert
      alert('Cotización guardada');
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const countries = params?.geo?.map(p => p.key) || [];
  const stacks = params?.stack?.map(p => p.key) || [];
  const modalities = params?.modality?.map(p => p.key) || [];
  const toolsOpts = params?.tools?.map(p => p.key) || [];

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
          <button style={css.btnOutline} onClick={() => save()} disabled={saving}>{saving ? 'Guardando...' : 'Guardar borrador'}</button>
          <button style={css.btn('var(--teal-mid)')} onClick={() => save('sent')} disabled={saving}>Guardar como Enviada</button>
        </div>
      </div>

      <div style={css.card}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text, var(--purple-dark))', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.04 }}>Datos del Proyecto</h3>
        <div className="project-info-grid">
          {[
            ['project_name', 'Nombre del Proyecto'],
            ['client_name', 'Cliente'],
            ['commercial_name', 'Responsable Comercial'],
            ['preventa_name', 'Ingeniero Pre-venta'],
          ].map(([field, label]) => (
            <div key={field}>
              <label style={css.label}>{label}</label>
              <input style={css.input} value={data[field] || ''} onChange={e => updateField(field, e.target.value)} />
            </div>
          ))}
          <div>
            <label style={css.label}>Estado</label>
            <select style={{ ...css.select, width: '100%' }} value={data.status} onChange={e => updateField('status', e.target.value)}>
              {['draft', 'sent', 'approved', 'rejected', 'expired'].map(st => (
                <option key={st} value={st}>
                  {({ draft: 'Borrador', sent: 'Enviada', approved: 'Aprobada', rejected: 'Rechazada', expired: 'Expirada' }[st])}
                </option>
              ))}
            </select>
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
                <td style={css.td}><select style={{ ...css.select, width: 120, fontSize: 11 }} value={line.specialty} onChange={e => updateLine(idx, 'specialty', e.target.value)}><option value="">—</option>{SPECIALTIES.map(sp => <option key={sp}>{sp}</option>)}</select></td>
                <td style={css.td}><input style={{ ...css.input, width: 140, fontSize: 12, padding: 6 }} value={line.role_title || ''} onChange={e => updateLine(idx, 'role_title', e.target.value)} placeholder="Ej: Senior React Dev" /></td>
                <td style={css.td}><select style={{ ...css.select, width: 50, fontSize: 11 }} value={line.level || ''} onChange={e => updateLine(idx, 'level', Number(e.target.value))}><option value="">—</option>{[1,2,3,4,5,6,7,8,9,10,11].map(n => <option key={n} value={n}>L{n}</option>)}</select></td>
                <td style={css.td}><select style={{ ...css.select, width: 100, fontSize: 11 }} value={line.country} onChange={e => updateLine(idx, 'country', e.target.value)}>{countries.map(c => <option key={c}>{c}</option>)}</select></td>
                <td style={{ ...css.td, textAlign: 'center' }}><input type="checkbox" checked={line.bilingual || false} onChange={e => updateLine(idx, 'bilingual', e.target.checked)} /></td>
                <td style={css.td}><select style={{ ...css.select, width: 110, fontSize: 11 }} value={line.tools} onChange={e => updateLine(idx, 'tools', e.target.value)}>{toolsOpts.map(t => <option key={t}>{t}</option>)}</select></td>
                <td style={css.td}><select style={{ ...css.select, width: 110, fontSize: 11 }} value={line.stack} onChange={e => updateLine(idx, 'stack', e.target.value)}>{stacks.map(st => <option key={st}>{st}</option>)}</select></td>
                <td style={css.td}><select style={{ ...css.select, width: 100, fontSize: 11 }} value={line.modality} onChange={e => updateLine(idx, 'modality', e.target.value)}>{modalities.map(m => <option key={m}>{m}</option>)}</select></td>
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
    </div>
  );
}
