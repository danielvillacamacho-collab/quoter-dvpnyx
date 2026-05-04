require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const crypto = require('crypto');
const { serverError } = require('./utils/http');

// ── Startup fixup: garantiza que help_articles exista con el schema correcto
// independiente del estado de la migración. Cada paso en su propio try/catch
// para que un fallo aislado no cancele los siguientes. ──────────────────────
(async () => {
  let pool;
  try { pool = require('./database/pool'); } catch (e) {
    console.warn('[startup] pool unavailable:', e.message); return;
  }

  // 1. Crear tabla si no existe (primer boot antes de migración)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS help_articles (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        slug         TEXT        NOT NULL UNIQUE,
        category     TEXT        NOT NULL,
        sort_order   INTEGER     NOT NULL DEFAULT 0,
        title        TEXT        NOT NULL,
        body_md      TEXT        NOT NULL DEFAULT '',
        is_published BOOLEAN     NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by   UUID        REFERENCES users(id) ON DELETE SET NULL
      )
    `);
  } catch (e) { console.warn('[startup] help_articles CREATE skipped:', e.message); }

  // 2. Agregar columnas si faltan (DBs creadas por deploys parciales)
  const colFixups = [
    `ALTER TABLE help_articles ADD COLUMN IF NOT EXISTS body_md TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE help_articles ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL`,
  ];
  for (const sql of colFixups) {
    try { await pool.query(sql); } catch (e) { console.warn('[startup] col fixup skipped:', e.message); }
  }

  // 3. Seed artículos base — ON CONFLICT DO NOTHING hace esto idempotente
  try {
    await pool.query(`
      INSERT INTO help_articles (slug, category, sort_order, title, body_md, is_published) VALUES
        ('ayuda-bienvenida','general',1,'Bienvenida al Quoter DVPNYX','# Bienvenida al Quoter DVPNYX\n\nEste es el sistema interno de DVPNYX para gestionar cotizaciones, contratos, asignaciones y capacidad del equipo de entrega.\n\n## Módulos principales\n\n- **CRM / Oportunidades** — Pipeline comercial con 9 etapas, alertas y revenue forecasting.\n- **Cotizador** — Propuestas de staff augmentation o fixed scope con cálculo de márgenes.\n- **Contratos** — Lifecycle completo desde kick-off hasta cierre.\n- **Capacity Planner** — Disponibilidad del equipo y asignación de recursos.\n- **Time Tracking** — Registro de horas por asignación.\n- **Reportes** — Utilización, bench, compliance y plan vs real.',true),
        ('crm-pipeline-etapas','crm',1,'Pipeline CRM — Las 9 etapas','# Pipeline CRM — Las 9 etapas\n\n| Etapa | Descripción |\n|---|---|\n| Lead | Contacto inicial sin calificación |\n| Qualified | Necesidad confirmada |\n| Solution Design | Diseñando la propuesta |\n| Proposal Sent | Propuesta enviada |\n| Proposal Validated | Cliente revisó y dio feedback |\n| Negotiation | Negociando términos y precio |\n| Verbal Commit | Acuerdo verbal, pendiente firma |\n| Closed Won | Contrato firmado |\n| Closed Lost | Oportunidad perdida |\n\nTambién existe **Postponed** para oportunidades pausadas.\n\n## Reglas\n\n- Debes cumplir los exit criteria de cada etapa para avanzar.\n- Para Closed Lost es obligatorio registrar el motivo (mínimo 30 caracteres).',true),
        ('crm-alertas','crm',2,'Alertas automáticas del CRM (A1-A5)','# Alertas automáticas del CRM\n\n| Alerta | Nombre | Condición |\n|---|---|---|\n| A1 | Oportunidad fría | Sin actividad 14 días en etapas 1-4 |\n| A2 | Propuesta sin respuesta | Más de 7 días en Proposal Sent |\n| A3 | Negociación extendida | Más de 21 días en Negotiation |\n| A4 | Margen bajo | Margen proyectado bajo el umbral |\n| A5 | Verbal sin cierre | Más de 7 días en Verbal Commit |\n\nCada alerta se deduplica: no recibirás la misma dos veces en 24 horas.',true),
        ('asignaciones-como-funciona','delivery',1,'Asignaciones — Motor de validación','# Asignaciones — Motor de validación\n\nAl asignar un empleado el sistema corre 4 validaciones:\n\n1. **Área** — debe coincidir con el área del resource request.\n2. **Level** — nivel del empleado debe ser >= nivel mínimo del request.\n3. **Capacidad** — el empleado no puede quedar sobrecargado (> 100%).\n4. **Overlap** — las fechas no pueden solaparse con otra asignación activa.\n\n## Overrides\n\nSi una validación falla puedes registrar un override con justificación. Queda registrado y visible para el Delivery Manager y Capacity Manager.',true),
        ('time-tracking-semanal','time',1,'Time Tracking — Registro de horas','# Time Tracking — Registro de horas\n\n## /time/me — Matriz diaria\nRegistra horas por día y por asignación.\n\n## /time/team — Porcentaje semanal\nRegistra qué porcentaje de tu semana dedicaste a cada asignación. El bench se calcula automáticamente.',true),
        ('reportes-plan-vs-real','reportes',1,'Reporte Plan vs Real','# Reporte Plan vs Real\n\nCompara lo planeado (asignaciones / capacidad) contra lo real (horas reportadas).\n\n| Estado | Significado |\n|---|---|\n| on_plan | Diferencia <= 10pp |\n| over | Reportó más horas de las asignadas |\n| under | Reportó menos horas de las asignadas |\n| missing | No registró horas esa semana |\n| unplanned | Registró horas sin asignación planificada |\n| no_data | Sin datos suficientes |\n\nTolerancia: +-10 puntos porcentuales.',true)
      ON CONFLICT (slug) DO NOTHING
    `);
    console.log('[startup] help_articles schema + seed OK');
  } catch (e) { console.warn('[startup] help_articles seed skipped:', e.message); }
})();

const app = express();
// Detrás de Traefik (1 hop). Necesario para que req.ip sea el IP real del
// cliente y el rate-limit no agrupe todo el tráfico bajo el IP del proxy.
// Más seguro que 'true' porque sólo confía en un único hop.
app.set('trust proxy', 1);
app.use(helmet());

// ── Request ID — every request gets a unique ID for log correlation ──
app.use((req, _res, next) => {
  req.requestId = crypto.randomBytes(6).toString('hex');
  next();
});
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '5mb' }));

/* ===================================================================
 * Rate limiting
 *
 * Aprendizaje 2026-04-28: el límite anterior (200 req / 15min global por IP)
 * tumbó la app porque toda la oficina sale por una sola IP NAT y la SPA
 * hace 5-10 calls por navegación. Resultado: 10 usuarios = se agota la
 * cuota en minutos y nadie puede entrar.
 *
 * Decisiones del fix:
 *   - Global: 2000 req / 15min, key por (user_id si autenticado, sino IP)
 *     para que NAT compartido no penalice. 2000 es generoso pero protege
 *     de scraping/abuso.
 *   - Login: 30 intentos / 15min por (email + IP) para que un mistype
 *     repetido no bloquee a otros del mismo NAT.
 *   - Health: bypass para que monitoring no consuma cuota.
 *   - handler: SIEMPRE responde JSON para que el cliente pueda parsearlo
 *     (antes el cliente recibía text/plain "Too many requests..." y crasheaba
 *     con "Unexpected token 'T'... is not valid JSON").
 *   - standardHeaders: 'draft-7' expone cabeceras RateLimit-* legibles.
 * =================================================================== */
function jsonRateLimitHandler(retryAfterSeconds) {
  return (req, res /* , next, options */) => {
    res.status(429).json({
      error: 'Demasiadas peticiones. Esperá unos minutos e intentá de nuevo.',
      code: 'rate_limited',
      retry_after_seconds: retryAfterSeconds,
    });
  };
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Authenticated users get their own bucket; resto cae a IP (req.ip
    // honra X-Forwarded-For si trust proxy está activado).
    return (req.user && req.user.id) ? `u:${req.user.id}` : `ip:${req.ip}`;
  },
  skip: (req) => req.path === '/health' || req.path.startsWith('/health'),
  handler: jsonRateLimitHandler(15 * 60),
});
app.use('/api/', apiLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Por (email, IP) — alguien tipeando mal su pass no bloquea a otros del
    // mismo NAT, pero un atacante por IP-única no escapa con N emails.
    const email = String(req.body?.email || '').trim().toLowerCase();
    return `${req.ip}|${email}`;
  },
  handler: jsonRateLimitHandler(15 * 60),
});
app.use('/api/auth/login', loginLimiter);

app.use('/api/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/parameters', require('./routes/parameters'));
app.use('/api/quotations', require('./routes/quotations'));

// V2 modules — currently 501 stubs; sprints 2+ replace each file.
const _stubs = require('./routes/_stubs');
app.use('/api/clients',           require('./routes/clients'));       // ✅ Sprint 2
app.use('/api/opportunities',     require('./routes/opportunities')); // ✅ Sprint 2
app.use('/api/employees',         require('./routes/employees'));    // ✅ Sprint 3 EE-1
app.use('/api/skills',            require('./routes/skills'));       // ✅ Sprint 3 EA-2
app.use('/api/areas',             require('./routes/areas'));        // ✅ Sprint 3 EA-1
app.use('/api/contracts',         require('./routes/contracts'));    // ✅ Sprint 4 EK-1/EK-2
app.use('/api/revenue',           require('./routes/revenue'));      // ✅ RR-MVP-00.1 (placeholder, eng team to refactor)
app.use('/api/admin/exchange-rates', require('./routes/exchange_rates')); // ✅ RR-MVP-00.6 (placeholder)
app.use('/api/time-allocations',  require('./routes/time_allocations')); // ✅ Time-MVP-00.1 (placeholder, weekly %)
app.use('/api/resource-requests', require('./routes/resource_requests')); // ✅ Sprint 4 ER-1/ER-2
app.use('/api/assignments',       require('./routes/assignments'));  // ✅ Sprint 4 EN-1/EN-2/EN-5
app.use('/api/capacity',          require('./routes/capacity'));     // ✅ Sprint 6 US-BK-1 (planner)
app.use('/api/time-entries',      require('./routes/time_entries')); // ✅ Sprint 5 ET-*
app.use('/api/reports',           require('./routes/reports'));      // ✅ Sprint 6 EI-* / ED-1
app.use('/api/dashboard',         require('./routes/dashboard'));    // ✅ Executive Dashboard v2
app.use('/api/search',            require('./routes/search'));       // ✅ Command Palette
app.use('/api/bulk-import',       require('./routes/bulk_import'));  // ✅ Sprint 9 (admin+)
app.use('/api/squads',            _stubs.squads);
app.use('/api/events',            _stubs.events);
app.use('/api/notifications',     require('./routes/notifications')); // ✅ In-app notifications
// SPEC-CRM-01 — Contacts, Activities, Budgets (CRM enrichment)
app.use('/api/contacts',          require('./routes/contacts'));
app.use('/api/activities',        require('./routes/activities'));
app.use('/api/budgets',           require('./routes/budgets'));
app.use('/api/ai-interactions',   require('./routes/ai_interactions')); // ✅ AI agent log + decision feedback
app.use('/api/employee-costs',    require('./routes/employee_costs')); // ✅ Employee Costs (admin-only PII)
// SPEC-II-00 — Internal Initiatives, Novelties & Idle Time (Abril 2026)
app.use('/api/internal-initiatives', require('./routes/internal_initiatives'));
app.use('/api/novelties',         require('./routes/novelties'));
app.use('/api/holidays',          require('./routes/holidays'));
app.use('/api/idle-time',         require('./routes/idle_time'));
app.use('/api/reports/v2',        require('./routes/reports_v2'));    // Reports v2 — aggregate endpoints for charts
app.use('/api/help',              require('./routes/help'));           // Manual de usuario vivo

if (process.env.NODE_ENV === 'production') {
  // Hashed static assets (JS, CSS, media) — safe to cache long-term.
  app.use(express.static(path.join(__dirname, '../client/build')));
  // index.html must NEVER be cached: it references the hashed bundles, so
  // if a stale index.html is served after a deploy the user gets the old app.
  app.get('*', (_, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Global error handler — safety net for unhandled errors in routes
app.use((err, req, res, _next) => {
  serverError(res, `UNHANDLED ${req.method} ${req.originalUrl}`, err);
});

// Only start the HTTP listener when executed directly (EC2 / local dev).
// When required by lambda.js for API Gateway, we just export the app.
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`DVPNYX Quoter API running on port ${PORT}`));
}

module.exports = app;
