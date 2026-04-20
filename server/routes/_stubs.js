/**
 * Stub routers for V2 modules that haven't been implemented yet.
 *
 * They exist so the route tree is complete and future sprint PRs can
 * replace them file-by-file without touching index.js. Every stub
 * returns 501 Not Implemented with a clear pointer to the spec.
 */
const express = require('express');
const { auth } = require('../middleware/auth');

function stub(label, specRef) {
  const router = express.Router();
  router.use(auth);
  router.all('*', (_req, res) => {
    res.status(501).json({
      error: `${label} no implementado todavía`,
      spec: specRef,
    });
  });
  return router;
}

module.exports = {
  clients:          stub('Módulo Clientes',          'docs/specs/v2/04_modules/02_clients_opportunities.md'),
  opportunities:    stub('Módulo Oportunidades',     'docs/specs/v2/04_modules/02_clients_opportunities.md'),
  employees:        stub('Módulo Empleados',         'docs/specs/v2/04_modules/03_employees_and_skills.md'),
  skills:           stub('Catálogo Skills',          'docs/specs/v2/04_modules/03_employees_and_skills.md'),
  areas:            stub('Catálogo Áreas',           'docs/specs/v2/04_modules/03_employees_and_skills.md'),
  contracts:        stub('Módulo Contratos',         'docs/specs/v2/04_modules/04_contracts_requests_assignments.md'),
  resourceRequests: stub('Módulo Solicitudes',       'docs/specs/v2/04_modules/04_contracts_requests_assignments.md'),
  assignments:      stub('Módulo Asignaciones',      'docs/specs/v2/04_modules/04_contracts_requests_assignments.md'),
  timeEntries:      stub('Módulo Time Tracking',     'docs/specs/v2/04_modules/05_time_tracking.md'),
  reports:          stub('Módulo Reportes',          'docs/specs/v2/04_modules/06_reports.md'),
  squads:           stub('Módulo Squads',            'docs/specs/v2/02_glossary_and_roles.md'),
  events:           stub('Event log',                'docs/specs/v2/05_api_spec.md'),
  notifications:    stub('Notificaciones in-app',    'docs/specs/v2/05_api_spec.md'),
};
