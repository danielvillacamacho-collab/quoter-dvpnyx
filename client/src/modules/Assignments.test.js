import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Assignments from './Assignments';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><Assignments /></MemoryRouter>);

const sampleAssignments = [
  {
    id: 'a1', employee_first_name: 'Ana', employee_last_name: 'García',
    contract_name: 'Contrato Alpha', role_title: 'Senior Dev', request_role_title: 'Backend Lead',
    weekly_hours: 20, start_date: '2026-05-01', end_date: '2026-08-01', status: 'active',
  },
];

const sampleRequests = [
  { id: 'r1', role_title: 'Backend Lead', contract_id: 'ct1', contract_name: 'Contrato Alpha', level: 'L4', quantity: 2, status: 'open', active_assignments_count: 1 },
  { id: 'r9', role_title: 'Closed role',  contract_id: 'ct1', contract_name: 'Contrato Alpha', level: 'L3', quantity: 1, status: 'filled', active_assignments_count: 1 },
];

const sampleEmployees = [
  { id: 'e1', first_name: 'Ana',  last_name: 'García', level: 'L4', weekly_capacity_hours: 40, status: 'active' },
  { id: 'e9', first_name: 'Terminated', last_name: 'Person', level: 'L2', weekly_capacity_hours: 40, status: 'terminated' },
];

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/resource-requests')) return Promise.resolve({ data: sampleRequests });
    if (url.startsWith('/api/employees'))         return Promise.resolve({ data: sampleEmployees });
    if (url.startsWith('/api/assignments'))       return Promise.resolve({ data: sampleAssignments, pagination: { page: 1, limit: 25, total: 1, pages: 1 } });
    return Promise.resolve({});
  });
});

describe('Assignments module', () => {
  it('renders header and "+ Nueva Asignación" button', async () => {
    mount();
    expect(await screen.findByText(/🗓 Asignaciones/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nueva Asignación/i })).toBeInTheDocument();
  });

  it('loads and renders assignment rows', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    expect(await screen.findByText('Ana García')).toBeInTheDocument();
    const row = screen.getByText('Ana García').closest('tr');
    expect(within(row).getByText('Activa')).toBeInTheDocument();
    expect(within(row).getByText('Backend Lead')).toBeInTheDocument();
  });

  it('request dropdown excludes filled/cancelled requests', async () => {
    mount();
    await screen.findByText('Ana García');
    await waitFor(() => {
      // filters populate asynchronously
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/resource-requests'))).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    const reqSel = within(dialog).getByLabelText('Solicitud');
    expect(reqSel.querySelector('option[value="r1"]')).not.toBeNull();
    expect(reqSel.querySelector('option[value="r9"]')).toBeNull();
  });

  it('employee dropdown excludes terminated employees', async () => {
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    const empSel = within(dialog).getByLabelText('Empleado');
    expect(empSel.querySelector('option[value="e1"]')).not.toBeNull();
    expect(empSel.querySelector('option[value="e9"]')).toBeNull();
  });

  it('creates assignment via POST with force when the override checkbox is ticked', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'a-new' });
    mount();
    await screen.findByText('Ana García');
    await waitFor(() => {
      // Wait for requests + employees to be populated in the form dropdowns
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/resource-requests'))).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Solicitud').querySelector('option[value="r1"]')).not.toBeNull();
      expect(within(dialog).getByLabelText('Empleado').querySelector('option[value="e1"]')).not.toBeNull();
    });
    fireEvent.change(within(dialog).getByLabelText('Solicitud'), { target: { value: 'r1' } });
    fireEvent.change(within(dialog).getByLabelText('Empleado'),  { target: { value: 'e1' } });
    fireEvent.change(within(dialog).getByLabelText('Fecha inicio'), { target: { value: '2026-05-01' } });
    fireEvent.click(within(dialog).getByLabelText('Forzar overbooking'));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/assignments',
        expect.objectContaining({
          resource_request_id: 'r1', employee_id: 'e1',
          contract_id: 'ct1', force: true,
        })
      );
    });
  });

  it('deletes with confirmation; surfaces soft-delete message when time entries preserved', async () => {
    apiV2.apiDelete.mockResolvedValue({ mode: 'soft', preserved_time_entries: 3, message: 'ok' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByLabelText('Eliminar asignación de Ana García'));
    await waitFor(() => expect(apiV2.apiDelete).toHaveBeenCalledWith('/api/assignments/a1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/3 time entries/)));
    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it('filters by status refetches', async () => {
    mount();
    await screen.findByText('Ana García');
    apiV2.apiGet.mockClear();
    fireEvent.change(screen.getByLabelText('Filtro por estado'), { target: { value: 'active' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('status=active'))).toBe(true);
    });
  });
});
