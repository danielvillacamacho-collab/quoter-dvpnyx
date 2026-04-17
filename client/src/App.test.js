import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import * as api from './utils/api';

jest.mock('./utils/api');

/* ===== fixtures ===== */
const mockUser = {
  id: 'u1', name: 'Test User', email: 'test@dvpnyx.com',
  role: 'preventa', must_change_password: false,
};
const mockAdmin = { ...mockUser, role: 'admin' };
const mockParams = {
  level: [{ id: 1, key: 'L5', value: 4000, label: 'Nivel 5', sort_order: 5 }],
  geo: [{ id: 2, key: 'Colombia', value: 1.0, label: 'Colombia', sort_order: 1 }],
  bilingual: [{ id: 3, key: 'No', value: 1.0, label: 'No bilingüe', sort_order: 1 }],
  stack: [{ id: 4, key: 'Especializada', value: 1.0, label: 'Stack Esp.', sort_order: 1 }],
  tools: [{ id: 5, key: 'Básico', value: 0, label: 'Sin extras', sort_order: 1 }],
  modality: [{ id: 6, key: 'Remoto', value: 0.95, label: 'Remoto', sort_order: 1 }],
  margin: [{ id: 7, key: 'talent', value: 0.35, label: 'Margen talento', sort_order: 1 }],
  project: [{ id: 8, key: 'hours_month', value: 160, label: 'Horas mes', sort_order: 1 }],
};

/* ===== LOGIN ===== */
describe('Login', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.resetAllMocks();
  });

  it('renders login form fields and brand', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('correo@dvpnyx.com')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ingresar/i })).toBeInTheDocument();
    expect(screen.getByText('DVPNYX')).toBeInTheDocument();
  });

  it('shows error message on failed login', async () => {
    api.login.mockRejectedValue(new Error('Credenciales inválidas'));
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText('correo@dvpnyx.com'));

    fireEvent.change(screen.getByPlaceholderText('correo@dvpnyx.com'), { target: { value: 'bad@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(screen.getByText('Credenciales inválidas')).toBeInTheDocument());
  });

  it('redirects to dashboard after successful login', async () => {
    api.login.mockResolvedValue({ token: 'tok123', user: mockUser });
    api.getParams.mockResolvedValue(mockParams);
    api.getQuotations.mockResolvedValue([]);
    render(<App />);

    await waitFor(() => screen.getByPlaceholderText('correo@dvpnyx.com'));
    fireEvent.change(screen.getByPlaceholderText('correo@dvpnyx.com'), { target: { value: 'test@dvpnyx.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pass1234' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(screen.getByText('Cotizaciones')).toBeInTheDocument());
  });

  it('shows change-password form when must_change_password is true', async () => {
    api.login.mockResolvedValue({ token: 'tok', user: { ...mockUser, must_change_password: true } });
    api.getParams.mockResolvedValue(mockParams);
    render(<App />);

    await waitFor(() => screen.getByPlaceholderText('correo@dvpnyx.com'));
    fireEvent.change(screen.getByPlaceholderText('correo@dvpnyx.com'), { target: { value: 'test@dvpnyx.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(screen.getByText('Debe cambiar su contraseña')).toBeInTheDocument());
  });
});

/* ===== DASHBOARD ===== */
describe('Dashboard', () => {
  beforeEach(() => {
    localStorage.setItem('dvpnyx_token', 'valid-token');
    jest.resetAllMocks();
    api.getMe.mockResolvedValue(mockUser);
    api.getParams.mockResolvedValue(mockParams);
  });

  it('shows 4 metric cards', async () => {
    api.getQuotations.mockResolvedValue([]);
    render(<App />);
    await waitFor(() => expect(screen.getByText('Total')).toBeInTheDocument());
    expect(screen.getByText('Borradores')).toBeInTheDocument();
    expect(screen.getByText('Enviadas')).toBeInTheDocument();
    expect(screen.getByText('Aprobadas')).toBeInTheDocument();
  });

  it('shows empty state when no quotations', async () => {
    api.getQuotations.mockResolvedValue([]);
    render(<App />);
    await waitFor(() => expect(screen.getByText('No hay cotizaciones aún')).toBeInTheDocument());
  });

  it('renders quotation row in table', async () => {
    api.getQuotations.mockResolvedValue([{
      id: 'q1', project_name: 'Proyecto Alpha', client_name: 'Acme SA',
      type: 'staff_aug', status: 'draft', line_count: 2,
      created_at: '2026-01-15T00:00:00Z',
    }]);
    render(<App />);
    await waitFor(() => expect(screen.getByText('Proyecto Alpha')).toBeInTheDocument());
    expect(screen.getByText('Acme SA')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /duplicar/i })).toBeInTheDocument();
  });

  it('shows admin nav links for admin role', async () => {
    api.getMe.mockResolvedValue(mockAdmin);
    api.getQuotations.mockResolvedValue([]);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Parámetros/)).toBeInTheDocument());
    expect(screen.getByText(/Usuarios/)).toBeInTheDocument();
  });

  it('hides admin nav links for preventa role', async () => {
    api.getQuotations.mockResolvedValue([]);
    render(<App />);
    await waitFor(() => expect(screen.getByText('Cotizaciones')).toBeInTheDocument());
    expect(screen.queryByText(/⚙️/)).toBeNull();
    expect(screen.queryByText(/👤 Usuarios/)).toBeNull();
  });

  it('counts metrics correctly', async () => {
    api.getQuotations.mockResolvedValue([
      { id: '1', project_name: 'P1', client_name: 'C1', type: 'staff_aug', status: 'draft', line_count: 1, created_at: '2026-01-01T00:00:00Z' },
      { id: '2', project_name: 'P2', client_name: 'C2', type: 'staff_aug', status: 'sent', line_count: 2, created_at: '2026-01-01T00:00:00Z' },
      { id: '3', project_name: 'P3', client_name: 'C3', type: 'staff_aug', status: 'approved', line_count: 3, created_at: '2026-01-01T00:00:00Z' },
    ]);
    render(<App />);
    // Wait until Total metric shows 3 (proves api.getQuotations resolved and state updated)
    await waitFor(() => {
      const totalLabel = screen.getByText('Total');
      expect(totalLabel.previousElementSibling).toHaveTextContent('3');
    });
    // Verify per-status counts via DOM traversal (label → previous sibling = value)
    expect(screen.getByText('Borradores').previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Enviadas').previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Aprobadas').previousElementSibling).toHaveTextContent('1');
  });
});

/* ===== LAYOUT – hamburger sidebar ===== */
describe('Layout — hamburger sidebar', () => {
  beforeEach(() => {
    localStorage.setItem('dvpnyx_token', 'valid-token');
    jest.resetAllMocks();
    api.getMe.mockResolvedValue(mockUser);
    api.getParams.mockResolvedValue(mockParams);
    api.getQuotations.mockResolvedValue([]);
  });

  it('renders hamburger button', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Menú')).toBeInTheDocument());
  });

  it('sidebar starts closed, opens on hamburger click', async () => {
    render(<App />);
    await waitFor(() => screen.getByLabelText('Menú'));

    const sidebar = document.querySelector('.sidebar');
    expect(sidebar).not.toHaveClass('open');

    fireEvent.click(screen.getByLabelText('Menú'));
    expect(sidebar).toHaveClass('open');
  });

  it('closes sidebar on second hamburger click', async () => {
    render(<App />);
    await waitFor(() => screen.getByLabelText('Menú'));

    fireEvent.click(screen.getByLabelText('Menú'));
    fireEvent.click(screen.getByLabelText('Menú'));

    expect(document.querySelector('.sidebar')).not.toHaveClass('open');
  });

  it('closes sidebar when overlay is clicked', async () => {
    render(<App />);
    await waitFor(() => screen.getByLabelText('Menú'));

    fireEvent.click(screen.getByLabelText('Menú'));
    const overlay = document.querySelector('.sidebar-overlay');
    expect(overlay).toHaveClass('open');

    fireEvent.click(overlay);
    expect(overlay).not.toHaveClass('open');
    expect(document.querySelector('.sidebar')).not.toHaveClass('open');
  });

  it('closes sidebar when a nav link is clicked', async () => {
    render(<App />);
    await waitFor(() => screen.getByLabelText('Menú'));

    fireEvent.click(screen.getByLabelText('Menú'));
    expect(document.querySelector('.sidebar')).toHaveClass('open');

    fireEvent.click(screen.getByText('📊 Dashboard'));
    expect(document.querySelector('.sidebar')).not.toHaveClass('open');
  });
});

/* ===== PROJECT EDITOR (fixed_scope stepper) ===== */
describe('ProjectEditor — fixed_scope stepper', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dvpnyx_token', 'valid-token');
    jest.resetAllMocks();
    api.getMe.mockResolvedValue(mockUser);
    api.getParams.mockResolvedValue(mockParams);
    api.getQuotations.mockResolvedValue([]);
    window.history.pushState({}, '', '/quotation/new/fixed_scope');
  });

  afterEach(() => { window.history.pushState({}, '', '/'); });

  it('renders 6-step stepper when type=fixed_scope', async () => {
    render(<App />);
    // Use the unique Step-1 heading to confirm the project editor mounted
    await waitFor(() => expect(screen.getByText(/📝 Datos del Proyecto/)).toBeInTheDocument());
    // stepper nav contains all 6 step labels (multiple "Proyecto" matches expected)
    expect(screen.getAllByText(/Proyecto/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Equipo/)).toBeInTheDocument();
    expect(screen.getByText(/Fases/)).toBeInTheDocument();
    expect(screen.getByText(/Asignación/)).toBeInTheDocument();
    expect(screen.getByText(/Épicas/)).toBeInTheDocument();
    expect(screen.getByText(/Resumen/)).toBeInTheDocument();
  });

  it('starts on Step 1 with project data form', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/📝 Datos del Proyecto/));
    expect(screen.getByPlaceholderText(/Plataforma de analítica/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Acme SA/i)).toBeInTheDocument();
  });

  it('disables Next button until project name and client are filled', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/📝 Datos del Proyecto/));
    const next = screen.getByRole('button', { name: /Siguiente paso/i });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Plataforma de analítica/i), { target: { value: 'Proyecto Alpha' } });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Acme SA/i), { target: { value: 'Acme' } });
    expect(next).toBeEnabled();
  });

  it('navigates to Step 2 (Team) once name and client are provided', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/📝 Datos del Proyecto/));
    fireEvent.change(screen.getByPlaceholderText(/Plataforma de analítica/i), { target: { value: 'Proyecto Alpha' } });
    fireEvent.change(screen.getByPlaceholderText(/Acme SA/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente paso/i }));
    await waitFor(() => expect(screen.getByText(/Composición del Equipo/i)).toBeInTheDocument());
  });

  it('"Guardar borrador" in header calls createQuotation with type=fixed_scope', async () => {
    api.createQuotation.mockResolvedValue({ id: 'new-q-1' });
    api.getQuotation.mockResolvedValue({ id: 'new-q-1', type: 'fixed_scope', project_name: 'Draft P', client_name: 'Acme', lines: [], phases: [], epics: [], milestones: [], metadata: {} });
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    render(<App />);
    await waitFor(() => screen.getByText(/📝 Datos del Proyecto/));
    fireEvent.change(screen.getByPlaceholderText(/Plataforma de analítica/i), { target: { value: 'Draft P' } });
    fireEvent.change(screen.getByPlaceholderText(/Acme SA/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar borrador/i }));
    await waitFor(() => expect(api.createQuotation).toHaveBeenCalled());
    const payload = api.createQuotation.mock.calls[0][0];
    expect(payload.type).toBe('fixed_scope');
    expect(payload.project_name).toBe('Draft P');
    expect(payload.phases.length).toBe(5);
    alertSpy.mockRestore();
  });

  it('back button returns to previous step', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/📝 Datos del Proyecto/));
    fireEvent.change(screen.getByPlaceholderText(/Plataforma de analítica/i), { target: { value: 'P' } });
    fireEvent.change(screen.getByPlaceholderText(/Acme SA/i), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente paso/i }));
    await waitFor(() => screen.getByText(/Composición del Equipo/i));
    fireEvent.click(screen.getByRole('button', { name: /Anterior/i }));
    await waitFor(() => expect(screen.getByText(/📝 Datos del Proyecto/i)).toBeInTheDocument());
  });
});

/* ===== Dashboard — US-9.1 badge ===== */
describe('Dashboard — fixed_scope badge says "Proyecto"', () => {
  beforeEach(() => {
    localStorage.setItem('dvpnyx_token', 'valid-token');
    jest.resetAllMocks();
    api.getMe.mockResolvedValue(mockUser);
    api.getParams.mockResolvedValue(mockParams);
    window.history.pushState({}, '', '/');
  });

  it('shows "Proyecto" (not "Alcance Fijo") for fixed_scope rows', async () => {
    api.getQuotations.mockResolvedValue([{
      id: 'qp', project_name: 'Plataforma X', client_name: 'Cliente Y',
      type: 'fixed_scope', status: 'draft', line_count: 3,
      created_at: '2026-02-10T00:00:00Z',
    }]);
    render(<App />);
    await waitFor(() => expect(screen.getByText('Plataforma X')).toBeInTheDocument());
    // Match the badge span specifically (the table header also says "Proyecto")
    expect(screen.getByText('Proyecto', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Alcance Fijo')).toBeNull();
  });
});
