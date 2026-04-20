import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Employees from './Employees';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><Employees /></MemoryRouter>);

const sampleEmployees = [
  {
    id: 'e1', first_name: 'Ana', last_name: 'García',
    corporate_email: 'ana@dvpnyx.com', area_name: 'Desarrollo', area_id: 1,
    level: 'L4', country: 'Colombia', weekly_capacity_hours: 40,
    skills_count: 3, status: 'active', start_date: '2024-01-15',
  },
  {
    id: 'e2', first_name: 'Luis', last_name: 'Pérez',
    area_name: 'QA', area_id: 3, level: 'L2', country: 'México',
    weekly_capacity_hours: 30, skills_count: 1, status: 'on_leave',
    start_date: '2025-06-01',
  },
];

const sampleAreas = [
  { id: 1, name: 'Desarrollo', active: true },
  { id: 3, name: 'QA',         active: true },
  { id: 9, name: 'Deprecated', active: false },
];

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/areas')) return Promise.resolve({ data: sampleAreas });
    if (url.startsWith('/api/employees')) return Promise.resolve({ data: sampleEmployees, pagination: { page: 1, limit: 25, total: 2, pages: 1 } });
    return Promise.resolve({});
  });
});

describe('Employees module', () => {
  it('renders header and "+ Nuevo Empleado" button', async () => {
    mount();
    expect(await screen.findByText(/🧑‍💻 Empleados/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo Empleado/i })).toBeInTheDocument();
  });

  it('loads employees + areas on mount and renders rows', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    expect(await screen.findByText('Ana García')).toBeInTheDocument();
    expect(screen.getByText('Luis Pérez')).toBeInTheDocument();
  });

  it('row shows skills count and status badge', async () => {
    mount();
    await screen.findByText('Ana García');
    const anaRow = screen.getByText('Ana García').closest('tr');
    expect(within(anaRow).getByText('Activo')).toBeInTheDocument();
    expect(within(anaRow).getByText('3')).toBeInTheDocument();
    const luisRow = screen.getByText('Luis Pérez').closest('tr');
    expect(within(luisRow).getByText('De permiso')).toBeInTheDocument();
  });

  it('filter by area refetches with area_id param', async () => {
    mount();
    await screen.findByText('Ana García');
    apiV2.apiGet.mockClear();
    fireEvent.change(screen.getByLabelText('Filtro por área'), { target: { value: '1' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('area_id=1'))).toBe(true);
    });
  });

  it('filter by level refetches with level param', async () => {
    mount();
    await screen.findByText('Ana García');
    apiV2.apiGet.mockClear();
    fireEvent.change(screen.getByLabelText('Filtro por level'), { target: { value: 'L4' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('level=L4'))).toBe(true);
    });
  });

  it('opens create modal and submits a new employee', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'e-new' });
    mount();
    await screen.findByText('Ana García');
    await waitFor(() => {
      expect(screen.getByLabelText('Filtro por área').querySelector('option[value="1"]')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Empleado/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Carolina' } });
    fireEvent.change(within(dialog).getByLabelText('Apellido'), { target: { value: 'Muñoz' } });
    fireEvent.change(within(dialog).getByLabelText('Área'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText('Fecha de inicio'), { target: { value: '2026-04-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/employees',
        expect.objectContaining({
          first_name: 'Carolina', last_name: 'Muñoz',
          area_id: 1, level: 'L3', start_date: '2026-04-01',
        }),
      );
    });
  });

  it('validation error when required fields missing', async () => {
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Empleado/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(within(dialog).getByRole('button', { name: /^Guardar/i }).closest('form'));
    await waitFor(() => expect(within(dialog).getByText(/Nombre es requerido/i)).toBeInTheDocument());
  });

  it('opens edit modal with prefilled values', async () => {
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByLabelText('Editar Ana García'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Editar empleado')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Ana')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('García')).toBeInTheDocument();
  });

  it('deletes with confirmation', async () => {
    apiV2.apiDelete.mockResolvedValue({ message: 'ok' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByLabelText('Eliminar Ana García'));
    await waitFor(() => expect(apiV2.apiDelete).toHaveBeenCalledWith('/api/employees/e1'));
    confirmSpy.mockRestore();
  });

  it('does NOT delete when confirm is cancelled', async () => {
    apiV2.apiDelete.mockResolvedValue({ message: 'ok' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByLabelText('Eliminar Ana García'));
    expect(apiV2.apiDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('surfaces server 409 (active assignments) via alert', async () => {
    apiV2.apiDelete.mockRejectedValue(new Error('Este empleado tiene 2 asignación(es) activa(s). Termínalas antes de eliminar.'));
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    mount();
    await screen.findByText('Ana García');
    fireEvent.click(screen.getByLabelText('Eliminar Ana García'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/asignación/)));
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('renders empty state when no employees match filters', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/areas')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [], pagination: { page: 1, total: 0, pages: 1 } });
    });
    mount();
    await waitFor(() => expect(screen.getByText(/No hay empleados que coincidan/i)).toBeInTheDocument());
  });
});
