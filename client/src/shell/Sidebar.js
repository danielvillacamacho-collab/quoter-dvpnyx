import React from 'react';
import { NavLink } from 'react-router-dom';
import Avatar from './Avatar';
import {
  Home, UserPlus, FileText, Building2, Briefcase, FileCheck2,
  ClipboardList, CalendarDays, LayoutGrid, Users, Layers, Tag,
  Clock, TrendingUp, BarChart3, BookOpen, Settings, UserCog, Upload,
  Palette, LogOut, DollarSign,
} from 'lucide-react';

/**
 * App Shell — Sidebar.
 *
 * Visual direction comes from the DVPNYX design handoff (see
 * `UI de claude design/design_handoff_dvpnyx_ui`): soft neutral
 * background, hair-thin border, 232×100vh grid column, 52px brand
 * header matching the Topbar, sectioned nav with uppercase micro
 * labels, and a user footer with logout action.
 *
 * Visibility rules:
 *   - The "Gente → Áreas / Skills" and the entire "Configuración"
 *     block are admin-only, mirroring the previous inline markup in
 *     App.js. Non-admin users simply don't see them.
 *
 * Accessibility:
 *   - <nav aria-label="Navegación principal"> so screen readers can
 *     jump to it. Each item uses <NavLink>, which applies the
 *     .active class when the current pathname matches — no manual
 *     comparison needed, which also makes detail-route matching
 *     consistent (e.g. /clients/:id keeps Clientes highlighted).
 *   - Icons are aria-hidden so the accessible name is just the label.
 *
 * The outer wrapper keeps the legacy `.sidebar` class (+ `.ds-sidebar`
 * for the new styles) because App.test.js and the mobile hamburger
 * overlay query-select on `.sidebar`.
 */

const ICONS = {
  '/':                        Home,
  '/quotation/new/staff_aug': UserPlus,
  '/quotation/new/fixed_scope': FileText,
  '/clients':                 Building2,
  '/opportunities':           Briefcase,
  '/pipeline':                LayoutGrid,
  '/revenue':                 BarChart3,
  '/contracts':               FileCheck2,
  '/resource-requests':       ClipboardList,
  '/assignments':             CalendarDays,
  '/capacity/planner':        LayoutGrid,
  '/employees':               Users,
  '/admin/areas':             Layers,
  '/admin/skills':            Tag,
  '/time/me':                 Clock,
  '/time/team':               TrendingUp,
  '/reports':                 BarChart3,
  '/wiki':                    BookOpen,
  '/admin/params':            Settings,
  '/admin/exchange-rates':    BarChart3,
  '/admin/employee-costs':    DollarSign,
  '/admin/users':             UserCog,
  '/admin/bulk-import':       Upload,
  '/preferencias':            Palette,
};

/** Build the grouped nav model; admin-only sections are filtered here. */
export function buildGroups(isAdmin) {
  const groups = [
    {
      title: null, items: [
        { path: '/', label: 'Dashboard' },
      ],
    },
    {
      title: 'Comercial', items: [
        { path: '/quotation/new/staff_aug',  label: 'Nueva Staff Aug' },
        { path: '/quotation/new/fixed_scope', label: 'Nuevo Proyecto' },
        { path: '/clients',                  label: 'Clientes' },
        { path: '/opportunities',            label: 'Oportunidades' },
        { path: '/pipeline',                 label: 'Pipeline' },
      ],
    },
    {
      title: 'Delivery', items: [
        { path: '/contracts',         label: 'Contratos' },
        { path: '/resource-requests', label: 'Solicitudes' },
        { path: '/assignments',       label: 'Asignaciones' },
        { path: '/capacity/planner',  label: 'Planner' },
      ],
    },
    {
      title: 'Gente', items: [
        { path: '/employees', label: 'Empleados' },
        ...(isAdmin ? [
          { path: '/admin/areas',  label: 'Áreas'  },
          { path: '/admin/skills', label: 'Skills' },
        ] : []),
      ],
    },
    {
      title: 'Time Tracking', items: [
        { path: '/time/me',   label: 'Mis horas' },
        { path: '/time/team', label: 'Tiempo semanal' },
      ],
    },
    {
      title: 'Finanzas', items: [
        { path: '/revenue', label: 'Reconocimiento' },
      ],
    },
    {
      title: null, items: [
        { path: '/reports',      label: 'Reportes' },
        { path: '/wiki',         label: 'Wiki' },
        { path: '/preferencias', label: 'Preferencias' },
      ],
    },
  ];
  if (isAdmin) {
    groups.push({
      title: 'Configuración', items: [
        { path: '/admin/params',          label: 'Parámetros'      },
        { path: '/admin/exchange-rates',  label: 'Tasas de cambio' },
        { path: '/admin/employee-costs',  label: 'Costos del equipo' },
        { path: '/admin/users',           label: 'Usuarios'        },
        { path: '/admin/bulk-import',     label: 'Carga masiva'    },
      ],
    });
  }
  return groups;
}

/** Safe initials for the avatar (never blanks out even on missing name). */
function initials(name) {
  if (!name) return 'DV';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0] || '').join('');
  return letters.toUpperCase() || 'DV';
}

export default function Sidebar({
  user,
  isAdmin = false,
  open = false,
  onNavigate,
  onLogout,
}) {
  const groups = buildGroups(isAdmin);

  // NavLink gives us `isActive` → feeds our own class to preserve the
  // existing visual contract (".active" → accent-soft + accent-text).
  const itemClass = ({ isActive }) => (isActive ? 'ds-sb-item active' : 'ds-sb-item');

  return (
    <aside
      className={`sidebar ds-sidebar${open ? ' open' : ''}`}
      aria-label="Navegación principal"
    >
      <div className="ds-sb-brand">
        <div className="ds-sb-logo" aria-hidden="true">DV</div>
        <span className="ds-sb-brand-name">DVPNYX</span>
        <span className="ds-sb-brand-sub">v2.0</span>
      </div>

      <nav className="ds-sb-scroll" aria-label="Secciones">
        {groups.map((g, gi) => (
          <div className="ds-sb-section" key={gi}>
            {g.title && <div className="ds-sb-section-label">{g.title}</div>}
            {g.items.map((it) => {
              const Icon = ICONS[it.path];
              // Dashboard has to match exactly `/` — NavLink's `end`
              // prop prevents it from being active on every deeper path.
              const end = it.path === '/';
              return (
                <NavLink
                  key={it.path}
                  to={it.path}
                  end={end}
                  className={itemClass}
                  onClick={onNavigate}
                >
                  {Icon ? <Icon className="ds-sb-ico" aria-hidden="true" /> : null}
                  <span>{it.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="ds-sb-foot">
        <div className="ds-sb-user">
          <Avatar name={user?.name} size={28} />
          <div className="ds-sb-user-info">
            <div className="ds-sb-user-name">{user?.name || '—'}</div>
            <div className="ds-sb-user-role">{user?.role || ''}</div>
          </div>
        </div>
        <button
          type="button"
          className="ds-sb-logout"
          onClick={onLogout}
          aria-label="Cerrar sesión"
        >
          <LogOut size={13} aria-hidden="true" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}
