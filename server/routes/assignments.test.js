/**
 * Unit tests for server/routes/assignments.js (EN-1, EN-2, EN-5).
 */

const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (mockControlSql.has(sql)) return { rows: [] };
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

const aRouter = require('./assignments');
const app = express();
app.use(express.json());
app.use('/api/assignments', aRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'admin' };
});

const validBody = {
  resource_request_id: 'rr1', employee_id: 'e1', contract_id: 'ct1',
  weekly_hours: 20, start_date: '2026-05-01', end_date: '2026-08-01',
};

describe('POST /api/assignments — EN-1', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(403);
  });

  it('rejects missing required fields', async () => {
    for (const miss of ['resource_request_id','employee_id','contract_id','weekly_hours','start_date']) {
      const body = { ...validBody, [miss]: undefined };
      // eslint-disable-next-line no-await-in-loop
      const res = await client.call('POST', '/api/assignments', body);
      expect(res.status).toBe(400);
    }
  });

  it('rejects weekly_hours out of range', async () => {
    let res = await client.call('POST', '/api/assignments', { ...validBody, weekly_hours: 0 });
    expect(res.status).toBe(400);
    res = await client.call('POST', '/api/assignments', { ...validBody, weekly_hours: 100 });
    expect(res.status).toBe(400);
  });

  it('rejects when resource_request does not exist or is cancelled', async () => {
    queryQueue.push({ rows: [] });
    let res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(400);

    queryQueue.push({ rows: [{ id: 'rr1', contract_id: 'ct1', status: 'cancelled' }] });
    res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancelada/);
  });

  it('rejects 409 when request does not belong to the given contract', async () => {
    queryQueue.push({ rows: [{ id: 'rr1', contract_id: 'ct-other', status: 'open' }] });
    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no pertenece al contrato/);
  });

  it('rejects when employee is terminated', async () => {
    queryQueue.push({ rows: [{ id: 'rr1', contract_id: 'ct1', status: 'open' }] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'e1', weekly_capacity_hours: 40, status: 'terminated', first_name: 'Ana', last_name: 'G' }] });
    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/terminado/);
  });

  it('warnings (non-blocking) when employee is on_leave or bench', async () => {
    queryQueue.push({ rows: [{ id: 'rr1', contract_id: 'ct1', status: 'open' }] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'e1', weekly_capacity_hours: 40, status: 'on_leave', first_name: 'Ana', last_name: 'G' }] });
    queryQueue.push({ rows: [{ total: 0 }] }); // overlap sum
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] }); // INSERT

    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(201);
    expect(res.body.warnings.some((w) => /on_leave/.test(w))).toBe(true);
  });

  it('EN-2: rejects 409 when proposed hours would overbook (>capacity × 1.10)', async () => {
    queryQueue.push({ rows: [{ id: 'rr1', contract_id: 'ct1', status: 'open' }] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'e1', weekly_capacity_hours: 40, status: 'active', first_name: 'Ana', last_name: 'G' }] });
    queryQueue.push({ rows: [{ total: 30 }] }); // existing hours — adding 20 = 50 > 44 threshold

    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Overbooking/);
    expect(res.body.threshold).toBeCloseTo(44, 1);
    expect(res.body.proposed_weekly_hours).toBe(50);
  });

  it('EN-2: allows overbook when force=true and emits assignment.overbooked', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'rr1', contract_id: 'ct1', status: 'open' }] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'e1', weekly_capacity_hours: 40, status: 'active', first_name: 'Ana', last_name: 'G' }] });
    queryQueue.push({ rows: [{ total: 30 }] });
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] });

    const res = await client.call('POST', '/api/assignments', { ...validBody, force: true });
    expect(res.status).toBe(201);
    expect(res.body.overbooked).toBe(true);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'assignment.overbooked');
    expect(evt).toBeTruthy();
  });

  it('creates assignment within capacity (no overbook)', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'rr1', contract_id: 'ct1', status: 'open' }] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'e1', weekly_capacity_hours: 40, status: 'active', first_name: 'Ana', last_name: 'G' }] });
    queryQueue.push({ rows: [{ total: 10 }] });
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] });

    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(201);
    expect(res.body.overbooked).toBe(false);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'assignment.created');
    expect(evt).toBeTruthy();
  });
});

describe('PUT /api/assignments/:id — EN-2 on update', () => {
  it('rejects 409 when increasing hours would overbook', async () => {
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e1', weekly_hours: 10, start_date: '2026-05-01', end_date: '2026-08-01', status: 'active' }] });
    queryQueue.push({ rows: [{ weekly_capacity_hours: 40, first_name: 'Ana', last_name: 'G' }] });
    queryQueue.push({ rows: [{ total: 30 }] }); // existing OTHER assignments

    const res = await client.call('PUT', '/api/assignments/a1', { weekly_hours: 20 });
    expect(res.status).toBe(409);
  });

  it('updates when hours change stays under threshold', async () => {
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e1', weekly_hours: 10, start_date: '2026-05-01', end_date: '2026-08-01', status: 'active' }] });
    queryQueue.push({ rows: [{ weekly_capacity_hours: 40 }] });
    queryQueue.push({ rows: [{ total: 10 }] });
    queryQueue.push({ rows: [{ id: 'a1', weekly_hours: 20 }] });

    const res = await client.call('PUT', '/api/assignments/a1', { weekly_hours: 20 });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/assignments/validate — US-BK-2', () => {
  /**
   * Validate enqueues queries in this order:
   *   1. SELECT employee + area        (Promise.all first)
   *   2. SELECT request + area         (Promise.all second)
   *   3. SELECT committed_hours SUM    (sumOverlappingHours)
   */
  const enqueue = (employeeRow, requestRow, committedTotal) => {
    queryQueue.push({ rows: employeeRow ? [employeeRow] : [] });
    queryQueue.push({ rows: requestRow  ? [requestRow]  : [] });
    if (employeeRow && requestRow) {
      queryQueue.push({ rows: [{ total: committedTotal }] });
    }
  };

  const matchedEmployee = {
    id: 'e1', first_name: 'Ana', last_name: 'G',
    level: 'L5', weekly_capacity_hours: 40, status: 'active',
    area_id: 1, area_name: 'Desarrollo',
  };
  const matchedRequest = {
    id: 'rr1', contract_id: 'ct1', role_title: 'Senior Dev', level: 'L5',
    weekly_hours: 20, start_date: '2026-05-01', end_date: '2026-08-01',
    status: 'open', area_id: 1, area_name: 'Desarrollo',
  };

  it('requires employee_id and request_id', async () => {
    let res = await client.call('GET', '/api/assignments/validate');
    expect(res.status).toBe(400);
    res = await client.call('GET', '/api/assignments/validate?employee_id=e1');
    expect(res.status).toBe(400);
    res = await client.call('GET', '/api/assignments/validate?request_id=rr1');
    expect(res.status).toBe(400);
  });

  it('returns 404 when employee does not exist', async () => {
    enqueue(null, matchedRequest);
    const res = await client.call('GET', '/api/assignments/validate?employee_id=e1&request_id=rr1');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/employee/);
  });

  it('returns 404 when request does not exist', async () => {
    enqueue(matchedEmployee, null);
    const res = await client.call('GET', '/api/assignments/validate?employee_id=e1&request_id=rr1');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/resource_request/);
  });

  it('returns valid=true when everything matches', async () => {
    enqueue(matchedEmployee, matchedRequest, 0);
    const res = await client.call('GET', '/api/assignments/validate?employee_id=e1&request_id=rr1');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.can_override).toBe(false);
    expect(res.body.summary.pass).toBe(4);
    expect(res.body.checks).toHaveLength(4);
    expect(res.body.context.employee.name).toBe('Ana G');
    expect(res.body.context.request.role_title).toBe('Senior Dev');
    expect(res.body.context.proposed.weekly_hours).toBe(20);
  });

  it('flags area mismatch as overridable fail', async () => {
    enqueue(
      { ...matchedEmployee, area_id: 2, area_name: 'Testing' },
      matchedRequest, 0,
    );
    const res = await client.call('GET', '/api/assignments/validate?employee_id=e1&request_id=rr1');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.can_override).toBe(true);
    expect(res.body.requires_justification).toBe(true);
    const areaCheck = res.body.checks.find((c) => c.check === 'area_match');
    expect(areaCheck.status).toBe('fail');
    expect(areaCheck.overridable).toBe(true);
  });

  it('marks non-overlapping dates as non-overridable fail', async () => {
    enqueue(matchedEmployee, matchedRequest, 0);
    const res = await client.call(
      'GET',
      '/api/assignments/validate?employee_id=e1&request_id=rr1&start_date=2027-01-01&end_date=2027-06-01',
    );
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.can_override).toBe(false);
    const dateCheck = res.body.checks.find((c) => c.check === 'date_conflict');
    expect(dateCheck.status).toBe('fail');
    expect(dateCheck.overridable).toBe(false);
  });

  it('uses query-provided weekly_hours when present (overrides request default)', async () => {
    enqueue(matchedEmployee, matchedRequest, 30);
    const res = await client.call(
      'GET',
      '/api/assignments/validate?employee_id=e1&request_id=rr1&weekly_hours=20',
    );
    // committed 30 + requested 20 > capacity 40 → fail overridable
    const cap = res.body.checks.find((c) => c.check === 'capacity');
    expect(cap.status).toBe('fail');
    expect(cap.overridable).toBe(true);
    expect(cap.detail.utilization_after_pct).toBe(125);
    expect(res.body.context.proposed.weekly_hours).toBe(20);
  });

  it('surfaces employee status advisories alongside checks', async () => {
    enqueue({ ...matchedEmployee, status: 'terminated' }, matchedRequest, 0);
    const res = await client.call('GET', '/api/assignments/validate?employee_id=e1&request_id=rr1');
    expect(res.status).toBe(200);
    expect(res.body.advisories.map((a) => a.code)).toContain('employee_terminated');
  });

  it('surfaces cancelled request as advisory', async () => {
    enqueue(matchedEmployee, { ...matchedRequest, status: 'cancelled' }, 0);
    const res = await client.call('GET', '/api/assignments/validate?employee_id=e1&request_id=rr1');
    expect(res.status).toBe(200);
    expect(res.body.advisories.map((a) => a.code)).toContain('request_cancelled');
  });

  it('supports ignore_assignment_id (for editing flow)', async () => {
    enqueue(matchedEmployee, matchedRequest, 0);
    const res = await client.call(
      'GET',
      '/api/assignments/validate?employee_id=e1&request_id=rr1&ignore_assignment_id=a-existing',
    );
    expect(res.status).toBe(200);
    // The third query (sumOverlappingHours) must have received the ignore id as a param
    const overlapQuery = issuedQueries.find((q) => /SUM\(weekly_hours\)/i.test(q.sql));
    expect(overlapQuery).toBeTruthy();
    expect(overlapQuery.params).toContain('a-existing');
  });
});

describe('DELETE /api/assignments/:id — EN-5', () => {
  it('hard-deletes when there are no time entries', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ count: 0 }] });
    queryQueue.push({ rows: [{ id: 'a1' }] });
    const res = await client.call('DELETE', '/api/assignments/a1');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hard');
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'assignment.hard_deleted');
    expect(evt).toBeTruthy();
  });

  it('soft-deletes + cancels when time entries exist', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ count: 12 }] });
    queryQueue.push({ rows: [{ id: 'a1', status: 'cancelled', deleted_at: 'now' }] });
    const res = await client.call('DELETE', '/api/assignments/a1');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('soft');
    expect(res.body.preserved_time_entries).toBe(12);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'assignment.soft_deleted');
    expect(evt).toBeTruthy();
  });
});
