import React from 'react';
import { Bell, Search } from 'lucide-react';
import Breadcrumb from './Breadcrumb';

/**
 * Top bar that sits above each page in the app layout.
 *
 * Visual direction comes from the DVPNYX design handoff
 * (design_handoff_dvpnyx_ui): breadcrumb → flex spacer → search pill
 * → notifications icon.
 *
 * Props:
 *   - onOpenSearch?: when provided, the search pill becomes clickable
 *     and opens the global Command Palette. When absent (e.g. in the
 *     standalone shell tests), the pill renders disabled — matching the
 *     pre-palette behavior.
 */
export default function Topbar({ onOpenSearch }) {
  const searchEnabled = typeof onOpenSearch === 'function';
  return (
    <div className="ds-topbar" role="navigation" aria-label="Barra superior">
      <Breadcrumb />
      <div className="ds-topbar-spacer" />

      <button
        type="button"
        className="ds-search"
        aria-label="Abrir búsqueda global"
        title={searchEnabled ? 'Búsqueda global (⌘K)' : 'Búsqueda global — próximamente'}
        onClick={searchEnabled ? onOpenSearch : undefined}
        disabled={!searchEnabled}
        data-testid="topbar-search"
      >
        <Search size={13} aria-hidden="true" />
        <span className="ds-search-placeholder">Buscar…</span>
        <kbd>⌘K</kbd>
      </button>

      <button
        type="button"
        className="ds-icon-btn"
        aria-label="Notificaciones"
        title="Notificaciones"
        disabled
      >
        <Bell size={16} aria-hidden="true" />
        <span className="ds-dot" />
      </button>
    </div>
  );
}
