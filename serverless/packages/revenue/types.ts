/* ── Revenue, Exchange Rates & Budgets — type definitions ── */

// ── Revenue Periods ──

export interface RevenuePeriod {
  contract_id: string;
  yyyymm: string;
  projected_usd: number;
  projected_pct: number | null;
  real_usd: number | null;
  real_pct: number | null;
  status: 'open' | 'closed';
  notes: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RevenuePeriodWithContract extends RevenuePeriod {
  contract_name: string;
  contract_type: string;
  contract_status: string;
  total_value_usd: number;
  original_currency: string;
  client_name: string;
  client_country: string | null;
}

export interface UpdateRevenuePlanDTO {
  projected_usd?: number;
  projected_pct?: number | null;
  notes?: string;
}

export interface RevenueFilters {
  from?: string;
  to?: string;
  type?: string;
  owner_id?: string;
  country?: string;
  display_currency?: string;
}

export const REVENUE_SORTABLE: Record<string, string> = {
  contract_name: 'c.name',
  client_name:   'cl.name',
  yyyymm:        'rp.yyyymm',
  status:        'rp.status',
  projected_usd: 'rp.projected_usd',
  real_usd:      'rp.real_usd',
  created_at:    'rp.created_at',
};

export const VALID_REVENUE_STATUSES = ['open', 'closed'] as const;

// ── Exchange Rates ──

export interface ExchangeRate {
  yyyymm: string;
  currency: string;
  usd_rate: number;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface UpsertExchangeRateDTO {
  yyyymm: string;
  currency: string;
  usd_rate: number;
  notes?: string;
}

export const EXCHANGE_RATE_SORTABLE: Record<string, string> = {
  yyyymm:   'er.yyyymm',
  currency: 'er.currency',
  usd_rate: 'er.usd_rate',
  updated_at: 'er.updated_at',
};

// ── Budgets ──

export interface Budget {
  id: string;
  period_year: number;
  period_quarter: number | null;
  period_month: number | null;
  country: string | null;
  owner_id: string | null;
  service_line: string | null;
  target_usd: number;
  status: 'draft' | 'active' | 'closed';
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // joined fields
  owner_name?: string;
  approved_by_name?: string;
}

export interface CreateBudgetDTO {
  period_year: number;
  period_quarter?: number | null;
  period_month?: number | null;
  country?: string;
  owner_id?: string;
  service_line?: string;
  target_usd: number;
  status?: string;
  notes?: string;
}

export interface UpdateBudgetDTO extends Partial<CreateBudgetDTO> {}

export interface BudgetFilters {
  period_year?: string;
  period_quarter?: string;
  country?: string;
  owner_id?: string;
  service_line?: string;
  status?: string;
}

export interface BudgetSummaryRow {
  period_year: number;
  period_quarter: number | null;
  country: string | null;
  service_line: string | null;
  target_usd: number;
  actual_usd: number;
  pct: number;
}

export const VALID_BUDGET_STATUSES = ['draft', 'active', 'closed'] as const;

export const BUDGET_SORTABLE: Record<string, string> = {
  period_year:    'b.period_year',
  period_quarter: 'b.period_quarter',
  period_month:   'b.period_month',
  country:        'b.country',
  target_usd:     'b.target_usd',
  status:         'b.status',
  created_at:     'b.created_at',
  updated_at:     'b.updated_at',
};

export const BUDGET_EDITABLE_FIELDS = [
  'period_year', 'period_quarter', 'period_month', 'country',
  'owner_id', 'service_line', 'target_usd', 'status', 'notes',
] as const;
