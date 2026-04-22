/**
 * Avatar — initials-in-circle with deterministic hue-from-name.
 *
 * Before this, the single avatar in Sidebar (`.ds-sb-avatar`) rendered
 * every user with the same accent-hue background, so visually every
 * session looked identical. List modules that wanted an avatar had
 * to reinvent the circle + initials + color pairing.
 *
 * `hueFromName(name)` hashes the display name into 0–359 so each user
 * keeps the SAME tint across reloads and modules. The soft/text colors
 * come from OKLCH chroma values tuned to match the DS palette density,
 * so avatars sit comfortably next to `.ds-badge` pills.
 */
import React from 'react';

/** Deterministic 0-359 hue from a person's name. Stable across reloads. */
export function hueFromName(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** First char of first two words, uppercased. "DV" fallback. */
export function initialsFor(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Avatar({ name, size = 28, title, className = '', style = {} }) {
  const hue = hueFromName(name);
  const initials = initialsFor(name);
  const s = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: '50%',
    fontSize: Math.max(10, Math.round(size * 0.42)),
    fontWeight: 600,
    fontFamily: 'var(--font-ui, inherit)',
    letterSpacing: 0.02,
    flexShrink: 0,
    // OKLCH values chosen to match the softness of `.ds-badge.accent`
    // across the whole hue wheel without going neon.
    background: `oklch(0.92 0.06 ${hue})`,
    color:      `oklch(0.38 0.12 ${hue})`,
    ...style,
  };
  return (
    <span
      className={className}
      style={s}
      title={title || name}
      aria-label={name ? `Avatar ${name}` : 'Avatar'}
      data-hue={hue}
    >
      {initials}
    </span>
  );
}
