export const VALID_LEVELS = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'] as const;
export const VALID_STATUSES = ['active','on_leave','bench','terminated'] as const;
export const VALID_EMPLOYMENT_TYPES = ['fulltime','parttime','contractor'] as const;

export const EMPLOYEE_SORTABLE: Record<string, string> = {
  first_name: 'e.first_name', last_name: 'e.last_name',
  level: 'e.level', country: 'e.country', status: 'e.status',
  employment_type: 'e.employment_type', start_date: 'e.start_date',
  created_at: 'e.created_at', area_name: 'a.name',
  weekly_capacity_hours: 'e.weekly_capacity_hours',
};

export const EMPLOYEE_EDITABLE_FIELDS = [
  'first_name', 'last_name', 'personal_email', 'corporate_email',
  'country', 'city', 'area_id', 'level', 'seniority_label',
  'employment_type', 'weekly_capacity_hours', 'languages',
  'start_date', 'end_date', 'status', 'squad_id', 'manager_user_id',
  'notes', 'tags', 'user_id', 'bio', 'linkedin_url', 'github_url', 'portfolio_url',
] as const;

export interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  personal_email: string | null;
  corporate_email: string | null;
  country: string | null;
  city: string | null;
  area_id: string | null;
  level: string | null;
  seniority_label: string | null;
  status: string;
  employment_type: string;
  weekly_capacity_hours: number;
  start_date: string | null;
  end_date: string | null;
  user_id: string | null;
  manager_user_id: string | null;
  bio: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  languages: unknown | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Area {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sort_order: number;
  active: boolean;
}

export interface Skill {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  active: boolean;
}
