import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '../utils/apiV2';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';
import StatusBadge from '../shell/StatusBadge';
import SortableTh from '../shell/SortableTh';
import { useSort } from '../utils/useSort';
import { STAGES, STAGE_BY_ID, TRANSITIONS as PIPELINE_TRANSITIONS } from '../utils/pipeline';
// SPEC-CRM-00 v1.1 PR2 — modelo de revenue + loss reasons formales.
import {
  REVENUE_TYPES, FUNDING_SOURCES, LOSS_REASONS, LOSS_REASON_DETAIL_MIN,
  computeBooking, validateRevenueModel, validateFunding, validateLossReason,
} from '../utils/booking';

/* ========== styles (mirror Clients.js) ========== */
const s = {
  page:   { maxWidth: 1200, margin: '0 auto' },
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
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

// SPEC-CRM-00 v1.1 — los stages, labels, colors y transiciones vienen
// del SSOT en utils/pipeline.js (importado arriba) para evitar drift
// entre frontend y backend. Cualquier cambio del modelo se propaga aquí
// automáticamente.
const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  ...STAGES.map((st) => ({ value: st.id, label: st.label })),
];
const STATUS_LABEL = Object.fromEntries(STAGES.map((st) => [st.id, st.label]));
const STATUS_COLORS = Object.fromEntries(STAGES.map((st) => [st.id, st.color]));
const TRANSITIONS = PIPELINE_TRANSITIONS;

const OUTCOME_REASONS = [
  { value: 'price',           label: 'Precio' },
  { value: 'timing',          label: 'Timing' },
  { value: 'competition',     label: 'Competencia' },
  { value: 'technical_fit',   label: 'Fit técnico' },
  { value: 'client_internal', label: 'Interna del cliente' },
  { value: 'other',           label: 'Otro' },
];

const DEAL_TYPES = [
  { value: 'new_business',      label: 'Venta nueva' },
  { value: 'upsell_cross_sell', label: 'Upsell / Cross-sell' },
  { value: 'renewal',           label: 'Renovación' },
  { value: 'resell',            label: 'Resell' },
];

const EMPTY = {
  client_id: '', name: '', description: '',
  expected_close_date: '', tags: [],
  // SPEC-CRM-00 v1.1 PR2 — defaults para revenue model + funding + flags.
  revenue_type: 'one_time',
  one_time_amount_usd: '', mrr_usd: '', contract_length_months: '',
  champion_identified: false, economic_buyer_identified: false,
  funding_source: 'client_direct', funding_amount_usd: '',
  drive_url: '',
  // SPEC-CRM-01 — deal enrichment
  deal_type: 'new_business', co_owner_id: '',
  // Brief de la oportunidad — insumo estructurado para preventa
  context_client: '', context_scope: '', context_pains: '',
  context_requirements: '', context_politics: '',
};

// Cada bloque del Brief tiene: clave, etiqueta, hint corto y placeholder
// con un ejemplo real (caso BBVA Colombia que la country manager compartió
// por chat) para que el comercial vea la calidad de input que se espera.
const BRIEF_SECTIONS = [
  {
    key: 'context_client',
    label: '1. Contexto del cliente',
    hint: 'Quién decide, dónde se decide, área del cliente.',
    placeholder:
      'Ej. BBVA Colombia, área de banca corporativa. La decisión se toma en Colombia, no escala a España (punto a favor). Decisor: BBVA Colombia.',
  },
  {
    key: 'context_scope',
    label: '2. Alcance del servicio',
    hint: 'Qué producto/funcionalidad busca, usuarios finales, integraciones.',
    placeholder:
      'Ej. Producto de factoring y confirming dirigido a miles de clientes (pymes y corporativos). Front: carga/descarga de facturas multibanco (subastadas en Klym y Mente). Back: control de cupos, descuentos, contabilidad y autorizaciones.',
  },
  {
    key: 'context_pains',
    label: '3. Pain points y razón del cambio',
    hint: 'Por qué cambian de proveedor, qué les duele hoy.',
    placeholder:
      'Ej. Proveedor actual (10+ años) propuso modelo no escalable. Cada desarrollo se paga muy caro (incluso cambios de color/tamaño). Dolor con integración a Klym/Mente. Onboarding de proveedores lento. La contabilidad seguirá con el proveedor actual.',
  },
  {
    key: 'context_requirements',
    label: '4. Requisitos del nuevo proveedor',
    hint: 'Qué buscan, modelo comercial, alcance esperado.',
    placeholder:
      'Ej. Nuevo proveedor debe manejar 100% del servicio (o explorar split front/back). Buscan activamente varios proveedores. Abiertos a fee de facturación o business case. Quieren solución con agentes. Confirmar fecha de vencimiento del contrato actual.',
  },
  {
    key: 'context_politics',
    label: '5. Política y siguientes pasos',
    hint: 'Influenciadores con nombre, próximos pasos, timeline de decisión.',
    placeholder:
      'Ej. Hay que convencer a Guillermo (le habla al oído al CEO). Jorge Antorveza trabaja para Guillermo. Próximo paso: reunión con dueños de producto y Gerente Comercial Corporativo. Preparar speech sobre costo multiplataforma y spreads. Decisión en 2026 — proyecto de largo aliento.',
  },
];

const fmtUsd = (n) => `USD ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function OpportunityForm({ initial, clients, users, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Booking calculado en vivo (mirror del trigger DB).
  const bookingPreview = computeBooking({
    revenue_type: form.revenue_type,
    one_time_amount_usd: form.one_time_amount_usd,
    mrr_usd: form.mrr_usd,
    contract_length_months: form.contract_length_months,
  });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.client_id) return setErr('Cliente es requerido');
    if (!form.name.trim()) return setErr('El nombre es requerido');
    // SPEC-CRM-00 v1.1 PR2 — para el flujo "crear rápido", si revenue_type
    // es one_time y el monto está vacío lo tratamos como 0 (deal temprano,
    // se refina después). Para recurring/mixed exigimos los campos.
    const normalized = {
      ...form,
      one_time_amount_usd: (form.revenue_type === 'one_time' && (form.one_time_amount_usd === '' || form.one_time_amount_usd == null))
        ? 0
        : form.one_time_amount_usd,
    };
    const revenueErr = validateRevenueModel(normalized);
    if (revenueErr) return setErr(revenueErr);
    const fundingErr = validateFunding(normalized);
    if (fundingErr) return setErr(fundingErr);
    try {
      await onSave(normalized);
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar oportunidad' : 'Nueva oportunidad'}
      </h2>
      <div>
        <label style={s.label}>Cliente *</label>
        <select
          style={s.input}
          value={form.client_id || ''}
          onChange={(e) => set('client_id', e.target.value)}
          aria-label="Cliente"
          required
          disabled={!!initial?.id}
        >
          <option value="">— Selecciona —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label style={s.label}>Nombre *</label>
        <input style={s.input} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus required />
      </div>
      <div>
        <label style={s.label}>Descripción</label>
        <textarea
          style={{ ...s.input, minHeight: 80, resize: 'vertical' }}
          value={form.description || ''}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={s.label}>Tipo de deal *</label>
          <select style={s.input} value={form.deal_type} onChange={(e) => set('deal_type', e.target.value)} aria-label="Tipo de deal">
            {DEAL_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={s.label}>Fecha esperada de cierre</label>
          <input
            type="date"
            style={s.input}
            value={form.expected_close_date || ''}
            onChange={(e) => set('expected_close_date', e.target.value)}
          />
        </div>
      </div>

      {/* SPEC-CRM-00 v1.1 PR2 — Revenue model. */}
      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, margin: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple-dark)', padding: '0 6px' }}>
          Tipo de Revenue *
        </legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          {REVENUE_TYPES.map((rt) => (
            <label key={rt.value} style={{ fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="radio"
                name="revenue_type"
                value={rt.value}
                checked={form.revenue_type === rt.value}
                onChange={(e) => set('revenue_type', e.target.value)}
                aria-label={rt.label}
              />
              {rt.label}
            </label>
          ))}
        </div>
        {(form.revenue_type === 'one_time' || form.revenue_type === 'mixed') && (
          <div style={{ marginBottom: 8 }}>
            <label style={s.label}>Monto one-time (USD) *</label>
            <input
              type="number"
              min="0"
              style={s.input}
              value={form.one_time_amount_usd}
              onChange={(e) => set('one_time_amount_usd', e.target.value)}
              aria-label="Monto one-time USD"
              placeholder="20000"
            />
          </div>
        )}
        {(form.revenue_type === 'recurring' || form.revenue_type === 'mixed') && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>MRR (USD/mes) *</label>
              <input
                type="number"
                min="0"
                style={s.input}
                value={form.mrr_usd}
                onChange={(e) => set('mrr_usd', e.target.value)}
                aria-label="MRR USD"
                placeholder="5000"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Duración (meses) *</label>
              <input
                type="number"
                min="0"
                style={s.input}
                value={form.contract_length_months}
                onChange={(e) => set('contract_length_months', e.target.value)}
                aria-label="Duración del contrato en meses"
                placeholder="24"
              />
            </div>
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal-mid)' }} aria-live="polite">
          Booking calculado: {fmtUsd(bookingPreview)}
        </div>
      </fieldset>

      <button
        type="button"
        style={{ ...s.btnOutline, alignSelf: 'flex-start', fontSize: 12, padding: '4px 10px' }}
        onClick={() => setShowAdvanced((x) => !x)}
        aria-expanded={showAdvanced}
        aria-label="Mostrar opciones avanzadas"
      >
        {showAdvanced ? '▾ Menos opciones' : '▸ Más opciones (Champion, EB, funding, drive)'}
      </button>

      {showAdvanced && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, background: 'var(--surface-soft, #f8f7fa)', borderRadius: 8 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!form.champion_identified}
                onChange={(e) => set('champion_identified', e.target.checked)}
                aria-label="Champion identificado"
              />
              Champion identificado
            </label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!form.economic_buyer_identified}
                onChange={(e) => set('economic_buyer_identified', e.target.checked)}
                aria-label="Economic Buyer identificado"
              />
              Economic Buyer identificado
            </label>
          </div>
          <div>
            <label style={s.label}>Funding source</label>
            <select
              style={s.input}
              value={form.funding_source}
              onChange={(e) => set('funding_source', e.target.value)}
              aria-label="Funding source"
            >
              {FUNDING_SOURCES.map((fs) => <option key={fs.value} value={fs.value}>{fs.label}</option>)}
            </select>
          </div>
          {form.funding_source !== 'client_direct' && (
            <div>
              <label style={s.label}>Monto de funding (USD) *</label>
              <input
                type="number"
                min="0"
                style={s.input}
                value={form.funding_amount_usd}
                onChange={(e) => set('funding_amount_usd', e.target.value)}
                aria-label="Monto de funding USD"
              />
            </div>
          )}
          <div>
            <label style={s.label}>Co-owner</label>
            <select style={s.input} value={form.co_owner_id || ''} onChange={(e) => set('co_owner_id', e.target.value || '')} aria-label="Co-owner">
              <option value="">— Sin co-owner —</option>
              {(users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>Drive URL</label>
            <input
              type="url"
              style={s.input}
              value={form.drive_url}
              onChange={(e) => set('drive_url', e.target.value)}
              aria-label="Drive URL"
              placeholder="https://drive.google.com/..."
            />
          </div>
        </div>
      )}

      {/* Brief de la oportunidad — insumo estructurado para preventa.
          Cada sección es opcional al crear (un comercial rara vez tiene
          los 5 bloques al inicio del deal); se enriquece a medida que avanza. */}
      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, margin: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple-dark)', padding: '0 6px' }}>
          📋 Brief de la oportunidad
        </legend>
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 10 }}>
          Insumo para preventa: cuanto más rico, mejor cotización. Llena lo que tengas hoy y enriquécelo a medida que avanza el deal.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {BRIEF_SECTIONS.map((sec) => (
            <div key={sec.key}>
              <label style={s.label} htmlFor={`brief-${sec.key}`}>
                {sec.label} <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>· {sec.hint}</span>
              </label>
              <textarea
                id={`brief-${sec.key}`}
                style={{ ...s.input, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
                value={form[sec.key] || ''}
                onChange={(e) => set(sec.key, e.target.value)}
                placeholder={sec.placeholder}
                aria-label={sec.label}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }} role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

function TransitionModal({ opp, target, onConfirm, onCancel, saving }) {
  const needsWinningQuot = target === 'closed_won';
  const needsReason      = target === 'closed_lost';
  const needsPostponedDate = target === 'postponed';
  const [winningId, setWinningId] = useState('');
  const [reason, setReason]       = useState('');
  const [notes, setNotes]         = useState('');
  // SPEC-CRM-00 v1.1 PR2 — loss_reason formal (enum extendido + detail).
  const [lossReason, setLossReason] = useState('');
  const [lossDetail, setLossDetail] = useState('');
  // SPEC-CRM-00 v1.1 — Postponed exige fecha futura de reactivación.
  // Default: 30 días desde hoy (suficiente para que el comercial vuelva
  // a tocar la opp pero no tan lejos que se olvide).
  const defaultPostponedDate = (() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();
  const [postponedDate, setPostponedDate] = useState(defaultPostponedDate);
  const [postponedReason, setPostponedReason] = useState('');
  const [err, setErr]             = useState('');

  // Para closed_won, cargar cotizaciones de la opp así el usuario elige cuál ganó.
  const [quotations, setQuotations] = useState([]);
  useEffect(() => {
    if (needsWinningQuot && opp?.id) {
      apiGet(`/api/opportunities/${opp.id}`).then((r) => setQuotations(r?.quotations || [])).catch(() => setQuotations([]));
    }
  }, [needsWinningQuot, opp?.id]);

  // Validación local: la fecha de reactivación debe ser futura.
  const todayIso = new Date().toISOString().slice(0, 10);
  const postponedDateInvalid = needsPostponedDate && postponedDate <= todayIso;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (needsWinningQuot && !winningId) return setErr('Selecciona cotización ganadora');
    if (needsReason) {
      const lossErr = validateLossReason({ loss_reason: lossReason, loss_reason_detail: lossDetail });
      if (lossErr) return setErr(lossErr);
    }
    if (needsPostponedDate && !postponedDate) return setErr('La fecha de reactivación es requerida');
    if (needsPostponedDate && postponedDateInvalid) return setErr('La fecha de reactivación debe ser futura');
    try {
      await onConfirm({
        new_status: target,
        winning_quotation_id: winningId || undefined,
        // SPEC-CRM-00 v1.1 PR2 — campos formales del lost; el legacy
        // outcome_reason se sigue mandando para que el backend pueda
        // aceptar ambas formas durante el período de transición.
        loss_reason: needsReason ? lossReason : undefined,
        loss_reason_detail: needsReason ? lossDetail : undefined,
        outcome_reason: needsReason ? lossReason : (reason || undefined),
        outcome_notes: notes || undefined,
        postponed_until_date: needsPostponedDate ? postponedDate : undefined,
        postponed_reason: needsPostponedDate ? (postponedReason || undefined) : undefined,
      });
    } catch (ex) {
      setErr(ex.message || 'Error');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        Mover a {STATUS_LABEL[target] || target}
      </h2>
      <div style={{ fontSize: 13, color: 'var(--text-light)' }}>
        Oportunidad: <strong>{opp?.name}</strong>
      </div>
      {needsWinningQuot && (
        <div>
          <label style={s.label}>Cotización ganadora *</label>
          <select style={s.input} value={winningId} onChange={(e) => setWinningId(e.target.value)} aria-label="Cotización ganadora" required>
            <option value="">— Selecciona —</option>
            {quotations.map((q) => (
              <option key={q.id} value={q.id}>
                {q.project_name} · {q.status}
              </option>
            ))}
          </select>
          {quotations.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
              Esta oportunidad no tiene cotizaciones todavía.
            </div>
          )}
        </div>
      )}
      {needsReason && (
        <>
          <div>
            <label style={s.label}>Razón de pérdida *</label>
            <select
              style={s.input}
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value)}
              aria-label="Razón de pérdida"
              required
            >
              <option value="">— Selecciona —</option>
              {LOSS_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>
              Descripción detallada * <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>
                (mín {LOSS_REASON_DETAIL_MIN} chars — {lossDetail.trim().length}/{LOSS_REASON_DETAIL_MIN})
              </span>
            </label>
            <textarea
              style={{ ...s.input, minHeight: 80, resize: 'vertical' }}
              value={lossDetail}
              onChange={(e) => setLossDetail(e.target.value)}
              aria-label="Descripción detallada de la pérdida"
              placeholder="Ej. Cliente eligió competidor X por feature Y. Plan: incluir Y en roadmap Q3 y reabrir oportunidad."
              required
            />
          </div>
        </>
      )}
      {needsPostponedDate && (
        <>
          <div style={{ background: 'var(--surface-soft, #f8f7fa)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text-light)' }}>
            ⚠ Las oportunidades postergadas <strong>NO entran</strong> en pipeline weighted hasta que se reactiven. Recibirás recordatorio el día indicado.
          </div>
          <div>
            <label style={s.label}>Reactivar revisión el *</label>
            <input
              type="date"
              style={s.input}
              value={postponedDate}
              min={todayIso}
              onChange={(e) => setPostponedDate(e.target.value)}
              aria-label="Fecha de reactivación"
              required
            />
            {postponedDateInvalid && (
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
                La fecha debe ser futura.
              </div>
            )}
          </div>
          <div>
            <label style={s.label}>Razón de la postergación</label>
            <textarea
              style={{ ...s.input, minHeight: 60, resize: 'vertical' }}
              value={postponedReason}
              onChange={(e) => setPostponedReason(e.target.value)}
              placeholder="Ej. Cliente postpuso decisión por restructura organizacional. Esperan resolver Q3."
              aria-label="Razón de postergación"
            />
          </div>
        </>
      )}
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }} role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving || postponedDateInvalid}>
          {saving ? 'Guardando…' : 'Confirmar'}
        </button>
      </div>
    </form>
  );
}

export default function Opportunities() {
  const nav = useNavigate();
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [dealTypeFilter, setDealTypeFilter] = useState('');
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(null); // { opp, target }
  const sort = useSort({ field: 'created_at', dir: 'desc' });

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (search) qs.set('search', search);
    if (statusFilter) qs.set('status', statusFilter);
    if (clientFilter) qs.set('client_id', clientFilter);
    if (dealTypeFilter) qs.set('deal_type', dealTypeFilter);
    sort.applyToQs(qs);
    try {
      const r = await apiGet(`/api/opportunities?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando oportunidades: ' + e.message);
    }
  }, [search, statusFilter, clientFilter, dealTypeFilter, sort.field, sort.dir]);

  const loadClients = useCallback(async () => {
    try {
      const r = await apiGet('/api/clients?limit=100&active=true');
      setClients(r.data || []);
    } catch {
      setClients([]);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const r = await apiGet('/api/users?limit=200');
      const list = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [];
      setUsers(list);
    } catch {
      setUsers([]);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadClients(); }, [loadClients]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      // Helper: transformar string vacío → null y string numérico → Number.
      const num = (v) => (v === '' || v == null ? null : Number(v));
      const payload = {
        client_id: form.client_id,
        name: form.name,
        description: form.description,
        expected_close_date: form.expected_close_date || null,
        // SPEC-CRM-00 v1.1 PR2 — modelo de revenue + funding + flags + drive.
        revenue_type: form.revenue_type || 'one_time',
        one_time_amount_usd: num(form.one_time_amount_usd),
        mrr_usd: num(form.mrr_usd),
        contract_length_months: num(form.contract_length_months),
        champion_identified: !!form.champion_identified,
        economic_buyer_identified: !!form.economic_buyer_identified,
        funding_source: form.funding_source || 'client_direct',
        funding_amount_usd: num(form.funding_amount_usd),
        drive_url: form.drive_url || null,
        // SPEC-CRM-01 — deal enrichment
        deal_type: form.deal_type || 'new_business',
        co_owner_id: form.co_owner_id || null,
        // Brief de la oportunidad
        context_client: form.context_client || null,
        context_scope: form.context_scope || null,
        context_pains: form.context_pains || null,
        context_requirements: form.context_requirements || null,
        context_politics: form.context_politics || null,
      };
      if (editing?.id) {
        await apiPut(`/api/opportunities/${editing.id}`, payload);
      } else {
        await apiPost('/api/opportunities', payload);
      }
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (o) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar oportunidad "${o.name}"? Esta acción es reversible (soft delete).`)) return;
    try {
      await apiDelete(`/api/opportunities/${o.id}`);
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  const onTransition = async (payload) => {
    if (!transitioning) return;
    setSaving(true);
    try {
      await apiPost(`/api/opportunities/${transitioning.opp.id}/status`, payload);
      setTransitioning(null);
      await load(state.page);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>💼 Oportunidades</h1>
          <div style={s.sub}>Pipeline comercial. Una oportunidad agrupa cotizaciones de un mismo deal.</div>
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
                await apiDownload(`/api/opportunities/export.csv${qs.toString() ? `?${qs}` : ''}`, 'oportunidades.csv');
              } catch (e) {
                // eslint-disable-next-line no-alert
                alert(`No se pudo descargar: ${e.message}`);
              }
            }}
            data-testid="opportunities-export-csv"
          >
            ⤓ Descargar CSV
          </button>
          <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
            + Nueva Oportunidad
          </button>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input
              style={s.input}
              placeholder="Nombre o descripción"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar oportunidades"
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Cliente</label>
            <select style={s.input} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Filtro por cliente">
              <option value="">Cualquiera</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Estado</label>
            <select style={s.input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtro por estado">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Tipo de deal</label>
            <select style={s.input} value={dealTypeFilter} onChange={(e) => setDealTypeFilter(e.target.value)} aria-label="Filtro por tipo de deal">
              <option value="">Todos</option>
              {DEAL_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr>
                <SortableTh sort={sort} field="name" style={s.th}>Nombre</SortableTh>
                <th style={s.th}>Cliente</th>
                <SortableTh sort={sort} field="status" style={s.th}>Estado</SortableTh>
                <SortableTh sort={sort} field="deal_type" style={s.th}>Tipo</SortableTh>
                <th style={s.th}>Cotizaciones</th>
                <SortableTh sort={sort} field="expected_close_date" style={s.th}>Cierre esperado</SortableTh>
                <SortableTh sort={sort} field="created_at" style={s.th}>Creada</SortableTh>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay oportunidades que coincidan con los filtros.
                </td></tr>
              )}
              {state.data.map((o) => {
                const nextStates = TRANSITIONS[o.status] || [];
                return (
                  <tr key={o.id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>
                      <Link to={`/opportunities/${o.id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }} aria-label={`Ver ${o.name}`}>{o.name}</Link>
                    </td>
                    <td style={s.td}>{o.client_name || '—'}</td>
                    <td style={s.td}>
                      <StatusBadge domain="opportunity" value={o.status} label={STATUS_LABEL[o.status]} />
                    </td>
                    <td style={{ ...s.td, fontSize: 11 }}>{(DEAL_TYPES.find((dt) => dt.value === o.deal_type) || {}).label || o.deal_type || '—'}</td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{o.quotations_count ?? 0}</td>
                    <td style={s.td}>{o.expected_close_date ? String(o.expected_close_date).slice(0, 10) : '—'}</td>
                    <td style={s.td}>{o.created_at ? String(o.created_at).slice(0, 10) : '—'}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                              onClick={() => { setEditing(o); setShowForm(true); }}
                              aria-label={`Editar ${o.name}`}>Editar</button>
                      {nextStates.map((ns) => (
                        <button
                          key={ns}
                          style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                          onClick={() => setTransitioning({ opp: o, target: ns })}
                          aria-label={`Mover ${o.name} a ${STATUS_LABEL[ns]}`}
                        >
                          {STATUS_LABEL[ns]}
                        </button>
                      ))}
                      <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                              onClick={() => onDelete(o)}
                              aria-label={`Eliminar ${o.name}`}>Eliminar</button>
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
              Página {state.page} de {state.pages} · {state.total} oportunidades
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <OpportunityForm
              initial={editing}
              clients={clients}
              users={users}
              saving={saving}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSave={onSave}
            />
          </div>
        </div>
      )}

      {transitioning && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <TransitionModal
              opp={transitioning.opp}
              target={transitioning.target}
              saving={saving}
              onCancel={() => setTransitioning(null)}
              onConfirm={onTransition}
            />
          </div>
        </div>
      )}

      {/* Breadcrumb hosts the "back" link — keep a hidden anchor for Router */}
      <button type="button" onClick={() => nav('/')} style={{ display: 'none' }} aria-hidden="true" />
    </div>
  );
}
