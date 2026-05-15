// ─── Time Entries (daily hours per assignment) ───

export interface TimeEntry {
  id: string;
  employee_id: string;
  assignment_id: string;
  work_date: string;
  hours: number;
  description: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  deleted_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // joined fields
  employee_name?: string;
  assignment_role_title?: string;
  contract_name?: string;
  client_name?: string;
}

export interface CreateTimeEntryDTO {
  employee_id: string;
  assignment_id: string;
  work_date: string;
  hours: number;
  description?: string;
  status?: string;
}

export interface UpdateTimeEntryDTO {
  hours?: number;
  description?: string;
  status?: string;
  rejection_reason?: string;
}

export interface CopyWeekDTO {
  employee_id: string;
  source_week_start: string;  // Monday of source week
  target_week_start: string;  // Monday of target week
}

export interface TimeEntryFilters {
  employee_id?: string;
  assignment_id?: string;
  date_from?: string;
  date_to?: string;
  status?: string;
}

export const VALID_ENTRY_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;

export const ENTRY_EDITABLE_FIELDS = [
  'hours', 'description', 'status',
] as const;

export const ENTRY_SORTABLE: Record<string, string> = {
  work_date:   'te.work_date',
  hours:       'te.hours',
  status:      'te.status',
  created_at:  'te.created_at',
};

// ─── Weekly Time Allocations (% per assignment per week) ───

export interface WeeklyTimeAllocation {
  id: string;
  employee_id: string;
  week_start_date: string;
  assignment_id: string;
  pct: number;
  notes: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  // joined fields
  assignment_role_title?: string;
  contract_name?: string;
  client_name?: string;
}

export interface BulkAllocationItem {
  assignment_id: string;
  week_start_date: string;
  pct: number;
  notes?: string;
}

export interface BulkAllocationDTO {
  employee_id: string;
  allocations: BulkAllocationItem[];
}

export interface AllocationFilters {
  employee_id?: string;
  assignment_id?: string;
  week_start_date?: string;
  date_from?: string;
  date_to?: string;
}
