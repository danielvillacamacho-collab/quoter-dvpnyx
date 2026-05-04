import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  beforeEach(() => { localStorage.clear(); });

  it('renders brand header with version', () => {
    mount();
    expect(screen.getByText('DVPNYX')).toBeInTheDocument();
    expect(screen.getByText('v2.0')).toBeInTheDocument();
  });

  it('renders all section labels for an admin user', () => {
    mount();
    const sectionHeaders = document.querySelectorAll('.ds-sb-section-label, [aria-expanded]');
    const labels = Array.from(sectionHeaders).map((el) => el.textContent.trim());
    ['Comercial', 'Cotizaciones', 'Delivery', 'Gente', 'Tiempo', 'Operaciones', 'Reportes', 'Configuración'].forEach((label) => {
      expect(labels).toContain(label);
    });
  });

  it('hides admin-only sections for non-admin users', () => {
    mount({ isAdmin: false });
    expect(screen.queryByText('Configuración')).toBeNull();
    expect(screen.queryByRole('link', { name: /^Áreas$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Skills$/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^Empleados$/ })).toBeInTheDocument();
  });

  it('marks the current route as active via NavLink', () => {
    mount({ initial: '/clients' });
    const link = screen.getByRole('link', { name: /^Clientes$/ });
    expect(link.className).toMatch(/\bactive\b/);
  });

  it('does NOT treat non-root routes as matching "/" (Dashboard)', () => {
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

  it('buildGroups returns 10 groups for admins and 9 for non-admins', () => {
    expect(buildGroups(true).length).toBe(10);
    expect(buildGroups(false).length).toBe(9);
  });

  // ── Accordion behavior ──

  it('collapsible sections have aria-expanded buttons', () => {
    mount();
    const buttons = document.querySelectorAll('[aria-expanded]');
    expect(buttons.length).toBeGreaterThanOrEqual(8);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('aria-expanded')).toBe('true');
    });
  });

  it('clicking a section header collapses its items', () => {
    mount();
    const comercialBtn = screen.getByRole('button', { name: /Comercial/i });
    expect(comercialBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: /^Clientes$/ })).toBeInTheDocument();

    fireEvent.click(comercialBtn);
    expect(comercialBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking again re-expands the section', () => {
    mount();
    const btn = screen.getByRole('button', { name: /Delivery/i });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('persists collapsed state to localStorage', () => {
    mount();
    const btn = screen.getByRole('button', { name: /Reportes/i });
    fireEvent.click(btn);
    const stored = JSON.parse(localStorage.getItem('dvpnyx-sidebar-collapsed'));
    expect(stored.reportes).toBe(true);
  });

  it('non-collapsible sections (Dashboard, help) have no toggle button', () => {
    mount();
    expect(screen.queryByRole('button', { name: /Dashboard/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Manual de usuario/i })).toBeNull();
  });
});
