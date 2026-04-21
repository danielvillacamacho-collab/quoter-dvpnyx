/**
 * StatusBadge — shared pill for status columns across the app.
 *
 * Before this component every list module (Employees, Contracts,
 * Opportunities, ResourceRequests, Assignments, Quotations, …) shipped
 * its own inline `<span style={{ background: ..., color: ..., padding,
 * borderRadius }}>` with hardcoded colors. That made the visual
 * language inconsistent (one module used `--orange`, another a
 * custom hex, a third `--teal-mid`) and skipped the DS soft-token
 * palette entirely.
 *
 * This component maps a (domain, status) pair to one of the four
 * semantic tones defined in `.ds-badge` CSS: `ok`, `warn`, `bad`,
 * `accent`, or the neutral default. The mapping table is colocated
 * here so every module reads the same contract; new domains add a
 * section instead of reinventing the palette.
 *
 * Usage:
 *   <StatusBadge domain="contract" value={row.status} />
 *   <StatusBadge domain="quotation" value={q.status} label="Borrador" />
 */
import React from 'react';

/** (domain, status) → CSS modifier class for `.ds-badge`.  */
const TONE_MAP = {
  contract: {
    planned:   'warn',
    active:    'ok',
    paused:    'warn',
    completed: 'accent',
    cancelled: 'bad',
    ended:     '',
  },
  assignment: {
    planned:   'warn',
    active:    'ok',
    ended:     '',
    cancelled: 'bad',
  },
  opportunity: {
    open:        'accent',
    qualified:   'accent',
    proposal:    'warn',
    negotiation: 'warn',
    won:         'ok',
    lost:        'bad',
    cancelled:   'bad',
  },
  resource_request: {
    open:             'warn',
    partially_filled: 'warn',
    filled:           'ok',
    cancelled:        'bad',
  },
  employee: {
    active:      'ok',
    on_leave:    'warn',
    bench:       'accent',
    terminated:  'bad',
  },
  quotation: {
    draft:    '',
    sent:     'warn',
    approved: 'ok',
    rejected: 'bad',
    expired:  '',
  },
};

/** Human labels — so modules don't each re-translate. Callers can still
 *  override with `label` for ad-hoc cases. */
const LABEL_MAP = {
  contract: {
    planned: 'Planificado', active: 'Activo', paused: 'Pausado',
    completed: 'Completado', cancelled: 'Cancelado', ended: 'Terminado',
  },
  assignment: {
    planned: 'Planificada', active: 'Activa',
    ended: 'Terminada', cancelled: 'Cancelada',
  },
  opportunity: {
    open: 'Abierta', qualified: 'Calificada', proposal: 'Propuesta',
    negotiation: 'Negociación', won: 'Ganada', lost: 'Perdida',
    cancelled: 'Cancelada',
  },
  resource_request: {
    open: 'Abierta', partially_filled: 'Parcial',
    filled: 'Cubierta', cancelled: 'Cancelada',
  },
  employee: {
    active: 'Activo', on_leave: 'Licencia',
    bench: 'Bench', terminated: 'Terminado',
  },
  quotation: {
    draft: 'Borrador', sent: 'Enviada', approved: 'Aprobada',
    rejected: 'Rechazada', expired: 'Expirada',
  },
};

export default function StatusBadge({ domain, value, label, className = '', ...rest }) {
  const tone  = TONE_MAP[domain]?.[value] ?? '';
  const text  = label ?? LABEL_MAP[domain]?.[value] ?? value ?? '—';
  const cls   = ['ds-badge', tone, className].filter(Boolean).join(' ');
  return <span className={cls} data-status={value} {...rest}>{text}</span>;
}
