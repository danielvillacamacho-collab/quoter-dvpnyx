import React from 'react';
import { STATUS_META, CHECK_LABEL, CHECK_ORDER } from '../utils/validationMeta';

/**
 * AssignmentValidationInline — US-VAL-4 (proactive mode)
 *
 * Compact, read-only checklist that lives inside the assignment form.
 * It is fed by calls to `GET /api/assignments/validate` while the user
 * fills the form, so they see area/level/capacity/date feedback BEFORE
 * hitting Save.
 *
 * States the component knows how to render:
 *   - `loading` → shows a subtle "Validando…" banner.
 *   - `error`   → shows the message (falls back gracefully; the form is
 *     still submittable because the server validates again on POST).
 *   - `validation` → 4-row compact list with status dots + messages.
 *
 * Deliberately stateless: the parent form owns fetch timing + debounce.
 * This keeps the component testable in isolation.
 */

const s = {
  box: {
    border: '1px solid var(--border, #e5e5e5)',
    borderRadius: 8,
    padding: 10,
    background: 'var(--bg-soft, #fafafa)',
    fontSize: 12,
  },
  head: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { fontWeight: 600, fontSize: 12, color: 'var(--text, #222)' },
  sub: { fontSize: 11, color: 'var(--text-light, #666)' },
  row: {
    display: 'flex', gap: 8, alignItems: 'flex-start',
    padding: '4px 0', borderTop: '1px dashed var(--border, #eee)',
  },
  firstRow: {
    display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0',
  },
  dot: (color) => ({
    minWidth: 14, height: 14, borderRadius: 7, background: color,
    color: '#fff', fontSize: 9, fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  }),
  label: { fontWeight: 600, color: 'var(--text, #222)' },
  msg: { color: 'var(--text-light, #666)', marginLeft: 4 },
  summary: (color) => ({
    fontSize: 11, fontWeight: 600, color: '#fff',
    background: color, padding: '2px 8px', borderRadius: 10,
  }),
  empty: { fontSize: 11, color: 'var(--text-light, #888)', fontStyle: 'italic' },
};

function summaryColor(summary) {
  if ((summary.fail || 0) > 0) return 'var(--danger, #c0392b)';
  if ((summary.warn || 0) > 0) return '#c77700';
  return 'var(--success, #1b9e4a)';
}

function summaryText(summary) {
  const parts = [];
  if (summary.pass) parts.push(`${summary.pass} OK`);
  if (summary.warn) parts.push(`${summary.warn} warn`);
  if (summary.fail) parts.push(`${summary.fail} fail`);
  if (summary.info) parts.push(`${summary.info} info`);
  return parts.join(' · ') || '—';
}

export default function AssignmentValidationInline({
  validation,   // { checks, summary, valid, can_override }
  loading = false,
  error = null,
}) {
  if (loading) {
    return (
      <div style={s.box} data-testid="val-inline-loading">
        <div style={s.sub}>Validando compatibilidad…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={s.box} data-testid="val-inline-error">
        <div style={{ ...s.sub, color: 'var(--danger, #c0392b)' }}>
          No se pudo pre-validar: {error}. La validación final ocurrirá al guardar.
        </div>
      </div>
    );
  }

  if (!validation) {
    return (
      <div style={s.box} data-testid="val-inline-empty">
        <div style={s.empty}>
          Selecciona solicitud, empleado, horas y fecha de inicio para ver
          la revisión de compatibilidad.
        </div>
      </div>
    );
  }

  const { checks = [], summary = {} } = validation;
  // Render in canonical order; checks not returned by the API are skipped.
  const byCheck = Object.fromEntries(checks.map((c) => [c.check, c]));
  const ordered = CHECK_ORDER.map((k) => byCheck[k]).filter(Boolean);

  return (
    <div style={s.box} data-testid="val-inline">
      <div style={s.head}>
        <div style={s.title}>Revisión de compatibilidad</div>
        <div style={s.sub}>· pre-validación</div>
        <div style={{ flex: 1 }} />
        <div style={s.summary(summaryColor(summary))} aria-label="Resumen de validación">
          {summaryText(summary)}
        </div>
      </div>
      {ordered.map((c, i) => {
        const meta = STATUS_META[c.status] || STATUS_META.info;
        return (
          <div
            key={c.check}
            style={i === 0 ? s.firstRow : s.row}
            data-testid={`val-inline-check-${c.check}`}
          >
            <span style={s.dot(meta.color)} aria-label={meta.label}>{meta.icon}</span>
            <div style={{ flex: 1 }}>
              <span style={s.label}>{CHECK_LABEL[c.check] || c.check}:</span>
              <span style={s.msg}>{c.message}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
