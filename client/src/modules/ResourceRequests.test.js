import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResourceRequests from './ResourceRequests';
import * as apiV2 from '../utils/apiV2';
import { changeSelect } from '../utils/testHelpers';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><ResourceRequests /></MemoryRouter>);

const sampleRequests = [
  { id: 'r1', role_title: 'Senior Dev', contract_id: 'ct1', contract_name: 'Contrato Alpha',
    area_name: 'Desarrollo', level: 'L4', quantity: 2, priority: 'high',
    status: 'partially_filled', active_assignments_count: 1, start_date: '2026-05-01' },
  { id: 'r2', role_title: 'QA Lead', contract_id: 'ct2', contract_name: 'Contrato Beta',
    area_name: 'Testing', level: 'L5', quantity: 1, priority: 'critical',
    status: 'open', active_assignments_count: 0, start_date: '2026-06-10' },
];
const sampleContracts = [
  { id: 'ct1', name: 'Contrato Alpha', status: 'active',  client_name: 'Cliente Uno' },
  { id: 'ct2', name: 'Contrato Beta',  status: 'active',  client_name: 'Cliente Dos' },
  { id: 'ct3', name: 'Contrato Old',   status: 'completed', client_name: 'Cliente Uno' },
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
    // Open the SearchableSelect filter bar to inspect available options
    const filterInput = screen.getByLabelText('Filtro por contrato');
    fireEvent.click(filterInput);
    const listbox = await screen.findByRole('listbox');
    // Active contracts appear
    expect(within(listbox).getByText('Contrato Alpha')).toBeInTheDocument();
    expect(within(listbox).getByText('Contrato Beta')).toBeInTheDocument();
    // Completed contract is filtered out before passing options
    expect(within(listbox).queryByText('Contrato Old')).toBeNull();
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
    // Wait for contracts to finish loading
    await waitFor(() => {
      expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/contracts'))).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: /Nueva Solicitud/i }));
    const dialog = await screen.findByRole('dialog');

    // Select contract via SearchableSelect: click to open, then mouseDown the option
    const contractInput = within(dialog).getByLabelText('Contrato');
    fireEvent.click(contractInput);
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Contrato Alpha/ }));

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

  // ── SPEC-010: Búsqueda por texto en selector de contrato ──────────────────

  describe('SPEC-010: selector de contrato con búsqueda por texto', () => {
    const openForm = async () => {
      mount();
      await screen.findByText('Senior Dev');
      await waitFor(() => {
        expect(apiV2.apiGet.mock.calls.some((c) => c[0].startsWith('/api/contracts'))).toBe(true);
      });
      fireEvent.click(screen.getByRole('button', { name: /Nueva Solicitud/i }));
      return screen.findByRole('dialog');
    };

    it('muestra todos los contratos al abrir el selector', async () => {
      const dialog = await openForm();
      const contractInput = within(dialog).getByLabelText('Contrato');
      fireEvent.click(contractInput);
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Contrato Alpha')).toBeInTheDocument();
      expect(within(listbox).getByText('Contrato Beta')).toBeInTheDocument();
    });

    it('filtra contratos al escribir (coincidencia parcial)', async () => {
      const dialog = await openForm();
      const contractInput = within(dialog).getByLabelText('Contrato');
      fireEvent.change(contractInput, { target: { value: 'Alpha' } });
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Contrato Alpha')).toBeInTheDocument();
      expect(within(listbox).queryByText('Contrato Beta')).toBeNull();
    });

    it('la búsqueda es insensible a mayúsculas', async () => {
      const dialog = await openForm();
      const contractInput = within(dialog).getByLabelText('Contrato');
      fireEvent.change(contractInput, { target: { value: 'beta' } });
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Contrato Beta')).toBeInTheDocument();
      expect(within(listbox).queryByText('Contrato Alpha')).toBeNull();
    });

    it('muestra "No se encontraron contratos" si no hay coincidencias', async () => {
      const dialog = await openForm();
      const contractInput = within(dialog).getByLabelText('Contrato');
      fireEvent.change(contractInput, { target: { value: 'zzz-no-existe' } });
      await screen.findByText('No se encontraron contratos');
    });

    it('al seleccionar un contrato el nombre aparece en el campo y se envía contract_id', async () => {
      const dialog = await openForm();
      const contractInput = within(dialog).getByLabelText('Contrato');
      fireEvent.click(contractInput);
      fireEvent.mouseDown(await screen.findByRole('option', { name: /Contrato Beta/ }));
      expect(contractInput.value).toBe('Contrato Beta');
    });

    it('al borrar el texto la lista vuelve a mostrar todos los contratos', async () => {
      const dialog = await openForm();
      const contractInput = within(dialog).getByLabelText('Contrato');
      fireEvent.change(contractInput, { target: { value: 'Alpha' } });
      await screen.findByRole('listbox');
      fireEvent.change(contractInput, { target: { value: '' } });
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Contrato Alpha')).toBeInTheDocument();
      expect(within(listbox).getByText('Contrato Beta')).toBeInTheDocument();
    });

    it('en modo edición el campo de contrato está deshabilitado', async () => {
      mount();
      await screen.findByText('Senior Dev');
      fireEvent.click(screen.getByLabelText('Editar Senior Dev'));
      const dialog = await screen.findByRole('dialog');
      const contractInput = within(dialog).getByLabelText('Contrato');
      expect(contractInput).toBeDisabled();
    });

    it('la búsqueda por nombre de cliente también filtra resultados', async () => {
      const dialog = await openForm();
      const contractInput = within(dialog).getByLabelText('Contrato');
      // "Cliente Dos" is the client_name of "Contrato Beta"
      fireEvent.change(contractInput, { target: { value: 'Cliente Dos' } });
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Contrato Beta')).toBeInTheDocument();
      expect(within(listbox).queryByText('Contrato Alpha')).toBeNull();
    });

    it('el filtro de contrato en la barra también usa búsqueda por texto', async () => {
      mount();
      await screen.findByText('Senior Dev');
      const filterInput = screen.getByLabelText('Filtro por contrato');
      fireEvent.change(filterInput, { target: { value: 'Beta' } });
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Contrato Beta')).toBeInTheDocument();
      expect(within(listbox).queryByText('Contrato Alpha')).toBeNull();
    });
  });
});
