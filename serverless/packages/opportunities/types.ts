/* ------------------------------------------------------------------ */
/*  Opportunities — Types, constants & pipeline definitions            */
/* ------------------------------------------------------------------ */

// ---- Pipeline stages ------------------------------------------------

export interface PipelineStage {
  id: Stage;
  label: string;
  prob: number;
  color: string;
  terminal: boolean;
  postponed: boolean;
  won?: boolean;
  lost?: boolean;
  sort: number;
}

export const PIPELINE_STAGES: PipelineStage[] = [
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

export const STAGE_BY_ID: Record<string, PipelineStage> =
  PIPELINE_STAGES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {} as Record<string, PipelineStage>);

export const PROBABILITIES: Record<Stage, number> =
  PIPELINE_STAGES.reduce((acc, s) => { acc[s.id] = s.prob; return acc; }, {} as Record<Stage, number>);

export const STAGE_ORDER: Record<string, number> =
  PIPELINE_STAGES.reduce((acc, s) => { acc[s.id] = s.sort; return acc; }, {} as Record<string, number>);

// ---- Stage type & helpers -------------------------------------------

export type Stage =
  | 'lead' | 'qualified' | 'solution_design' | 'proposal_validated'
  | 'negotiation' | 'verbal_commit'
  | 'closed_won' | 'closed_lost' | 'postponed';

export const VALID_STAGES: Stage[] = PIPELINE_STAGES.map(s => s.id);

export const TERMINAL_STAGES = new Set<Stage>(
  PIPELINE_STAGES.filter(s => s.terminal).map(s => s.id),
);

export const ACTIVE_STAGES: Stage[] =
  PIPELINE_STAGES.filter(s => !s.terminal).map(s => s.id);

export function isTerminal(id: string): boolean {
  return TERMINAL_STAGES.has(id as Stage);
}

export function isPostponed(id: string): boolean {
  return id === 'postponed';
}

export function isWon(id: string): boolean {
  return id === 'closed_won';
}

export function isLost(id: string): boolean {
  return id === 'closed_lost';
}

export function probabilityFor(id: string): number {
  return PROBABILITIES[id as Stage] ?? 0;
}

// ---- Valid transitions ----------------------------------------------

export const TRANSITIONS: Record<Stage, Stage[]> = {
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

export function isValidTransition(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from as Stage];
  return Array.isArray(allowed) && allowed.includes(to as Stage);
}

export function validNextStages(from: string): Stage[] {
  return TRANSITIONS[from as Stage] || [];
}

// ---- Kanban: relaxed transitions (any active <-> any active) --------

const ACTIVE_STAGE_SET = new Set<Stage>(ACTIVE_STAGES);

export const KANBAN_TRANSITIONS: Record<Stage, Set<Stage>> =
  PIPELINE_STAGES.reduce((acc, s) => {
    if (s.terminal) {
      acc[s.id] = new Set<Stage>();
    } else if (s.postponed) {
      acc[s.id] = new Set<Stage>(['qualified', 'closed_lost']);
    } else {
      acc[s.id] = new Set<Stage>([
        ...ACTIVE_STAGES.filter(id => id !== s.id),
        'closed_won', 'closed_lost',
      ]);
    }
    return acc;
  }, {} as Record<Stage, Set<Stage>>);

// ---- Exit criteria per stage ----------------------------------------

export interface ExitCriteria {
  field: string;
  message: string;
  minStageSort: number;
}

export const EXIT_CRITERIA: ExitCriteria[] = [
  { field: 'description',               message: 'Descripción requerida',                      minStageSort: 2 },
  { field: 'expected_close_date',        message: 'Fecha de cierre esperada requerida',              minStageSort: 3 },
  { field: 'next_step',                  message: 'Próximo paso requerido',                     minStageSort: 3 },
  { field: 'champion_identified',        message: 'Champion debe estar identificado',                minStageSort: 5 },
  { field: 'economic_buyer_identified',  message: 'Economic Buyer debe estar identificado',          minStageSort: 6 },
];

/**
 * Returns array of unmet exit criteria when moving forward to `targetStage`.
 * Returns empty array if all criteria are met.
 */
export function checkExitCriteria(
  opp: Record<string, unknown>,
  targetStageSort: number,
): string[] {
  const gaps: string[] = [];
  for (const ec of EXIT_CRITERIA) {
    if (targetStageSort >= ec.minStageSort && !opp[ec.field]) {
      gaps.push(ec.message);
    }
  }
  return gaps;
}

// ---- Deal types -----------------------------------------------------

export type DealType = 'new_business' | 'upsell_cross_sell' | 'renewal' | 'resell';

export const VALID_DEAL_TYPES: DealType[] = ['new_business', 'upsell_cross_sell', 'renewal', 'resell'];

// ---- Contract types -------------------------------------------------

export type ContractType = 'project' | 'capacity' | 'resell';

export const VALID_CONTRACT_TYPES: ContractType[] = ['project', 'capacity', 'resell'];

// ---- Revenue model --------------------------------------------------

export type RevenueType = 'one_time' | 'recurring' | 'mixed';

export const REVENUE_TYPES: RevenueType[] = ['one_time', 'recurring', 'mixed'];

export type FundingSource = 'client_direct' | 'aws_mdf' | 'vendor_mdf' | 'mixed';

export const FUNDING_SOURCES: FundingSource[] = ['client_direct', 'aws_mdf', 'vendor_mdf', 'mixed'];

// ---- Loss reasons ---------------------------------------------------

export const LOSS_REASONS = [
  'price', 'competitor_won', 'no_decision', 'budget_cut', 'champion_left',
  'wrong_fit', 'timing', 'incumbent_win', 'other',
] as const;

export type LossReason = typeof LOSS_REASONS[number];

export const LOSS_REASON_DETAIL_MIN = 30;

export const VALID_OUTCOME_REASONS = ['price', 'timing', 'competition', 'technical_fit', 'client_internal', 'other'] as const;

// ---- Margin ---------------------------------------------------------

export const MARGIN_LOW_THRESHOLD = 20; // %

// ---- Revenue helpers ------------------------------------------------

export function computeBooking(input: {
  revenue_type: string;
  one_time_amount_usd?: number | null;
  mrr_usd?: number | null;
  contract_length_months?: number | null;
}): number {
  const oneTime = Number(input.one_time_amount_usd) || 0;
  const mrr     = Number(input.mrr_usd) || 0;
  const months  = Number(input.contract_length_months) || 0;

  let booking: number;
  switch (input.revenue_type) {
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

export function validateRevenueModel(input: {
  revenue_type: string;
  one_time_amount_usd?: number | null;
  mrr_usd?: number | null;
  contract_length_months?: number | null;
}): string | null {
  if (!(REVENUE_TYPES as readonly string[]).includes(input.revenue_type)) {
    return `revenue_type debe ser uno de: ${REVENUE_TYPES.join(', ')}`;
  }
  if (input.revenue_type === 'one_time') {
    if (input.one_time_amount_usd == null) return 'one_time_amount_usd es requerido cuando revenue_type=one_time';
    if (Number(input.one_time_amount_usd) < 0) return 'one_time_amount_usd no puede ser negativo';
  }
  if (input.revenue_type === 'recurring' || input.revenue_type === 'mixed') {
    if (input.mrr_usd == null) return `mrr_usd es requerido cuando revenue_type=${input.revenue_type}`;
    if (input.contract_length_months == null) return `contract_length_months es requerido cuando revenue_type=${input.revenue_type}`;
    if (Number(input.mrr_usd) < 0) return 'mrr_usd no puede ser negativo';
    if (Number(input.contract_length_months) < 0) return 'contract_length_months no puede ser negativo';
    if (input.revenue_type === 'mixed' && input.one_time_amount_usd == null) return 'one_time_amount_usd es requerido cuando revenue_type=mixed';
    if (input.revenue_type === 'mixed' && Number(input.one_time_amount_usd) < 0) return 'one_time_amount_usd no puede ser negativo';
  }
  return null;
}

export function validateFunding(input: {
  funding_source?: string | null;
  funding_amount_usd?: number | null;
}): string | null {
  if (input.funding_source != null && !(FUNDING_SOURCES as readonly string[]).includes(input.funding_source)) {
    return `funding_source debe ser uno de: ${FUNDING_SOURCES.join(', ')}`;
  }
  if (input.funding_source && input.funding_source !== 'client_direct' && input.funding_amount_usd == null) {
    return 'funding_amount_usd es requerido cuando funding_source != client_direct';
  }
  if (input.funding_amount_usd != null && Number(input.funding_amount_usd) < 0) {
    return 'funding_amount_usd no puede ser negativo';
  }
  return null;
}

export function validateLossReason(input: {
  loss_reason?: string | null;
  loss_reason_detail?: string | null;
}): string | null {
  if (!(LOSS_REASONS as readonly string[]).includes(input.loss_reason as string)) {
    return `loss_reason debe ser uno de: ${LOSS_REASONS.join(', ')}`;
  }
  if (typeof input.loss_reason_detail !== 'string' || input.loss_reason_detail.trim().length < LOSS_REASON_DETAIL_MIN) {
    return `loss_reason_detail es requerido y debe tener al menos ${LOSS_REASON_DETAIL_MIN} caracteres`;
  }
  return null;
}

export function computeMargin(input: {
  booking_amount_usd: number;
  estimated_cost_usd: number;
}): number | null {
  const booking = Number(input.booking_amount_usd) || 0;
  const cost    = Number(input.estimated_cost_usd)  || 0;
  if (booking <= 0) return null;
  return Math.round(((booking - cost) / booking * 100) * 100) / 100;
}

export function validateMarginInput(input: { estimated_cost_usd?: number | null }): string | null {
  if (input.estimated_cost_usd == null) return null;
  const n = Number(input.estimated_cost_usd);
  if (isNaN(n) || n < 0) return 'estimated_cost_usd debe ser un número no negativo';
  return null;
}

// ---- Opportunity entity ---------------------------------------------

export interface Opportunity {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: Stage;
  outcome: string | null;
  outcome_reason: string | null;
  outcome_notes: string | null;
  winning_quotation_id: string | null;
  account_owner_id: string | null;
  presales_lead_id: string | null;
  co_owner_id: string | null;
  squad_id: string | null;
  expected_close_date: string | null;
  closed_at: string | null;
  tags: string | null;
  external_crm_id: string | null;
  country: string | null;
  opportunity_number: string | null;
  // Revenue model
  revenue_type: RevenueType;
  one_time_amount_usd: number | null;
  mrr_usd: number | null;
  contract_length_months: number | null;
  booking_amount_usd: number | null;
  weighted_amount_usd: number | null;
  probability: number | null;
  // Flags
  champion_identified: boolean;
  economic_buyer_identified: boolean;
  // Funding
  funding_source: FundingSource | null;
  funding_amount_usd: number | null;
  // Margin
  estimated_cost_usd: number | null;
  margin_pct: number | null;
  // Deal enrichment
  deal_type: DealType | null;
  contract_type: ContractType | null;
  drive_url: string | null;
  // Opportunity brief
  context_client: string | null;
  context_scope: string | null;
  context_pains: string | null;
  context_requirements: string | null;
  context_politics: string | null;
  // Stage tracking
  last_stage_change_at: string | null;
  next_step: string | null;
  next_step_due_date: string | null;
  // Postponed
  postponed_until_date: string | null;
  postponed_reason: string | null;
  // Loss model
  loss_reason: string | null;
  loss_reason_detail: string | null;
  // Metadata
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Computed joins (optional)
  client_name?: string;
  co_owner_name?: string;
  quotations_count?: number;
}

// ---- DTOs -----------------------------------------------------------

export interface CreateOpportunityDTO {
  client_id: string;
  name: string;
  description?: string;
  account_owner_id?: string;
  presales_lead_id?: string;
  co_owner_id?: string;
  squad_id?: string;
  expected_close_date?: string;
  tags?: string;
  external_crm_id?: string;
  country?: string;
  // Revenue model
  revenue_type?: string;
  one_time_amount_usd?: number;
  mrr_usd?: number;
  contract_length_months?: number;
  booking_amount_usd?: number;
  // Flags
  champion_identified?: boolean;
  economic_buyer_identified?: boolean;
  // Funding
  funding_source?: string;
  funding_amount_usd?: number;
  drive_url?: string;
  // Deal enrichment
  deal_type?: string;
  contract_type?: string;
  // Brief
  context_client?: string;
  context_scope?: string;
  context_pains?: string;
  context_requirements?: string;
  context_politics?: string;
}

export interface UpdateOpportunityDTO extends Partial<CreateOpportunityDTO> {}

export interface ChangeStatusDTO {
  new_status: string;
  winning_quotation_id?: string;
  outcome_reason?: string;
  outcome_notes?: string;
  postponed_until_date?: string;
  postponed_reason?: string;
  loss_reason?: string;
  loss_reason_detail?: string;
  override_exit_criteria?: boolean;
}

// ---- Filters --------------------------------------------------------

export interface OpportunityFilters {
  search?: string;
  client_id?: string;
  status?: string;
  stage?: string;      // alias for status in query
  deal_type?: string;
  contract_type?: string;
  account_owner_id?: string;
  squad_id?: string;
  revenue_type?: string;
  funding_source?: string;
  from_expected_close?: string;
  to_expected_close?: string;
  has_champion?: string;
  has_economic_buyer?: string;
}

// ---- Kanban ---------------------------------------------------------

export interface KanbanColumn {
  id: Stage;
  label: string;
  prob: number;
  color: string;
  terminal: boolean;
  sort: number;
  summary: {
    count: number;
    total_amount_usd: number;
    weighted_amount_usd: number;
    has_more: boolean;
  };
  opportunities: Partial<Opportunity>[];
}

export interface KanbanResult {
  stages: KanbanColumn[];
  global_summary: {
    total_opportunities: number;
    total_amount_usd: number;
    weighted_amount_usd: number;
  };
}

// ---- Sortable columns -----------------------------------------------

export const SORTABLE: Record<string, string> = {
  name:                 'o.name',
  status:               'o.status',
  expected_close_date:  'o.expected_close_date',
  closed_at:            'o.closed_at',
  booking_amount_usd:   'o.booking_amount_usd',
  weighted_amount_usd:  'o.weighted_amount_usd',
  probability:          'o.probability',
  last_stage_change_at: 'o.last_stage_change_at',
  next_step_due_date:   'o.next_step_due_date',
  created_at:           'o.created_at',
  updated_at:           'o.updated_at',
  client_name:          'c.name',
  deal_type:            'o.deal_type',
};

// ---- Editable fields (for update event tracking) --------------------

export const EDITABLE_FIELDS = [
  'name', 'description', 'account_owner_id', 'presales_lead_id',
  'squad_id', 'expected_close_date', 'tags', 'external_crm_id',
  'booking_amount_usd', 'next_step', 'next_step_due_date',
  'country',
  'revenue_type', 'one_time_amount_usd', 'mrr_usd', 'contract_length_months',
  'champion_identified', 'economic_buyer_identified',
  'funding_source', 'funding_amount_usd', 'drive_url',
  'deal_type', 'co_owner_id', 'contract_type',
  'context_client', 'context_scope', 'context_pains', 'context_requirements', 'context_politics',
] as const;

export const KANBAN_PER_COLUMN = 100;
