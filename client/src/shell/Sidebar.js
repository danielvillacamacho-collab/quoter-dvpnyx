import React, { useState, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Avatar from './Avatar';
import {
  Home, UserPlus, FileText, Building2, Briefcase, FileCheck2,
  ClipboardList, CalendarDays, Users, Tag,
  Clock, BarChart3, BookOpen, Settings, UserCog, Upload,
  LogOut, DollarSign, Rocket, CalendarOff, Activity, Globe,
  Contact, MessageSquare, Target, ChevronRight,
  Kanban, PieChart, LineChart, Wallet, FolderKanban, Sparkles,
  GanttChart, Timer, Coffee, LayoutDashboard, Landmark, Wrench,
} from 'lucide-react';
import cx from './Sidebar.module.css';

const ICONS = {
  '/':                          Home,
  '/quotation/new/staff_aug':   UserPlus,
  '/quotation/new/fixed_scope': FileText,
  '/clients':                   Building2,
  '/opportunities':             Briefcase,
  '/pipeline':                  Kanban,
  '/contacts':                  Contact,
  '/activities':                MessageSquare,
  '/contracts':                 FileCheck2,
  '/resource-requests':         ClipboardList,
  '/assignments':               CalendarDays,
  '/capacity/planner':          GanttChart,
  '/employees':                 Users,
  '/admin/areas':               FolderKanban,
  '/admin/skills':              Tag,
  '/time/me':                   Clock,
  '/time/team':                 Timer,
  '/internal-initiatives':      Rocket,
  '/novelties':                 Sparkles,
  '/idle-time':                 Coffee,
  '/revenue':                   Wallet,
  '/reports':                   PieChart,
  '/reports/ejecutivo':         LayoutDashboard,
  '/reports/comercial':         Briefcase,
  '/reports/delivery':          FileCheck2,
  '/reports/gente':             Users,
  '/reports/finanzas':          LineChart,
  '/wiki':                      BookOpen,
  '/admin/params':              Settings,
  '/admin/exchange-rates':      Landmark,
  '/admin/employee-costs':      DollarSign,
  '/admin/users':               UserCog,
  '/admin/bulk-import':         Upload,
  '/admin/holidays':            Globe,
  '/admin/budgets':             Target,
};

/** Build the grouped nav model. */
export function buildGroups(isAdmin) {
  const groups = [
    {
      key: 'home', title: null, collapsible: false, items: [
        { path: '/', label: 'Dashboard' },
      ],
    },
    {
      key: 'comercial', title: 'Comercial', collapsible: true, items: [
        { path: '/clients',                  label: 'Clientes' },
        { path: '/contacts',                 label: 'Contactos' },
        { path: '/opportunities',            label: 'Oportunidades' },
        { path: '/activities',               label: 'Actividades' },
        { path: '/pipeline',                 label: 'Pipeline' },
      ],
    },
    {
      key: 'cotizaciones', title: 'Cotizaciones', collapsible: true, items: [
        { path: '/quotation/new/staff_aug',   label: 'Staff Augmentation' },
        { path: '/quotation/new/fixed_scope', label: 'Proyecto (fixed)' },
      ],
    },
    {
      key: 'delivery', title: 'Delivery', collapsible: true, items: [
        { path: '/contracts',         label: 'Contratos' },
        { path: '/resource-requests', label: 'Solicitudes' },
        { path: '/assignments',       label: 'Asignaciones' },
        { path: '/capacity/planner',  label: 'Planner' },
      ],
    },
    {
      key: 'gente', title: 'Gente', collapsible: true, items: [
        { path: '/employees', label: 'Empleados' },
        ...(isAdmin ? [
          { path: '/admin/areas',  label: 'Áreas'  },
          { path: '/admin/skills', label: 'Skills' },
        ] : []),
      ],
    },
    {
      key: 'tiempo', title: 'Tiempo', collapsible: true, items: [
        { path: '/time/me',   label: 'Mis horas' },
        { path: '/time/team', label: 'Equipo semanal' },
      ],
    },
    {
      key: 'operaciones', title: 'Operaciones', collapsible: true, items: [
        { path: '/internal-initiatives', label: 'Iniciativas' },
        { path: '/novelties',            label: 'Novedades' },
        { path: '/idle-time',            label: 'Bench & capacidad' },
        { path: '/revenue',              label: 'Revenue' },
      ],
    },
    {
      key: 'reportes', title: 'Reportes', collapsible: true, items: [
        { path: '/reports',           label: 'Hub' },
        { path: '/reports/ejecutivo', label: 'Ejecutivo' },
        { path: '/reports/comercial', label: 'Comercial' },
        { path: '/reports/delivery',  label: 'Delivery' },
        { path: '/reports/gente',     label: 'Gente' },
        { path: '/reports/finanzas',  label: 'Finanzas' },
      ],
    },
    {
      key: 'ayuda', title: null, collapsible: false, items: [
        { path: '/wiki',         label: 'Wiki' },
      ],
    },
  ];
  if (isAdmin) {
    groups.push({
      key: 'config', title: 'Configuración', collapsible: true, items: [
        { path: '/admin/params',          label: 'Parámetros'      },
        { path: '/admin/exchange-rates',  label: 'Tasas de cambio' },
        { path: '/admin/employee-costs',  label: 'Costos del equipo' },
        { path: '/admin/budgets',         label: 'Presupuestos'    },
        { path: '/admin/holidays',        label: 'Festivos'        },
        { path: '/admin/users',           label: 'Usuarios'        },
        { path: '/admin/bulk-import',     label: 'Carga masiva'    },
      ],
    });
  }
  return groups;
}

function initials(name) {
  if (!name) return 'DV';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0] || '').join('');
  return letters.toUpperCase() || 'DV';
}

const STORAGE_KEY = 'dvpnyx-sidebar-collapsed';

function loadCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { return {}; }
}

function SidebarSection({ group, collapsed, onToggle, itemClass, onNavigate, pathname }) {
  const isOpen = !collapsed;

  if (!group.collapsible) {
    return (
      <div className="ds-sb-section">
        {group.title && <div className="ds-sb-section-label">{group.title}</div>}
        {group.items.map((it) => {
          const Icon = ICONS[it.path];
          return (
            <NavLink key={it.path} to={it.path} end={it.path === '/'} className={itemClass} onClick={onNavigate}>
              {Icon ? <Icon className="ds-sb-ico" aria-hidden="true" /> : null}
              <span>{it.label}</span>
            </NavLink>
          );
        })}
      </div>
    );
  }

  const hasActiveChild = group.items.some((it) =>
    it.path === '/' ? pathname === '/' : pathname.startsWith(it.path)
  );

  return (
    <div className="ds-sb-section">
      <button
        type="button"
        className={cx.sectionHeader}
        onClick={() => onToggle(group.key)}
        aria-expanded={isOpen}
      >
        <ChevronRight
          className={`${cx.chevron} ${isOpen ? cx.chevronOpen : ''}`}
          aria-hidden="true"
        />
        <span>{group.title}</span>
        {!isOpen && hasActiveChild && (
          <span className="ds-dot-inline" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ds-accent)', marginLeft: 'auto', flexShrink: 0 }} />
        )}
      </button>
      <div className={`${cx.sectionBody} ${!isOpen ? cx.sectionBodyClosed : ''}`}>
        <div className={cx.sectionInner}>
          {group.items.map((it) => {
            const Icon = ICONS[it.path];
            return (
              <NavLink key={it.path} to={it.path} end={it.path === '/'} className={itemClass} onClick={onNavigate}>
                {Icon ? <Icon className="ds-sb-ico" aria-hidden="true" /> : null}
                <span>{it.label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({
  user,
  isAdmin = false,
  open = false,
  onNavigate,
  onLogout,
}) {
  const groups = buildGroups(isAdmin);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  const toggleSection = useCallback((key) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

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
        {groups.map((g) => (
          <SidebarSection
            key={g.key}
            group={g}
            collapsed={!!collapsed[g.key]}
            onToggle={toggleSection}
            itemClass={itemClass}
            onNavigate={onNavigate}
            pathname={location.pathname}
          />
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
