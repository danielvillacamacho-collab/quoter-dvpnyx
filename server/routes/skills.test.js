/**
 * Unit tests for server/routes/skills.js (EA-2).
 *
 * Same harness pattern as areas.test.js.
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

const skillsRouter = require('./skills');
const app = express();
app.use(express.json());
app.use('/api/skills', skillsRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
});

describe('GET /api/skills', () => {
  it('returns skills grouped by category ordering', async () => {
    queryQueue.push({ rows: [
      { id: 1, name: 'React', category: 'framework', active: true, employees_count: 3 },
      { id: 2, name: 'Python', category: 'language', active: true, employees_count: 7 },
    ] });
    const res = await client.call('GET', '/api/skills');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(issuedQueries[0].sql).toMatch(/ORDER BY s\.category/);
  });

  it('applies active + search + category filters', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/skills?active=true&search=react&category=framework');
    const sql = issuedQueries[0].sql;
    expect(sql).toMatch(/s\.active = \$1/);
    expect(sql).toMatch(/s\.category = \$2/);
    expect(sql).toMatch(/LOWER\(s\.name\) LIKE LOWER\(\$3\)/);
  });
});

describe('POST /api/skills (admin+)', () => {
  it('rejects non-admin with 403', async () => {
    const res = await client.call('POST', '/api/skills', { name: 'Rust' });
    expect(res.status).toBe(403);
  });

  it('rejects when name is missing', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const res = await client.call('POST', '/api/skills', { category: 'language' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate name (case-insensitive) with 409', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ id: 10, name: 'React' }] });
    const res = await client.call('POST', '/api/skills', { name: 'react' });
    expect(res.status).toBe(409);
    expect(res.body.hint).toBe('React');
  });

  it('creates a skill and emits event', async () => {
    const { emitEvent } = require('../utils/events');
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [{ id: 99, name: 'Rust', category: 'language', active: true }] });
    const res = await client.call('POST', '/api/skills', { name: 'Rust', category: 'language' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(99);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'skill.created');
    expect(call).toBeTruthy();
  });
});

describe('PUT /api/skills/:id (admin+)', () => {
  it('rejects non-admin', async () => {
    const res = await client.call('PUT', '/api/skills/1', { name: 'X' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when skill does not exist', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [] });
    const res = await client.call('PUT', '/api/skills/999', { name: 'X' });
    expect(res.status).toBe(404);
  });

  it('rejects rename to an existing name', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ id: 1, name: 'React', category: 'framework' }] });
    queryQueue.push({ rows: [{ id: 2 }] });
    const res = await client.call('PUT', '/api/skills/1', { name: 'Vue' });
    expect(res.status).toBe(409);
  });

  it('updates + emits event with changed_fields', async () => {
    const { emitEvent } = require('../utils/events');
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ id: 1, name: 'React', category: 'framework', description: null }] });
    queryQueue.push({ rows: [{ id: 1, name: 'React', category: 'frontend', description: null }] });
    const res = await client.call('PUT', '/api/skills/1', { category: 'frontend' });
    expect(res.status).toBe(200);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'skill.updated');
    expect(call).toBeTruthy();
    expect(call[1].payload.changed_fields).toContain('category');
  });
});

describe('POST /api/skills/:id/deactivate (admin+)', () => {
  it('rejects 409 when skill is assigned to employees', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ count: 7 }] });
    const res = await client.call('POST', '/api/skills/1/deactivate');
    expect(res.status).toBe(409);
    expect(res.body.employees_count).toBe(7);
  });

  it('deactivates when no employees + emits event', async () => {
    const { emitEvent } = require('../utils/events');
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ count: 0 }] });
    queryQueue.push({ rows: [{ id: 1, name: 'Legacy', active: false }] });
    const res = await client.call('POST', '/api/skills/1/deactivate');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'skill.deactivated');
    expect(call).toBeTruthy();
  });
});
