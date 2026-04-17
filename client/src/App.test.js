import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as api from './utils/api';

jest.mock('./utils/api');

/* ===== helpers ===== */
const mockUser = { id: '1', name: 'Test User', email: 'test@dvpnyx.com', role: 'preventa', must_change_password: false };
const mockAdmin = { ...mockUser, role: 'admin' };
const mockParams = {
  level: [{ id: 1, key: 'L5', value: 4000, label: 'Nivel 5', sort_order: 5 }],
  geo: [{ id: 2, key: 'Colombia', value: 1.0, label: 'Colombia', sort_order: 1 }],
  bilingual: [{ id: 3, key: 'No', value: 1.0, label: 'No bilingüe', sort_order: 1 }],
  stack: [{ id: 4, key: 'Especializada', value: 1.0, label: 'Stack Especializada', sort_order: 1 }],
  tools: [{ id: 5, key: 'Básico', value: 0, label: 'Sin herramientas extra', sort_order: 1 }],
  modality: [{ id: 6, key: 'Remoto', value: 0.95, label: 'Remoto', sort_order: 1 }],
  margin: [{ id: 7, key: 'talent', value: 0.35, label: 'Margen talento', sort_order: 1 }],
  project: [{ id: 8, key: 'hours_month', value: 160, label: 'Horas mes', sort_order: 1 }],
};

/* ===== LOGIN ===== */
describe('Login', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    api.getMe.mockRejectedValue(new Error('no token'));
  });

  const renderLogin = () => {
    const App = require('./App').default;
    return render(<App />);
  };

  it('renders login form', async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByPlaceholderText('correo@dvpnyx.com')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ingresar/i })).toBeInTheDocument();
  });

  it('shows DVPNYX brand', async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText('DVPNYX')).toBeInTheDocument());
    expect(screen.getByText('Cotizador de Servicios')).toBeInTheDocument();
  });

  it('shows error on failed login', async () => {
    api.login.mockRejectedValue(new Error('Credenciales inválidas'));
    renderLogin();
    await waitFor(() => screen.getByPlaceholderText('correo@dvpnyx.com'));

    fireEvent.change(screen.getByPlaceholderText('correo@dvpnyx.com'), { target: { value: 'wrong@dvpnyx.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'badpass' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(screen.getByText('Credenciales inválidas')).toBeInTheDocument());
  });

  it('redirects to dashboard on successful login', async () => {
    api.login.mockResolvedValue({ token: 'tok123', user: mockUser });
    api.getMe.mockResolvedValue(mockUser);
    api.getParams.mockResolvedValue(mockParams);
    api.getQuotations.mockResolvedValue([]);
    renderLogin();

    await waitFor(() => screen.getByPlaceholderText('correo@dvpnyx.com'));
    fireEvent.change(screen.getByPlaceholderText('correo@dvpnyx.com'), { target: { value: 'test@dvpnyx.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(screen.getByText('Cotizaciones')).toBeInTheDocument());
  });

  it('shows change password form on must_change_password', async () => {
    api.login.mockResolvedValue({ token: 'tok', user: { ...mockUser, must_change_password: true } });
    api.getMe.mockResolvedValue({ ...mockUser, must_change_password: true });
    api.getParams.mockResolvedValue(mockParams);
    renderLogin();

    await waitFor(() => screen.getByPlaceholderText('correo@dvpnyx.com'));
    fireEvent.change(screen.getByPlaceholderText('correo@dvpnyx.com'), { target: { value: 'test@dvpnyx.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(screen.getByText('Debe cambiar su contraseña')).toBeInTheDocument());
  });
});

/* ===== DASHBOARD ===== */
describe('Dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem('dvpnyx_token', 'valid-token');
    api.getMe.mockResolvedValue(mockUser);
    api.getParams.mockResolvedValue(mockParams);
  });

  const renderDashboard = () => {
    const App = require('./App').default;
    return render(<App />);
  };

  it('shows empty state when no quotations', async () => {
    api.getQuotations.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => expect(screen.getByText('No hay cotizaciones aún')).toBeInTheDocument());
  });

  it('shows metrics cards', async () => {
    api.getQuotations.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Total')).toBeInTheDocument();
      expect(screen.getByText('Borradores')).toBeInTheDocument();
      expect(screen.getByText('Enviadas')).toBeInTheDocument();
      expect(screen.getByText('Aprobadas')).toBeInTheDocument();
    });
  });

  it('shows quotation list when data exists', async () => {
    api.getQuotations.mockResolvedValue([{
      id: 'q1', project_name: 'Proyecto Alpha', client_name: 'Cliente SA',
      type: 'staff_aug', status: 'draft', line_count: 3,
      created_at: '2026-01-15T00:00:00Z',
    }]);
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Proyecto Alpha')).toBeInTheDocument());
    expect(screen.getByText('Cliente SA')).toBeInTheDocument();
  });

  it('shows admin nav items for admin users', async () => {
    api.getMe.mockResolvedValue(mockAdmin);
    api.getQuotations.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/Parámetros/)).toBeInTheDocument());
    expect(screen.getByText(/Usuarios/)).toBeInTheDocument();
  });

  it('hides admin nav items for preventa users', async () => {
    api.getQuotations.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Cotizaciones')).toBeInTheDocument());
    expect(screen.queryByText(/Parámetros/)).toBeNull();
  });

  it('shows hamburger button', async () => {
    api.getQuotations.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => expect(screen.getByLabelText('Menú')).toBeInTheDocument());
  });
});

/* ===== LAYOUT - Hamburger sidebar ===== */
describe('Layout hamburger menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem('dvpnyx_token', 'valid-token');
    api.getMe.mockResolvedValue(mockUser);
    api.getParams.mockResolvedValue(mockParams);
    api.getQuotations.mockResolvedValue([]);
  });

  it('toggles sidebar open/close on hamburger click', async () => {
    const App = require('./App').default;
    render(<App />);
    await waitFor(() => screen.getByLabelText('Menú'));

    const sidebar = document.querySelector('.sidebar');
    const hamburger = screen.getByLabelText('Menú');

    expect(sidebar).not.toHaveClass('open');
    fireEvent.click(hamburger);
    expect(sidebar).toHaveClass('open');
    fireEvent.click(hamburger);
    expect(sidebar).not.toHaveClass('open');
  });

  it('closes sidebar when overlay is clicked', async () => {
    const App = require('./App').default;
    render(<App />);
    await waitFor(() => screen.getByLabelText('Menú'));

    fireEvent.click(screen.getByLabelText('Menú'));
    const overlay = document.querySelector('.sidebar-overlay');
    expect(overlay).toHaveClass('open');

    fireEvent.click(overlay);
    expect(overlay).not.toHaveClass('open');
  });
});
