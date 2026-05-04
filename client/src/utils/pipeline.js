/*
 * Pipeline constants — espejo cliente de server/utils/pipeline.js.
 *
 * Versión vigente: SPEC-CRM-00 v1.1 (mayo 2026). Pipeline de 9 estados.
 * Si cambias valores aquí, cambia también allá Y en el trigger
 * opp_pipeline_recalc() de server/database/migrate.js. Los tres deben
 * coincidir o el cliente y el server discreparán en weighted totals.
 */

export const STAGES = [
  { id: 'lead',               label: 'Lead',                prob: 5,   color: '#9CA3AF', terminal: false, postponed: false, sort: 1 },
  { id: 'qualified',          label: 'Calificada',          prob: 15,  color: '#3B82F6', terminal: false, postponed: false, sort: 2 },
  { id: 'solution_design',    label: 'Diseño de Solución',  prob: 30,  color: '#6366F1', terminal: false, postponed: false, sort: 3 },
  { id: 'proposal_validated', label: 'Propuesta Validada',  prob: 50,  color: '#8B5CF6', terminal: false, postponed: false, sort: 4 },
  { id: 'negotiation',        label: 'Negociación',         prob: 75,  color: '#F59E0B', terminal: false, postponed: false, sort: 5 },
  { id: 'verbal_commit',      label: 'Compromiso Verbal',   prob: 90,  color: '#FB923C', terminal: false, postponed: false, sort: 6 },
  { id: 'closed_won',         label: 'Ganada',              prob: 100, color: '#10B981', terminal: true,  won: true,  postponed: false, sort: 7 },
  { id: 'closed_lost',        label: 'Perdida',             prob: 0,   color: '#EF4444', terminal: true,  lost: true, postponed: false, sort: 8 },
  { id: 'postponed',          label: 'Postergada',          prob: 0,   color: '#A78BFA', terminal: false, postponed: true, sort: 9 },
];

export const STAGE_BY_ID = STAGES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

/**
 * Transiciones válidas (debe coincidir con server/utils/pipeline.js).
 * Postponed se entra desde cualquier etapa activa y sale a `qualified`
 * (per spec: la opp ya estaba calificada antes de pausar) o `closed_lost`.
 */
export const TRANSITIONS = {
  lead:               ['qualified', 'closed_lost', 'postponed'],
  qualified:          ['solution_design', 'closed_lost', 'postponed'],
  solution_design:    ['proposal_validated', 'closed_lost', 'postponed'],
  proposal_validated: ['negotiation', 'closed_won', 'closed_lost', 'postponed'],
  negotiation:        ['verbal_commit', 'closed_won', 'closed_lost', 'postponed'],
  verbal_commit:      ['closed_won', 'closed_lost', 'postponed'],
  closed_won:         [],
  closed_lost:        [],
  postponed:          ['qualified', 'closed_lost'],
};

export const probabilityFor = (id) => (STAGE_BY_ID[id] ? STAGE_BY_ID[id].prob : 0);
export const isTerminal = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].terminal);
export const isPostponed = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].postponed);
export const isWon = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].won);
export const isLost = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].lost);

export const validNextStages = (fromId) => TRANSITIONS[fromId] || [];

/**
 * Warnings soft (no bloqueantes) que mostramos en el modal de transition.
 * Spec v1.1: validaciones soft, hard exit criteria vienen en CRM-02.
 */
export function computeTransitionWarnings({ fromStage, toStage, opportunity }) {
  const warnings = [];
  const to = STAGE_BY_ID[toStage];
  if (!to) return warnings;
  const amount = Number(opportunity?.booking_amount_usd || 0);
  const fromOrder = STAGE_BY_ID[fromStage]?.sort ?? 0;

  // Warning: monto en 0 al avanzar a etapas con commitment formal
  if (amount === 0 && ['proposal_validated', 'negotiation', 'verbal_commit', 'closed_won'].includes(toStage)) {
    warnings.push({ code: 'amount_zero', message: 'El monto USD está en 0. ¿Continuar?' });
  }
  // Warning: backwards transition (excepto postponed→qualified que es legítimo)
  if (fromOrder > 0 && fromOrder > (to.sort ?? 0) && !to.terminal && !to.postponed && fromStage !== 'postponed') {
    warnings.push({ code: 'backwards', message: 'Estás moviendo la oportunidad a una etapa anterior. ¿Confirmar?' });
  }
  // Warning: fecha estimada de cierre vencida
  if (opportunity?.expected_close_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = new Date(opportunity.expected_close_date);
    if (exp < today && !to.terminal && !to.postponed) {
      warnings.push({ code: 'close_date_past', message: 'La fecha estimada ya pasó. Recomendado actualizar.' });
    }
  }
  return warnings;
}
