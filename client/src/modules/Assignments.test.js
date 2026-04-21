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

  it('creates assignment via POST (happy path, no overrides)', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'a-new', validation: { valid: true } });
    mount();
    await screen.findByText('Ana García');
    await waitFor(() => {
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/resource-requests'))).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Solicitud').querySelector('option[value="r1"]')).not.toBeNull();
    });
    fireEvent.change(within(dialog).getByLabelText('Solicitud'), { target: { value: 'r1' } });
    fireEvent.change(within(dialog).getByLabelText('Empleado'),  { target: { value: 'e1' } });
    fireEvent.change(within(dialog).getByLabelText('Fecha inicio'), { target: { value: '2026-05-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/assignments',
        expect.objectContaining({
          resource_request_id: 'r1', employee_id: 'e1', contract_id: 'ct1',
        }),
      );
    });
    // No override flag should be sent on the happy path.
    const [, sentBody] = apiV2.apiPost.mock.calls[0];
    expect(sentBody).not.toHaveProperty('override_reason');
    expect(sentBody).not.toHaveProperty('force');
  });

  it('US-VAL-4: on 409 OVERRIDE_REQUIRED shows the validation modal and retries with override_reason', async () => {
    // First POST returns 409 with a capacity fail → triggers modal.
    const checks = [
      { check: 'area_match',    status: 'pass', message: 'ok' },
      { check: 'level_match',   status: 'pass', message: 'ok' },
      { check: 'capacity',      status: 'fail', overridable: true, message: 'Sin capacidad', detail: { utilization_after_pct: 125 } },
      { check: 'date_conflict', status: 'pass', message: 'ok' },
    ];
    const conflictErr = Object.assign(new Error('needs override'), {
      status: 409,
      body: {
        code: 'OVERRIDE_REQUIRED', requires_justification: true,
        checks, summary: { pass: 3, warn: 0, info: 0, fail: 1, overridable_fails: 1, non_overridable_fails: 0 },
      },
    });
    apiV2.apiPost
      .mockRejectedValueOnce(conflictErr)
      .mockResolvedValueOnce({ id: 'a-new', validation: { valid: false, can_override: true } });

    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Solicitud').querySelector('option[value="r1"]')).not.toBeNull();
    });
    fireEvent.change(within(dialog).getByLabelText('Solicitud'), { target: { value: 'r1' } });
    fireEvent.change(within(dialog).getByLabelText('Empleado'),  { target: { value: 'e1' } });
    fireEvent.change(within(dialog).getByLabelText('Fecha inicio'), { target: { value: '2026-05-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));

    // Modal should appear with the checklist
    await screen.findByText(/Revisión de compatibilidad/i);
    const reason = 'Aprobado por COO para cubrir hito crítico del cliente.';
    fireEvent.change(screen.getByLabelText(/Justificación de override/i), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: /Crear con justificación/i }));

    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledTimes(2);
    });
    const [, retryBody] = apiV2.apiPost.mock.calls[1];
    expect(retryBody.override_reason).toBe(reason);
  });

  it('US-VAL-4: on 409 VALIDATION_FAILED (non-overridable) shows modal without justification field', async () => {
    const conflictErr = Object.assign(new Error('blocked'), {
      status: 409,
      body: {
        code: 'VALIDATION_FAILED',
        checks: [
          { check: 'area_match',    status: 'pass', message: 'ok' },
          { check: 'level_match',   status: 'pass', message: 'ok' },
          { check: 'capacity',      status: 'pass', message: 'ok' },
          { check: 'date_conflict', status: 'fail', overridable: false, message: 'No overlap' },
        ],
        summary: { pass: 3, warn: 0, info: 0, fail: 1, overridable_fails: 0, non_overridable_fails: 1 },
      },
    });
    apiV2.apiPost.mockRejectedValueOnce(conflictErr);

    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Solicitud').querySelector('option[value="r1"]')).not.toBeNull();
    });
    fireEvent.change(within(dialog).getByLabelText('Solicitud'), { target: { value: 'r1' } });
    fireEvent.change(within(dialog).getByLabelText('Empleado'),  { target: { value: 'e1' } });
    fireEvent.change(within(dialog).getByLabelText('Fecha inicio'), { target: { value: '2026-05-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));

    await screen.findByText(/Revisión de compatibilidad/i);
    expect(screen.queryByLabelText(/Justificación de override/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crear con justificación/i })).not.toBeInTheDocument();
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
