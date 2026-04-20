/**
 * Unit tests for server/routes/areas.js (EA-1).
 *
 * Same harness pattern as clients.test.js — pg is module-mocked, auth
 * middleware is stubbed, an http harness drives the route.
 */

const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (!queryQueue.length) {
      throw new Error(`Unexpected query (no mock enqueued): ${String(sql).slice(0, 80)}`);
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

jest.mock('../utils/events', () => ({
  emitEvent: jest.fn(async () => ({ id: 'evt', created_at: new Date().toISOString() })),
  buildUpdatePayload: jest.requireActual('../utils/events').buildUpdatePayload,
}));

let mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
  superadminOnly: (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Rol insuficiente' });
    next();
  },
}));

const express = require('express');
const request = (app) => {
  const http = require('http');
  return {
    async call(method, url, body = null) {
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
    },
  };
};

const areasRouter = require('./areas');
const app = express();
app.use(express.json());
app.use('/api/areas', areasRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
});

describe('GET /api/areas', () => {
  it('returns all areas sorted by sort_order', async () => {
    queryQueue.push({ rows: [
      { id: 1, key: 'development', name: 'Desarrollo', sort_order: 1, active: true, active_employees_count: 0 },
      { id: 2, key: 'testing', name: 'Testing', sort_order: 3, active: true, active_employees_count: 0 },
    ] });
    const res = await client.call('GET', '/api/areas');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(issuedQueries[0].sql).toMatch(/ORDER BY a\.sort_order/);
  });

  it('filters by active=true', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/areas?active=true');
    expect(issuedQueries[0].sql).toMatch(/active = \$1/);
    expect(issuedQueries[0].params).toEqual([true]);
  });
});

describe('GET /api/areas/:id', () => {
  it('returns 404 when not found', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/areas/999');
    expect(res.status).toBe(404);
  });

  it('returns area with employee count', async () => {
    queryQueue.push({ rows: [{ id: 1, key: 'development', name: 'Desarrollo', active_employees_count: 5 }] });
    const res = await client.call('GET', '/api/areas/1');
    expect(res.status).toBe(200);
    expect(res.body.active_employees_count).toBe(5);
  });
});

describe('POST /api/areas (admin+)', () => {
  it('rejects non-admin with 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/areas', { key: 'new', name: 'New' });
    expect(res.status).toBe(403);
  });

  it('rejects when key is missing', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const res = await client.call('POST', '/api/areas', { name: 'X' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/);
  });

  it('rejects when name is missing', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const res = await client.call('POST', '/api/areas', { key: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('rejects duplicate key with 409 + hint', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ id: 1, key: 'development', name: 'Desarrollo' }] });
    const res = await client.call('POST', '/api/areas', { key: 'Development', name: 'Dev' });
    expect(res.status).toBe(409);
    expect(res.body.hint).toBe('Desarrollo');
    expect(res.body.existing_id).toBe(1);
  });

  it('creates an area and emits event', async () => {
    const { emitEvent } = require('../utils/events');
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [] }); // no dup
    queryQueue.push({ rows: [{ id: 10, key: 'new_area', name: 'New', sort_order: 0 }] });
    const res = await client.call('POST', '/api/areas', { key: 'new_area', name: 'New' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'area.created');
    expect(call).toBeTruthy();
  });
});

describe('PUT /api/areas/:id (admin+)', () => {
  it('rejects non-admin', async () => {
    const res = await client.call('PUT', '/api/areas/1', { name: 'X' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when area does not exist', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [] });
    const res = await client.call('PUT', '/api/areas/999', { name: 'X' });
    expect(res.status).toBe(404);
  });

  it('rejects rename to a key that already exists', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ id: 1, key: 'dev', name: 'Dev' }] });     // SELECT before
    queryQueue.push({ rows: [{ id: 2 }] });                               // duplicate found
    const res = await client.call('PUT', '/api/areas/1', { key: 'testing' });
    expect(res.status).toBe(409);
  });

  it('updates and emits area.updated with changed_fields', async () => {
    const { emitEvent } = require('../utils/events');
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ id: 1, key: 'dev', name: 'Desarrollo', description: null, sort_order: 1 }] });
    queryQueue.push({ rows: [{ id: 1, key: 'dev', name: 'Desarrollo', description: 'Nueva descripción', sort_order: 1 }] });
    const res = await client.call('PUT', '/api/areas/1', { description: 'Nueva descripción' });
    expect(res.status).toBe(200);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'area.updated');
    expect(call).toBeTruthy();
    expect(call[1].payload.changed_fields).toContain('description');
  });
});

describe('POST /api/areas/:id/deactivate (admin+)', () => {
  it('rejects non-admin', async () => {
    const res = await client.call('POST', '/api/areas/1/deactivate');
    expect(res.status).toBe(403);
  });

  it('rejects with 409 when there are active employees', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ count: 3 }] });
    const res = await client.call('POST', '/api/areas/1/deactivate');
    expect(res.status).toBe(409);
    expect(res.body.active_employees_count).toBe(3);
  });

  it('deactivates when no active employees + emits event', async () => {
    const { emitEvent } = require('../utils/events');
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ count: 0 }] });
    queryQueue.push({ rows: [{ id: 1, key: 'dev', name: 'Dev', active: false }] });
    const res = await client.call('POST', '/api/areas/1/deactivate');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'area.deactivated');
    expect(call).toBeTruthy();
  });
});

describe('POST /api/areas/:id/activate (admin+)', () => {
  it('rejects non-admin', async () => {
    const res = await client.call('POST', '/api/areas/1/activate');
    expect(res.status).toBe(403);
  });

  it('reactivates + emits event', async () => {
    const { emitEvent } = require('../utils/events');
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ id: 1, key: 'dev', name: 'Dev', active: true }] });
    const res = await client.call('POST', '/api/areas/1/activate');
    expect(res.status).toBe(200);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'area.activated');
    expect(call).toBeTruthy();
  });
});
