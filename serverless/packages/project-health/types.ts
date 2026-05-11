/* ────────── Project Health / EVM types ────────── */

/** Active or historical project baseline. */
export interface Baseline {
  id: string;
  contract_id: string;
  version: number;
  is_active: boolean;
  frozen_by: string;
  frozen_by_name?: string;
  bac_cost_usd: number;
  bac_revenue_usd: number;
  planned_start: string; // YYYY-MM-DD
  planned_end: string;   // YYYY-MM-DD
  measurement_method: 'weighted_milestones' | 'percent_complete';
  snapshot: unknown;
  reason: string;
  frozen_at: string;
  created_at: string;
}

/** Work Breakdown Structure package (phase, epic, or milestone). */
export interface WbsPackage {
  id: string;
  baseline_id: string;
  parent_id: string | null;
  kind: 'phase' | 'epic' | 'milestone';
  source_id: string | null;
  name: string;
  sort_order: number;
  planned_hours: number;
  planned_cost_usd: number;
  weight_pct: number;
  planned_start: string;
  planned_end: string;
  current_progress?: number;
}

/** Per-package progress entry within a status report. */
export interface WbsProgressEntry {
  wbs_package_id: string;
  percent_complete: number;
  evidence_url?: string | null;
  notes?: string | null;
}

/** Monthly status report with computed EVM KPIs. */
export interface StatusReport {
  id: string;
  baseline_id: string;
  cutoff_date: string; // YYYY-MM-DD
  reported_by: string;
  reported_by_name?: string;
  overall_health: 'green' | 'yellow' | 'red';
  narrative: string | null;
  risks: unknown | null;
  computed_kpis: HealthKpis;
  created_at: string;
}

/** Full set of EVM KPIs stored in computed_kpis JSONB. */
export interface HealthKpis {
  pv: number;
  ev: number;
  ac: number;
  sv: number;
  cv: number;
  spi: number | null;
  cpi: number | null;
  eac_typical: number | null;
  eac_atypical: number;
  eac_pressure: number | null;
  etc: number | null;
  vac: number | null;
  tcpi_bac: number | null;
  tcpi_eac: number | null;
  es_days: number | null;
  spi_t: number | null;
  sv_t_days: number | null;
  ac_warnings: string[];
  ac_coverage_pct: number;
}

/** Health assessment (traffic light). */
export interface HealthBadge {
  overall: 'green' | 'yellow' | 'red';
  drivers: string[];
}

/** Cost forecast: AC executed + projected future staffing cost. */
export interface CostForecast {
  contract_id: string;
  as_of: string;
  ac_executed: number;
  ac_warnings: string[];
  planned_future_cost: number;
  eac_staffing: number;
  bac_cost: number | null;
  bac_revenue: number | null;
  variance_at_completion: number | null;
  margin_projected: number | null;
  assignments_detail: AssignmentForecastDetail[];
}

export interface AssignmentForecastDetail {
  employee_id: string;
  weekly_hours: number;
  weeks_remaining: number;
  hourly_cost: number;
  projected_cost: number;
  has_cost_data: boolean;
}

/** Portfolio-level project summary row. */
export interface PortfolioProject {
  contract_id: string;
  contract_name: string;
  client_name: string | null;
  status: string;
  has_baseline: boolean;
  baseline_version: number | null;
  bac_cost_usd: number | null;
  bac_revenue_usd: number | null;
  planned_start: string | null;
  planned_end: string | null;
  last_report_date: string | null;
  overall_health: string | null;
  kpis: HealthKpis | null;
}

/** DTOs */

export interface CreateBaselineDTO {
  bac_cost_usd?: number;
  measurement_method?: string;
  reason?: string;
}

export interface RebaseDTO {
  reason: string;
  bac_cost_usd?: number;
  bac_revenue_usd?: number;
  planned_end?: string;
  measurement_method?: string;
}

export interface SubmitStatusReportDTO {
  cutoff_date: string;
  wbs_progress: WbsProgressEntry[];
  narrative?: string;
  risks?: unknown;
  overall_health?: string;
}

/** Trend data point for S-curve chart. */
export interface TrendPoint {
  cutoff_date: string;
  cpi: number | null;
  spi: number | null;
  overall_health: string;
}
