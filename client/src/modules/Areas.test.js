import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Areas from './Areas';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><Areas /></MemoryRouter>);

const sampleAreas = [
  { id: 1, key: 'development', name: 'Desarrollo', description: 'Equipo de código', sort_order: 1, active: true, active_employees_count: 5 },
  { id: 2, key: 'testing',     name: 'Testing',    description: null,               sort_order: 2, active: true, active_employees_count: 0 },
  { id: 9, key: 'legacy',      name: 'Legacy',     description: null,               sort_order: 99, active: false, active_employees_count: 0 },
];

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockResolvedValue({ data: sampleAreas });
});

describe('Areas module', () => {
  it('renders header and "+ Nueva Área" button', async () => {
    mount();
    expect(await screen.findByText(/🧭 Áreas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nueva Área/i })).toBeInTheDocument();
  });

  it('loads areas on mount and renders rows', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalledWith('/api/areas'));
    expect(await screen.findByText('Desarrollo')).toBeInTheDocument();
    expect(screen.getByText('Testing')).toBeInTheDocument();
    expect(screen.getByText('Legacy')).toBeInTheDocument();
  });

  it('shows active employees count per row', async () => {
    mount();
    await screen.findByText('Desarrollo');
    const row = screen.getByText('Desarrollo').closest('tr');
    expect(within(row).getByText('5')).toBeInTheDocument();
  });

  it('shows Inactiva badge for inactive area', async () => {
    mount();
    await screen.findByText('Legacy');
    const row = screen.getByText('Legacy').closest('tr');
    expect(within(row).getByText('Inactiva')).toBeInTheDocument();
  });

  it('opens create modal and submits a new area', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 10 });
    mount();
    await screen.findByText('Desarrollo');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Área/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'new_area' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Nueva' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/areas',
        expect.objectContaining({ key: 'new_area', name: 'Nueva' })
      );
    });
  });

  it('shows validation error when name is missing', async () => {
    mount();
    await screen.findByText('Desarrollo');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Área/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'x' } });
    // no name
    fireEvent.submit(within(dialog).getByRole('button', { name: /^Guardar/i }).closest('form'));
    await waitFor(() => expect(within(dialog).getByText(/Nombre es requerido/i)).toBeInTheDocument());
  });

  it('opens edit modal with prefilled values and disables key field', async () => {
    mount();
    await screen.findByText('Desarrollo');
    fireEvent.click(screen.getByLabelText('Editar Desarrollo'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Editar área')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Desarrollo')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Key')).toBeDisabled();
  });

  it('calls /deactivate when toggling an active area', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 1, active: false });
    mount();
    await screen.findByText('Desarrollo');
    fireEvent.click(screen.getByLabelText('Desactivar Desarrollo'));
    await waitFor(() => expect(apiV2.apiPost).toHaveBeenCalledWith('/api/areas/1/deactivate', {}));
  });

  it('calls /activate when toggling an inactive area', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 9, active: true });
    mount();
    await screen.findByText('Legacy');
    fireEvent.click(screen.getByLabelText('Activar Legacy'));
    await waitFor(() => expect(apiV2.apiPost).toHaveBeenCalledWith('/api/areas/9/activate', {}));
  });

  it('surfaces server error (e.g. 409 when employees still active) via alert', async () => {
    apiV2.apiPost.mockRejectedValue(new Error('Este área tiene 3 empleado(s) activo(s).'));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    mount();
    await screen.findByText('Desarrollo');
    fireEvent.click(screen.getByLabelText('Desactivar Desarrollo'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/3 empleado/)));
    alertSpy.mockRestore();
  });
});
