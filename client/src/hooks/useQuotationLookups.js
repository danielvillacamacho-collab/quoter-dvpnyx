/**
 * useQuotationLookups — shared hook for quotation editors.
 *
 * Fetches:
 *   - Active clients (for client dropdown)
 *   - Opportunities filtered by selected client (for opportunity dropdown)
 *   - Users with function='comercial' (for commercial dropdown)
 *
 * Returns: { clients, opportunities, commercials, loading }
 *
 * Usage:
 *   const lookups = useQuotationLookups(data.client_id);
 */
import { useState, useEffect, useRef } from 'react';
import { apiGet } from '../utils/apiV2';

export default function useQuotationLookups(clientId) {
  const [clients, setClients] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [commercials, setCommercials] = useState([]);
  const [loading, setLoading] = useState(true);

  // Track mount for cleanup
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Load clients + commercials on mount.
  // clientId is captured once at mount time — it is the ID of the client
  // already linked to the quotation being edited (if any). We need it here
  // so that if that client is inactive it still appears in the dropdown.
  const mountClientIdRef = useRef(clientId);
  useEffect(() => {
    let cancelled = false;
    const mountedClientId = mountClientIdRef.current;
    Promise.all([
      apiGet('/api/clients?limit=500&active=true').catch(() => ({ data: [] })),
      apiGet('/api/users/lookup?function=comercial').catch(() => []),
    ]).then(async ([clientsRes, commercialsRes]) => {
      if (cancelled) return;
      let loadedClients = clientsRes?.data || [];
      // If the quotation already references a client that isn't in the active
      // list (e.g. it was deactivated after the quotation was created), fetch
      // it individually so it still appears as a selectable option.
      if (
        mountedClientId &&
        !loadedClients.some((c) => String(c.id) === String(mountedClientId))
      ) {
        try {
          const existing = await apiGet(`/api/clients/${mountedClientId}`);
          if (existing && existing.id) loadedClients = [existing, ...loadedClients];
        } catch (_) { /* best-effort: skip if fetch fails */ }
      }
      setClients(loadedClients);
      setCommercials(Array.isArray(commercialsRes) ? commercialsRes : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // Load opportunities when client changes
  useEffect(() => {
    if (!clientId) {
      setOpportunities([]);
      return;
    }
    let cancelled = false;
    apiGet(`/api/opportunities?client_id=${clientId}&limit=200`)
      .then((res) => {
        if (cancelled) return;
        const active = (res?.data || []).filter(
          (o) => !['closed_lost', 'cancelled'].includes(o.status)
        );
        setOpportunities(active);
      })
      .catch(() => { if (!cancelled) setOpportunities([]); });
    return () => { cancelled = true; };
  }, [clientId]);

  // Helper: add a newly created client to the local list
  const addClient = (client) => {
    setClients((prev) => [client, ...prev]);
  };

  // Helper: add a newly created opportunity to the local list
  const addOpportunity = (opp) => {
    setOpportunities((prev) => [opp, ...prev]);
  };

  return { clients, opportunities, commercials, loading, addClient, addOpportunity };
}
