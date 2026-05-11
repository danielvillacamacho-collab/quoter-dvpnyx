/* ------------------------------------------------------------------ */
/* Reports — read-only aggregate query result interfaces               */
/* ------------------------------------------------------------------ */

export interface UtilizationRow {
  id: string;
  first_name: string;
  last_name: string;
  level: string | null;
  country: string | null;
  status: string;
  weekly_capacity_hours: number;
  area_name: string | null;
  assigned_weekly_hours: number;
  utilization: number;
}

export interface BenchRow {
  id: string;
  first_name: string;
  last_name: string;
  level: string | null;
  country: string | null;
  status: string;
  weekly_capacity_hours: number;
  area_name: string | null;
  assigned_weekly_hours: number;
  utilization: number;
}

export interface PendingRequestRow {
  id: string;
  role_title: string | null;
  level: string | null;
  country: string | null;
  quantity: number;
  priority: string | null;
  status: string;
  start_date: string | null;
  created_at: string;
  contract_name: string | null;
  client_name: string | null;
  active_assignments: number;
  age_days: number;
}

export interface HiringNeedsRow {
  area_id: string;
  area_name: string;
  level: string | null;
  country: string;
  open_slots: number;
  requests_count: number;
  priorities: string[];
}

export interface CoverageRow {
  id: string;
  name: string;
  type: string;
  status: string;
  client_name: string | null;
  requested_weekly_hours: number;
  assigned_weekly_hours: number;
  coverage_pct: number;
  open_requests_count: number;
}

export interface TimeComplianceRow {
  id: string;
  first_name: string;
  last_name: string;
  level: string | null;
  area_name: string | null;
  weekly_capacity_hours: number;
  total_logged_hours: number;
  expected_hours: number;
  compliance_pct: number;
}

export interface PlanVsRealLine {
  assignment_id: string | null;
  contract_id: string | null;
  contract_name: string | null;
  role_title: string | null;
  planned_hours: number;
  planned_pct: number;
  actual_pct: number | null;
  diff_pct: number | null;
  status: 'on_plan' | 'over' | 'under' | 'unplanned' | 'missing' | 'no_data';
}

export interface PlanVsRealRow {
  employee_id: string;
  employee_name: string;
  area_name: string | null;
  level: string | null;
  capacity_hours: number;
  has_actual_data: boolean;
  weekly_total_planned_pct: number;
  weekly_total_actual_pct: number | null;
  bench_pct: number | null;
  lines: PlanVsRealLine[];
}

export interface PlanVsRealResult {
  week_start_date: string;
  week_end_date: string;
  rows: PlanVsRealRow[];
}

export interface MyDashboardResult {
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    weekly_capacity_hours: number;
  } | null;
  active_assignments: Record<string, unknown>[];
  week_hours: {
    logged: number;
    expected: number;
    capacity: number;
    week_start?: string;
    week_end?: string;
  };
}

export interface OverviewResult {
  generated_at: string;
  assignments: {
    active_count: number;
    planned_count: number;
    weekly_hours: number;
  };
  requests: {
    open_count: number;
    open_hours_weekly: number;
  };
  employees: {
    total: number;
    bench: number;
    utilized: number;
  };
  contracts: {
    active_count: number;
    planned_count: number;
    by_status: Record<string, number>;
  };
  opportunities: {
    pipeline_count: number;
    by_status: Record<string, number>;
  };
  quotations: {
    total: number;
    by_status: Record<string, number>;
  };
}

export interface ReportsV2DeliveryResult {
  kpis: {
    active_employees: number;
    avg_utilization: number;
    bench_count: number;
    active_contracts: number;
    avg_coverage: number;
    open_requests: number;
    critical_requests: number;
  };
  utilization_by_area: { name: string; avg_utilization: number; count: number }[];
  utilization_distribution: { name: string; value: number }[];
}

export interface UtilizationFilters {
  area_id?: string;
}

export interface TimeComplianceFilters {
  from?: string;
  to?: string;
}

export interface PlanVsRealFilters {
  week_start?: string;
  employee_id?: string;
  manager_id?: string;
}
