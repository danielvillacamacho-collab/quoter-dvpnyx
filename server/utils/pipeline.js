/*
 * Pipeline constants — SSOT para los stages de oportunidades.
 *
 * Versión vigente: SPEC-CRM-00 v1.1 (mayo 2026). Pipeline de 9 estados:
 *   lead → qualified → solution_design → proposal_validated →
 *   negotiation → verbal_commit → (closed_won | closed_lost | postponed)
 *
 * Probabilidades fijas. DEBEN coincidir con el trigger
 * opp_pipeline_recalc() en migrate.js y con client/src/utils/pipeline.js.
 * Si cambias acá, cambia los tres lugares o el cliente y el server
 * discreparán en weighted totals.
 *
 * Mapeo legacy (solo referencia histórica — la migración v1.1 ya renombró
 * los datos en la BD):
 *   open       → lead
 *   proposal   → proposal_validated
 *   won        → closed_won
 *   lost / cancelled → closed_lost (decisión CCO mayo 2026)
 */

const STAGES = [
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

const STAGE_BY_ID = STAGES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

/**
 * Transiciones válidas. Postponed es un "limbo" — se puede entrar desde
 * cualquier estado activo (no desde otro Postponed ni desde terminal) y
 * salir a qualified (per spec: ya estaba calificado, no se devuelve a Lead)
 * o cerrar como perdida si finalmente no continúa.
 *
 * Los terminales closed_won/closed_lost son inmutables — sin transiciones.
 */
const TRANSITIONS = {
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

const isValidStage = (id) => Object.prototype.hasOwnProperty.call(STAGE_BY_ID, id);
const probabilityFor = (id) => (STAGE_BY_ID[id] ? STAGE_BY_ID[id].prob : 0);
const isTerminal = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].terminal);
const isPostponed = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].postponed);
const isWon = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].won);
const isLost = (id) => !!(STAGE_BY_ID[id] && STAGE_BY_ID[id].lost);

const validNextStages = (fromId) => TRANSITIONS[fromId] || [];
const isValidTransition = (fromId, toId) => validNextStages(fromId).includes(toId);

module.exports = {
  STAGES,
  STAGE_BY_ID,
  TRANSITIONS,
  isValidStage,
  probabilityFor,
  isTerminal,
  isPostponed,
  isWon,
  isLost,
  validNextStages,
  isValidTransition,
};
