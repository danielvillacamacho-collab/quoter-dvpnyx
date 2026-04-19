/**
 * Unit tests for server/routes/clients.js
 *
 * We mock the pg Pool at the module level so the route handlers run
 * against canned query results. This gives us deterministic coverage
 * of the REST contract (validations, status codes, role gating) without
 * needing a real Postgres.
 */

// ---- Shared test harness ----
// We track every query issued so we can assert on them, and allow each
// test to enqueue the row set each query should return in order.
const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  return {
    query: jest.fn(async (sql, params) => {
      issuedQueries.push({ sql, params });
      if (!queryQueue.length) {
        throw new Error(`Unexpected query (no mock enqueued): ${sql.slice(0, 80)}`);
      }
      const next = queryQueue.shift();
      if (next instanceof Error) throw next;
      return next;
    }),
    connect: jest.fn(async () => ({
      query: async (sql, params) => {
        issuedQueries.push({ sql, params });
        if (!queryQueue.length) throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
        const next = queryQueue.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      release: () => {},
    })),
  };
});

// The emitEvent helper hits the pool too; stub it out so we don't need
// to enqueue its INSERT rows in every test.
jest.mock('../utils/events', () => ({
  emitEvent: jest.fn(async () => ({ id: 'evt', created_at: new Date().toISOString() })),
  buildUpdatePayload: jest.requireActual('../utils/events').buildUpdatePayload,
}));

// Stub auth middleware to inject a fake user (preserves role-gating tests).
let mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Acceso solo para administradores' });
    next();
  },
  superadminOnly: (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Acceso solo para superadmin' });
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Rol insuficiente' });
    next();
  },
}));

const express = require('express');
const request = (app) => {
  // Minimal supertest-free harness: call express via http module.
  // We use a tiny polyfill instead of adding supertest as a dep for speed.
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

const clientsRouter = require('./clients');
const app = express();
app.use(express.json());
app.use('/api/clients', clientsRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
});

/* ---------- GET / ---------- */
describe('GET /api/clients', () => {
  it('returns paginated list with defaults', async () => {
    queryQueue.push({ rows: [{ total: 2 }] });
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Globex' }] });
    const res = await client.call('GET', '/api/clients');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ page: 1, limit: 25, total: 2, pages: 1 });
    // Both queries should have filtered out soft-deleted rows
    expect(issuedQueries[0].sql).toMatch(/deleted_at IS NULL/);
  });

  it('applies search + country filter', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/clients?search=acme&country=Colombia');
    const firstSql = issuedQueries[0].sql;
    expect(firstSql).toMatch(/LOWER\(name\) LIKE/);
    expect(firstSql).toMatch(/country =/);
  });
});

/* ---------- GET /:id ---------- */
describe('GET /api/clients/:id', () => {
  it('returns 404 when not found', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/clients/missing');
    expect(res.status).toBe(404);
  });

  it('returns client with counts', async () => {
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme', opportunities_count: 3, active_contracts_count: 1 }] });
    const res = await client.call('GET', '/api/clients/c1');
    expect(res.status).toBe(200);
    expect(res.body.opportunities_count).toBe(3);
  });
});

/* ---------- POST / ---------- */
describe('POST /api/clients', () => {
  it('rejects when name is missing', async () => {
    const res = await client.call('POST', '/api/clients', { country: 'Colombia' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nombre/i);
  });

  it('rejects invalid tier', async () => {
    const res = await client.call('POST', '/api/clients', { name: 'Acme', tier: 'unicorn' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tier/i);
  });

  it('rejects duplicate name with 409 and hint', async () => {
    queryQueue.push({ rows: [{ id: 'existing', name: 'ACME' }] });
    const res = await client.call('POST', '/api/clients', { name: 'Acme' });
    expect(res.status).toBe(409);
    expect(res.body.hint).toBe('ACME');
    expect(res.body.existing_id).toBe('existing');
  });

  it('creates a client with valid payload and emits event', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [] }); // no dup
    queryQueue.push({ rows: [{ id: 'new-1', name: 'Acme', country: 'Colombia', tier: 'enterprise' }] });
    const res = await client.call('POST', '/api/clients', {
      name: 'Acme', country: 'Colombia', tier: 'enterprise',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('new-1');
    expect(emitEvent).toHaveBeenCalled();
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'client.created');
    expect(call).toBeTruthy();
    expect(call[1].entity_id).toBe('new-1');
  });

  it('trims whitespace around the name', async () => {
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [{ id: 'c', name: 'Acme' }] });
    await client.call('POST', '/api/clients', { name: '   Acme   ' });
    // params of the dup-check query should be ['Acme']
    const insertCall = issuedQueries[1];
    expect(insertCall.params[0]).toBe('Acme');
  });
});

/* ---------- PUT /:id ---------- */
describe('PUT /api/clients/:id', () => {
  it('returns 404 if client does not exist', async () => {
    queryQueue.push({ rows: [] }); // SELECT before
    const res = await client.call('PUT', '/api/clients/missing', { name: 'X' });
    expect(res.status).toBe(404);
  });

  it('rejects renaming to an already-used name', async () => {
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme', tier: 'smb' }] });  // SELECT before
    queryQueue.push({ rows: [{ id: 'other' }] });                           // dup check finds another
    const res = await client.call('PUT', '/api/clients/c1', { name: 'Globex' });
    expect(res.status).toBe(409);
  });

  it('updates a client and emits event with changed_fields', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme', country: 'Colombia', tier: 'smb' }] });
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme', country: 'México',   tier: 'smb' }] });
    const res = await client.call('PUT', '/api/clients/c1', { country: 'México' });
    expect(res.status).toBe(200);
    const updatedCall = emitEvent.mock.calls.find((c) => c[1].event_type === 'client.updated');
    expect(updatedCall).toBeTruthy();
    expect(updatedCall[1].payload.changed_fields).toContain('country');
  });
});

/* ---------- DELETE /:id ---------- */
describe('DELETE /api/clients/:id (admin+)', () => {
  it('rejects non-admin users with 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('DELETE', '/api/clients/c1');
    expect(res.status).toBe(403);
    expect(issuedQueries).toHaveLength(0);
  });

  it('rejects deletion when client has opportunities or contracts', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ opps: 3, ctrs: 0 }] });
    const res = await client.call('DELETE', '/api/clients/c1');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/3 oportunidad/);
  });

  it('soft-deletes when there are no dependencies', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ opps: 0, ctrs: 0 }] });
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }] });
    const res = await client.call('DELETE', '/api/clients/c1');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/eliminado/i);
  });
});

/* ---------- deactivate/activate ---------- */
describe('deactivate/activate (admin+)', () => {
  it('non-admin gets 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/clients/c1/deactivate');
    expect(res.status).toBe(403);
  });

  it('admin can deactivate a client', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme', active: false }] });
    const res = await client.call('POST', '/api/clients/c1/deactivate');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });
});
