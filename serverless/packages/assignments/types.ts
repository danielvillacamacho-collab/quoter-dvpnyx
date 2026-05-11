export interface Assignment {
  id: string;
  resource_request_id: string;
  employee_id: string;
  contract_id: string;
  weekly_hours: number;
  start_date: string;
  end_date: string | null;
  status: 'planned' | 'active' | 'ended' | 'cancelled';
  role_title: string | null;
  notes: string | null;
  approval_required: boolean;
  approved_at: string | null;
  approved_by: string | null;
  override_reason: string | null;
  override_checks: Record<string, unknown> | null;
  override_author_id: string | null;
  override_at: string | null;
  deleted_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // joined fields
  employee_name?: string;
  employee_area_id?: number;
  employee_area_name?: string;
  employee_level?: string;
  contract_name?: string;
  client_name?: string;
  request_role_title?: string;
}

export interface CreateAssignmentDTO {
  resource_request_id: string;
  employee_id: string;
  contract_id: string;
  weekly_hours: number;
  start_date: string;
  end_date?: string;
  role_title?: string;
  notes?: string;
  force?: boolean;
  override_reason?: string;
}

export interface UpdateAssignmentDTO {
  weekly_hours?: number;
  start_date?: string;
  end_date?: string;
  status?: string;
  role_title?: string;
  notes?: string;
}

export interface AssignmentFilters {
  search?: string;
  contract_id?: string;
  employee_id?: string;
  resource_request_id?: string;
  status?: string;
}

export interface ValidationCheck {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  checks: ValidationCheck[];
  warnings: ValidationCheck[];
  errors: ValidationCheck[];
}

export interface EmployeeContext {
  id: string;
  area_id: number;
  level: string;
  weekly_capacity_hours: number;
  status: string;
}

export interface RequestContext {
  id: string;
  area_id: number;
  level: string;
  weekly_hours: number;
  start_date: string;
  end_date: string | null;
  quantity: number;
  status: string;
}

export interface ExistingAssignment {
  id: string;
  employee_id: string;
  weekly_hours: number;
  start_date: string;
  end_date: string | null;
  status: string;
}

export const VALID_STATUSES = ['planned', 'active', 'ended', 'cancelled'] as const;

export const EDITABLE_FIELDS = [
  'weekly_hours', 'start_date', 'end_date', 'status', 'role_title', 'notes',
] as const;

export const SORTABLE: Record<string, string> = {
  start_date:     'asg.start_date',
  end_date:       'asg.end_date',
  status:         'asg.status',
  weekly_hours:   'asg.weekly_hours',
  role_title:     'asg.role_title',
  created_at:     'asg.created_at',
  updated_at:     'asg.updated_at',
  employee_name:  "CONCAT(e.first_name, ' ', e.last_name)",
};
