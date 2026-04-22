/**
 * Preferencias — self-service UI settings (Phase 10 UI refresh).
 *
 * Three controls that write to `users.preferences` (JSONB column):
 *   - scheme    'light' | 'dark'           — flips `data-scheme` on :root
 *   - accentHue 0-360                      — redefines `--accent-hue`
 *   - density   0.9 | 1.0 | 1.1            — scales `--ds-row-h`
 *
 * Writes are optimistic: the theme applies instantly to :root, then the
 * change flies to the server. On failure we roll back (handled by
 * AuthContext.updatePreferences). No global reload.
 */
import React, { useState } from 'react';
import { useAuth } from '../AuthContext';

const s = {
  page:  { maxWidth: 720, margin: '0 auto', padding: '20px 24px 40px', fontFamily: 'var(--font-ui, inherit)' },
  h1:    { margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ds-text)' },
  sub:   { margin: '4px 0 20px', fontSize: 13, color: 'var(--ds-text-dim)' },

  card:  { background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius-lg, 10px)', padding: '18px 20px', marginBottom: 16 },
  label: { fontSize: 11, fontWeight: 500, color: 'var(--ds-text-dim)', textTransform: 'uppercase', letterSpacing: 0.04, marginBottom: 10, display: 'block' },

  segGroup: { display: 'inline-flex', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', overflow: 'hidden', background: 'var(--ds-surface)' },
  segBtn: (active) => ({
    padding: '6px 14px', fontSize: 12.5, cursor: 'pointer',
    border: 'none',
    background: active ? 'var(--ds-accent-soft)' : 'var(--ds-surface)',
    color:      active ? 'var(--ds-accent-text)' : 'var(--ds-text-muted)',
    fontWeight: active ? 600 : 500,
    fontFamily: 'var(--font-ui, inherit)',
  }),

  hueRow: { display: 'flex', alignItems: 'center', gap: 12 },
  hueInput: { flex: 1, accentColor: 'var(--ds-accent)' },
  hueValue: { fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)', fontFeatureSettings: "'tnum'", fontSize: 12.5, color: 'var(--ds-text)', minWidth: 42, textAlign: 'right' },
  hueSwatch: { width: 28, height: 28, borderRadius: '50%', background: 'var(--ds-accent)', border: '1px solid var(--ds-border)', flexShrink: 0 },

  status: (kind) => ({
    marginTop: 10, fontSize: 12,
    color: kind === 'error' ? 'var(--ds-bad)' : 'var(--ds-text-dim)',
  }),
  preview: {
    marginTop: 8,
    padding: 12,
    borderRadius: 'var(--ds-radius, 6px)',
    background: 'var(--ds-bg-soft)',
    border: '1px solid var(--ds-border)',
    fontSize: 12,
    color: 'var(--ds-text-muted)',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  chip: { display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 10, background: 'var(--ds-accent-soft)', color: 'var(--ds-accent-text)', fontSize: 11, fontWeight: 600 },
};

const HUE_PRESETS = [
  { label: 'Violeta', value: 270 },
  { label: 'Azul',    value: 230 },
  { label: 'Teal',    value: 180 },
  { label: 'Verde',   value: 140 },
  { label: 'Naranja', value: 40  },
  { label: 'Rojo',    value: 15  },
];

export default function Preferencias() {
  const { user, updatePreferences } = useAuth();
  const prefs = user?.preferences || {};
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  const scheme = prefs.scheme === 'dark' ? 'dark' : 'light';
  const hue    = Number.isFinite(prefs.accentHue) ? prefs.accentHue : 270;
  const density = Number.isFinite(prefs.density) ? prefs.density : 1;

  const save = async (patch) => {
    setSaving(true); setErr(''); setSaved(false);
    try {
      await updatePreferences(patch);
      setSaved(true);
      // Fade the "Guardado" hint — not a hard timeout, just a UX nicety.
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setErr(e.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Preferencias</h1>
      <p style={s.sub}>Personaliza el tema y la densidad del cotizador. Los cambios se aplican al instante.</p>

      {/* Scheme */}
      <section style={s.card} aria-labelledby="pref-scheme">
        <label id="pref-scheme" style={s.label}>Tema</label>
        <div style={s.segGroup} role="group" aria-label="Tema">
          {[
            { v: 'light', label: 'Claro' },
            { v: 'dark',  label: 'Oscuro' },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              style={s.segBtn(scheme === o.v)}
              onClick={() => save({ scheme: o.v })}
              aria-pressed={scheme === o.v}
              disabled={saving}
              data-testid={`pref-scheme-${o.v}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {/* Accent hue */}
      <section style={s.card} aria-labelledby="pref-hue">
        <label id="pref-hue" style={s.label}>Color de acento</label>
        <div style={s.hueRow}>
          <span style={s.hueSwatch} aria-hidden />
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={hue}
            onChange={(e) => save({ accentHue: Number(e.target.value) })}
            style={s.hueInput}
            aria-label="Color de acento (0-360)"
            disabled={saving}
            data-testid="pref-hue-slider"
          />
          <span style={s.hueValue}>{hue}°</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {HUE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              style={s.segBtn(hue === p.value)}
              onClick={() => save({ accentHue: p.value })}
              disabled={saving}
              data-testid={`pref-hue-${p.value}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* Density */}
      <section style={s.card} aria-labelledby="pref-density">
        <label id="pref-density" style={s.label}>Densidad</label>
        <div style={s.segGroup} role="group" aria-label="Densidad">
          {[
            { v: 0.9, label: 'Compacta' },
            { v: 1.0, label: 'Normal'   },
            { v: 1.1, label: 'Relajada' },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              style={s.segBtn(Math.abs(density - o.v) < 0.01)}
              onClick={() => save({ density: o.v })}
              aria-pressed={Math.abs(density - o.v) < 0.01}
              disabled={saving}
              data-testid={`pref-density-${o.v}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div style={s.preview} aria-live="polite">
          <span style={s.chip}>Ejemplo</span>
          <span>Esta tarjeta respeta la densidad y el acento actual.</span>
        </div>
      </section>

      {saved && <div style={s.status('ok')} role="status">✓ Guardado</div>}
      {err   && <div style={s.status('error')} role="alert">{err}</div>}
    </div>
  );
}
