export type QuotationType = 'staff_aug' | 'fixed_scope';
export type QuotationStatus = 'draft' | 'sent' | 'approved' | 'rejected';

export interface Quotation {
  id: string;
  type: QuotationType;
  status: QuotationStatus;
  parent_id: string | null;
  version: number;
  project_name: string;
  client_id: string | null;
  client_name: string;
  opportunity_id: string | null;
  commercial_name: string | null;
  preventa_name: string | null;
  discount_pct: number;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  parameters_snapshot: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  deleted_at: string | null;
  /* joined */
  created_by_name?: string;
  line_count?: number;
  lines?: QuotationLine[];
  phases?: QuotationPhase[];
  epics?: QuotationEpic[];
  milestones?: QuotationMilestone[];
}

export interface QuotationLine {
  id?: string;
  quotation_id?: string;
  sort_order: number;
  specialty: string | null;
  role_title: string | null;
  level: number | null;
  country: string | null;
  bilingual: boolean;
  tools: string | null;
  stack: string | null;
  modality: string | null;
  quantity: number;
  duration_months: number;
  hours_per_week: number;
  phase: string | null;
  cost_hour: number;
  rate_hour: number;
  rate_month: number;
  total: number;
}

export interface QuotationPhase {
  id?: string;
  quotation_id?: string;
  sort_order: number;
  name: string;
  weeks: number;
  description: string | null;
}

export interface QuotationEpic {
  id?: string;
  quotation_id?: string;
  sort_order: number;
  name: string;
  priority: string;
  hours_by_profile: Record<string, unknown>;
  total_hours: number;
}

export interface QuotationMilestone {
  id?: string;
  quotation_id?: string;
  sort_order: number;
  name: string;
  phase: string | null;
  percentage: number | null;
  amount: number | null;
  expected_date: string | null;
}

export interface QuotationAllocation {
  quotation_id: string;
  line_sort_order: number;
  phase_id: string;
  weekly_hours: number;
}

export interface CreateQuotationDTO {
  type: QuotationType;
  project_name: string;
  client_id: string;
  opportunity_id: string;
  client_name?: string;
  commercial_name?: string;
  preventa_name?: string;
  discount_pct?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
  lines?: QuotationLine[];
  phases?: QuotationPhase[];
  epics?: QuotationEpic[];
  milestones?: QuotationMilestone[];
}

export interface UpdateQuotationDTO {
  project_name?: string;
  client_name?: string;
  commercial_name?: string;
  preventa_name?: string;
  status?: QuotationStatus;
  discount_pct?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
  lines?: QuotationLine[];
  phases?: QuotationPhase[];
  epics?: QuotationEpic[];
  milestones?: QuotationMilestone[];
}

export interface QuotationFilters {
  search?: string;
  type?: string;
  status?: string;
  client_id?: string;
  opportunity_id?: string;
  created_by?: string;
}

export const VALID_TYPES: QuotationType[] = ['staff_aug', 'fixed_scope'];
export const VALID_STATUSES: QuotationStatus[] = ['draft', 'sent', 'approved', 'rejected'];

export const SORTABLE: Record<string, string> = {
  project_name:    'q.project_name',
  client_name:     'q.client_name',
  type:            'q.type',
  status:          'q.status',
  created_at:      'q.created_at',
  updated_at:      'q.updated_at',
  sent_at:         'q.sent_at',
  created_by_name: 'u.name',
};
