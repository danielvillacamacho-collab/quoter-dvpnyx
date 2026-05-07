import React from 'react';
import SearchableSelect from './SearchableSelect';

/**
 * FilterableSelect — wrapper sobre SearchableSelect que mantiene la
 * misma API que un `<select>` nativo:
 *
 *   value       string       ID seleccionado ('' = nada)
 *   onChange     (event) =>   recibe { target: { value, name } }
 *   options      [{id, label, hint?, searchText?}]
 *   placeholder  string       texto cuando no hay selección
 *   clearable    boolean      si true (típico en filtros), agrega una fila
 *                             "Mostrar todos" en el dropdown que limpia la
 *                             selección. Default false.
 *   clearLabel   string       override del label de la fila de limpiar
 *                             (default: usa el placeholder).
 *   ...rest      se pasan directo a SearchableSelect
 *
 * Así los handlers existentes (`e.target.value`) siguen funcionando
 * sin modificación.
 */
export default function FilterableSelect({
  value,
  onChange,
  options,
  placeholder = '— Selecciona —',
  name,
  ...rest
}) {
  const handleChange = (id) => {
    if (onChange) onChange({ target: { value: id, name: name || '' } });
  };

  return (
    <SearchableSelect
      value={value || ''}
      onChange={handleChange}
      options={options}
      placeholder={placeholder}
      name={name}
      {...rest}
    />
  );
}
