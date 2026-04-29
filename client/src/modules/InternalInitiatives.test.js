import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InternalInitiatives from './InternalInitiatives';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><InternalInitiatives /></MemoryRouter>);

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockResolvedValue({
    data: [
      { id: 'a', initiative_code: 'II-PROD-2026-00001', name: 'Quoter v3', status: 'active',
        business_area_id: 'product', business_area_label: 'Producto',
        operations_owner_name: 'Andrés', budget_usd: 500000, consumed_usd: 50000,
        assignments_count: 6 },
    ],
  });
});

describe('InternalInitiatives', () => {
  it('renderiza header', async () => {
    mount();
    expect(await screen.findByText(/Iniciativas Internas/i)).toBeInTheDocument();
  });

  it('lista las iniciativas devueltas por API', async () => {
    mount();
    expect(await screen.findByText(/Quoter v3/)).toBeInTheDocument();
    expect(screen.getByText(/II-PROD-2026-00001/)).toBeInTheDocument();
  });

  it('muestra totales con presupuesto y consumido', async () => {
    mount();
    await screen.findByText(/Quoter v3/);
    expect(screen.getByText(/Presupuesto:/)).toBeInTheDocument();
    expect(screen.getByText(/Consumido:/)).toBeInTheDocument();
  });

  it('llama apiGet con filtros', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    const calls = apiV2.apiGet.mock.calls;
    const url = calls[0][0];
    expect(url).toMatch(/\/api\/internal-initiatives/);
    expect(url).toMatch(/status=active/);
  });

  it('botón "Nueva iniciativa" oculto para no-admin', async () => {
    mount();
    await screen.findByText(/Quoter v3/);
    expect(screen.queryByRole('button', { name: /Nueva iniciativa/i })).toBeNull();
  });
});
