import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Topbar from './Topbar';

/**
 * The Topbar wraps <Breadcrumb/> plus search + notifications. We assert
 * the structural contract the rest of the app relies on:
 *   - it carries the `ds-topbar` class (theme hook)
 *   - it has an accessible role + aria-label
 *   - it embeds the legacy `.breadcrumb` element so existing tests keep
 *     passing when the Topbar is rendered in the Layout
 *   - search + notifications are disabled placeholders until Phase 2
 */
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Topbar />
    </MemoryRouter>
  );
}

describe('Topbar', () => {
  it('renders the topbar shell with accessible role', () => {
    const { container } = renderAt('/clients');
    const bar = container.querySelector('.ds-topbar');
    expect(bar).not.toBeNull();
    expect(screen.getByRole('navigation', { name: /Barra superior/i })).toBeInTheDocument();
  });

  it('embeds the legacy breadcrumb when not at root', () => {
    const { container } = renderAt('/clients');
    expect(container.querySelector('.breadcrumb')).not.toBeNull();
  });

  it('omits the legacy breadcrumb at root (preserves Breadcrumb behaviour)', () => {
    const { container } = renderAt('/');
    // Breadcrumb returns null on "/" — topbar still renders the shell.
    expect(container.querySelector('.breadcrumb')).toBeNull();
    expect(container.querySelector('.ds-topbar')).not.toBeNull();
  });

  it('renders a disabled search button when no onOpenSearch prop is provided', () => {
    renderAt('/clients');
    const search = screen.getByRole('button', { name: /Abrir búsqueda global/i });
    expect(search).toBeDisabled();
    expect(screen.getByText('Buscar…')).toBeInTheDocument();
  });

  it('enables the search button when onOpenSearch is provided and fires it on click', () => {
    const onOpenSearch = jest.fn();
    render(
      <MemoryRouter initialEntries={['/clients']}>
        <Topbar onOpenSearch={onOpenSearch} />
      </MemoryRouter>
    );
    const search = screen.getByRole('button', { name: /Abrir búsqueda global/i });
    expect(search).not.toBeDisabled();
    search.click();
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('renders a disabled notifications button when no onOpenNotifications prop is provided', () => {
    renderAt('/clients');
    const bell = screen.getByRole('button', { name: /^Notificaciones$/i });
    expect(bell).toBeDisabled();
    expect(screen.queryByTestId('topbar-bell-badge')).toBeNull();
  });

  it('enables the bell when onOpenNotifications is provided and fires it on click', () => {
    const onOpenNotifications = jest.fn();
    render(
      <MemoryRouter initialEntries={['/clients']}>
        <Topbar onOpenNotifications={onOpenNotifications} />
      </MemoryRouter>
    );
    const bell = screen.getByRole('button', { name: /^Notificaciones$/i });
    expect(bell).not.toBeDisabled();
    bell.click();
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
  });

  it('renders the unread-count badge capped at 9+ and reflects count in aria-label', () => {
    render(
      <MemoryRouter initialEntries={['/clients']}>
        <Topbar onOpenNotifications={() => {}} unreadCount={12} />
      </MemoryRouter>
    );
    const badge = screen.getByTestId('topbar-bell-badge');
    expect(badge).toHaveTextContent('9+');
    expect(screen.getByRole('button', { name: /Notificaciones \(12 sin leer\)/i })).toBeInTheDocument();
  });

  it('shows the exact count when below cap', () => {
    render(
      <MemoryRouter initialEntries={['/clients']}>
        <Topbar onOpenNotifications={() => {}} unreadCount={3} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('topbar-bell-badge')).toHaveTextContent('3');
  });
});
