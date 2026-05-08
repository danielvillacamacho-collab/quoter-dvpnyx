require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const crypto = require('crypto');
const { serverError } = require('./utils/http');

const app = express();
// DetrÃ¡s de Traefik (1 hop). Necesario para que req.ip sea el IP real del
// cliente y el rate-limit no agrupe todo el trÃ¡fico bajo el IP del proxy.
// MÃ¡s seguro que 'true' porque sÃ³lo confÃ­a en un Ãºnico hop.
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src':  ["'self'", 'https://accounts.google.com/gsi/client'],
      'frame-src':   ["'self'", 'https://accounts.google.com/gsi/'],
      'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
      'style-src':   ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
      'img-src':     ["'self'", 'data:', 'https://*.googleusercontent.com', 'https://lh3.googleusercontent.com'],
    },
  },
}));

// â”€â”€ Request ID â€” every request gets a unique ID for log correlation â”€â”€
app.use((req, _res, next) => {
  req.requestId = crypto.randomBytes(6).toString('hex');
  next();
});
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '5mb' }));

/* ===================================================================
 * Rate limiting
 *
 * Aprendizaje 2026-04-28: el lÃ­mite anterior (200 req / 15min global por IP)
 * tumbÃ³ la app porque toda la oficina sale por una sola IP NAT y la SPA
 * hace 5-10 calls por navegaciÃ³n. Resultado: 10 usuarios = se agota la
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
 *     (antes el cliente recibÃ­a text/plain "Too many requests..." y crasheaba
 *     con "Unexpected token 'T'... is not valid JSON").
 *   - standardHeaders: 'draft-7' expone cabeceras RateLimit-* legibles.
 * =================================================================== */
function jsonRateLimitHandler(retryAfterSeconds) {
  return (req, res /* , next, options */) => {
    res.status(429).json({
      error: 'Demasiadas peticiones. EsperÃ¡ unos minutos e intentÃ¡ de nuevo.',
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
    // honra X-Forwarded-For si trust proxy estÃ¡ activado).
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
    // Por (email, IP) â€” alguien tipeando mal su pass no bloquea a otros del
    // mismo NAT, pero un atacante por IP-Ãºnica no escapa con N emails.
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

// V2 modules â€” currently 501 stubs; sprints 2+ replace each file.
const _stubs = require('./routes/_stubs');
app.use('/api/clients',           require('./routes/clients'));       // âœ… Sprint 2
app.use('/api/opportunities',     require('./routes/opportunities')); // âœ… Sprint 2
app.use('/api/employees',         require('./routes/employees'));    // âœ… Sprint 3 EE-1
app.use('/api/skills',            require('./routes/skills'));       // âœ… Sprint 3 EA-2
app.use('/api/areas',             require('./routes/areas'));        // âœ… Sprint 3 EA-1
app.use('/api/contracts',         require('./routes/contracts'));    // âœ… Sprint 4 EK-1/EK-2
app.use('/api/revenue',           require('./routes/revenue'));      // âœ… RR-MVP-00.1 (placeholder, eng team to refactor)
app.use('/api/admin/exchange-rates', require('./routes/exchange_rates')); // âœ… RR-MVP-00.6 (placeholder)
app.use('/api/time-allocations',  require('./routes/time_allocations')); // âœ… Time-MVP-00.1 (placeholder, weekly %)
app.use('/api/resource-requests', require('./routes/resource_requests')); // âœ… Sprint 4 ER-1/ER-2
app.use('/api/assignments',       require('./routes/assignments'));  // âœ… Sprint 4 EN-1/EN-2/EN-5
app.use('/api/capacity',          require('./routes/capacity'));     // âœ… Sprint 6 US-BK-1 (planner)
app.use('/api/time-entries',      require('./routes/time_entries')); // âœ… Sprint 5 ET-*
app.use('/api/reports',           require('./routes/reports'));      // âœ… Sprint 6 EI-* / ED-1
app.use('/api/dashboard',         require('./routes/dashboard'));    // âœ… Executive Dashboard v2
app.use('/api/search',            require('./routes/search'));       // âœ… Command Palette
app.use('/api/bulk-import',       require('./routes/bulk_import'));  // âœ… Sprint 9 (admin+)
app.use('/api/squads',            _stubs.squads);
app.use('/api/events',            _stubs.events);
app.use('/api/notifications',     require('./routes/notifications')); // âœ… In-app notifications
// SPEC-CRM-01 â€” Contacts, Activities, Budgets (CRM enrichment)
app.use('/api/contacts',          require('./routes/contacts'));
app.use('/api/activities',        require('./routes/activities'));
app.use('/api/budgets',           require('./routes/budgets'));
app.use('/api/ai-interactions',   require('./routes/ai_interactions')); // âœ… AI agent log + decision feedback
app.use('/api/employee-costs',    require('./routes/employee_costs')); // âœ… Employee Costs (admin-only PII)
// SPEC-II-00 â€” Internal Initiatives, Novelties & Idle Time (Abril 2026)
app.use('/api/internal-initiatives', require('./routes/internal_initiatives'));
app.use('/api/novelties',         require('./routes/novelties'));
app.use('/api/holidays',          require('./routes/holidays'));
app.use('/api/idle-time',         require('./routes/idle_time'));
app.use('/api/me',                require('./routes/me'));           // SPEC-EMP-00 self-service
app.use('/api/reports/v2',        require('./routes/reports_v2'));    // Reports v2 â€” aggregate endpoints for charts
app.use('/api/rm',                require('./routes/rm'));            // SPEC-RM-00 Resource Management
// SPEC-PRJ-HEALTH-01 — Project Health (EVM/PMI)
app.use('/api/projects',          require('./routes/project_health'));
app.use('/api/admin/settings',    require('./routes/app_settings'));  // System config (superadmin)

if (process.env.NODE_ENV === 'production') {
  // Hashed static assets (JS, CSS, media) â€” safe to cache long-term.
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

// Global error handler â€” safety net for unhandled errors in routes
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
