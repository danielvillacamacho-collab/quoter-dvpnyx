import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/apiV2';
import StatusBadge from '../shell/StatusBadge';
import { STAGES, TRANSITIONS as PIPELINE_TRANSITIONS, isPostponed, isWon } from '../utils/pipeline';

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

export default function OpportunityDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [opp, setOpp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/opportunities/${id}`);
      setOpp(data || null);
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
      // eslint-disable-next-line no-alert
      const reason = window.prompt(
        `Razón para marcar ${STATUS_LABEL[target]}:\n(price / timing / competition / technical_fit / client_internal / other)`,
        'other'
      );
      if (!reason) return;
      // eslint-disable-next-line no-alert
      const notes = window.prompt('Notas adicionales (opcional):', '');
      await doTransition({ new_status: target, outcome_reason: reason, outcome_notes: notes || null });
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
          <Field label="Cierre esperado">{opp.expected_close_date ? String(opp.expected_close_date).slice(0, 10) : null}</Field>
          <Field label="Owner (comercial)">{opp.account_owner_id}</Field>
          <Field label="Preventa lead">{opp.presales_lead_id}</Field>
          <Field label="Outcome">{opp.outcome_reason}</Field>
        </div>
      </div>

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
    </div>
  );
}
