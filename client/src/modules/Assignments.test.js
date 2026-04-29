import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Assignments from './Assignments';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><Assignments /></MemoryRouter>);

/**
 * Helper para los <SearchableSelect>: enfoca el input para abrir el
 * listbox, espera a que la opción esté en el DOM (los lookups cargan
 * async) y la selecciona. Async para tolerar la carrera entre la carga
 * de assignments y la de los lookups.
 */
const pickFromCombobox = async (dialog, label, optionText) => {
  fireEvent.focus(within(dialog).getByLabelText(label));
  const list = within(dialog).getByRole('listbox');
  const option = await within(list).findByText(optionText);
  fireEvent.mouseDown(option);
};

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

  it('request combobox excludes filled/cancelled requests', async () => {
    mount();
    await screen.findByText('Ana García');
    await waitFor(() => {
      // filters populate asynchronously
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/resource-requests'))).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.focus(within(dialog).getByLabelText('Solicitud'));
    const list = within(dialog).getByRole('listbox');
    // Esperamos a que la opción válida esté presente — entonces sabemos
    // que el lookup ya hidrató el state y la ausencia de "Closed role"
    // es una decisión real del filtro, no un timing race.
    await within(list).findByText(/Backend Lead/);
    expect(within(list).queryByText('Closed role')).toBeNull();
  });

  it('employee combobox excludes terminated employees', async () => {
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.focus(within(dialog).getByLabelText('Empleado'));
    const list = within(dialog).getByRole('listbox');
    await within(list).findByText('Ana García');
    expect(within(list).queryByText(/Terminated Person/)).toBeNull();
  });

  it('employee combobox filters by typed query', async () => {
    // Reglas claras del nuevo combobox: el usuario tipea "ana" y sólo debe
    // ver coincidencias de Ana — central a la UX que vinimos a arreglar.
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    const empInput = within(dialog).getByLabelText('Empleado');
    fireEvent.focus(empInput);
    // Espera a que el lookup termine antes de filtrar.
    await within(within(dialog).getByRole('listbox')).findByText('Ana García');
    fireEvent.change(empInput, { target: { value: 'ana' } });
    const list = within(dialog).getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Ana García');
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

    await pickFromCombobox(dialog, 'Solicitud', /Backend Lead/);
    await pickFromCombobox(dialog, 'Empleado', 'Ana García');

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
      // El combobox precisa que la lista de solicitudes ya haya cargado
      // antes de abrir el listbox.
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/resource-requests'))).toBe(true);
    });
    await pickFromCombobox(dialog, 'Solicitud', /Backend Lead/);
    await pickFromCombobox(dialog, 'Empleado', 'Ana García');
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
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/resource-requests'))).toBe(true);
    });
    await pickFromCombobox(dialog, 'Solicitud', /Backend Lead/);
    await pickFromCombobox(dialog, 'Empleado', 'Ana García');
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

  it('Descargar CSV button calls apiDownload with active filters', async () => {
    apiV2.apiDownload.mockResolvedValue();
    mount();
    await screen.findByText('Ana García');
    fireEvent.change(screen.getByLabelText('Filtro por estado'), { target: { value: 'active' } });
    fireEvent.click(screen.getByTestId('assignments-export-csv'));
    await waitFor(() => expect(apiV2.apiDownload).toHaveBeenCalledTimes(1));
    const [url, filename] = apiV2.apiDownload.mock.calls[0];
    expect(url).toMatch(/^\/api\/assignments\/export\.csv\?/);
    expect(url).toContain('status=active');
    expect(filename).toBe('asignaciones.csv');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SPEC-007 Spec 1 — Filtro por empleado
  // ─────────────────────────────────────────────────────────────────────────

  it('SPEC-007: renders the employee filter input', async () => {
    mount();
    await screen.findByText('Ana García');
    expect(screen.getByLabelText('Filtro por empleado')).toBeInTheDocument();
  });

  it('SPEC-007: selecting an employee adds employee_ids to the API call', async () => {
    mount();
    await screen.findByText('Ana García');
    await waitFor(() =>
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/employees'))).toBe(true),
    );
    apiV2.apiGet.mockClear();

    const filterInput = screen.getByLabelText('Filtro por empleado');
    fireEvent.focus(filterInput);

    // Wait for the listbox to appear and find Ana García
    const listbox = await screen.findByRole('listbox', { name: 'Empleados' });
    const option = await within(listbox).findByText(/Ana García/);
    fireEvent.mouseDown(option);

    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('employee_ids=e1'))).toBe(true);
    });
  });

  it('SPEC-007: selected employee renders as a removable chip', async () => {
    mount();
    await screen.findByText('Ana García');
    await waitFor(() =>
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/employees'))).toBe(true),
    );

    fireEvent.focus(screen.getByLabelText('Filtro por empleado'));
    const listbox = await screen.findByRole('listbox', { name: 'Empleados' });
    fireEvent.mouseDown(await within(listbox).findByText(/Ana García/));

    // Chip with remove button must appear
    expect(await screen.findByLabelText('Quitar Ana García')).toBeInTheDocument();
  });

  it('SPEC-007: removing a chip clears that employee from the filter', async () => {
    mount();
    await screen.findByText('Ana García');
    await waitFor(() =>
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/employees'))).toBe(true),
    );

    fireEvent.focus(screen.getByLabelText('Filtro por empleado'));
    const listbox = await screen.findByRole('listbox', { name: 'Empleados' });
    fireEvent.mouseDown(await within(listbox).findByText(/Ana García/));
    await screen.findByLabelText('Quitar Ana García');

    apiV2.apiGet.mockClear();
    fireEvent.click(screen.getByLabelText('Quitar Ana García'));

    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      // After removing, the call must NOT include employee_ids
      expect(urls.some((u) => u.includes('employee_ids='))).toBe(false);
    });
  });

  it('SPEC-007: terminated employees appear in the filter dropdown but not in the form', async () => {
    mount();
    // Wait for table to load
    await screen.findByText('Ana García');
    await waitFor(() =>
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/employees'))).toBe(true),
    );

    // Filter dropdown — should include terminated
    fireEvent.focus(screen.getByLabelText('Filtro por empleado'));
    const filterListbox = await screen.findByRole('listbox', { name: 'Empleados' });
    expect(within(filterListbox).getByText(/Terminated Person/)).toBeInTheDocument();

    // Form combobox — should exclude terminated
    fireEvent.click(screen.getByRole('button', { name: /Nueva Asignación/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.focus(within(dialog).getByLabelText('Empleado'));
    const formListbox = within(dialog).getByRole('listbox');
    await within(formListbox).findByText('Ana García');
    expect(within(formListbox).queryByText(/Terminated Person/)).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SPEC-007 Spec 2 — Filtro por rango de fechas
  // ─────────────────────────────────────────────────────────────────────────

  it('SPEC-007: date_from filter adds date_from to API call', async () => {
    mount();
    await screen.findByText('Ana García');
    apiV2.apiGet.mockClear();

    fireEvent.change(screen.getByLabelText('Filtro fecha desde'), { target: { value: '2026-05-01' } });

    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('date_from=2026-05-01'))).toBe(true);
    });
  });

  it('SPEC-007: date_to filter adds date_to to API call', async () => {
    mount();
    await screen.findByText('Ana García');
    apiV2.apiGet.mockClear();

    fireEvent.change(screen.getByLabelText('Filtro fecha hasta'), { target: { value: '2026-08-31' } });

    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('date_to=2026-08-31'))).toBe(true);
    });
  });

  it('SPEC-007: date_from > date_to shows an error and does NOT fetch', async () => {
    mount();
    await screen.findByText('Ana García');

    // Set a valid date_to first — this WILL trigger a fetch (expected)
    fireEvent.change(screen.getByLabelText('Filtro fecha hasta'), { target: { value: '2026-04-01' } });
    // Wait for that valid fetch to complete, then clear the mock
    await waitFor(() => {
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].includes('date_to=2026-04-01'))).toBe(true);
    });
    apiV2.apiGet.mockClear();

    // Now set date_from AFTER date_to — invalid range — must NOT trigger a fetch
    fireEvent.change(screen.getByLabelText('Filtro fecha desde'), { target: { value: '2026-06-01' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La fecha de inicio no puede ser posterior a la fecha de fin',
    );
    // No assignment fetch should have been dispatched after the invalid range was set
    expect(apiV2.apiGet.mock.calls.map((c) => c[0]).some((u) => u.includes('/api/assignments?'))).toBe(false);
  });

  it('SPEC-007: clear-filters button resets all filters and reloads', async () => {
    mount();
    await screen.findByText('Ana García');

    // Apply a status filter to make "Limpiar filtros" appear
    fireEvent.change(screen.getByLabelText('Filtro por estado'), { target: { value: 'active' } });
    const clearBtn = await screen.findByLabelText('Limpiar filtros');

    apiV2.apiGet.mockClear();
    fireEvent.click(clearBtn);

    await waitFor(() => {
      // Should have re-fetched without any filter params
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      const assignmentCalls = urls.filter((u) => u.startsWith('/api/assignments?'));
      expect(assignmentCalls.length).toBeGreaterThan(0);
      expect(assignmentCalls.every((u) => !u.includes('status=') && !u.includes('employee_ids=') && !u.includes('date_from=') && !u.includes('date_to='))).toBe(true);
    });
  });

  it('SPEC-007: CSV export includes employee_ids and date range params', async () => {
    apiV2.apiDownload.mockResolvedValue();
    mount();
    await screen.findByText('Ana García');
    await waitFor(() =>
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/employees'))).toBe(true),
    );

    // Select an employee
    fireEvent.focus(screen.getByLabelText('Filtro por empleado'));
    const listbox = await screen.findByRole('listbox', { name: 'Empleados' });
    fireEvent.mouseDown(await within(listbox).findByText(/Ana García/));

    // Set date range
    fireEvent.change(screen.getByLabelText('Filtro fecha desde'), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByLabelText('Filtro fecha hasta'), { target: { value: '2026-08-31' } });

    fireEvent.click(screen.getByTestId('assignments-export-csv'));

    await waitFor(() => expect(apiV2.apiDownload).toHaveBeenCalledTimes(1));
    const [url] = apiV2.apiDownload.mock.calls[0];
    expect(url).toContain('employee_ids=e1');
    expect(url).toContain('date_from=2026-05-01');
    expect(url).toContain('date_to=2026-08-31');
  });
});
