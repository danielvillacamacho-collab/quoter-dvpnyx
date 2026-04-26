import React, { useEffect, useState } from 'react';

/*
 * AutosaveIndicator — badge minimalista para el header de los editores.
 *
 * Estados:
 *   - idle        gris claro · "Auto-guardado activo"
 *   - saving      amarillo   · "Guardando…"
 *   - saved       verde      · "Guardado hace Xs ✓" (cuenta el tiempo en vivo)
 *   - error       naranja    · "Error al guardar — reintenta editando"
 *   - disabled    nada — el hook tiene flag off, no se renderiza
 *
 * Mantenemos el componente pequeño y sin dependencias externas para que
 * encaje en el estilo inline del resto del editor.
 */

function fmtRelative(date) {
  if (!date) return '';
  const sec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (sec < 5) return 'ahora';
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min}m`;
  const hr = Math.floor(min / 60);
  return `hace ${hr}h`;
}

export default function AutosaveIndicator({ enabled, status, lastSavedAt }) {
  // Tick para refrescar el "hace Xs" mientras estamos en estado saved.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'saved') return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  if (!enabled) return null;

  const map = {
    idle: { color: '#666', bg: 'transparent', text: '☁ Auto-guardado activo' },
    saving: { color: '#b06b00', bg: '#fff7e6', text: '⏳ Guardando…' },
    saved: { color: '#1f7a3a', bg: '#e8f5ec', text: `✓ Guardado ${fmtRelative(lastSavedAt)}` },
    error: { color: '#b00020', bg: '#fde8eb', text: '⚠ Error al guardar — reintenta editando' },
  };
  const cfg = map[status] || map.idle;

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="autosave-indicator"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        borderRadius: 12,
        background: cfg.bg,
        color: cfg.color,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {cfg.text}
    </span>
  );
}
