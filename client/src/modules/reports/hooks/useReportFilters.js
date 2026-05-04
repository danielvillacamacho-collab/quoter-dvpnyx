import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function useReportFilters(defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const keys = useMemo(() => Object.keys(defaults), [defaults]);

  const filters = useMemo(() => {
    const out = {};
    keys.forEach((k) => {
      out[k] = searchParams.get(k) || defaults[k] || '';
    });
    return out;
  }, [searchParams, keys, defaults]);

  const setFilter = useCallback(
    (key, value) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
  }, [setSearchParams, keys]);

  const toQueryString = useCallback(() => {
    const params = new URLSearchParams();
    keys.forEach((k) => {
      const v = filters[k];
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [keys, filters]);

  return { filters, setFilter, resetFilters, toQueryString };
}
