import { useState, useCallback, useEffect, useRef } from 'react';
import { apiGet } from '../../../utils/apiV2';

export default function useReportData(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const urlRef = useRef(url);
  urlRef.current = url;

  const reload = useCallback(async () => {
    const currentUrl = urlRef.current;
    if (!currentUrl) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiGet(currentUrl);
      setData(res);
    } catch (e) {
      setError(e.message || 'Error al cargar datos');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError('');

    (async () => {
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
  }, [url]);

  return { data, loading, error, reload };
}
