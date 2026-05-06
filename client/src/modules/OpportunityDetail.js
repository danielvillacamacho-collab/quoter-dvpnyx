import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost, apiPut } from '../utils/apiV2';
import StatusBadge from '../shell/StatusBadge';
import { STAGES, TRANSITIONS as PIPELINE_TRANSITIONS, isPostponed, isWon } from '../utils/pipeline';
// SPEC-CRM-00 v1.1 PR2/PR3 — labels + margin.
import {
  REVENUE_TYPES, FUNDING_SOURCES, LOSS_REASONS, LOSS_REASON_DETAIL_MIN,
  MARGIN_LOW_THRESHOLD,
  validateLossReason,
} from '../utils/booking';

const REVENUE_LABEL = Object.fromEntries(REVENUE_TYPES.map((r) => [r.value, r.label]));
const FUNDING_LABEL = Object.fromEntries(FUNDING_SOURCES.map((f) => [f.value, f.label]));
const LOSS_LABEL    = Object.fromEntries(LOSS_REASONS.map((l) => [l.value, l.label]));
const fmtUsd = (n) => `USD ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const s = {
  page:   { maxWidth: 1200, margin: '0 auto' },
  h1:     { fontSize: 26, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 4px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  h2:     { fontSize: 16, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 12px' },
  btn:    (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  grid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 },
  label:  { fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 1 },
  value:  { fontSize: 14, color: 'var(--purple-dark)', fontWeight: 600, marginTop: 2 },
  th:     { padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left' },
  td:     { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  link:   { color: 'var(--teal-mid)', textDecoration: 'none', fontWeight: 600 },
};

// SPEC-CRM-00 v1.1 — labels y transiciones del SSOT de pipeline.
const STATUS_LABEL = Object.fromEntries(STAGES.map((st) => [st.id, st.label]));
const TRANSITIONS = PIPELINE_TRANSITIONS;

function Field({ label, children }) {
  return (
    <div>
      <div style={s.label}>{label}</div>
      <div style={s.value}>{children || '—'}</div>
    </div>
  );
}

const DEAL_ROLE_LABEL = {
  economic_buyer: 'Economic Buyer', champion: 'Champion', coach: 'Coach',
  decision_maker: 'Decision Maker', influencer: 'Influencer',
  technical_evaluator: 'Technical Evaluator', procurement: 'Procurement',
  legal: 'Legal', detractor: 'Detractor', blocker: 'Blocker',
};
const ACTIVITY_TYPE_LABEL = {
  call: 'Llamada', email: 'Email', meeting: 'Reunión', note: 'Nota',
  proposal_sent: 'Propuesta', demo: 'Demo', follow_up: 'Seguimiento', other: 'Otro',
};

// Brief de la oportunidad — mismas secciones que el formulario de creación
// (ver Opportunities.js BRIEF_SECTIONS). Duplicamos local en lugar de
// extraer a un módulo compartido para no inflar el footprint del PR; cuando
// haya un tercer consumidor (p.ej. wizard de IA, export PDF) vale extraer.
const BRIEF_SECTIONS = [
  { key: 'context_client',       label: '1. Contexto del cliente',       hint: 'Quién decide, dónde se decide, área del cliente.' },
  { key: 'context_scope',        label: '2. Alcance del servicio',       hint: 'Qué producto/funcionalidad busca, usuarios finales, integraciones.' },
  { key: 'context_pains',        label: '3. Pain points y razón del cambio', hint: 'Por qué cambian de proveedor, qué les duele hoy.' },
  { key: 'context_requirements', label: '4. Requisitos del nuevo proveedor', hint: 'Qué buscan, modelo comercial, alcance esperado.' },
  { key: 'context_politics',     label: '5. Política y siguientes pasos', hint: 'Influenciadores con nombre, próximos pasos, timeline de decisión.' },
];
const BRIEF_PLACEHOLDERS = {
  context_client:       'Ej. BBVA Colombia, área de banca corporativa. La decisión se toma en Colombia, no escala a España.',
  context_scope:        'Ej. Producto de factoring/confirming para pymes y corporativos. Front multibanco (Klym, Mente). Back: cupos, contabilidad, autorizaciones.',
  context_pains:        'Ej. Proveedor actual no escalable, cada desarrollo se paga muy caro. Dolor con integración. Onboarding lento.',
  context_requirements: 'Ej. Nuevo proveedor maneja 100% del servicio (o split front/back). Abiertos a fee de facturación o business case.',
  context_politics:     'Ej. Convencer a Guillermo (le habla al CEO). Próximo paso: reunión con dueños de producto. Decisión en 2026.',
};

function OpportunityBriefCard({ opp, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const startEdit = () => {
    setDraft(BRIEF_SECTIONS.reduce((acc, sec) => {
      acc[sec.key] = opp[sec.key] || '';
      return acc;
    }, {}));
    setErr('');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await apiPut(`/api/opportunities/${opp.id}`, draft);
      setEditing(false);
      await onSaved();
    } catch (e) {
      setErr(e.message || 'Error guardando');
    } finally {
      setSaving(false);
    }
  };

  const filled = BRIEF_SECTIONS.filter((sec) => (opp[sec.key] || '').trim().length > 0).length;
  const isEmpty = filled === 0;

  return (
    <div style={s.card} data-testid="opportunity-brief-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={s.h2}>
          📋 Brief de la oportunidad
          <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 600, color: filled === BRIEF_SECTIONS.length ? 'var(--success)' : 'var(--text-light)' }}>
            {filled}/{BRIEF_SECTIONS.length} secciones
          </span>
        </h2>
        {!editing && (
          <button type="button" style={s.btnOutline} onClick={startEdit} aria-label="Editar brief">
            {isEmpty ? '+ Llenar brief' : '✎ Editar'}
          </button>
        )}
      </div>

      {!editing && isEmpty && (
        <div style={{ fontSize: 13, color: 'var(--text-light)', padding: '12px 0' }}>
          Sin brief todavía. Llénalo con contexto del cliente, alcance, pain points, requisitos y política para que preventa cotice con buen insumo.
        </div>
      )}

      {!editing && !isEmpty && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {BRIEF_SECTIONS.map((sec) => {
            const val = (opp[sec.key] || '').trim();
            return (
              <div key={sec.key}>
                <div style={{ ...s.label, marginBottom: 4 }}>{sec.label}</div>
                {val ? (
                  <div style={{ fontSize: 13, color: 'var(--purple-dark)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {val}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-light)' }}>
                    — pendiente: {sec.hint}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
            Cuanto más rico el brief, mejor cotización. Los placeholders muestran ejemplos del nivel de detalle esperado.
          </div>
          {BRIEF_SECTIONS.map((sec) => (
            <div key={sec.key}>
              <label style={{ ...s.label, marginBottom: 4, display: 'block' }} htmlFor={`brief-edit-${sec.key}`}>
                {sec.label} <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>· {sec.hint}</span>
              </label>
              <textarea
                id={`brief-edit-${sec.key}`}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 13, outline: 'none', minHeight: 80, resize: 'vertical',
                  fontFamily: 'inherit',
                }}
                value={draft[sec.key] || ''}
                onChange={(e) => setDraft((d) => ({ ...d, [sec.key]: e.target.value }))}
                placeholder={BRIEF_PLACEHOLDERS[sec.key]}
                aria-label={sec.label}
              />
            </div>
          ))}
          {err && <div style={{ color: 'var(--danger)', fontSize: 13 }} role="alert">{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={s.btnOutline} onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
            <button type="button" style={s.btn()} onClick={save} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar brief'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OpportunityDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [opp, setOpp] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, ctRes, actRes] = await Promise.all([
        apiGet(`/api/opportunities/${id}`),
        apiGet(`/api/contacts/by-opportunity/${id}`).catch(() => []),
        apiGet(`/api/activities/by-opportunity/${id}?limit=20`).catch(() => ({ data: [] })),
      ]);
      setOpp(data || null);
      setContacts(Array.isArray(ctRes) ? ctRes : (ctRes?.data || []));
      setActivities(actRes?.data || (Array.isArray(actRes) ? actRes : []));
    } catch (e) { setErr(e.message || 'Error'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const transition = async (target) => {
    if (target === 'closed_won') {
      const winning = (opp.quotations || []).filter((q) => q.status !== 'rejected');
      if (winning.length === 0) {
        // eslint-disable-next-line no-alert
        alert('No hay cotizaciones válidas para marcar como ganadora. Crea y envía una cotización primero.');
        return;
      }
      // eslint-disable-next-line no-alert
      const pick = window.prompt(
        `Selecciona la cotización ganadora:\n\n${winning.map((q, i) => `${i + 1}. ${q.project_name} (${q.status})`).join('\n')}\n\nEscribe el número:`
      );
      const idx = Number(pick) - 1;
      if (!Number.isFinite(idx) || !winning[idx]) return;
      await doTransition({ new_status: 'closed_won', winning_quotation_id: winning[idx].id });
      // eslint-disable-next-line no-alert
      if (window.confirm('¡Oportunidad ganada! ¿Crear un contrato desde esta cotización ahora? (un click — luego puedes ajustar los detalles)')) {
        try {
          const c = await apiPost(`/api/contracts/from-quotation/${winning[idx].id}`, {});
          if (c && c.id) nav(`/contracts/${c.id}`);
        } catch (e) {
          // eslint-disable-next-line no-alert
          alert('No se pudo crear el contrato automáticamente: ' + (e.message || 'error desconocido') + '\n\nTe llevamos al formulario manual.');
          nav(`/contracts?client_id=${opp.client?.id || opp.client_id}&opportunity_id=${opp.id}&winning_quotation_id=${winning[idx].id}`);
        }
      }
      return;
    }
    if (target === 'closed_lost') {
      // SPEC-CRM-00 v1.1 PR2 — loss_reason del enum extendido + detail
      // mínimo 30 chars (validado backend; aquí soft-check para UX).
      const enumOptions = LOSS_REASONS.map((l) => `${l.value} = ${l.label}`).join('\n');
      // eslint-disable-next-line no-alert
      const lossReason = window.prompt(
        `Razón para marcar Perdida:\n${enumOptions}\n\nEscribe el código (ej. "price"):`,
        'other'
      );
      if (!lossReason) return;
      // eslint-disable-next-line no-alert
      const lossDetail = window.prompt(
        `Descripción detallada (mín ${LOSS_REASON_DETAIL_MIN} chars):\nEj: "Cliente eligió competidor X. Plan: incluir feature Y en roadmap Q3."`,
        ''
      );
      const v = validateLossReason({ loss_reason: lossReason, loss_reason_detail: lossDetail || '' });
      if (v) {
        // eslint-disable-next-line no-alert
        alert(v);
        return;
      }
      await doTransition({
        new_status: target,
        loss_reason: lossReason,
        loss_reason_detail: lossDetail,
        // legacy compat: seguimos enviando outcome_reason para servidores
        // viejos. Si es un enum no aceptado por el legacy enum (e.g. champion_left),
        // el backend ahora prioriza loss_reason — sin daño.
        outcome_reason: lossReason,
      });
      return;
    }
    if (target === 'postponed') {
      // SPEC-CRM-00 v1.1 — Postponed exige fecha de reactivación.
      // Default: hoy + 30 días.
      const defaultIso = (() => {
        const d = new Date(); d.setDate(d.getDate() + 30);
        return d.toISOString().slice(0, 10);
      })();
      // eslint-disable-next-line no-alert
      const dateInput = window.prompt(
        'Postergar la oportunidad — ¿en qué fecha la revisamos de nuevo? (YYYY-MM-DD)',
        defaultIso,
      );
      if (!dateInput) return;
      const today = new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput) || dateInput <= today) {
        // eslint-disable-next-line no-alert
        alert('Fecha inválida. Debe ser YYYY-MM-DD y posterior a hoy.');
        return;
      }
      // eslint-disable-next-line no-alert
      const reason = window.prompt('Razón de la postergación (opcional):', '');
      await doTransition({
        new_status: 'postponed',
        postponed_until_date: dateInput,
        postponed_reason: reason || undefined,
      });
      return;
    }
    await doTransition({ new_status: target });
  };

  const doTransition = async (payload) => {
    setBusy(true);
    try {
      await apiPost(`/api/opportunities/${id}/status`, payload);
      await load();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    } finally { setBusy(false); }
  };

  // SPEC-CRM-00 v1.1 PR3 — Calcula y persiste margin_pct.
  // Prompt para costo estimado (vacío → auto-computa desde cotizaciones).
  const checkMargin = async () => {
    // eslint-disable-next-line no-alert
    const costInput = window.prompt(
      `Ingresa el costo estimado en USD (o cancela para auto-calcular desde las líneas de cotización):\n\nBooking actual: ${fmtUsd(opp.booking_amount_usd)}`,
      '',
    );
    if (costInput === null) return; // cancelled

    const body = costInput.trim() !== '' ? { estimated_cost_usd: Number(costInput) } : {};
    setBusy(true);
    try {
      const result = await apiPost(`/api/opportunities/${id}/check-margin`, body);
      if (result.alert_fired) {
        // eslint-disable-next-line no-alert
        alert(`⚠ Alerta A4 — Margen bajo: ${result.margin_pct}%\nEl margen está por debajo del umbral mínimo (${MARGIN_LOW_THRESHOLD}%). Considera revisar la cotización.`);
      }
      await load();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    } finally { setBusy(false); }
  };

  if (loading) return <div style={s.page}><div style={{ color: 'var(--text-light)' }}>Cargando…</div></div>;
  if (err || !opp) return <div style={s.page}><div style={{ color: 'var(--danger)' }}>{err || 'Oportunidad no encontrada'}</div></div>;

  const nextStates = TRANSITIONS[opp.status] || [];

  return (
    <div style={s.page}>
      <button type="button" style={{ ...s.btnOutline, marginBottom: 12 }} onClick={() => nav('/opportunities')}>← Oportunidades</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          {opp.opportunity_number && (
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
              {opp.opportunity_number}
            </div>
          )}
          <h1 style={s.h1}>💼 {opp.name}</h1>
          <div style={s.sub}>
            Cliente:{' '}
            {opp.client ? <Link to={`/clients/${opp.client.id}`} style={s.link}>{opp.client.name}</Link> : '—'}
            {opp.country && <> · {opp.country}</>}
            {' · '}
            <StatusBadge domain="opportunity" value={opp.status} label={STATUS_LABEL[opp.status]} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {nextStates.map((ns) => (
            <button
              key={ns} type="button" style={s.btnOutline}
              onClick={() => transition(ns)} disabled={busy}
              aria-label={`Mover a ${STATUS_LABEL[ns]}`}
            >
              {ns === 'closed_won' ? '🏆 ' : ns === 'postponed' ? '⏸ ' : ''}Mover a {STATUS_LABEL[ns]}
            </button>
          ))}
        </div>
      </div>

      {opp.status === 'postponed' && (
        <div style={{ ...s.card, background: '#f5f3ff', borderColor: '#A78BFA' }}>
          <h2 style={{ ...s.h2, color: '#7c3aed' }}>⏸ Oportunidad postergada</h2>
          <div style={{ fontSize: 13 }}>
            Reactivar revisión el <strong>{opp.postponed_until_date ? String(opp.postponed_until_date).slice(0, 10) : '—'}</strong>.
            {opp.postponed_reason && (
              <div style={{ marginTop: 6, color: 'var(--text-light)' }}>
                <em>{opp.postponed_reason}</em>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-light)' }}>
              Mientras esté en este estado <strong>NO entra</strong> en pipeline weighted. Para reactivar, mueve a <em>Calificada</em>.
            </div>
          </div>
        </div>
      )}

      {isWon(opp.status) && (
        <div style={{ ...s.card, background: '#effff6', borderColor: 'var(--success)' }}>
          <h2 style={{ ...s.h2, color: 'var(--success)' }}>🏆 Oportunidad ganada</h2>
          <div style={{ fontSize: 13 }}>
            Cerrada el {opp.closed_at ? String(opp.closed_at).slice(0, 10) : '—'}.
            Cotización ganadora:{' '}
            {opp.winning_quotation_id ? (
              <Link to={`/quotation/${opp.winning_quotation_id}`} style={s.link}>ver cotización</Link>
            ) : '—'}
            {' · '}
            <Link to={`/contracts?opportunity_id=${opp.id}`} style={s.link}>Ver contratos asociados →</Link>
          </div>
          {opp.winning_quotation_id && (
            <button
              type="button"
              style={{ ...s.btn('var(--purple-dark)'), marginTop: 10 }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const c = await apiPost(`/api/contracts/from-quotation/${opp.winning_quotation_id}`, {});
                  if (c && c.id) nav(`/contracts/${c.id}`);
                } catch (e) {
                  // eslint-disable-next-line no-alert
                  alert('No se pudo crear el contrato: ' + (e.message || 'error'));
                } finally { setBusy(false); }
              }}
              aria-label="Convertir cotización ganadora en contrato"
            >
              📄 Crear contrato desde cotización ganadora
            </button>
          )}
        </div>
      )}

      <div style={s.card}>
        <h2 style={s.h2}>Resumen</h2>
        <div style={s.grid}>
          <Field label="Descripción">{opp.description}</Field>
          <Field label="Tipo de deal">{({new_business:'Venta nueva',upsell_cross_sell:'Upsell/Cross-sell',renewal:'Renovación',resell:'Resell'})[opp.deal_type] || opp.deal_type || '—'}</Field>
          <Field label="Cierre esperado">{opp.expected_close_date ? String(opp.expected_close_date).slice(0, 10) : null}</Field>
          <Field label="Owner (comercial)">{opp.account_owner_id}</Field>
          <Field label="Co-owner">{opp.co_owner_name || opp.co_owner_id || '—'}</Field>
          <Field label="Preventa lead">{opp.presales_lead_id}</Field>
          <Field label="Outcome">{opp.outcome_reason}</Field>
        </div>
      </div>

      <OpportunityBriefCard opp={opp} onSaved={load} />

      {/* SPEC-CRM-00 v1.1 PR2 — Revenue breakdown. */}
      <div style={s.card} data-testid="opportunity-revenue-card">
        <h2 style={s.h2}>💰 Revenue</h2>
        <div style={s.grid}>
          <Field label="Tipo">{REVENUE_LABEL[opp.revenue_type] || opp.revenue_type || '—'}</Field>
          {(opp.revenue_type === 'one_time' || opp.revenue_type === 'mixed') && (
            <Field label="One-time USD">{opp.one_time_amount_usd != null ? fmtUsd(opp.one_time_amount_usd) : '—'}</Field>
          )}
          {(opp.revenue_type === 'recurring' || opp.revenue_type === 'mixed') && (
            <>
              <Field label="MRR USD">{opp.mrr_usd != null ? fmtUsd(opp.mrr_usd) : '—'}</Field>
              <Field label="Duración (meses)">{opp.contract_length_months ?? '—'}</Field>
            </>
          )}
          <Field label="Booking total">{opp.booking_amount_usd != null ? fmtUsd(opp.booking_amount_usd) : '—'}</Field>
          <Field label="Weighted">{opp.weighted_amount_usd != null ? fmtUsd(opp.weighted_amount_usd) : '—'}</Field>
        </div>
      </div>

      {/* SPEC-CRM-00 v1.1 PR3 — Margen + Alerta A4. */}
      <div style={s.card} data-testid="opportunity-margin-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={s.h2}>
            📊 Margen
            {opp.margin_pct != null && opp.margin_pct < MARGIN_LOW_THRESHOLD && (
              <span
                style={{ marginLeft: 10, background: '#fee2e2', color: '#b91c1c', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}
                aria-label="Alerta A4: margen bajo"
              >
                ⚠ A4 Margen bajo
              </span>
            )}
          </h2>
          <button
            type="button"
            style={s.btnOutline}
            onClick={checkMargin}
            disabled={busy}
            aria-label="Calcular margen de la oportunidad"
          >
            🧮 Calcular Margen
          </button>
        </div>
        <div style={s.grid}>
          <Field label="Costo estimado">
            {opp.estimated_cost_usd != null ? fmtUsd(opp.estimated_cost_usd) : '—'}
          </Field>
          <Field label="Margen (%)">
            {opp.margin_pct != null ? (
              <span style={{ color: opp.margin_pct < MARGIN_LOW_THRESHOLD ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                {opp.margin_pct}%
              </span>
            ) : '—'}
          </Field>
          <Field label="Booking (base)">
            {opp.booking_amount_usd != null ? fmtUsd(opp.booking_amount_usd) : '—'}
          </Field>
        </div>
        {opp.margin_pct == null && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-light)' }}>
            Margen no calculado todavía. Haz clic en "Calcular Margen" para computarlo desde las cotizaciones o ingresar el costo estimado.
          </div>
        )}
      </div>

      {/* SPEC-CRM-00 v1.1 PR2 — Stakeholders / Funding / Drive. */}
      <div style={s.card} data-testid="opportunity-meddpicc-card">
        <h2 style={s.h2}>
          🎯 Stakeholders & Funding
          {['solution_design', 'proposal_validated', 'negotiation', 'verbal_commit'].includes(opp.status)
            && (!opp.champion_identified || !opp.economic_buyer_identified) && (
            <span
              style={{ marginLeft: 10, background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}
              aria-label="Alerta A3: Champion o EB pendiente"
            >
              ⚠ A3 {!opp.champion_identified && !opp.economic_buyer_identified ? 'Champion + EB' : !opp.champion_identified ? 'Champion' : 'EB'} pendiente
            </span>
          )}
        </h2>
        <div style={s.grid}>
          <Field label="Champion identificado">{opp.champion_identified ? '✅ Sí' : '❌ No'}</Field>
          <Field label="Economic Buyer">{opp.economic_buyer_identified ? '✅ Sí' : '❌ No'}</Field>
          <Field label="Funding source">{FUNDING_LABEL[opp.funding_source] || opp.funding_source || '—'}</Field>
          {opp.funding_source && opp.funding_source !== 'client_direct' && (
            <Field label="Funding USD">{opp.funding_amount_usd != null ? fmtUsd(opp.funding_amount_usd) : '—'}</Field>
          )}
          <Field label="Drive">
            {opp.drive_url ? (
              <a href={opp.drive_url} target="_blank" rel="noreferrer" style={s.link} aria-label="Abrir Drive de la oportunidad">
                Abrir carpeta ↗
              </a>
            ) : '—'}
          </Field>
        </div>
      </div>

      {/* SPEC-CRM-00 v1.1 PR2 — Razón de pérdida (cuando aplique). */}
      {opp.status === 'closed_lost' && (opp.loss_reason || opp.outcome_reason) && (
        <div style={{ ...s.card, background: '#fff5f5', borderColor: 'var(--danger)' }} data-testid="opportunity-loss-card">
          <h2 style={{ ...s.h2, color: 'var(--danger)' }}>📉 Razón de la pérdida</h2>
          <Field label="Categoría">
            {LOSS_LABEL[opp.loss_reason] || opp.loss_reason || opp.outcome_reason || '—'}
          </Field>
          {opp.loss_reason_detail && (
            <div style={{ marginTop: 10, fontSize: 13, fontStyle: 'italic', color: 'var(--text-light)' }}>
              {opp.loss_reason_detail}
            </div>
          )}
        </div>
      )}

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={s.h2}>Cotizaciones ({(opp.quotations || []).length})</h2>
          <button type="button" style={s.btn('var(--teal-mid)')} onClick={() => nav('/quotation/new/staff_aug')} aria-label="Nueva cotización">
            + Nueva cotización
          </button>
        </div>
        {(!opp.quotations || opp.quotations.length === 0) ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin cotizaciones todavía. Crea una usando "+ Nueva cotización".
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Proyecto', 'Tipo', 'Estado', 'Total USD'].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {opp.quotations.map((q) => (
                <tr key={q.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <Link to={`/quotation/${q.id}`} style={s.link}>{q.project_name}</Link>
                  </td>
                  <td style={{ ...s.td, fontSize: 12 }}>{q.type}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{q.status}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{q.total_usd ? `$${Number(q.total_usd).toLocaleString()}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={s.h2}>Contactos ({contacts.length})</h2>
          <Link to="/contacts" style={s.link}>Ver todos →</Link>
        </div>
        {contacts.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin contactos vinculados a esta oportunidad.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nombre', 'Email', 'Cargo', 'Rol en el deal'].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{c.first_name} {c.last_name}</td>
                  <td style={s.td}>{c.email_primary || '—'}</td>
                  <td style={s.td}>{c.job_title || '—'}</td>
                  <td style={s.td}>
                    {c.deal_role ? (
                      <span style={{ background: '#dbeafe', color: '#1e40af', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                        {DEAL_ROLE_LABEL[c.deal_role] || c.deal_role}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={s.h2}>Actividades recientes ({activities.length})</h2>
          <Link to={`/activities?opportunity_id=${opp.id}`} style={s.link}>Ver todas →</Link>
        </div>
        {activities.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin actividades registradas.{' '}
            <Link to="/activities" style={s.link}>Registrar una</Link>.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Fecha', 'Tipo', 'Asunto', 'Usuario'].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.activity_date ? String(a.activity_date).slice(0, 10) : '—'}</td>
                  <td style={s.td}>
                    <span style={{ background: '#e0e7ff', color: '#3730a3', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                      {ACTIVITY_TYPE_LABEL[a.activity_type] || a.activity_type}
                    </span>
                  </td>
                  <td style={s.td}>{a.subject}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.user_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
