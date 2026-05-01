import React from 'react';

/**
 * <th> con click-to-sort + flecha indicadora.
 *
 * Uso:
 *   <SortableTh sort={sort} field="name" style={s.th}>Nombre</SortableTh>
 *
 *   sort: el resultado de useSort() — debe tener `field`, `dir`, `setSort(fieldName)`.
 *   field: el nombre del campo (mismo que el server espera en ?sort=).
 *
 * Si `field` es undefined o null → renderiza un <th> normal sin click.
 */
export default function SortableTh({ sort, field, children, style, ariaLabel, ...rest }) {
  if (!sort || !field) {
    return <th style={style} {...rest}>{children}</th>;
  }
  const active = sort.field === field;
  const arrow = !active ? '⇅' : (sort.dir === 'asc' ? '▲' : '▼');
  const opacity = active ? 1 : 0.45;

  return (
    <th
      role="button"
      tabIndex={0}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      aria-label={ariaLabel || `Ordenar por ${typeof children === 'string' ? children : field}`}
      onClick={() => sort.setSort(field)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort.setSort(field); } }}
      style={{
        ...style,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: (style && style.whiteSpace) || 'nowrap',
      }}
      {...rest}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {children}
        <span aria-hidden="true" style={{ opacity, fontSize: 10, lineHeight: 1 }}>{arrow}</span>
      </span>
    </th>
  );
}
