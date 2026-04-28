/**
 * Catálogo de subtipos de contrato — espejo del que vive en
 * `server/utils/contract_subtype.js`.
 *
 * Duplicado a propósito: el formulario los necesita inmediatamente al cambiar
 * el dropdown de Tipo (sin round-trip al server) y son sólo 6 valores
 * estables. Si agregás uno nuevo, agregalo en AMBOS archivos.
 *
 * Spec original: `SPEC_subtipo-contrato.docx` (Abril 2026).
 */

export const SUBTYPES_BY_TYPE = {
  capacity: [
    { value: 'staff_augmentation',   label: 'Staff Augmentation' },
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

/** Map plano valor → etiqueta (para mostrar en list/detail). */
export const SUBTYPE_LABEL = Object.fromEntries(
  Object.values(SUBTYPES_BY_TYPE).flat().map((s) => [s.value, s.label])
);

/** Devuelve label visible o "—" / "Sin especificar" si vacío. */
export function formatSubtype(value, { fallback = 'Sin especificar' } = {}) {
  if (!value) return fallback;
  return SUBTYPE_LABEL[value] || value;
}

/** ¿El type elegido admite subtype? */
export function typeRequiresSubtype(type) {
  return type === 'capacity' || type === 'project';
}

/** Lista de opciones para el dropdown según el type actual. */
export function subtypesFor(type) {
  if (!type) return [];
  return SUBTYPES_BY_TYPE[type] || [];
}
