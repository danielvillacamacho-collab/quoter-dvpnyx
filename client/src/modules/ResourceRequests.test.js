import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResourceRequests from './ResourceRequests';
import * as apiV2 from '../utils/apiV2';
import { changeSelect } from '../utils/testHelpers';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><ResourceRequests /></MemoryRouter>);

const sampleRequests = [
  { id: 'r1', role_title: 'Senior Dev', contract_name: 'Contrato Alpha', area_name: 'Desarrollo',
    level: 'L4', quantity: 2, priority: 'high', status: 'partially_filled',
    active_assignments_count: 1, start_date: '2026-05-01' },
  { id: 'r2', role_title: 'QA Lead', contract_name: 'Contrato Beta', area_name: 'Testing',
    level: 'L5', quantity: 1, priority: 'critical', status: 'open',
    active_assignments_count: 0, start_date: '2026-06-10' },
];
const sampleContracts = [
  { id: 'ct1', name: 'Contrato Alpha', status: 'active' },
  { id: 'ct2', name: 'Contrato Beta',  status: 'active' },
  { id: 'ct3', name: 'Contrato Old',   status: 'completed' },
];
const sampleAreas = [
  { id: 1, name: 'Desarrollo', active: true },
  { id: 2, name: 'Testing',    active: true },
];

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/contracts'))          return Promise.resolve({ data: sampleContracts });
    if (url.startsWith('/api/areas'))              return Promise.resolve({ data: sampleAreas });
    if (url.startsWith('/api/resource-requests'))  return Promise.resolve({ data: sampleRequests, pagination: { page: 1, limit: 25, total: 2, pages: 1 } });
    return Promise.resolve({});
  });
});

describe('ResourceRequests module', () => {
  it('renders header and "+ Nueva Solicitud" button', async () => {
    mount();
    expect(await screen.findByText(/🧾 Solicitudes de recurso/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nueva Solicitud/i })).toBeInTheDocument();
  });

  it('loads and renders rows with priority + status badges', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    expect(await screen.findByText('Senior Dev')).toBeInTheDocument();
    const row = screen.getByText('Senior Dev').closest('tr');
    expect(within(row).getByText('Alta')).toBeInTheDocument();
    expect(within(row).getByText(/Parcialmente/)).toBeInTheDocument();
  });

  it('contract filter excludes completed/cancelled contracts', async () => {
    mount();
    await screen.findByText('Senior Dev');
    // Open the contract filter dropdown and check options
    const contractFilter = screen.getByLabelText('Filtro por contrato');
    fireEvent.click(contractFilter);
    await waitFor(() => {
      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
      // Active contracts are present
      expect(listbox.querySelector('[data-value="ct1"]')).not.toBeNull();
      expect(listbox.querySelector('[data-value="ct2"]')).not.toBeNull();
      // Completed contract is filtered out
      expect(listbox.querySelector('[data-value="ct3"]')).toBeNull();
    });
  });

  it('status filter triggers refetch', async () => {
    mount();
    await screen.findByText('Senior Dev');
    apiV2.apiGet.mockClear();
    await changeSelect('Filtro por estado', 'open');
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('status=open'))).toBe(true);
    });
  });

  it('creates a request via POST', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'r-new' });
    mount();
    await screen.findByText('Senior Dev');
    // Wait for contracts to load by checking the filter options
    const contractFilterInput = screen.getByLabelText('Filtro por contrato');
    fireEvent.click(contractFilterInput);
    await waitFor(() => {
      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
      expect(listbox.querySelector('[data-value="ct1"]')).not.toBeNull();
    });
    fireEvent.keyDown(contractFilterInput, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Nueva Solicitud/i }));
    const dialog = await screen.findByRole('dialog');
    await changeSelect('Contrato', 'ct1');
    fireEvent.change(within(dialog).getByLabelText('Role title'), { target: { value: 'UX Designer' } });
    await changeSelect('Área', '1');
    fireEvent.change(within(dialog).getByLabelText('Fecha de inicio'), { target: { value: '2026-08-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/resource-requests',
        expect.objectContaining({ contract_id: 'ct1', role_title: 'UX Designer', area_id: 1 })
      );
    });
  });

  it('cancel action hits /cancel endpoint with confirmation', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'r1', status: 'cancelled' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await screen.findByText('Senior Dev');
    fireEvent.click(screen.getByLabelText('Cancelar Senior Dev'));
    await waitFor(() => expect(apiV2.apiPost).toHaveBeenCalledWith('/api/resource-requests/r1/cancel', {}));
    confirmSpy.mockRestore();
  });

  it('does not show Cancel button for cancelled requests', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/contracts')) return Promise.resolve({ data: sampleContracts });
      if (url.startsWith('/api/areas'))     return Promise.resolve({ data: sampleAreas });
      return Promise.resolve({ data: [
        { id: 'r9', role_title: 'Old role', contract_name: 'X', area_name: 'Y', level: 'L3',
          quantity: 1, priority: 'low', status: 'cancelled', active_assignments_count: 0, start_date: '2026-01-01' },
      ], pagination: { page: 1, total: 1, pages: 1 } });
    });
    mount();
    await screen.findByText('Old role');
    expect(screen.queryByLabelText('Cancelar Old role')).toBeNull();
  });
});
