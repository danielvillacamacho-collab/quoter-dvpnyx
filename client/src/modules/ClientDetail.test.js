import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ClientDetail from './ClientDetail';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = (id = 'c1') => render(
  <MemoryRouter initialEntries={[`/clients/${id}`]}>
    <Routes>
      <Route path="/clients/:id" element={<ClientDetail />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => { jest.resetAllMocks(); });

describe('ClientDetail', () => {
  it('shows client + opportunities + contracts when loaded', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url === '/api/clients/c1') return Promise.resolve({
        id: 'c1', name: 'Acme', country: 'Colombia', tier: 'enterprise', active: true,
        opportunities_count: 2, active_contracts_count: 1,
      });
      if (url.startsWith('/api/opportunities')) return Promise.resolve({ data: [
        { id: 'o1', name: 'Deal Alpha', status: 'open', quotations_count: 1, expected_close_date: '2026-06-30' },
      ] });
      if (url.startsWith('/api/contracts')) return Promise.resolve({ data: [
        { id: 'ct1', name: 'Contrato A', type: 'project', status: 'active', active_assignments_count: 2, start_date: '2026-03-01' },
      ] });
      return Promise.resolve({});
    });
    mount();
    expect(await screen.findByText(/🏢 Acme/)).toBeInTheDocument();
    expect(screen.getByText('Deal Alpha')).toBeInTheDocument();
    expect(screen.getByText('Contrato A')).toBeInTheDocument();
  });

  it('renders empty-state copy when client has no opps/contracts', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url === '/api/clients/c2') return Promise.resolve({ id: 'c2', name: 'SoloSolo', active: true });
      return Promise.resolve({ data: [] });
    });
    mount('c2');
    await screen.findByText(/🏢 SoloSolo/);
    expect(screen.getByText(/Sin oportunidades registradas/i)).toBeInTheDocument();
    expect(screen.getByText(/Sin contratos para este cliente/i)).toBeInTheDocument();
  });

  it('surfaces error state when the client is not found', async () => {
    apiV2.apiGet.mockRejectedValue(new Error('404 Cliente no encontrado'));
    mount('missing');
    await waitFor(() => expect(screen.getByText(/Cliente no encontrado|404/i)).toBeInTheDocument());
  });
});
