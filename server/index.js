require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '5mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Demasiados intentos. Intente en 15 minutos.' } });
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
app.use('/api/employees',         _stubs.employees);
app.use('/api/skills',            require('./routes/skills'));       // ✅ Sprint 3 EA-2
app.use('/api/areas',             require('./routes/areas'));        // ✅ Sprint 3 EA-1
app.use('/api/contracts',         _stubs.contracts);
app.use('/api/resource-requests', _stubs.resourceRequests);
app.use('/api/assignments',       _stubs.assignments);
app.use('/api/time-entries',      _stubs.timeEntries);
app.use('/api/reports',           _stubs.reports);
app.use('/api/squads',            _stubs.squads);
app.use('/api/events',            _stubs.events);
app.use('/api/notifications',     _stubs.notifications);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (_, res) => res.sendFile(path.join(__dirname, '../client/build/index.html')));
}

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Error interno del servidor' }); });

// Only start the HTTP listener when executed directly (EC2 / local dev).
// When required by lambda.js for API Gateway, we just export the app.
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`DVPNYX Quoter API running on port ${PORT}`));
}

module.exports = app;
