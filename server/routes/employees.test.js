/**
 * Unit tests for server/routes/employees.js (EE-1).
 *
 * Same harness pattern as areas/skills tests.
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

let mockCurrentUser = { id: 'u1', role: 'admin' };
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

const empRouter = require('./employees');
const app = express();
app.use(express.json());
app.use('/api/employees', empRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'admin' };
});

const validBody = {
  first_name: 'Ana', last_name: 'García',
  country: 'Colombia', area_id: 1, level: 'L3',
  start_date: '2026-01-15',
};

describe('GET /api/employees', () => {
  it('returns paginated list with defaults', async () => {
    queryQueue.push({ rows: [{ total: 2 }] });
    queryQueue.push({ rows: [
      { id: 'e1', first_name: 'Ana',  last_name: 'G', area_name: 'Desarrollo', skills_count: 3 },
      { id: 'e2', first_name: 'Luis', last_name: 'P', area_name: 'QA',         skills_count: 0 },
    ] });
    const res = await client.call('GET', '/api/employees');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ page: 1, limit: 25, total: 2, pages: 1 });
    expect(issuedQueries[0].sql).toMatch(/deleted_at IS NULL/);
  });

  it('applies filter combination', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/employees?search=ana&area_id=1&level=L3&status=active&country=Colombia');
    const sql = issuedQueries[0].sql;
    expect(sql).toMatch(/LOWER\(e\.first_name\) LIKE/);
    expect(sql).toMatch(/e\.area_id =/);
    expect(sql).toMatch(/e\.level =/);
    expect(sql).toMatch(/e\.status =/);
  });
});

describe('GET /api/employees/:id', () => {
  it('returns 404 when missing', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/employees/missing');
    expect(res.status).toBe(404);
  });

  it('returns employee with counts', async () => {
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', skills_count: 3, active_assignments_count: 1 }] });
    const res = await client.call('GET', '/api/employees/e1');
    expect(res.status).toBe(200);
    expect(res.body.skills_count).toBe(3);
    expect(res.body.active_assignments_count).toBe(1);
  });
});

describe('POST /api/employees (admin+)', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/employees', validBody);
    expect(res.status).toBe(403);
  });

  it('rejects when required fields are missing', async () => {
    for (const miss of ['first_name','last_name','country','area_id','level','start_date']) {
      const body = { ...validBody, [miss]: undefined };
      // eslint-disable-next-line no-await-in-loop
      const res = await client.call('POST', '/api/employees', body);
      expect(res.status).toBe(400);
    }
  });

  it('rejects invalid level', async () => {
    const res = await client.call('POST', '/api/employees', { ...validBody, level: 'L99' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/level/i);
  });

  it('rejects invalid status', async () => {
    const res = await client.call('POST', '/api/employees', { ...validBody, status: 'ghosted' });
    expect(res.status).toBe(400);
  });

  it('rejects when area does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/employees', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/area_id no existe/);
  });

  it('rejects when area is inactive', async () => {
    queryQueue.push({ rows: [{ id: 1, active: false }] });
    const res = await client.call('POST', '/api/employees', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/área está inactiva/i);
  });

  it('rejects duplicate corporate_email', async () => {
    queryQueue.push({ rows: [{ id: 1, active: true }] });
    queryQueue.push({ rows: [{ id: 'existing' }] });
    const res = await client.call('POST', '/api/employees', { ...validBody, corporate_email: 'ana@dvpnyx.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/corporate_email/);
  });

  it('rejects when user_id is already linked to another employee', async () => {
    queryQueue.push({ rows: [{ id: 1, active: true }] });
    queryQueue.push({ rows: [{ id: 'other-employee' }] });
    const res = await client.call('POST', '/api/employees', { ...validBody, user_id: 'u42' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/usuario ya está asociado/i);
  });

  it('creates employee with user_id=null (employee without system account)', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 1, active: true }] });
    queryQueue.push({ rows: [{ id: 'e-new', first_name: 'Ana', last_name: 'García', status: 'active' }] });
    const res = await client.call('POST', '/api/employees', validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('e-new');
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.created');
    expect(call).toBeTruthy();
  });
});

describe('PUT /api/employees/:id (admin+)', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('PUT', '/api/employees/e1', { first_name: 'X' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when missing', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('PUT', '/api/employees/missing', { first_name: 'X' });
    expect(res.status).toBe(404);
  });

  it('rejects empty first_name', async () => {
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'A' }] });
    const res = await client.call('PUT', '/api/employees/e1', { first_name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid level on update', async () => {
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'A' }] });
    const res = await client.call('PUT', '/api/employees/e1', { level: 'L999' });
    expect(res.status).toBe(400);
  });

  it('updates and emits event with changed_fields', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'García', status: 'active', level: 'L3' }] });
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'García', status: 'active', level: 'L4' }] });
    const res = await client.call('PUT', '/api/employees/e1', { level: 'L4' });
    expect(res.status).toBe(200);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.updated');
    expect(call).toBeTruthy();
    expect(call[1].payload.changed_fields).toContain('level');
  });
});

describe('DELETE /api/employees/:id (admin+)', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('DELETE', '/api/employees/e1');
    expect(res.status).toBe(403);
  });

  it('rejects with 409 when has active assignments', async () => {
    queryQueue.push({ rows: [{ active_assignments: 2 }] });
    const res = await client.call('DELETE', '/api/employees/e1');
    expect(res.status).toBe(409);
    expect(res.body.active_assignments).toBe(2);
  });

  it('soft-deletes when no active assignments + emits event', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ active_assignments: 0 }] });
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'García' }] });
    const res = await client.call('DELETE', '/api/employees/e1');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/eliminado/i);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.deleted');
    expect(call).toBeTruthy();
  });
});
