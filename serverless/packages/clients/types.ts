export interface Client {
  id: string;
  name: string;
  legal_name: string | null;
  country: string | null;
  industry: string | null;
  tier: 'enterprise' | 'mid_market' | 'smb' | null;
  preferred_currency: string;
  notes: string | null;
  tags: string | null;
  external_crm_id: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  last_activity_at: string | null;
  opportunities_count?: number;
  active_contracts_count?: number;
}

export interface CreateClientDTO {
  name: string;
  legal_name?: string;
  country?: string;
  industry?: string;
  tier?: string;
  preferred_currency?: string;
  notes?: string;
  tags?: string;
  external_crm_id?: string;
}

export interface UpdateClientDTO extends Partial<CreateClientDTO> {}

export interface ClientFilters {
  search?: string;
  country?: string;
  industry?: string;
  tier?: string;
  active?: string;
}

export const VALID_TIERS = ['enterprise', 'mid_market', 'smb'] as const;

export const EDITABLE_FIELDS = [
  'name', 'legal_name', 'country', 'industry', 'tier',
  'preferred_currency', 'notes', 'tags', 'external_crm_id',
] as const;

export const SORTABLE: Record<string, string> = {
  name:                   'c.name',
  legal_name:             'c.legal_name',
  country:                'c.country',
  industry:               'c.industry',
  tier:                   'c.tier',
  active:                 'c.active',
  preferred_currency:     'c.preferred_currency',
  created_at:             'c.created_at',
  updated_at:             'c.updated_at',
  opportunities_count:    '(SELECT COUNT(*)::int FROM opportunities o WHERE o.client_id=c.id AND o.deleted_at IS NULL)',
  active_contracts_count: "(SELECT COUNT(*)::int FROM contracts ct WHERE ct.client_id=c.id AND ct.status='active' AND ct.deleted_at IS NULL)",
};
