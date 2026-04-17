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
    await waitFor(() => screen.getByText('Cotizaciones'));
    const metricValues = document.querySelectorAll('[style*="Montserrat"]');
    const values = Array.from(metricValues).map(el => el.textContent);
    expect(values).toContain('3'); // Total
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
