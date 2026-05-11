// ── Contacts ────────────────────────────────────────────────────────
export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  client_id: string;
  job_title: string | null;
  email_primary: string | null;
  phone_mobile: string | null;
  seniority: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  client_name?: string;
}

export interface CreateContactDTO {
  first_name: string;
  last_name: string;
  client_id: string;
  job_title?: string;
  email_primary?: string;
  phone_mobile?: string;
  seniority?: string;
  notes?: string;
}

export interface OpportunityLink {
  opportunity_id: string;
  contact_id: string;
  deal_role: string;
  notes?: string;
}

export const VALID_SENIORITIES = [
  'c_level', 'vp', 'director', 'manager', 'senior', 'mid', 'junior', 'intern',
] as const;

export const VALID_DEAL_ROLES = [
  'economic_buyer', 'champion', 'coach', 'decision_maker', 'influencer',
  'technical_evaluator', 'procurement', 'legal', 'detractor', 'blocker',
] as const;

export const CONTACT_EDITABLE_FIELDS = [
  'first_name', 'last_name', 'job_title', 'email_primary',
  'phone_mobile', 'seniority', 'notes', 'client_id',
] as const;

export const CONTACT_SORTABLE: Record<string, string> = {
  first_name: 'co.first_name', last_name: 'co.last_name',
  email_primary: 'co.email_primary', job_title: 'co.job_title',
  seniority: 'co.seniority', created_at: 'co.created_at',
  client_name: '(SELECT cl.name FROM clients cl WHERE cl.id=co.client_id)',
};

// ── Activities ──────────────────────────────────────────────────────
export interface Activity {
  id: string;
  opportunity_id: string | null;
  client_id: string | null;
  contact_id: string | null;
  user_id: string;
  activity_type: string;
  subject: string;
  notes: string | null;
  activity_date: string;
  created_at: string;
  deleted_at: string | null;
}

export interface CreateActivityDTO {
  opportunity_id?: string;
  client_id?: string;
  contact_id?: string;
  activity_type: string;
  subject: string;
  notes?: string;
  activity_date?: string;
}

export const VALID_ACTIVITY_TYPES = [
  'call', 'email', 'meeting', 'note',
  'proposal_sent', 'demo', 'follow_up', 'other',
] as const;

export const ACTIVITY_SORTABLE: Record<string, string> = {
  activity_date: 'a.activity_date', subject: 'a.subject',
  activity_type: 'a.activity_type', created_at: 'a.created_at',
  user_name: '(SELECT name FROM users WHERE id = a.user_id)',
};
