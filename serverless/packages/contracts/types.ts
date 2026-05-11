export interface Contract {
  id: string;
  name: string;
  client_id: string;
  opportunity_id: string | null;
  winning_quotation_id: string | null;
  type: 'capacity' | 'project' | 'resell';
  contract_subtype: string | null;
  status: 'planned' | 'active' | 'paused' | 'completed' | 'cancelled';
  start_date: string;
  end_date: string | null;
  total_value_usd: number | null;
  original_currency: string | null;
  account_owner_id: string | null;
  delivery_manager_id: string | null;
  capacity_manager_id: string | null;
  squad_id: string;
  notes: string | null;
  tags: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /* joined fields */
  client_name?: string;
  open_requests_count?: number;
  active_assignments_count?: number;
}

export interface CreateContractDTO {
  name: string;
  client_id: string;
  opportunity_id?: string;
  winning_quotation_id?: string;
  type: string;
  contract_subtype?: string;
  start_date: string;
  end_date?: string;
  total_value_usd?: number;
  original_currency?: string;
  account_owner_id?: string;
  delivery_manager_id?: string;
  capacity_manager_id?: string;
  squad_id?: string;
  notes?: string;
  tags?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateContractDTO extends Partial<CreateContractDTO> {}

export interface ContractFilters {
  search?: string;
  client_id?: string;
  type?: string;
  subtype?: string;
  status?: string;
  squad_id?: string;
}

export const VALID_TYPES = ['capacity', 'project', 'resell'] as const;

export const VALID_SUBTYPES_BY_TYPE: Record<string, string[]> = {
  capacity: ['staff_augmentation', 'mission_driven_squad', 'managed_service', 'time_and_materials'],
  project: ['fixed_scope', 'hour_pool'],
  resell: ['aws', 'azure', 'gcp', 'other'],
};

export const ALL_SUBTYPES = new Set(
  Object.values(VALID_SUBTYPES_BY_TYPE).flat(),
);

export const CONTRACT_STATES = ['planned', 'active', 'paused', 'completed', 'cancelled'] as const;

export const TERMINAL_STATES = new Set(['completed', 'cancelled']);

export const TRANSITIONS: Record<string, Set<string>> = {
  planned:   new Set(['active', 'cancelled']),
  active:    new Set(['paused', 'completed', 'cancelled']),
  paused:    new Set(['active', 'completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

export const VALID_CURRENCIES = ['USD', 'COP', 'MXN', 'GTQ', 'EUR'] as const;

export const EDITABLE_FIELDS = [
  'name', 'type', 'contract_subtype', 'opportunity_id', 'winning_quotation_id',
  'start_date', 'end_date', 'account_owner_id', 'delivery_manager_id',
  'capacity_manager_id', 'squad_id', 'notes', 'tags', 'metadata',
] as const;

export const SORTABLE: Record<string, string> = {
  name:             'c.name',
  type:             'c.type',
  contract_subtype: 'c.contract_subtype',
  status:           'c.status',
  start_date:       'c.start_date',
  end_date:         'c.end_date',
  created_at:       'c.created_at',
  updated_at:       'c.updated_at',
  client_name:      'cl.name',
};

/**
 * Validate subtype coherence with contract type.
 * Returns { ok, value } on success, { ok, error, code } on failure.
 */
export function validateSubtype(
  type: string,
  subtype: string | null | undefined,
  opts: { required?: boolean } = {},
): { ok: true; value: string | null } | { ok: false; error: string; code: string } {
  const { required = true } = opts;
  const norm = subtype == null || subtype === '' ? null : String(subtype).trim();

  if (type === 'capacity' || type === 'project' || type === 'resell') {
    if (norm == null) {
      if (required) {
        return { ok: false, code: 'subtype_required', error: 'Debes seleccionar un subtipo para continuar' };
      }
      return { ok: true, value: null };
    }
    const valid = VALID_SUBTYPES_BY_TYPE[type];
    if (!valid || !valid.includes(norm)) {
      return {
        ok: false, code: 'subtype_invalid_for_type',
        error: `Subtipo "${norm}" no es válido para tipo "${type}". Opciones: ${(valid || []).join(', ')}.`,
      };
    }
    return { ok: true, value: norm };
  }

  if (norm != null && !ALL_SUBTYPES.has(norm)) {
    return { ok: false, code: 'subtype_unknown', error: `contract_subtype "${norm}" desconocido.` };
  }
  return { ok: true, value: norm };
}

/** Normalize legacy status aliases (draft -> planned, on_hold -> paused). */
export function normalizeStatus(s: string): string {
  if (s === 'draft') return 'planned';
  if (s === 'on_hold') return 'paused';
  return s;
}
