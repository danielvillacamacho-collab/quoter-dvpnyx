/**
 * Unit tests for server/routes/resource_requests.js (ER-1, ER-2).
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
  superadminOnly: (req, res, next) => { next(); },
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

const rrRouter = require('./resource_requests');
const app = express();
app.use(express.json());
app.use('/api/resource-requests', rrRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'admin' };
});

const validBody = {
  contract_id: 'ct1', role_title: 'Senior Dev', area_id: 1, level: 'L4',
  start_date: '2026-05-01', quantity: 2, priority: 'high',
};

describe('GET /api/resource-requests', () => {
  it('returns list with computed status (open when no active assignments)', async () => {
    queryQueue.push({ rows: [{ total: 1 }] });
    queryQueue.push({ rows: [
      { id: 'r1', role_title: 'Dev', status: 'open', quantity: 2, active_assignments_count: 0, priority: 'high' },
    ] });
    const res = await client.call('GET', '/api/resource-requests');
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('open');
    expect(res.body.data[0].stored_status).toBe('open');
  });

  it('derives partially_filled when active < quantity', async () => {
    queryQueue.push({ rows: [{ total: 1 }] });
    queryQueue.push({ rows: [
      { id: 'r1', role_title: 'Dev', status: 'open', quantity: 3, active_assignments_count: 1, priority: 'high' },
    ] });
    const res = await client.call('GET', '/api/resource-requests');
    expect(res.body.data[0].status).toBe('partially_filled');
  });

  it('derives filled when active >= quantity', async () => {
    queryQueue.push({ rows: [{ total: 1 }] });
    queryQueue.push({ rows: [
      { id: 'r1', role_title: 'Dev', status: 'open', quantity: 2, active_assignments_count: 2, priority: 'high' },
    ] });
    const res = await client.call('GET', '/api/resource-requests');
    expect(res.body.data[0].status).toBe('filled');
  });

  it('respects cancelled as terminal regardless of assignment count', async () => {
    queryQueue.push({ rows: [{ total: 1 }] });
    queryQueue.push({ rows: [
      { id: 'r1', role_title: 'Dev', status: 'cancelled', quantity: 2, active_assignments_count: 2, priority: 'low' },
    ] });
    const res = await client.call('GET', '/api/resource-requests');
    expect(res.body.data[0].status).toBe('cancelled');
  });

  it('applies contract + status + priority filters', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/resource-requests?contract_id=ct1&status=open&priority=critical');
    const sql = issuedQueries[0].sql;
    expect(sql).toMatch(/rr\.contract_id =/);
    expect(sql).toMatch(/rr\.status =/);
    expect(sql).toMatch(/rr\.priority =/);
  });
});

describe('POST /api/resource-requests (admin+)', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/resource-requests', validBody);
    expect(res.status).toBe(403);
  });

  it('rejects when required fields missing', async () => {
    for (const miss of ['contract_id', 'role_title', 'area_id', 'level', 'start_date']) {
      const body = { ...validBody, [miss]: undefined };
      // eslint-disable-next-line no-await-in-loop
      const res = await client.call('POST', '/api/resource-requests', body);
      expect(res.status).toBe(400);
    }
  });

  it('rejects invalid level + priority', async () => {
    let res = await client.call('POST', '/api/resource-requests', { ...validBody, level: 'L99' });
    expect(res.status).toBe(400);
    res = await client.call('POST', '/api/resource-requests', { ...validBody, priority: 'urgent' });
    expect(res.status).toBe(400);
  });

  it('rejects when contract does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/resource-requests', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contract_id no existe/);
  });

  it('rejects when contract is completed or cancelled', async () => {
    queryQueue.push({ rows: [{ id: 'ct1', status: 'completed' }] });
    const res = await client.call('POST', '/api/resource-requests', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed/);
  });

  it('rejects when area is inactive', async () => {
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 1, active: false }] });
    const res = await client.call('POST', '/api/resource-requests', validBody);
    expect(res.status).toBe(400);
  });

  it('creates request + emits event', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 1, active: true }] });
    queryQueue.push({ rows: [{ id: 'rr-new', role_title: 'Senior Dev', level: 'L4', quantity: 2, priority: 'high' }] });
    const res = await client.call('POST', '/api/resource-requests', validBody);
    expect(res.status).toBe(201);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'resource_request.created');
    expect(evt).toBeTruthy();
  });
});

describe('POST /api/resource-requests/:id/cancel', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/resource-requests/rr1/cancel');
    expect(res.status).toBe(403);
  });

  it('cancels + emits event', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'rr1', role_title: 'Dev', status: 'cancelled' }] });
    const res = await client.call('POST', '/api/resource-requests/rr1/cancel');
    expect(res.status).toBe(200);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'resource_request.cancelled');
    expect(evt).toBeTruthy();
  });
});

describe('DELETE /api/resource-requests/:id', () => {
  it('rejects 409 when there are active assignments', async () => {
    queryQueue.push({ rows: [{ active: 2 }] });
    const res = await client.call('DELETE', '/api/resource-requests/rr1');
    expect(res.status).toBe(409);
    expect(res.body.active_assignments).toBe(2);
  });

  it('soft-deletes when clean', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ active: 0 }] });
    queryQueue.push({ rows: [{ id: 'rr1', role_title: 'Dev' }] });
    const res = await client.call('DELETE', '/api/resource-requests/rr1');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/resource-requests/:id/candidates (US-RR-2)', () => {
  // Query sequence expected by the route:
  //   1. the request row
  //   2. employees + skill_ids
  //   3. overlapping assignments
  //   4. skills lookup (only if any skill_ids referenced)

  const happyRequestRow = {
    id: 'rr1', contract_id: 'ct1', role_title: 'Backend Sr',
    area_id: 1, area_name: 'Desarrollo', level: 'L5',
    required_skills: [10, 20, 30], nice_to_have_skills: [40],
    weekly_hours: 20, start_date: '2026-05-01', end_date: '2026-07-01',
    status: 'open',
  };
  const empAna = {
    id: 'e1', first_name: 'Ana', last_name: 'García', level: 'L5', area_id: 1,
    status: 'active', weekly_capacity_hours: 40, area_name: 'Desarrollo',
    skill_ids: [10, 20, 30, 40],
  };
  const empPedro = {
    id: 'e2', first_name: 'Pedro', last_name: 'Zúñiga', level: 'L3', area_id: 2,
    status: 'active', weekly_capacity_hours: 40, area_name: 'Testing',
    skill_ids: [10],
  };

  it('returns ranked candidates with skills_lookup', async () => {
    queryQueue.push({ rows: [happyRequestRow] });
    queryQueue.push({ rows: [empAna, empPedro] });
    queryQueue.push({ rows: [] }); // no overlapping assignments
    queryQueue.push({ rows: [
      { id: 10, name: 'React' }, { id: 20, name: 'Node' },
      { id: 30, name: 'Postgres' }, { id: 40, name: 'Docker' },
    ] });

    const res = await client.call('GET', '/api/resource-requests/rr1/candidates');
    expect(res.status).toBe(200);
    expect(res.body.request.id).toBe('rr1');
    expect(res.body.candidates).toHaveLength(2);
    // Ana has perfect area+level+skills → beats Pedro
    expect(res.body.candidates[0].employee_id).toBe('e1');
    expect(res.body.candidates[0].score).toBeGreaterThan(res.body.candidates[1].score);
    expect(res.body.skills_lookup[10]).toBe('React');
    expect(res.body.meta).toMatchObject({ employee_pool_size: 2, returned: 2 });
  });

  it('returns 404 when the request does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/resource-requests/does-not-exist/candidates');
    expect(res.status).toBe(404);
  });

  it('applies area_only=true filter in SQL', async () => {
    queryQueue.push({ rows: [happyRequestRow] });
    queryQueue.push({ rows: [empAna] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [{ id: 10, name: 'React' }, { id: 20, name: 'Node' }, { id: 30, name: 'Postgres' }, { id: 40, name: 'Docker' }] });

    const res = await client.call('GET', '/api/resource-requests/rr1/candidates?area_only=true');
    expect(res.status).toBe(200);
    // Second query is the employees one → must include area_id filter and the request's area_id.
    expect(issuedQueries[1].sql).toMatch(/e\.area_id =/);
    expect(issuedQueries[1].params).toContain(1);
  });

  it('excludes terminated via SQL guard', async () => {
    queryQueue.push({ rows: [happyRequestRow] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    // Even with no candidates, the request's required/nice skills seed the lookup query.
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/resource-requests/rr1/candidates');
    expect(issuedQueries[1].sql).toMatch(/e\.status <> 'terminated'/);
  });

  it('clamps limit to 1..100', async () => {
    queryQueue.push({ rows: [happyRequestRow] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] }); // skills lookup (request has required_skills)
    const res = await client.call('GET', '/api/resource-requests/rr1/candidates?limit=9999');
    expect(res.status).toBe(200);
    expect(res.body.meta.returned).toBe(0);
  });

  it('honors include_ineligible=false by filtering low-score candidates', async () => {
    // Junior in a different area with zero required skills → score < 30.
    const badEmp = { id: 'e-bad', first_name: 'Junior', last_name: 'Z', level: 'L1',
      area_id: 99, status: 'active', weekly_capacity_hours: 40, area_name: 'Otra',
      skill_ids: [] };
    queryQueue.push({ rows: [happyRequestRow] });
    queryQueue.push({ rows: [badEmp] });
    queryQueue.push({ rows: [] });
    // Skills lookup (request's required/nice — always queried when request has any).
    queryQueue.push({ rows: [{ id: 10, name: 'React' }, { id: 20, name: 'Node' },
                              { id: 30, name: 'Postgres' }, { id: 40, name: 'Docker' }] });

    const res = await client.call('GET', '/api/resource-requests/rr1/candidates?include_ineligible=false');
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(0);
  });
});


describe('GET /api/resource-requests/lookup — INC-003 (unpaginated dropdown source)', () => {
  it('returns ALL open / partially_filled requests, no pagination cap', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: 'rr' + i, role_title: 'Role ' + i, level: 'L4', weekly_hours: 20,
      start_date: '2026-05-01', end_date: '2026-08-01', status: 'open', priority: 'medium',
      contract_id: 'ct1', contract_name: 'C', area_id: 1, area_name: 'Dev',
    }));
    queryQueue.push({ rows: many });
    const res = await client.call('GET', '/api/resource-requests/lookup');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(250);
  });

  it('excludes filled and cancelled by default', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/resource-requests/lookup');
    const sql = issuedQueries[issuedQueries.length - 1].sql;
    expect(sql).toMatch(/NOT IN \('filled','cancelled'\)/);
  });

  it('filters by contract_id with a parameterized query (no SQL injection)', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/resource-requests/lookup?contract_id=ct-123');
    const last = issuedQueries[issuedQueries.length - 1];
    expect(last.sql).toMatch(/contract_id = \$\d+/); // parameterized, not string-interpolated
    expect(last.params).toContain('ct-123');
  });
});
