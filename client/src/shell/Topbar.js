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
 *   onOpenSearch?        → when present, search pill is clickable and
 *                          fires this. Otherwise renders disabled.
 *   onOpenNotifications? → when present, the bell is clickable and
 *                          fires this. Otherwise renders disabled.
 *   unreadCount?         → number; if > 0, a red badge sits on the bell
 *                          with the count (capped at "9+"). The dot is
 *                          also preserved for screen-reader clarity.
 */
export default function Topbar({ onOpenSearch, onOpenNotifications, unreadCount = 0 }) {
  const searchEnabled = typeof onOpenSearch === 'function';
  const bellEnabled   = typeof onOpenNotifications === 'function';
  const hasUnread     = Number(unreadCount) > 0;
  const badgeText     = unreadCount > 9 ? '9+' : String(unreadCount);

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
        aria-label={hasUnread ? `Notificaciones (${unreadCount} sin leer)` : 'Notificaciones'}
        title="Notificaciones"
        onClick={bellEnabled ? onOpenNotifications : undefined}
        disabled={!bellEnabled}
        data-testid="topbar-bell"
      >
        <Bell size={16} aria-hidden="true" />
        {hasUnread && (
          <span className="ds-badge" data-testid="topbar-bell-badge">{badgeText}</span>
        )}
      </button>
    </div>
  );
}
