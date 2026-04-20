import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Breadcrumb from './Breadcrumb';

const wrap = (path) => (
  <MemoryRouter initialEntries={[path]}>
    <Breadcrumb />
  </MemoryRouter>
);

describe('Breadcrumb', () => {
  it('renders nothing on the root path', () => {
    const { container } = render(wrap('/'));
    expect(container.querySelector('.breadcrumb')).toBeNull();
  });

  it('shows "Inicio › Clientes" on /clients', () => {
    render(wrap('/clients'));
    expect(screen.getByText('Inicio')).toBeInTheDocument();
    expect(screen.getByText('Clientes')).toBeInTheDocument();
  });

  it('labels the last crumb with aria-current="page"', () => {
    render(wrap('/wiki'));
    const current = screen.getByText('Wiki');
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('builds crumbs for nested routes and only the last one is current', () => {
    render(wrap('/admin/params'));
    expect(screen.getByText('Configuración')).toBeInTheDocument();  // /admin
    expect(screen.getByText('Parámetros')).toBeInTheDocument();     // /admin/params
    expect(screen.getByText('Parámetros')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Configuración')).not.toHaveAttribute('aria-current');
  });

  it('falls back to the raw segment when no label is mapped', () => {
    render(wrap('/clients/acme-123'));
    expect(screen.getByText('acme-123')).toBeInTheDocument();
  });
});
