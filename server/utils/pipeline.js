/*
 * Pipeline constants — single source of truth para los stages del Kanban.
 *
 * Decisión CRM-MVP-00.1 (Abril 27 2026): NO crear tabla pipeline_stages
 * todavía. Los 7 valores ya viven en el CHECK constraint de
 * opportunities.status; los enriquecemos con metadata (probability,
 * label, color, terminal, won/lost) en este módulo. Cuando se necesiten
 * stages configurables por tenant (CRM-01+), migramos a tabla.
 *
 * Las probabilidades aquí DEBEN coincidir con el trigger
 * opp_pipeline_recalc() en migrate.js. Si cambias acá, cambia allá.
 */

const STAGES = [
  { id: 'open',         label: 'Lead',        prob: 5,   color: '#9CA3AF', terminal: false, sort: 1 },
  { id: 'qualified',    label: 'Calificada',  prob: 20,  color: '#3B82F6', terminal: false, sort: 2 },
  { id: 'proposal',     label: 'Propuesta',   prob: 50,  color: '#8B5CF6', terminal: false, sort: 3 },
  { id: 'negotiation',  label: 'Negociación', prob: 75,  color: '#F59E0B', terminal: false, sort: 4 },
  { id: 'won',          label: 'Ganada',      prob: 100, color: '#10B981', terminal: true, won: true,  sort: 5 },
  { id: 'lost',         label: 'Perdida',     prob: 0,   color: '#EF4444', terminal: true, lost: true, sort: 6 },
  { id: 'cancelled',    label: 'Cancelada',   prob: 0,   color: '#6B7280', terminal: true, lost: true, sort: 7 },
];

const STAGE_BY_ID = STAGES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

const isValidStage = (id) => Object.prototype.hasOwnProperty.call(STAGE_BY_ID, id);

const probabilityFor = (statusId) => (STAGE_BY_ID[statusId] ? STAGE_BY_ID[statusId].prob : 0);

module.exports = { STAGES, STAGE_BY_ID, isValidStage, probabilityFor };
