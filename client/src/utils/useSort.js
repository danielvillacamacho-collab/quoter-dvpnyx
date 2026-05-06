import { useState, useCallback, useMemo } from 'react';

/**
 * Hook compartido para sort de tablas paginadas (server-side).
 *
 * Uso:
 *
 *   const sort = useSort({ field: 'created_at', dir: 'desc' });
 *
 *   // En el load (loadCallback dependency array incluye sort.field/dir):
 *   const qs = new URLSearchParams();
 *   sort.applyToQs(qs);  // agrega ?sort= y ?dir= si hay sort activo
 *
 *   // En el header de la tabla:
 *   <SortableTh sort={sort} field="name">Nombre</SortableTh>
 *
 * Comportamiento click:
 *   1er click  → asc (o desc, según el `firstDir` del campo si se quiere customizar)
 *   2do click  → flip
 *   3er click  → reset al default (si lo hay) o asc
 *
 * Para sort 100% client-side (en tablas no paginadas), usá `sortRows(rows, key)`
 * de utils/sortRows.js — este hook es para llamadas al server.
 */
export function useSort({ field = null, dir = 'desc' } = {}) {
  const [state, setState] = useState({ field, dir });

  const setSort = useCallback((newField) => {
    setState((prev) => {
      if (prev.field !== newField) {
        // Cambia de columna → empezar en asc por default (excepto fechas que
        // suelen querer "más reciente primero" — pero el caller puede
        // pre-setear el initial dir si tiene preferencia).
        return { field: newField, dir: 'asc' };
      }
      // Misma columna → toggle asc ↔ desc.
      return { field: newField, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  }, []);

  const applyToQs = useCallback((qs) => {
    if (state.field) {
      qs.set('sort', state.field);
      qs.set('dir', state.dir);
    }
  }, [state]);

  // Memoizado para que pase a deps de useEffect/useCallback estable cuando
  // ni field ni dir cambian.
  const value = useMemo(() => ({
    field: state.field,
    dir: state.dir,
    setSort,
    applyToQs,
  }), [state, setSort, applyToQs]);

  return value;
}
