/**
 * Shared visual metadata for assignment validation checks. Both the
 * reactive <AssignmentValidationModal /> (shown on 409) and the
 * proactive <AssignmentValidationInline /> (shown live in the form)
 * consume these constants so the look-and-feel stays consistent.
 */

export const STATUS_META = {
  pass: { label: 'OK',          icon: '✓', color: 'var(--success, #1b9e4a)' },
  warn: { label: 'Advertencia', icon: '!', color: '#c77700' },
  fail: { label: 'Falla',       icon: '✕', color: 'var(--danger, #c0392b)' },
  info: { label: 'Info',        icon: 'i', color: 'var(--teal-mid, #2a8fa0)' },
};

export const CHECK_LABEL = {
  area_match:    'Área',
  level_match:   'Nivel',
  capacity:      'Capacidad semanal',
  date_conflict: 'Fechas',
};

/** Shorthand order so we always render the four checks in a stable order. */
export const CHECK_ORDER = ['area_match', 'level_match', 'capacity', 'date_conflict'];
