import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Placeholder screen for V2 modules that aren't built yet. Every sidebar
 * item routes to some page — this keeps the navigation intact while
 * individual modules land in their own sprint PRs.
 */
const ROUTE_META = {
  '/clients':          { title: 'Clientes',            sprint: 'Sprint 2', spec: 'docs/specs/v2/04_modules/02_clients_opportunities.md' },
  '/opportunities':    { title: 'Oportunidades',       sprint: 'Sprint 2', spec: 'docs/specs/v2/04_modules/02_clients_opportunities.md' },
  '/employees':        { title: 'Empleados',           sprint: 'Sprint 3', spec: 'docs/specs/v2/04_modules/03_employees_and_skills.md' },
  '/contracts':        { title: 'Contratos',           sprint: 'Sprint 4', spec: 'docs/specs/v2/04_modules/04_contracts_requests_assignments.md' },
  '/resource-requests':{ title: 'Solicitudes',         sprint: 'Sprint 4', spec: 'docs/specs/v2/04_modules/04_contracts_requests_assignments.md' },
  '/assignments':      { title: 'Asignaciones',        sprint: 'Sprint 4', spec: 'docs/specs/v2/04_modules/04_contracts_requests_assignments.md' },
  '/time':             { title: 'Time Tracking',       sprint: 'Sprint 5', spec: 'docs/specs/v2/04_modules/05_time_tracking.md' },
  '/time/me':          { title: 'Mis horas',           sprint: 'Sprint 5', spec: 'docs/specs/v2/04_modules/05_time_tracking.md' },
  '/time/team':        { title: 'Horas del equipo',    sprint: 'Sprint 5', spec: 'docs/specs/v2/04_modules/05_time_tracking.md' },
  '/reports':          { title: 'Reportes',            sprint: 'Sprint 6', spec: 'docs/specs/v2/04_modules/06_reports.md' },
  '/admin/areas':      { title: 'Catálogo de Áreas',   sprint: 'Sprint 3', spec: 'docs/specs/v2/04_modules/03_employees_and_skills.md' },
  '/admin/skills':     { title: 'Catálogo de Skills',  sprint: 'Sprint 3', spec: 'docs/specs/v2/04_modules/03_employees_and_skills.md' },
};

export default function ComingSoon() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const meta = ROUTE_META[pathname] || { title: 'Próximamente', sprint: 'pendiente', spec: '' };

  return (
    <div className="coming-soon">
      <div className="coming-soon-icon" aria-hidden="true">🚧</div>
      <h1 style={{ color: 'var(--purple-dark)', fontFamily: 'Montserrat', fontSize: 28, marginBottom: 8 }}>
        {meta.title}
      </h1>
      <p style={{ color: 'var(--text-light)', fontSize: 14, maxWidth: 520, margin: '0 auto 16px' }}>
        Este módulo será implementado en <b>{meta.sprint}</b> del roadmap de V2.
        Mientras tanto, el cotizador sigue funcionando con normalidad.
      </p>
      {meta.spec && (
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 24 }}>
          Spec: <code>{meta.spec}</code>
        </div>
      )}
      <button
        onClick={() => nav('/')}
        style={{
          background: 'var(--purple-dark)', color: '#fff', border: 'none',
          padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'Montserrat',
        }}
      >← Volver al Dashboard</button>
    </div>
  );
}
