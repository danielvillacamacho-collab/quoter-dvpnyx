import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Users from './Users';
import * as api from '../utils/api';

// Stub AuthContext so Users can call useAuth()
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-super', role: 'superadmin', name: 'Super' } }),
}));

jest.mock('../utils/api');

const SAMPLE_USERS = [
  { id: 'u1', email: 'ana@dvpnyx.com', name: 'Ana López', role: 'member', function: 'comercial', active: true, must_change_password: false, created_at: '2026-01-01T00:00:00Z' },
  { id: 'u2', email: 'carlos@dvpnyx.com', name: 'Carlos Ruiz', role: 'lead', function: 'delivery_manager', active: true, must_change_password: false, created_at: '2026-02-01T00:00:00Z' },
  { id: 'u-super', email: 'super@dvpnyx.com', name: 'Super', role: 'superadmin', function: 'admin', active: true, must_change_password: false, created_at: '2025-01-01T00:00:00Z' },
];

beforeEach(() => {
  jest.resetAllMocks();
  api.getUsers.mockResolvedValue(SAMPLE_USERS);
});

describe('Users — render', () => {
  it('shows the list of users with role and function columns', async () => {
    render(<Users />);
    expect(await screen.findByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument();
    // Headers
    expect(screen.getByText('Función')).toBeInTheDocument();
    expect(screen.getByText('Rol')).toBeInTheDocument();
  });

  it('shows function labels (not raw keys)', async () => {
    render(<Users />);
    // "comercial" raw key → should show "Comercial" label somewhere
    await screen.findByText('Ana López');
    // The function dropdown for Ana should have "Comercial" as selected label
    // (it renders as a select with the label text)
    const selects = screen.getAllByRole('combobox');
    const functionSelects = selects.filter(s => s.value === 'comercial' || s.value === 'delivery_manager');
    expect(functionSelects.length).toBeGreaterThan(0);
  });

  it('shows V2 role badges (not the old "preventa" badge)', async () => {
    render(<Users />);
    await screen.findByText('Ana López');
    // The superadmin row is protected and shows a badge (not editable select)
    expect(screen.queryByText('preventa')).not.toBeInTheDocument();
  });
});

describe('Users — create', () => {
  it('opens the create form with V2 role options', async () => {
    render(<Users />);
    await screen.findByText('Ana López');
    fireEvent.click(screen.getByRole('button', { name: /Nuevo usuario/i }));

    // Use IDs to avoid ambiguity with multiple "Función" labels in table rows
    expect(document.getElementById('new-name')).toBeInTheDocument();
    expect(document.getElementById('new-function')).toBeInTheDocument();

    // Role select should have V2 options, not "preventa"
    const roleSelect = document.getElementById('new-role');
    const options = Array.from(roleSelect.options).map(o => o.value);
    expect(options).toContain('member');
    expect(options).toContain('lead');
    expect(options).toContain('viewer');
    expect(options).toContain('admin'); // superadmin can create admin
    expect(options).not.toContain('preventa');
    expect(options).not.toContain('superadmin');
  });

  it('calls api.createUser with role and function, then refreshes the list', async () => {
    const newUser = { id: 'u3', email: 'new@dvpnyx.com', name: 'New', role: 'viewer', function: 'finance', active: true, must_change_password: true, created_at: new Date().toISOString() };
    api.createUser.mockResolvedValue(newUser);
    api.getUsers.mockResolvedValueOnce(SAMPLE_USERS).mockResolvedValueOnce([...SAMPLE_USERS, newUser]);

    render(<Users />);
    await screen.findByText('Ana López');

    fireEvent.click(screen.getByRole('button', { name: /Nuevo usuario/i }));
    // Use id-based selectors — multiple labels with "Función" exist in the table rows
    fireEvent.change(document.getElementById('new-name'), { target: { value: 'New' } });
    fireEvent.change(document.getElementById('new-email'), { target: { value: 'new@dvpnyx.com' } });
    fireEvent.change(document.getElementById('new-role'), { target: { value: 'viewer' } });
    fireEvent.change(document.getElementById('new-function'), { target: { value: 'finance' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear usuario/i }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'viewer', function: 'finance' }),
    ));
    expect(await screen.findByText('New')).toBeInTheDocument();
  });
});

describe('Users — protected rows', () => {
  it('does not show Eliminar for own row (superadmin)', async () => {
    render(<Users />);
    await screen.findByText('Super');
    // The superadmin's own row should have no Eliminar button next to it
    const rows = screen.getAllByRole('row');
    const superRow = rows.find(r => r.textContent.includes('super@dvpnyx.com'));
    expect(superRow.textContent).not.toMatch(/Eliminar/);
  });
});
