/* ------------------------------------------------------------------ */
/* Internal Ops — initiatives, novelties, holidays                     */
/* ------------------------------------------------------------------ */

export type InitiativeStatus = 'active' | 'completed' | 'cancelled' | 'paused';

export interface Initiative {
  id: string;
  initiative_code: string;
  name: string;
  description: string | null;
  business_area_id: string;
  status: InitiativeStatus;
  budget_usd: number;
  hours_estimated: number;
  start_date: string;
  target_end_date: string | null;
  actual_end_date: string | null;
  operations_owner_id: string;
  source_system: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deletion_reason: string | null;
  /* computed */
  business_area_label?: string;
  operations_owner_name?: string;
  assignments_count?: number;
  hours_consumed?: number;
  consumed_usd?: number;
}

export interface CreateInitiativeDTO {
  name: string;
  description?: string;
  business_area_id: string;
  budget_usd: number;
  hours_estimated?: number;
  start_date: string;
  target_end_date?: string;
  operations_owner_id: string;
}

export interface UpdateInitiativeDTO {
  name?: string;
  description?: string;
  business_area_id?: string;
  budget_usd?: number;
  hours_estimated?: number;
  start_date?: string;
  target_end_date?: string;
  operations_owner_id?: string;
}

export interface InitiativeFilters {
  search?: string;
  status?: string;
  business_area?: string;
  operations_owner_id?: string;
}

export const INITIATIVE_EDITABLE_FIELDS = [
  'name', 'description', 'business_area_id',
  'budget_usd', 'hours_estimated',
  'start_date', 'target_end_date',
  'operations_owner_id',
] as const;

export const INITIATIVE_TRANSITIONS: Record<InitiativeStatus, Set<InitiativeStatus>> = {
  active: new Set(['paused', 'completed', 'cancelled']),
  paused: new Set(['active', 'completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

/* ---- Novelties ---- */

export type NoveltyType =
  | 'vacation' | 'sick_leave' | 'parental_leave' | 'unpaid_leave'
  | 'bereavement' | 'legal_leave' | 'corporate_training' | 'unavailable_other';

export interface Novelty {
  id: string;
  employee_id: string;
  novelty_type_id: string | null;
  novelty_type: NoveltyType | null;
  start_date: string;
  end_date: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /* joined */
  employee_name?: string;
  novelty_type_label?: string;
}

export interface CreateNoveltyDTO {
  employee_id: string;
  novelty_type_id?: string;
  start_date: string;
  end_date: string;
  notes?: string;
}

export interface NoveltyFilters {
  employee_id?: string;
  status?: string;
  from?: string;
  to?: string;
}

/* ---- Holidays ---- */

export type HolidayType = 'national' | 'regional' | 'optional' | 'company';

export interface Holiday {
  id: string;
  country_id: string;
  holiday_date: string;
  label: string;
  holiday_type: HolidayType;
  year: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  country_label?: string;
}

export interface CreateHolidayDTO {
  country_id: string;
  holiday_date: string;
  label: string;
  holiday_type?: HolidayType;
  notes?: string;
}

export interface UpdateHolidayDTO {
  label?: string;
  holiday_type?: HolidayType;
  holiday_date?: string;
  notes?: string;
}

export interface HolidayFilters {
  country?: string;
  year?: string;
  from?: string;
  to?: string;
}

export const VALID_HOLIDAY_TYPES: HolidayType[] = ['national', 'regional', 'optional', 'company'];
