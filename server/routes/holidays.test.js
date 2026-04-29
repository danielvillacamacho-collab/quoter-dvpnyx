const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (mockControlSql.has(sql)) return { rows: [] };
    if (typeof sql === 'string' && (
      sql.startsWith('SAVEPOINT') || sql.startsWith('RELEASE SAVEPOINT') || sql.startsWith('ROLLBACK TO SAVEPOINT')
    )) return { rows: [] };
    if (!queryQueue.length) {
      throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
    }
    const next = queryQueue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    query: jest.fn(async (sql, params) => pushAndPop(sql, params)),
    connect: jest.fn(async () => ({
      query: async (sql, params) => pushAndPop(sql, params),
      release: () => {},
    })),
  };
});

jest.mock('../utils/events', () => ({ emitEvent: jest.fn(async () => ({})), buildUpdatePayload: () => ({}) }));

let mockUser = { id: 'u1', role: 'admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
  superadminOnly: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const http = require('http');
function call(app, method, url, body = null) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app).listen(0, () => {
      const { port } = srv.address();
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = http.request(
        { host: '127.0.0.1', port, path: url, method, headers: {
          'content-type': 'application/json',
          'content-length': data ? data.length : 0,
          authorization: 'Bearer fake',
        } },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            srv.close();
            let parsed = null;
            try { parsed = buf ? JSON.parse(buf) : null; } catch { parsed = buf; }
            resolve({ status: res.statusCode, body: parsed });
          });
        },
      );
      req.on('error', (e) => { srv.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

const router = require('./holidays');
const app = express();
app.use(express.json());
app.use('/api/holidays', router);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockUser = { id: 'u1', role: 'admin' };
});

const validId = '11111111-1111-1111-1111-111111111111';

describe('GET /', () => {
  it('lista con filtros country+year', async () => {
    queryQueue.push({ rows: [{ id: 'h1', country_id: 'CO', year: 2026 }] });
    const r = await call(app, 'GET', '/api/holidays?country=co&year=2026');
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    const sql = issuedQueries[issuedQueries.length - 1].sql;
    expect(sql).toMatch(/h\.country_id =/);
    expect(sql).toMatch(/h\.year =/);
    // country pasa a uppercase
    expect(issuedQueries[issuedQueries.length - 1].params).toContain('CO');
  });
});

describe('GET /_meta/countries', () => {
  it('200', async () => {
    queryQueue.push({ rows: [{ id: 'CO', label_es: 'Colombia' }] });
    const r = await call(app, 'GET', '/api/holidays/_meta/countries');
    expect(r.status).toBe(200);
    expect(r.body.data[0].id).toBe('CO');
  });
});

describe('POST /', () => {
  const body = { country_id: 'co', holiday_date: '2026-12-31', label: 'Fin de año', holiday_type: 'company' };
  it('admin crea', async () => {
    queryQueue.push({ rows: [{ id: validId, country_id: 'CO' }] });
    const r = await call(app, 'POST', '/api/holidays', body);
    expect(r.status).toBe(201);
    expect(r.body.country_id).toBe('CO');
  });
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'member' };
    const r = await call(app, 'POST', '/api/holidays', body);
    expect(r.status).toBe(403);
  });
  it('400 country_id inválido', async () => {
    const r = await call(app, 'POST', '/api/holidays', { ...body, country_id: 'COL' });
    expect(r.status).toBe(400);
  });
  it('400 holiday_date inválido', async () => {
    const r = await call(app, 'POST', '/api/holidays', { ...body, holiday_date: '2026/12/31' });
    expect(r.status).toBe(400);
  });
  it('400 label vacío', async () => {
    const r = await call(app, 'POST', '/api/holidays', { ...body, label: '' });
    expect(r.status).toBe(400);
  });
  it('409 si duplicado (pgcode 23505)', async () => {
    const err = new Error('duplicate'); err.code = '23505';
    queryQueue.push(err);
    const r = await call(app, 'POST', '/api/holidays', body);
    expect(r.status).toBe(409);
  });
});

describe('PUT /:id', () => {
  it('actualiza label', async () => {
    queryQueue.push({ rows: [{ id: validId, label: 'Fin de Año (corregido)' }] });
    const r = await call(app, 'PUT', `/api/holidays/${validId}`, { label: 'Fin de Año (corregido)' });
    expect(r.status).toBe(200);
  });
  it('400 label muy corto', async () => {
    const r = await call(app, 'PUT', `/api/holidays/${validId}`, { label: 'X' });
    expect(r.status).toBe(400);
  });
  it('400 sin campos', async () => {
    const r = await call(app, 'PUT', `/api/holidays/${validId}`, {});
    expect(r.status).toBe(400);
  });
});

describe('DELETE /:id', () => {
  it('elimina', async () => {
    queryQueue.push({ rowCount: 1 });
    const r = await call(app, 'DELETE', `/api/holidays/${validId}`);
    expect(r.status).toBe(200);
  });
  it('404 si no existe', async () => {
    queryQueue.push({ rowCount: 0 });
    const r = await call(app, 'DELETE', `/api/holidays/${validId}`);
    expect(r.status).toBe(404);
  });
});
