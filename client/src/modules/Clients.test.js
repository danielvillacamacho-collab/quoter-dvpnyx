import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Clients from './Clients';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter initialEntries={['/clients']}><Clients /></MemoryRouter>);

const sampleClient = {
  id: 'c1', name: 'Acme Corp', legal_name: 'Acme S.A.',
  country: 'Colombia', industry: 'Banca', tier: 'enterprise',
  preferred_currency: 'USD',
  opportunities_count: 3, active_contracts_count: 1, active: true,
};

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockResolvedValue({
    data: [sampleClient],
    pagination: { page: 1, limit: 25, total: 1, pages: 1 },
  });
});

describe('Clients module', () => {
  it('renders the header and "+ Nuevo Cliente" button', async () => {
    mount();
    expect(await screen.findByText(/🏢 Clientes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo Cliente/i })).toBeInTheDocument();
  });

  it('loads clients on mount and renders a row', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Acme S.A.')).toBeInTheDocument();
    expect(screen.getByText('Banca')).toBeInTheDocument();
    expect(screen.getByText('enterprise')).toBeInTheDocument();
  });

  it('shows counts for opportunities and contracts', async () => {
    mount();
    await screen.findByText('Acme Corp');
    expect(screen.getByText('3')).toBeInTheDocument();  // opportunities
    expect(screen.getByText('1')).toBeInTheDocument();  // contracts
  });

  it('filters list by search and refetches', async () => {
    mount();
    await screen.findByText('Acme Corp');
    apiV2.apiGet.mockClear();
    const searchInput = screen.getByLabelText('Buscar clientes');
    fireEvent.change(searchInput, { target: { value: 'Acme' } });
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    const url = apiV2.apiGet.mock.calls.at(-1)[0];
    expect(url).toContain('search=Acme');
  });

  it('opens the form modal on "+ Nuevo Cliente" and cancels cleanly', async () => {
    mount();
    await screen.findByText('Acme Corp');
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Cliente/i }));
    expect(await screen.findByText('Nuevo cliente')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    await waitFor(() => expect(screen.queryByText('Nuevo cliente')).toBeNull());
  });

  it('creates a client via POST and reloads the list', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'new-1' });
    mount();
    await screen.findByText('Acme Corp');
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Cliente/i }));
    fireEvent.change(await screen.findByPlaceholderText(/Colombia/i), { target: { value: 'Colombia' } });
    // name input is the first input after the Nuevo cliente heading
    const nameInput = screen.getByLabelText('Nombre *', { exact: false }).closest('input')
      || screen.getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'New Corp' } });
    fireEvent.click(screen.getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => expect(apiV2.apiPost).toHaveBeenCalledWith('/api/clients', expect.objectContaining({ name: 'New Corp' })));
  });

  it('shows validation error when name is empty', async () => {
    mount();
    await screen.findByText('Acme Corp');
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Cliente/i }));
    await screen.findByText('Nuevo cliente');
    // submit the form directly (requires Name but we bypass HTML required by dispatching submit)
    const form = document.querySelector('form');
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/nombre es requerido/i)).toBeInTheDocument());
  });

  it('opens edit modal with prefilled name on "Editar"', async () => {
    mount();
    await screen.findByText('Acme Corp');
    fireEvent.click(screen.getByLabelText('Editar Acme Corp'));
    expect(await screen.findByText('Editar cliente')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument();
  });

  it('calls apiDelete with confirmation', async () => {
    apiV2.apiDelete.mockResolvedValue({ message: 'ok' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await screen.findByText('Acme Corp');
    fireEvent.click(screen.getByLabelText('Eliminar Acme Corp'));
    await waitFor(() => expect(apiV2.apiDelete).toHaveBeenCalledWith('/api/clients/c1'));
    confirmSpy.mockRestore();
  });

  it('does NOT call apiDelete when confirm is cancelled', async () => {
    apiV2.apiDelete.mockResolvedValue({ message: 'ok' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    mount();
    await screen.findByText('Acme Corp');
    fireEvent.click(screen.getByLabelText('Eliminar Acme Corp'));
    expect(apiV2.apiDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('toggles active via /deactivate when client is active', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'c1', active: false });
    mount();
    await screen.findByText('Acme Corp');
    fireEvent.click(screen.getByLabelText('Desactivar Acme Corp'));
    await waitFor(() => expect(apiV2.apiPost).toHaveBeenCalledWith('/api/clients/c1/deactivate', {}));
  });

  it('renders empty state when no clients match filters', async () => {
    apiV2.apiGet.mockResolvedValue({ data: [], pagination: { page: 1, total: 0, pages: 1 } });
    mount();
    await waitFor(() => expect(screen.getByText(/No hay clientes que coincidan/i)).toBeInTheDocument());
  });
});
