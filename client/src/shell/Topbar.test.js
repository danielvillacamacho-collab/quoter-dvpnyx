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

  it('renders a disabled search placeholder', () => {
    renderAt('/clients');
    const search = screen.getByPlaceholderText('Buscar…');
    expect(search).toBeDisabled();
  });

  it('renders a disabled notifications button', () => {
    renderAt('/clients');
    const bell = screen.getByRole('button', { name: /Notificaciones/i });
    expect(bell).toBeDisabled();
  });
});
