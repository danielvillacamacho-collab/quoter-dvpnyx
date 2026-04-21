import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Contracts from './Contracts';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><Contracts /></MemoryRouter>);

const sampleContracts = [
  {
    id: 'ct1', name: 'Contrato Alpha', client_name: 'Acme', client_id: 'c1',
    type: 'project', status: 'active', start_date: '2026-04-01',
    open_requests_count: 2, active_assignments_count: 3,
  },
  {
    id: 'ct2', name: 'Contrato Beta', client_name: 'Globex', client_id: 'c2',
    type: 'capacity', status: 'planned', start_date: '2026-05-15',
    open_requests_count: 0, active_assignments_count: 0,
  },
];

const sampleClients = [
  { id: 'c1', name: 'Acme',   active: true },
  { id: 'c2', name: 'Globex', active: true },
];

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/clients')) return Promise.resolve({ data: sampleClients });
    if (url.startsWith('/api/contracts')) return Promise.resolve({ data: sampleContracts, pagination: { page: 1, limit: 25, total: 2, pages: 1 } });
    return Promise.resolve({});
  });
});

describe('Contracts module', () => {
  it('renders header and "+ Nuevo Contrato" button', async () => {
    mount();
    expect(await screen.findByText(/📑 Contratos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo Contrato/i })).toBeInTheDocument();
  });

  it('loads and renders rows with client + status', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    expect(await screen.findByText('Contrato Alpha')).toBeInTheDocument();
    const alphaRow = screen.getByText('Contrato Alpha').closest('tr');
    expect(within(alphaRow).getByText('Acme')).toBeInTheDocument();
    expect(within(alphaRow).getByText('Activo')).toBeInTheDocument();
  });

  it('renders open requests + active assignments counts', async () => {
    mount();
    await screen.findByText('Contrato Alpha');
    const row = screen.getByText('Contrato Alpha').closest('tr');
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    mount();
    await screen.findByText('Contrato Alpha');
    apiV2.apiGet.mockClear();
    fireEvent.change(screen.getByLabelText('Filtro por estado'), { target: { value: 'active' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('status=active'))).toBe(true);
    });
  });

  it('renders transition buttons for active status (paused, completed, cancelled)', async () => {
    mount();
    await screen.findByText('Contrato Alpha');
    expect(screen.getByLabelText('Mover Contrato Alpha a Pausado')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover Contrato Alpha a Completado')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover Contrato Alpha a Cancelado')).toBeInTheDocument();
  });

  it('POSTs status transition with confirmation (completed)', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'ct1', status: 'completed' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await screen.findByText('Contrato Alpha');
    fireEvent.click(screen.getByLabelText('Mover Contrato Alpha a Completado'));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith('/api/contracts/ct1/status', { new_status: 'completed' });
    });
    confirmSpy.mockRestore();
  });

  it('creates a contract via POST', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'ct-new' });
    mount();
    await screen.findByText('Contrato Alpha');
    await waitFor(() => {
      expect(screen.getByLabelText('Filtro por cliente').querySelector('option[value="c1"]')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Contrato/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'New Contract' } });
    fireEvent.change(within(dialog).getByLabelText('Cliente'), { target: { value: 'c1' } });
    fireEvent.change(within(dialog).getByLabelText('Tipo'), { target: { value: 'project' } });
    fireEvent.change(within(dialog).getByLabelText('Fecha inicio'), { target: { value: '2026-06-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/contracts',
        expect.objectContaining({ name: 'New Contract', client_id: 'c1', type: 'project' })
      );
    });
    // squad_id ya no se envía desde el cliente — lo resuelve el backend
    const payload = apiV2.apiPost.mock.calls[0][1];
    expect(payload).not.toHaveProperty('squad_id');
  });

  it('deletes with confirmation', async () => {
    apiV2.apiDelete.mockResolvedValue({ message: 'ok' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await screen.findByText('Contrato Alpha');
    fireEvent.click(screen.getByLabelText('Eliminar Contrato Alpha'));
    await waitFor(() => expect(apiV2.apiDelete).toHaveBeenCalledWith('/api/contracts/ct1'));
    confirmSpy.mockRestore();
  });

  it('renders empty state when no contracts match filters', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/clients')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [], pagination: { page: 1, total: 0, pages: 1 } });
    });
    mount();
    await waitFor(() => expect(screen.getByText(/No hay contratos que coincidan/i)).toBeInTheDocument());
  });
});
