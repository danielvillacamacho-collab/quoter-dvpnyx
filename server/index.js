require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
// Detrás de Traefik (1 hop). Necesario para que req.ip sea el IP real del
// cliente y el rate-limit no agrupe todo el tráfico bajo el IP del proxy.
// Más seguro que 'true' porque sólo confía en un único hop.
app.set('trust proxy', 1);
app.use(helmet());
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
app.use('/api/ai-interactions',   require('./routes/ai_interactions')); // ✅ AI agent log + decision feedback

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

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Error interno del servidor' }); });

// Only start the HTTP listener when executed directly (EC2 / local dev).
// When required by lambda.js for API Gateway, we just export the app.
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`DVPNYX Quoter API running on port ${PORT}`));
}

module.exports = app;
