export type UtilizationBucket = 'idle' | 'light' | 'healthy' | 'overbooked';

export interface WeekAssignment {
  assignment_id: string;
  contract_id: string;
  contract_name: string;
  client_name: string;
  role_title: string | null;
  weekly_hours: number;
  status: string;
}

export interface EmployeeWeek {
  week_start: string;  // ISO date (Monday)
  assignments: WeekAssignment[];
  total_hours: number;
  capacity_hours: number;
  utilization_pct: number;
  bucket: UtilizationBucket;
}

export interface EmployeePlannerRow {
  employee_id: string;
  first_name: string;
  last_name: string;
  area_id: number;
  area_name: string;
  level: string;
  country: string;
  status: string;
  weekly_capacity_hours: number;
  weeks: EmployeeWeek[];
  avg_utilization_pct: number;
  avg_bucket: UtilizationBucket;
}

export interface PlannerResult {
  employees: EmployeePlannerRow[];
  weeks: string[];  // ordered list of week-start dates
  summary: {
    total_employees: number;
    idle_count: number;
    light_count: number;
    healthy_count: number;
    overbooked_count: number;
    avg_utilization_pct: number;
  };
}

export interface PlannerFilters {
  date_from?: string;
  date_to?: string;
  area_id?: string;
  level?: string;
  status?: string;
  employee_id?: string;
  country?: string;
}

export interface RawAssignmentRow {
  assignment_id: string;
  employee_id: string;
  contract_id: string;
  contract_name: string;
  client_name: string;
  role_title: string | null;
  weekly_hours: number;
  start_date: string;
  end_date: string | null;
  status: string;
}

export interface RawEmployeeRow {
  employee_id: string;
  first_name: string;
  last_name: string;
  area_id: number;
  area_name: string;
  level: string;
  country: string;
  status: string;
  weekly_capacity_hours: number;
}
