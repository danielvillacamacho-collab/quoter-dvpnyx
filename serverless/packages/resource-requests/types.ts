export interface ResourceRequest {
  id: string;
  contract_id: string;
  role_title: string;
  area_id: number;
  level: string;
  country: string | null;
  language_requirements: Record<string, unknown>[] | null;
  required_skills: number[] | null;
  nice_to_have_skills: number[] | null;
  weekly_hours: number;
  start_date: string;
  end_date: string | null;
  quantity: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'partially_filled' | 'filled' | 'cancelled';
  notes: string | null;
  deleted_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // joined fields
  area_name?: string;
  contract_name?: string;
  client_name?: string;
  assignments_count?: number;
}

export interface CreateResourceRequestDTO {
  contract_id: string;
  role_title: string;
  area_id: number;
  level: string;
  country?: string;
  language_requirements?: Record<string, unknown>[];
  required_skills?: number[];
  nice_to_have_skills?: number[];
  weekly_hours?: number;
  start_date: string;
  end_date?: string;
  quantity?: number;
  priority?: string;
  notes?: string;
}

export interface UpdateResourceRequestDTO extends Partial<CreateResourceRequestDTO> {
  status?: string;
}

export interface ResourceRequestFilters {
  search?: string;
  contract_id?: string;
  area_id?: string;
  level?: string;
  status?: string;
  priority?: string;
}

export interface Candidate {
  employee_id: string;
  first_name: string;
  last_name: string;
  area_id: number;
  area_name: string;
  level: string;
  country: string;
  weekly_capacity_hours: number;
  current_allocated_hours: number;
  available_hours: number;
  score: number;
  score_breakdown: {
    area_match: number;
    level_match: number;
    skills_match: number;
    availability: number;
  };
  matching_skills: number[];
  status: string;
}

export const VALID_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'L11'] as const;
export const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const VALID_STATUSES = ['open', 'partially_filled', 'filled', 'cancelled'] as const;

export const EDITABLE_FIELDS = [
  'role_title', 'area_id', 'level', 'country', 'language_requirements',
  'required_skills', 'nice_to_have_skills', 'weekly_hours',
  'start_date', 'end_date', 'quantity', 'priority', 'status', 'notes',
] as const;

export const SORTABLE: Record<string, string> = {
  role_title:  'rr.role_title',
  level:       'rr.level',
  priority:    'rr.priority',
  status:      'rr.status',
  start_date:  'rr.start_date',
  end_date:    'rr.end_date',
  quantity:    'rr.quantity',
  created_at:  'rr.created_at',
  updated_at:  'rr.updated_at',
};
