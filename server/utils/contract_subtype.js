/**
 * Catálogo de subtipos de contrato + reglas de coherencia con el type.
 *
 * Ver `docs/specs/v2/03_data_model.md §6` y la spec original
 * `SPEC_subtipo-contrato.docx` (Abril 2026).
 *
 * Reglas:
 *   - type='capacity' → 4 subtipos válidos.
 *   - type='project'  → 2 subtipos válidos.
 *   - type='resell'   → siempre NULL.
 *   - Cuando type es capacity|project, subtype es OBLIGATORIO al crear/editar.
 *   - Excepción: contratos legacy con subtype=NULL pueden editarse (otros campos)
 *     sin forzar a poblar el subtype, salvo que el usuario cambie el type.
 *
 * Si agregas un subtipo, también agrégalo en client/src/utils/contract_subtype.js
 * (mismo catálogo en ambos lados — pequeño costo de duplicación a cambio de
 * cero llamadas al server desde el form).
 */

const SUBTYPES_BY_TYPE = {
  capacity: [
    { value: 'staff_augmentation',  label: 'Staff Augmentation' },
    { value: 'mission_driven_squad', label: 'Mission-driven squad' },
    { value: 'managed_service',      label: 'Servicio administrado / Soporte' },
    { value: 'time_and_materials',   label: 'Tiempo y Materiales' },
  ],
  project: [
    { value: 'fixed_scope', label: 'Alcance fijo / POC' },
    { value: 'hour_pool',   label: 'Bolsa de horas' },
  ],
  resell: [],
};

/** Set de valores válidos cross-type (para CHECK lookups y validación). */
const ALL_SUBTYPES = new Set(
  Object.values(SUBTYPES_BY_TYPE).flat().map((s) => s.value)
);

/** Set por type para validar coherencia. */
const VALID_BY_TYPE = Object.fromEntries(
  Object.entries(SUBTYPES_BY_TYPE).map(([t, list]) => [t, new Set(list.map((s) => s.value))])
);

/**
 * Valida coherencia subtype ↔ type para una mutation (POST/PUT).
 *
 * @param {string|null|undefined} type      - 'capacity' | 'project' | 'resell'
 * @param {string|null|undefined} subtype   - subtipo o nulo
 * @param {object} opts
 * @param {boolean} opts.required           - si subtype es obligatorio cuando type lo permite (default: true)
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string, code: string }}
 *
 * Reglas:
 *  - type='resell' + subtype=cualquiera (no-null) → error
 *  - type='capacity'|'project' + subtype=null + required=true → error
 *  - subtype no en VALID_BY_TYPE[type] → error
 *  - todo lo demás → ok con value normalizado (string trim o null)
 */
function validateContractSubtype(type, subtype, { required = true } = {}) {
  // Normalize empty string to null para que el caller no tenga que hacerlo.
  const norm = subtype == null || subtype === '' ? null : String(subtype).trim();

  if (type === 'resell') {
    if (norm != null) {
      return {
        ok: false, code: 'subtype_not_allowed_for_resell',
        error: 'Reventa no admite subtipo. Envía contract_subtype=null o no envíes el campo.',
      };
    }
    return { ok: true, value: null };
  }

  if (type === 'capacity' || type === 'project') {
    if (norm == null) {
      if (required) {
        return {
          ok: false, code: 'subtype_required',
          error: 'Debes seleccionar un subtipo para continuar',
        };
      }
      return { ok: true, value: null };
    }
    if (!VALID_BY_TYPE[type].has(norm)) {
      return {
        ok: false, code: 'subtype_invalid_for_type',
        error: `Subtipo "${norm}" no es válido para tipo "${type}". Opciones: ${[...VALID_BY_TYPE[type]].join(', ')}.`,
      };
    }
    return { ok: true, value: norm };
  }

  // type desconocido o ausente — el validador del type lo manejará.
  // Si llega un subtype igual lo aceptamos (será rechazado en otro check).
  if (norm != null && !ALL_SUBTYPES.has(norm)) {
    return {
      ok: false, code: 'subtype_unknown',
      error: `contract_subtype "${norm}" desconocido.`,
    };
  }
  return { ok: true, value: norm };
}

module.exports = {
  SUBTYPES_BY_TYPE,
  ALL_SUBTYPES,
  VALID_BY_TYPE,
  validateContractSubtype,
};
