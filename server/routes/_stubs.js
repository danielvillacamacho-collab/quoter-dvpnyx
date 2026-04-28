/**
 * Stub routers para módulos V2 que aún no tienen ruta real.
 *
 * Cuando un módulo se implementa, en index.js se reemplaza el `_stubs.X`
 * por `require('./routes/X')` y la entrada se elimina de aquí. La lista
 * abajo refleja ÚNICAMENTE módulos no implementados; no es un índice de
 * todos los módulos del sistema.
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
  squads: stub('Módulo Squads', 'docs/specs/v2/02_glossary_and_roles.md'),
  events: stub('Event log',     'docs/specs/v2/05_api_spec.md'),
};
