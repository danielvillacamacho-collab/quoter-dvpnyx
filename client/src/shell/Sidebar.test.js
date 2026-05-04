import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar, { buildGroups } from './Sidebar';

const baseUser = { name: 'Mariana Vega', email: 'mariana@dvpnyx.com', role: 'admin' };

const mount = (props = {}) =>
  render(
    <MemoryRouter initialEntries={[props.initial || '/clients']}>
      <Sidebar user={baseUser} isAdmin={true} open={true} onNavigate={() => {}} onLogout={() => {}} {...props} />
    </MemoryRouter>,
  );

describe('Sidebar', () => {
  it('renders brand header with version', () => {
    mount();
    expect(screen.getByText('DVPNYX')).toBeInTheDocument();
    expect(screen.getByText('v2.0')).toBeInTheDocument();
  });

  it('renders all section labels for an admin user', () => {
    mount();
    const sectionLabels = document.querySelectorAll('.ds-sb-section-label');
    const labels = Array.from(sectionLabels).map((el) => el.textContent);
    ['Comercial', 'Delivery', 'Gente', 'Time Tracking', 'Iniciativas internas', 'Finanzas', 'Reportes', 'Configuración'].forEach((label) => {
      expect(labels).toContain(label);
    });
  });

  it('hides admin-only sections for non-admin users', () => {
    mount({ isAdmin: false });
    expect(screen.queryByText('Configuración')).toBeNull();
    expect(screen.queryByRole('link', { name: /^Áreas$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Skills$/ })).toBeNull();
    // Non-admin still sees core sections.
    expect(screen.getByRole('link', { name: /^Empleados$/ })).toBeInTheDocument();
  });

  it('marks the current route as active via NavLink', () => {
    mount({ initial: '/clients' });
    const link = screen.getByRole('link', { name: /^Clientes$/ });
    expect(link.className).toMatch(/\bactive\b/);
  });

  it('does NOT treat non-root routes as matching "/" (Dashboard)', () => {
    // NavLink `end` prop on Dashboard — when we're under /clients, the
    // Dashboard link should NOT also get `.active`, otherwise every page
    // would light up the Dashboard row.
    mount({ initial: '/clients' });
    const dashboard = screen.getByRole('link', { name: /^Dashboard$/ });
    expect(dashboard.className).not.toMatch(/\bactive\b/);
  });

  it('calls onNavigate when any nav link is clicked (mobile close)', () => {
    const onNavigate = jest.fn();
    mount({ onNavigate });
    fireEvent.click(screen.getByRole('link', { name: /^Oportunidades$/ }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('renders the user footer and fires onLogout', () => {
    const onLogout = jest.fn();
    mount({ onLogout });
    expect(screen.getByText('Mariana Vega')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Cerrar sesión'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('applies `open` class on the outer <aside> (used by mobile overlay)', () => {
    const { container } = mount({ open: true });
    expect(container.querySelector('.sidebar')).toHaveClass('open');
  });

  it('omits the `open` class when closed', () => {
    const { container } = mount({ open: false });
    expect(container.querySelector('.sidebar')).not.toHaveClass('open');
  });

  it('buildGroups returns 9 groups for admins and 8 for non-admins (+ Iniciativas internas group from SPEC-II-00)', () => {
    // Sanity on the pure model helper so it stays useful for consumers
    // (Command Palette quick actions list, for example).
    expect(buildGroups(true).length).toBe(10);
    expect(buildGroups(false).length).toBe(9);
  });
});
