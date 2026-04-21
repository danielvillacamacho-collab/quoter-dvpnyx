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
 * The Topbar intentionally wraps the existing <Breadcrumb /> component
 * so that:
 *   1. The legacy `.breadcrumb` DOM contract tests rely on still holds.
 *   2. Pages that render above the breadcrumb (e.g. no-op on `/`) keep
 *      their existing behaviour — <Breadcrumb /> returns `null` on `/`.
 *
 * The search input is presentational for now. When we wire the global
 * command palette (Phase 2+), this is the hook.
 */
export default function Topbar() {
  return (
    <div className="ds-topbar" role="navigation" aria-label="Barra superior">
      <Breadcrumb />
      <div className="ds-topbar-spacer" />

      <label className="ds-search" aria-label="Buscar">
        <Search size={13} aria-hidden="true" />
        <input
          type="search"
          placeholder="Buscar…"
          disabled
          title="Búsqueda global — próximamente"
        />
        <kbd>⌘K</kbd>
      </label>

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
