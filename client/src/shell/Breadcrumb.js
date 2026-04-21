import React from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * Auto-generated breadcrumb from the current pathname. Falls back to a
 * sensible label map for the known top-level sections. Each crumb is a
 * navigable link (except the last one, which is the current page).
 */
const LABELS = {
  '':             'Inicio',
  dashboard:      'Dashboard',
  quotation:      'Cotizaciones',
  quotations:     'Cotizaciones',
  clients:        'Clientes',
  opportunities:  'Oportunidades',
  employees:      'Empleados',
  contracts:      'Contratos',
  'resource-requests': 'Solicitudes',
  assignments:    'Asignaciones',
  time:           'Time Tracking',
  reports:        'Reportes',
  wiki:           'Wiki',
  admin:          'Configuración',
  users:          'Usuarios',
  params:         'Parámetros',
  areas:          'Áreas',
  skills:         'Skills',
  'bulk-import':  'Carga masiva',
  new:            'Nueva',
  me:             'Yo',
  team:           'Equipo',
};

function labelFor(segment) {
  return LABELS[segment] || segment;
}

export default function Breadcrumb() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);

  // Don't render on the very top-level route (it's noise there).
  if (parts.length === 0) return null;

  const crumbs = [];
  let href = '';
  for (let i = 0; i < parts.length; i++) {
    href += '/' + parts[i];
    crumbs.push({ href, label: labelFor(parts[i]), last: i === parts.length - 1 });
  }

  return (
    <nav className="breadcrumb" aria-label="Ruta de navegación">
      <Link to="/" className="breadcrumb-item">Inicio</Link>
      {crumbs.map((c) => (
        <React.Fragment key={c.href}>
          <span className="breadcrumb-sep" aria-hidden="true">›</span>
          {c.last ? (
            <span className="breadcrumb-item breadcrumb-current" aria-current="page">
              {c.label}
            </span>
          ) : (
            <Link to={c.href} className="breadcrumb-item">{c.label}</Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
