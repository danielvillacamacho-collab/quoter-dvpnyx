/**
 * NumberInput — input numérico con separadores de miles automáticos.
 *
 * Mientras el campo está enfocado muestra el número raw para editar.
 * Al perder foco, formatea con separadores de miles (ej. 546,135,545).
 *
 * Props:
 *   value      — string o number (el valor sin formatear)
 *   onChange   — fn(e) donde e.target.value es el string numérico limpio
 *   onBlur     — (opcional) se llama después de formatear
 *   locale     — (opcional) locale para formato, default 'en-US'
 *   decimals   — (opcional) si true permite decimales, default true
 *   ...rest    — se pasan al <input> (style, disabled, min, max, placeholder, etc.)
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';

// Strip everything except digits, minus, and decimal point.
function stripFormat(s) {
  if (s == null) return '';
  return String(s).replace(/[^0-9.\-]/g, '');
}

function formatNumber(val, locale) {
  if (val == null || val === '') return '';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  // Preserve the exact decimal digits the user typed.
  const str = String(val);
  const dotIdx = str.indexOf('.');
  const decimals = dotIdx >= 0 ? str.length - dotIdx - 1 : 0;
  return new Intl.NumberFormat(locale || 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: Math.max(decimals, 2),
  }).format(num);
}

export default function NumberInput({
  value,
  onChange,
  onBlur,
  locale,
  decimals = true,
  ...rest
}) {
  const [focused, setFocused] = useState(false);
  const [display, setDisplay] = useState('');
  const inputRef = useRef(null);

  // Sync external value → display.
  useEffect(() => {
    if (!focused) {
      setDisplay(formatNumber(value, locale));
    }
  }, [value, locale, focused]);

  const handleFocus = useCallback((e) => {
    setFocused(true);
    // Show raw value for editing.
    const raw = value != null && value !== '' ? String(value) : '';
    setDisplay(raw);
    // Select all on focus for easy replacement.
    setTimeout(() => { if (inputRef.current) inputRef.current.select(); }, 0);
  }, [value]);

  const handleChange = useCallback((e) => {
    let raw = e.target.value;
    // Allow typing formatted chars (commas) — strip on the fly.
    raw = stripFormat(raw);
    // If decimals are off, strip the dot too.
    if (!decimals) raw = raw.replace(/\./g, '');
    setDisplay(raw);
    // Propagate a synthetic-ish event with clean value.
    if (onChange) {
      const synth = { ...e, target: { ...e.target, value: raw, name: e.target.name } };
      onChange(synth);
    }
  }, [onChange, decimals]);

  const handleBlur = useCallback((e) => {
    setFocused(false);
    const raw = stripFormat(display);
    setDisplay(formatNumber(raw, locale));
    if (onBlur) {
      const synth = { ...e, target: { ...e.target, value: raw, name: e.target.name } };
      onBlur(synth);
    }
  }, [display, locale, onBlur]);

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={focused ? display : formatNumber(value, locale)}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
