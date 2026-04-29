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
      throw new Error(`Unexpected query: ${String(sql).slice(0, 100)}`);
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

const router = require('./novelties');
const app = express();
app.use(express.json());
app.use('/api/novelties', router);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockUser = { id: 'u1', role: 'admin' };
});

const empId = '11111111-1111-1111-1111-111111111111';
const novId = '22222222-2222-2222-2222-222222222222';

describe('GET /', () => {
  it('admin lista todo (sin scoping)', async () => {
    queryQueue.push({ rows: [{ total: 1 }] });
    queryQueue.push({ rows: [{ id: novId, employee_id: empId, novelty_type_id: 'vacation' }] });
    const r = await call(app, 'GET', '/api/novelties');
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
  });

  it('member sin filtro → solo sus propias', async () => {
    mockUser = { id: 'u1', role: 'member' };
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await call(app, 'GET', '/api/novelties');
    const lastSql = issuedQueries[issuedQueries.length - 1].sql;
    expect(lastSql).toMatch(/EXISTS.*employees.*user_id =/s);
  });

  it('lead sin filtro → suyas + de su equipo', async () => {
    mockUser = { id: 'u1', role: 'lead' };
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await call(app, 'GET', '/api/novelties');
    const lastSql = issuedQueries[issuedQueries.length - 1].sql;
    expect(lastSql).toMatch(/manager_user_id =/);
  });

  it('member con filtro employee_id ajeno → 403', async () => {
    mockUser = { id: 'u1', role: 'member' };
    queryQueue.push({ rows: [{ id: empId, user_id: 'someone-else', manager_user_id: null }] });
    const r = await call(app, 'GET', `/api/novelties?employee_id=${empId}`);
    expect(r.status).toBe(403);
  });
});

describe('POST /', () => {
  const validBody = {
    employee_id: empId,
    novelty_type_id: 'vacation',
    start_date: '2026-06-15',
    end_date: '2026-06-26',
    reason: 'Vacaciones programadas',
  };

  it('admin crea OK', async () => {
    queryQueue.push({ rows: [{ id: empId }] });          // employee exists
    queryQueue.push({ rows: [{ id: novId, ...validBody, status: 'approved' }] });
    const r = await call(app, 'POST', '/api/novelties', validBody);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('approved');
  });

  it('member intenta crear → 403', async () => {
    mockUser = { id: 'u1', role: 'member' };
    const r = await call(app, 'POST', '/api/novelties', validBody);
    expect(r.status).toBe(403);
  });

  it('lead crea para su equipo → OK', async () => {
    mockUser = { id: 'u1', role: 'lead' };
    queryQueue.push({ rows: [{ id: empId, user_id: null, manager_user_id: 'u1' }] }); // checkEmployeeScope
    queryQueue.push({ rows: [{ id: empId }] });           // BEGIN, then employee exists
    queryQueue.push({ rows: [{ id: novId, ...validBody, status: 'approved' }] });
    const r = await call(app, 'POST', '/api/novelties', validBody);
    expect(r.status).toBe(201);
  });

  it('lead intenta crear para ajeno → 403', async () => {
    mockUser = { id: 'u1', role: 'lead' };
    queryQueue.push({ rows: [{ id: empId, user_id: 'other', manager_user_id: 'other' }] });
    const r = await call(app, 'POST', '/api/novelties', validBody);
    expect(r.status).toBe(403);
  });

  it('400 si novelty_type inválido', async () => {
    const r = await call(app, 'POST', '/api/novelties', { ...validBody, novelty_type_id: 'made_up' });
    expect(r.status).toBe(400);
  });

  it('400 end_date < start_date', async () => {
    const r = await call(app, 'POST', '/api/novelties', { ...validBody, start_date: '2026-06-30', end_date: '2026-06-01' });
    expect(r.status).toBe(400);
  });

  it('422 overlap del trigger', async () => {
    queryQueue.push({ rows: [{ id: empId }] });
    queryQueue.push(new Error('novelty_overlap: employee already has approved novelty'));
    const r = await call(app, 'POST', '/api/novelties', validBody);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('overlap_detected');
  });
});

describe('POST /:id/cancel', () => {
  it('admin cancela', async () => {
    queryQueue.push({ rows: [{ id: novId, status: 'approved', employee_user_id: 'someone', manager_user_id: null, created_by: 'u1' }] });
    queryQueue.push({ rows: [{ id: novId, status: 'cancelled' }] });
    const r = await call(app, 'POST', `/api/novelties/${novId}/cancel`,
      { cancellation_reason: 'Necesita reagendar' });
    expect(r.status).toBe(200);
  });
  it('400 sin reason', async () => {
    const r = await call(app, 'POST', `/api/novelties/${novId}/cancel`, {});
    expect(r.status).toBe(400);
  });
  it('409 si ya cancelada', async () => {
    queryQueue.push({ rows: [{ id: novId, status: 'cancelled' }] });
    const r = await call(app, 'POST', `/api/novelties/${novId}/cancel`,
      { cancellation_reason: 'Ya estaba mal' });
    expect(r.status).toBe(409);
  });
});

describe('GET /_meta/types', () => {
  it('200', async () => {
    queryQueue.push({ rows: [{ id: 'vacation', label_es: 'Vacaciones' }] });
    const r = await call(app, 'GET', '/api/novelties/_meta/types');
    expect(r.status).toBe(200);
    expect(r.body.data[0].id).toBe('vacation');
  });
});

describe('GET /calendar/:employee_id', () => {
  it('admin obtiene calendario combinado', async () => {
    queryQueue.push({ rows: [{ id: empId, country_id: 'CO', weekly_capacity_hours: 40, first_name: 'D', last_name: 'M' }] });
    queryQueue.push({ rows: [{ holiday_date: '2026-06-29', label: 'San Pedro' }] });
    queryQueue.push({ rows: [] }); // novelties
    queryQueue.push({ rows: [] }); // contract assignments
    queryQueue.push({ rows: [] }); // internal assignments
    const r = await call(app, 'GET', `/api/novelties/calendar/${empId}?from=2026-06-01&to=2026-06-30`);
    expect(r.status).toBe(200);
    expect(r.body.holidays).toHaveLength(1);
  });
  it('400 si rango inválido', async () => {
    const r = await call(app, 'GET', `/api/novelties/calendar/${empId}?from=2026-06-30&to=2026-06-01`);
    expect(r.status).toBe(400);
  });
});
