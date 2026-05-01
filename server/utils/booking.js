/**
 * SPEC-CRM-00 v1.1 — Cálculo de booking según revenue_type.
 *
 * Esta es la fuente de verdad pura del modelo de revenue. Espejo de:
 *   - Trigger DB `opp_pipeline_recalc()` en server/database/migrate.js
 *   - Mirror cliente: client/src/utils/booking.js
 *
 * IMPORTANTE: Si cambias la fórmula aquí, también:
 *   1. Trigger DB (server/database/migrate.js → opp_pipeline_recalc)
 *   2. Mirror cliente (client/src/utils/booking.js)
 *   3. Tests (server/utils/booking.test.js + client/src/utils/booking.test.js)
 */

const REVENUE_TYPES = ['one_time', 'recurring', 'mixed'];
const FUNDING_SOURCES = ['client_direct', 'aws_mdf', 'vendor_mdf', 'mixed'];
const LOSS_REASONS = [
  'price', 'competitor_won', 'no_decision', 'budget_cut', 'champion_left',
  'wrong_fit', 'timing', 'incumbent_win', 'other',
];

const LOSS_REASON_DETAIL_MIN = 30;

/**
 * @param {object} input
 * @param {'one_time'|'recurring'|'mixed'} input.revenue_type
 * @param {number?} input.one_time_amount_usd
 * @param {number?} input.mrr_usd
 * @param {number?} input.contract_length_months
 * @returns {number} booking USD redondeado a 2 decimales
 */
function computeBooking({ revenue_type, one_time_amount_usd, mrr_usd, contract_length_months } = {}) {
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
      // Para revenue_type desconocido tratamos como one_time. La validación
      // estricta del enum ocurre en validateRevenueModel().
      booking = oneTime;
      break;
  }
  // Redondear a centavos para evitar drift floating-point.
  return Math.round(booking * 100) / 100;
}

/**
 * Valida la consistencia del modelo de revenue. Devuelve null si válido,
 * o un string con el primer error encontrado (formato listo para 400).
 */
function validateRevenueModel({ revenue_type, one_time_amount_usd, mrr_usd, contract_length_months } = {}) {
  if (!REVENUE_TYPES.includes(revenue_type)) {
    return `revenue_type debe ser uno de: ${REVENUE_TYPES.join(', ')}`;
  }
  if (revenue_type === 'one_time') {
    if (one_time_amount_usd == null) {
      return 'one_time_amount_usd es requerido cuando revenue_type=one_time';
    }
    if (Number(one_time_amount_usd) < 0) {
      return 'one_time_amount_usd no puede ser negativo';
    }
  }
  if (revenue_type === 'recurring' || revenue_type === 'mixed') {
    if (mrr_usd == null) return `mrr_usd es requerido cuando revenue_type=${revenue_type}`;
    if (contract_length_months == null) {
      return `contract_length_months es requerido cuando revenue_type=${revenue_type}`;
    }
    if (Number(mrr_usd) < 0) return 'mrr_usd no puede ser negativo';
    if (Number(contract_length_months) < 0) return 'contract_length_months no puede ser negativo';
    if (revenue_type === 'mixed' && one_time_amount_usd == null) {
      return 'one_time_amount_usd es requerido cuando revenue_type=mixed';
    }
    if (revenue_type === 'mixed' && Number(one_time_amount_usd) < 0) {
      return 'one_time_amount_usd no puede ser negativo';
    }
  }
  return null;
}

/**
 * Valida funding source + amount. Devuelve null o mensaje de error.
 */
function validateFunding({ funding_source, funding_amount_usd } = {}) {
  if (funding_source != null && !FUNDING_SOURCES.includes(funding_source)) {
    return `funding_source debe ser uno de: ${FUNDING_SOURCES.join(', ')}`;
  }
  if (funding_source && funding_source !== 'client_direct' && funding_amount_usd == null) {
    return 'funding_amount_usd es requerido cuando funding_source != client_direct';
  }
  if (funding_amount_usd != null && Number(funding_amount_usd) < 0) {
    return 'funding_amount_usd no puede ser negativo';
  }
  return null;
}

/**
 * Valida loss_reason + loss_reason_detail al cerrar como perdida.
 * loss_reason_detail debe tener al menos LOSS_REASON_DETAIL_MIN chars.
 * Devuelve null si válido, o mensaje de error.
 */
function validateLossReason({ loss_reason, loss_reason_detail } = {}) {
  if (!LOSS_REASONS.includes(loss_reason)) {
    return `loss_reason debe ser uno de: ${LOSS_REASONS.join(', ')}`;
  }
  if (typeof loss_reason_detail !== 'string' || loss_reason_detail.trim().length < LOSS_REASON_DETAIL_MIN) {
    return `loss_reason_detail es requerido y debe tener al menos ${LOSS_REASON_DETAIL_MIN} caracteres`;
  }
  return null;
}

module.exports = {
  REVENUE_TYPES,
  FUNDING_SOURCES,
  LOSS_REASONS,
  LOSS_REASON_DETAIL_MIN,
  computeBooking,
  validateRevenueModel,
  validateFunding,
  validateLossReason,
};
