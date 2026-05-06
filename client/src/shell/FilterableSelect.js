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
