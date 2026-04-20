import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Skills from './Skills';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><Skills /></MemoryRouter>);

const sample = [
  { id: 1, name: 'JavaScript', category: 'language',  active: true, employees_count: 5 },
  { id: 2, name: 'React',      category: 'framework', active: true, employees_count: 3 },
  { id: 9, name: 'Flash',      category: 'framework', active: false, employees_count: 0 },
];

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockResolvedValue({ data: sample });
});

describe('Skills module', () => {
  it('renders header and "+ Nuevo Skill" button', async () => {
    mount();
    expect(await screen.findByText(/🏷 Skills/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo Skill/i })).toBeInTheDocument();
  });

  it('loads skills on mount and renders rows', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    expect(await screen.findByText('JavaScript')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Flash')).toBeInTheDocument();
  });

  it('filter by search refetches with search param', async () => {
    mount();
    await screen.findByText('JavaScript');
    apiV2.apiGet.mockClear();
    fireEvent.change(screen.getByLabelText('Buscar skills'), { target: { value: 'react' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('search=react'))).toBe(true);
    });
  });

  it('filter by category refetches with category param', async () => {
    mount();
    await screen.findByText('JavaScript');
    apiV2.apiGet.mockClear();
    fireEvent.change(screen.getByLabelText('Filtro por categoría'), { target: { value: 'language' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('category=language'))).toBe(true);
    });
  });

  it('creates a skill via POST', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 100 });
    mount();
    await screen.findByText('JavaScript');
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Skill/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Rust' } });
    fireEvent.change(within(dialog).getByLabelText('Categoría'), { target: { value: 'language' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/skills',
        expect.objectContaining({ name: 'Rust', category: 'language' })
      );
    });
  });

  it('shows validation error when name is missing', async () => {
    mount();
    await screen.findByText('JavaScript');
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Skill/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(within(dialog).getByRole('button', { name: /^Guardar/i }).closest('form'));
    await waitFor(() => expect(within(dialog).getByText(/Nombre es requerido/i)).toBeInTheDocument());
  });

  it('opens edit modal with prefilled values', async () => {
    mount();
    await screen.findByText('JavaScript');
    fireEvent.click(screen.getByLabelText('Editar JavaScript'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Editar skill')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('JavaScript')).toBeInTheDocument();
  });

  it('calls /deactivate on an active skill', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 1, active: false });
    mount();
    await screen.findByText('JavaScript');
    fireEvent.click(screen.getByLabelText('Desactivar JavaScript'));
    await waitFor(() => expect(apiV2.apiPost).toHaveBeenCalledWith('/api/skills/1/deactivate', {}));
  });

  it('shows alert when server refuses deactivation (skill in use)', async () => {
    apiV2.apiPost.mockRejectedValue(new Error('Este skill está asignado a 5 empleado(s). Remuévelo primero.'));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    mount();
    await screen.findByText('JavaScript');
    fireEvent.click(screen.getByLabelText('Desactivar JavaScript'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/5 empleado/)));
    alertSpy.mockRestore();
  });
});
