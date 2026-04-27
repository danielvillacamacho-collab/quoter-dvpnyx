/*
 * Pipeline constants — espejo cliente del módulo server/utils/pipeline.js.
 *
 * Si cambias valores aquí, cambia también allá Y en el trigger
 * opp_pipeline_recalc() de server/database/migrate.js. Los tres deben
 * coincidir o el cliente y el server discreparán en weighted totals.
 */

export const STAGES = [
  { id: 'open',         label: 'Lead',        prob: 5,   color: '#9CA3AF', terminal: false, sort: 1 },
  { id: 'qualified',    label: 'Calificada',  prob: 20,  color: '#3B82F6', terminal: false, sort: 2 },
  { id: 'proposal',     label: 'Propuesta',   prob: 50,  color: '#8B5CF6', terminal: false, sort: 3 },
  { id: 'negotiation',  label: 'Negociación', prob: 75,  color: '#F59E0B', terminal: false, sort: 4 },
  { id: 'won',          label: 'Ganada',      prob: 100, color: '#10B981', terminal: true, won: true,  sort: 5 },
  { id: 'lost',         label: 'Perdida',     prob: 0,   color: '#EF4444', terminal: true, lost: true, sort: 6 },
  { id: 'cancelled',    label: 'Cancelada',   prob: 0,   color: '#6B7280', terminal: true, lost: true, sort: 7 },
];

export const STAGE_BY_ID = STAGES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

export const probabilityFor = (id) => (STAGE_BY_ID[id] ? STAGE_BY_ID[id].prob : 0);

export const isTerminal = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].terminal);

/* Warnings soft (no bloqueantes) que mostramos en el modal de transition. */
export function computeTransitionWarnings({ fromStage, toStage, opportunity }) {
  const warnings = [];
  const to = STAGE_BY_ID[toStage];
  if (!to) return warnings;
  const amount = Number(opportunity?.booking_amount_usd || 0);
  const fromOrder = STAGE_BY_ID[fromStage]?.sort ?? 0;
  if (amount === 0 && ['proposal', 'negotiation', 'won'].includes(toStage)) {
    warnings.push({ code: 'amount_zero', message: 'El monto USD está en 0. ¿Continuar?' });
  }
  if (fromOrder > 0 && fromOrder > (to.sort ?? 0) && !to.terminal) {
    warnings.push({ code: 'backwards', message: 'Estás moviendo la oportunidad a una etapa anterior. ¿Confirmar?' });
  }
  if (opportunity?.expected_close_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = new Date(opportunity.expected_close_date);
    if (exp < today && !to.terminal) {
      warnings.push({ code: 'close_date_past', message: 'La fecha estimada ya pasó. Recomendado actualizar.' });
    }
  }
  if (to.terminal && !opportunity?.next_step && to.id === 'won') {
    // No requerimos next_step en won; sólo si el form lo pide.
  }
  return warnings;
}
