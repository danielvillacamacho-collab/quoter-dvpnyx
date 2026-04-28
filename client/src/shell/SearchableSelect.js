import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * SearchableSelect — combobox que reemplaza a `<select>` cuando hay
 * muchas opciones (>20). El usuario tipea y filtra coincidencias por
 * substring; navega con ↑/↓; confirma con Enter; cierra con Esc.
 *
 * Mantiene `aria-label` en el `<input>` para que los tests con
 * `getByLabelText` sigan funcionando 1:1, y expone `data-testid` para
 * casos donde se prefiera selector estable.
 *
 * Props:
 *   - value:       id seleccionado (string | '' | null)
 *   - onChange:    (id) => void   (recibe '' al limpiar)
 *   - options:     [{ id, label, hint?, searchText? }]
 *                  • label   — línea principal visible
 *                  • hint    — línea secundaria (chica, gris)
 *                  • searchText — texto contra el que se filtra (opcional;
 *                    si no, se busca contra `${label} ${hint}`).
 *   - placeholder, disabled, required, name, id, aria-label, inputStyle
 *
 * No usa portal: el popover se posiciona con `absolute` debajo del input
 * (limitado a 240px de alto + scroll) — funciona dentro de modales.
 */
const norm = (s) => String(s || '').toLowerCase();

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '— Selecciona —',
  disabled = false,
  required = false,
  inputStyle,
  id,
  name,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}) {
  const reactId = useId();
  const inputId = id || `searchable-${reactId}`;
  const listId = `${inputId}-list`;

  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(-1);

  const selected = useMemo(
    () => options.find((o) => o.id === value) || null,
    [options, value],
  );

  // Cuando está abierto mostramos lo que el usuario tipea; cuando está
  // cerrado mostramos la etiqueta de la opción seleccionada.
  const displayValue = open ? query : (selected?.label || '');

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = norm(query);
    return options.filter((o) => norm(o.searchText || `${o.label} ${o.hint || ''}`).includes(q));
  }, [query, options]);

  // Reset highlight a la primera coincidencia cuando cambia el filtro.
  useEffect(() => {
    if (open) setHighlight(filtered.length ? 0 : -1);
  }, [query, open, filtered.length]);

  // Cerrar al click afuera.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (ev) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const commit = (newId) => {
    onChange(newId);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[highlight];
      if (pick) commit(pick.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      // Tab se comporta como cierre sin selección — natural para forms.
      setOpen(false);
      setQuery('');
    }
  };

  const onClear = (e) => {
    e.stopPropagation();
    e.preventDefault();
    onChange('');
    setQuery('');
    setOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        data-testid={dataTestId}
        placeholder={placeholder}
        disabled={disabled}
        // Truco para HTML5 required: marcamos el input como "vacío" cuando
        // no hay selección, así el browser bloquea el submit como con select.
        required={required && !value}
        value={displayValue}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onClick={() => { if (!disabled) setOpen(true); }}
        onKeyDown={onKeyDown}
        style={{
          width: '100%',
          padding: '8px 32px 8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 14,
          outline: 'none',
          background: '#fff',
          ...(inputStyle || {}),
        }}
      />
      {selected && !disabled && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Limpiar ${ariaLabel || 'selección'}`}
          tabIndex={-1}
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', color: 'var(--text-light)',
            fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '2px 6px',
          }}
        >×</button>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            zIndex: 50,
            margin: '4px 0 0',
            padding: 0, listStyle: 'none',
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-light)' }}>
              Sin coincidencias
            </li>
          )}
          {filtered.map((o, i) => {
            const isSel = o.id === value;
            const isHi = i === highlight;
            return (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSel}
                // mousedown (no click) para que el blur del input no cierre
                // el popover antes de que se procese la selección.
                onMouseDown={(e) => { e.preventDefault(); commit(o.id); }}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  background: isHi ? 'var(--purple-light, #f3eef7)' : 'transparent',
                  fontWeight: isSel ? 600 : 400,
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <div>{o.label}</div>
                {o.hint && (
                  <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{o.hint}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
