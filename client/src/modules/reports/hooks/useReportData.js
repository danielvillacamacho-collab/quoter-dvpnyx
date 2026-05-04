import { useState, useCallback, useEffect } from 'react';
import { apiGet } from '../../../utils/apiV2';

export default function useReportData(url, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiGet(url);
      setData(res);
    } catch (e) {
      setError(e.message || 'Error al cargar datos');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [url, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!url) return;
      setLoading(true);
      setError('');
      try {
        const res = await apiGet(url);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Error al cargar datos');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, reload };
}
