import React, { useState } from 'react';

/**
 * AssignmentValidationModal — US-VAL-4
 *
 * Renders the 4-check validation checklist returned by the server when
 * POST /api/assignments responds with 409 ({ code, checks, summary,
 * requires_justification }). Two modes:
 *
 *   - `requires_justification: true`  → user can override by typing a
 *     reason (min 10 chars) and clicking "Crear con justificación".
 *     Parent receives the reason via onConfirm(reason).
 *   - `requires_justification: false` → non-overridable fail; only
 *     "Cerrar" is available. Parent closes the modal via onClose.
 *
 * Keeps the look-and-feel aligned with the rest of the shell: minimal,
 * Google/Uber-level clarity, no libraries. The checklist structure is
 * intentionally flat so an AI layer can later produce these same
 * payloads and the UI Just Works.
 */

const STATUS_META = {
  pass: { label: 'OK',          icon: '✓', color: 'var(--success, #1b9e4a)' },
  warn: { label: 'Advertencia', icon: '!', color: '#c77700' },
  fail: { label: 'Falla',       icon: '✕', color: 'var(--danger, #c0392b)' },
  info: { label: 'Info',        icon: 'i', color: 'var(--teal-mid, #2a8fa0)' },
};

const CHECK_LABEL = {
  area_match:    'Área',
  level_match:   'Nivel',
  capacity:      'Capacidad semanal',
  date_conflict: 'Fechas',
};

const s = {
  bg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  box: { background: '#fff', borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
  h: { margin: '0 0 4px', fontSize: 18, color: 'var(--purple-dark)', fontFamily: 'Montserrat' },
  sub: { margin: '0 0 16px', fontSize: 13, color: 'var(--text-light)' },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border, #eee)' },
  badge: (color) => ({ minWidth: 22, height: 22, borderRadius: 11, background: color, color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'Montserrat' }),
  checkName: { fontSize: 13, fontWeight: 600, color: 'var(--text)' },
  msg: { fontSize: 12, color: 'var(--text-light)', marginTop: 2, lineHeight: 1.4 },
  details: { fontSize: 11, color: 'var(--text-light)', marginTop: 4, fontFamily: 'monospace' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', margin: '12px 0 4px', display: 'block' },
  textarea: { width: '100%', padding: '10px 12px', border: '1px solid var(--border, #ddd)', borderRadius: 8, fontSize: 14, outline: 'none', minHeight: 80, resize: 'vertical', fontFamily: 'inherit' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  btn: (bg = 'var(--purple-dark)') => ({ background: bg, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  banner: (color) => ({ background: color, color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 12 }),
};

const MIN_REASON = 10;

function CheckRow({ check }) {
  const meta = STATUS_META[check.status] || STATUS_META.info;
  return (
    <div style={s.row} data-testid={`check-${check.check}`}>
      <span style={s.badge(meta.color)} aria-label={meta.label}>{meta.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={s.checkName}>
          {CHECK_LABEL[check.check] || check.check}
          {check.overridable === false && check.status === 'fail' && (
            <span style={{ fontSize: 10, color: 'var(--danger)', marginLeft: 8, fontWeight: 700 }}>· BLOQUEANTE</span>
          )}
        </div>
        <div style={s.msg}>{check.message}</div>
        {check.detail && Object.keys(check.detail).length > 0 && (
          <div style={s.details}>
            {Object.entries(check.detail).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AssignmentValidationModal({
  validation,          // { checks, summary, requires_justification, can_override, valid }
  advisories = [],     // [{ code, message }]
  onConfirm,           // (reason: string) => Promise<void>
  onClose,             // () => void
  saving = false,
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  if (!validation) return null;
  const { checks = [], summary = {}, can_override } = validation;
  const nonOverridable = summary.non_overridable_fails > 0;

  const bannerColor = nonOverridable ? 'var(--danger, #c0392b)' : '#c77700';
  const bannerText = nonOverridable
    ? 'Esta asignación no puede crearse: hay incompatibilidades bloqueantes.'
    : 'Esta asignación tiene incompatibilidades. Requiere justificación explícita para continuar.';

  const canSubmit = can_override && !nonOverridable && reason.trim().length >= MIN_REASON && !saving;

  const submit = async () => {
    setErr('');
    if (reason.trim().length < MIN_REASON) {
      setErr(`La justificación debe tener al menos ${MIN_REASON} caracteres.`);
      return;
    }
    try {
      await onConfirm(reason.trim());
    } catch (ex) {
      setErr(ex.message || 'Error al crear la asignación.');
    }
  };

  return (
    <div style={s.bg} role="dialog" aria-modal="true" aria-labelledby="val-modal-title">
      <div style={s.box}>
        <h2 id="val-modal-title" style={s.h}>Revisión de compatibilidad</h2>
        <p style={s.sub}>
          {summary.pass ?? 0} OK · {summary.warn ?? 0} advertencias · {summary.info ?? 0} info · {summary.fail ?? 0} fallas
        </p>

        <div style={s.banner(bannerColor)} role="alert">{bannerText}</div>

        <div>
          {checks.map((c) => <CheckRow key={c.check} check={c} />)}
        </div>

        {advisories.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={s.label}>Advertencias adicionales</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-light)' }}>
              {advisories.map((a) => <li key={a.code}>{a.message}</li>)}
            </ul>
          </div>
        )}

        {can_override && !nonOverridable && (
          <div>
            <label style={s.label} htmlFor="override-reason">Justificación (min. {MIN_REASON} caracteres) *</label>
            <textarea
              id="override-reason"
              style={s.textarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: Cliente estratégico aprobado por COO; cubriremos el gap con mentoría de un L6 durante 3 semanas."
              aria-label="Justificación de override"
            />
            <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>
              Esta justificación queda registrada en el evento <code>assignment.overridden</code> y es consultable en auditoría.
            </div>
          </div>
        )}

        {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }} role="alert">{err}</div>}

        <div style={s.actions}>
          <button type="button" style={s.btnOutline} onClick={onClose} disabled={saving}>Cerrar</button>
          {can_override && !nonOverridable && (
            <button type="button" style={s.btn()} onClick={submit} disabled={!canSubmit} aria-label="Crear con justificación">
              {saving ? 'Creando…' : 'Crear con justificación'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
