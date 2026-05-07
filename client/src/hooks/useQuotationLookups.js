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

  // Load clients + commercials on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet('/api/clients?limit=500&active=true').catch(() => ({ data: [] })),
      apiGet('/api/users/lookup?function=comercial').catch(() => []),
    ]).then(([clientsRes, commercialsRes]) => {
      if (cancelled) return;
      setClients(clientsRes?.data || []);
      setCommercials(Array.isArray(commercialsRes) ? commercialsRes : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

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
