/**
 * useQuotationLookups — tests
 *
 * Key scenarios:
 *  - FIX-INACTIVE: when the hook is initialized with a clientId that is NOT
 *    in the active clients list (e.g. client was deactivated after the
 *    quotation was saved), the hook fetches that client individually and
 *    adds it to the list so the dropdown still shows the correct value.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { apiGet } from '../utils/apiV2';
import useQuotationLookups from './useQuotationLookups';

jest.mock('../utils/apiV2');

const activeClients = [
  { id: 'c-active', name: 'Cliente Activo' },
  { id: 'c-other', name: 'Otro Cliente' },
];
const commercials = [{ id: 'u1', name: 'Vendedor' }];
const inactiveClient = { id: 'c-inactive', name: 'Ágata Corp', active: false };

describe('useQuotationLookups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads active clients and commercials on mount', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('/api/clients')) return Promise.resolve({ data: activeClients });
      if (url.includes('/api/users/lookup')) return Promise.resolve(commercials);
      return Promise.reject(new Error('unexpected'));
    });

    const { result } = renderHook(() => useQuotationLookups(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.clients).toEqual(activeClients);
    expect(result.current.commercials).toEqual(commercials);
    // No individual client fetch should have happened
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringMatching(/\/api\/clients\//));
  });

  it('does not make an extra fetch when the provided clientId is already in the active list', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('/api/clients?')) return Promise.resolve({ data: activeClients });
      if (url.includes('/api/users/lookup')) return Promise.resolve(commercials);
      return Promise.reject(new Error('unexpected'));
    });

    const { result } = renderHook(() => useQuotationLookups('c-active'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.clients).toEqual(activeClients);
    expect(apiGet).not.toHaveBeenCalledWith('/api/clients/c-active');
  });

  it('FIX-INACTIVE: fetches inactive client individually when it is not in the active list', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('/api/clients?')) return Promise.resolve({ data: activeClients });
      if (url.includes('/api/users/lookup')) return Promise.resolve(commercials);
      if (url === '/api/clients/c-inactive') return Promise.resolve(inactiveClient);
      return Promise.reject(new Error('unexpected: ' + url));
    });

    const { result } = renderHook(() => useQuotationLookups('c-inactive'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The inactive client should be prepended to the list
    expect(result.current.clients[0]).toMatchObject({ id: 'c-inactive', name: 'Ágata Corp' });
    expect(result.current.clients).toHaveLength(activeClients.length + 1);
    expect(apiGet).toHaveBeenCalledWith('/api/clients/c-inactive');
  });

  it('FIX-INACTIVE: silently skips extra fetch when individual client fetch fails', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('/api/clients?')) return Promise.resolve({ data: activeClients });
      if (url.includes('/api/users/lookup')) return Promise.resolve(commercials);
      if (url === '/api/clients/c-missing') return Promise.reject(new Error('Not found'));
      return Promise.reject(new Error('unexpected'));
    });

    const { result } = renderHook(() => useQuotationLookups('c-missing'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should still load without crashing; clients list stays as-is
    expect(result.current.clients).toEqual(activeClients);
  });

  it('loads opportunities when clientId is provided', async () => {
    const opps = [{ id: 'o1', name: 'Opp 1', status: 'open' }];
    apiGet.mockImplementation((url) => {
      if (url.includes('/api/clients?')) return Promise.resolve({ data: activeClients });
      if (url.includes('/api/users/lookup')) return Promise.resolve(commercials);
      if (url.includes('/api/opportunities')) return Promise.resolve({ data: opps });
      if (url.startsWith('/api/clients/')) return Promise.resolve(activeClients[0]);
      return Promise.reject(new Error('unexpected: ' + url));
    });

    const { result } = renderHook(() => useQuotationLookups('c-active'));
    await waitFor(() => expect(result.current.opportunities).toHaveLength(1));
    expect(result.current.opportunities[0].id).toBe('o1');
  });

  it('addClient helper prepends a newly created client to the list', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('/api/clients?')) return Promise.resolve({ data: activeClients });
      if (url.includes('/api/users/lookup')) return Promise.resolve(commercials);
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useQuotationLookups(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addClient({ id: 'c-new', name: 'Nuevo' });
    await waitFor(() => expect(result.current.clients[0]).toMatchObject({ id: 'c-new' }));
  });
});
