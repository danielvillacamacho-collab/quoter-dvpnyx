/**
 * SPEC-CRM-00 v1.1 — Mirror cliente de server/utils/booking.js.
 *
 * Cualquier cambio en la fórmula debe sincronizarse con:
 *   - server/utils/booking.js
 *   - Trigger DB `opp_pipeline_recalc()` en server/database/migrate.js
 *   - Tests en ambos lados
 *
 * Esta versión usa export ES module porque es lo que CRA consume.
 */

export const REVENUE_TYPES = [
  { value: 'one_time',  label: 'One-time (proyecto puntual)' },
  { value: 'recurring', label: 'Recurring (mensual con duración)' },
  { value: 'mixed',     label: 'Mixed (one-time + recurring)' },
];

export const FUNDING_SOURCES = [
  { value: 'client_direct', label: 'Cliente directo' },
  { value: 'aws_mdf',       label: 'AWS MDF' },
  { value: 'vendor_mdf',    label: 'Vendor MDF' },
  { value: 'mixed',         label: 'Mixto (cliente + alianza)' },
];

export const LOSS_REASONS = [
  { value: 'price',          label: 'Precio' },
  { value: 'competitor_won', label: 'Ganó competidor' },
  { value: 'no_decision',    label: 'No decisión' },
  { value: 'budget_cut',     label: 'Recorte de presupuesto' },
  { value: 'champion_left',  label: 'Champion se fue' },
  { value: 'wrong_fit',      label: 'No es buen fit' },
  { value: 'timing',         label: 'Timing' },
  { value: 'incumbent_win',  label: 'Ganó incumbente' },
  { value: 'other',          label: 'Otro' },
];

export const LOSS_REASON_DETAIL_MIN = 30;

export function computeBooking({ revenue_type, one_time_amount_usd, mrr_usd, contract_length_months } = {}) {
  const oneTime = Number(one_time_amount_usd) || 0;
  const mrr     = Number(mrr_usd) || 0;
  const months  = Number(contract_length_months) || 0;

  let booking;
  switch (revenue_type) {
    case 'recurring':
      booking = mrr * months;
      break;
    case 'mixed':
      booking = oneTime + mrr * months;
      break;
    case 'one_time':
    default:
      booking = oneTime;
      break;
  }
  return Math.round(booking * 100) / 100;
}

/** Devuelve null si válido, o un string con el primer error para mostrar al usuario. */
export function validateRevenueModel({ revenue_type, one_time_amount_usd, mrr_usd, contract_length_months } = {}) {
  const ok = ['one_time', 'recurring', 'mixed'];
  if (!ok.includes(revenue_type)) return `Selecciona un tipo de revenue válido`;
  if (revenue_type === 'one_time') {
    if (one_time_amount_usd == null || one_time_amount_usd === '') return 'El monto one-time es requerido';
    if (Number(one_time_amount_usd) < 0) return 'El monto no puede ser negativo';
  }
  if (revenue_type === 'recurring' || revenue_type === 'mixed') {
    if (mrr_usd == null || mrr_usd === '') return 'El MRR es requerido';
    if (contract_length_months == null || contract_length_months === '') return 'La duración del contrato es requerida';
    if (Number(mrr_usd) < 0) return 'El MRR no puede ser negativo';
    if (Number(contract_length_months) < 0) return 'La duración no puede ser negativa';
    if (revenue_type === 'mixed') {
      if (one_time_amount_usd == null || one_time_amount_usd === '') return 'El monto one-time es requerido en mixed';
      if (Number(one_time_amount_usd) < 0) return 'El monto one-time no puede ser negativo';
    }
  }
  return null;
}

export function validateFunding({ funding_source, funding_amount_usd } = {}) {
  if (!funding_source) return null; // se asume client_direct si vacío
  if (funding_source !== 'client_direct' && (funding_amount_usd == null || funding_amount_usd === '')) {
    return 'El monto de funding es requerido cuando la fuente no es cliente directo';
  }
  if (funding_amount_usd != null && Number(funding_amount_usd) < 0) {
    return 'El monto de funding no puede ser negativo';
  }
  return null;
}

export function validateLossReason({ loss_reason, loss_reason_detail } = {}) {
  const valid = LOSS_REASONS.map((r) => r.value);
  if (!valid.includes(loss_reason)) return 'Selecciona una razón de pérdida válida';
  const detail = (loss_reason_detail || '').trim();
  if (detail.length < LOSS_REASON_DETAIL_MIN) {
    return `La descripción debe tener al menos ${LOSS_REASON_DETAIL_MIN} caracteres (lleva ${detail.length}).`;
  }
  return null;
}
