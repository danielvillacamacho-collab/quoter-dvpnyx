/**
 * Shared table styling tokens for list modules.
 *
 * Modules still spread these into inline `style={...}` props on each
 * <th>/<td> (so per-cell overrides like `{ ...td, textAlign: 'center' }`
 * keep working), but the VALUES now come from the DVPNYX design handoff
 * tokens instead of the legacy purple-dark/teal palette. Every module
 * imports from this file so a future token bump updates 10 places at once.
 *
 * CSS-only concerns (hover, sticky header, scrollbar) live in theme.css
 * under `.ds-table`. Apply the class on the <table> element to get them.
 */

const BORDER = '1px solid var(--ds-border)';

/** Header cell — soft bg, uppercase micro label, hair-thin border. */
export const th = {
  padding: '7px 12px',
  fontSize: 11.5,
  fontWeight: 500,
  color: 'var(--ds-text-dim)',
  background: 'var(--ds-bg-soft)',
  borderBottom: BORDER,
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: 0.04,
  whiteSpace: 'nowrap',
  fontFamily: 'var(--font-ui)',
};

/** Body cell — medium-dense row, hair-thin bottom border. */
export const td = {
  padding: '8px 12px',
  fontSize: 12.5,
  borderBottom: BORDER,
  color: 'var(--ds-text)',
  verticalAlign: 'middle',
  fontFamily: 'var(--font-ui)',
};

/** Compact variant for data-dense editors (quotation tables, etc.). */
export const thSm = { ...th, padding: '6px 8px', fontSize: 10.5 };
export const tdSm = { ...td, padding: '6px 8px', fontSize: 11.5 };

/** Convenience — class to attach to every DS-styled <table>. */
export const TABLE_CLASS = 'ds-table';
