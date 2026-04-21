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

// Post-mutation notification producers run in a best-effort try/catch
// and are exercised end-to-end in their own test file. Mock them here
// so the assignments POST tests stay focused on validation + events.
jest.mock('../utils/notifications', () => ({
  notify: jest.fn(async () => null),
  notifyMany: jest.fn(async () => []),
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
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp({ status: 'terminated' })] });
    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/terminado/);
  });

  it('warnings (non-blocking) when employee is on_leave', async () => {
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp({ status: 'on_leave' })] });
    queryQueue.push({ rows: [{ total: 0 }] });          // overlap sum
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] }); // INSERT
    queryQueue.push({ rows: [] });                      // notification context lookup

    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(201);
    expect(res.body.warnings.some((w) => /on_leave/.test(w))).toBe(true);
    expect(res.body.validation.valid).toBe(true);
  });

  it('US-VAL-4: rejects 409 OVERRIDE_REQUIRED when capacity would overflow and no override_reason', async () => {
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp()] });
    // committed=45 ≥ cap=40 → available ≤ 0 → FAIL overridable (engine fails
    // only when saturated; partial remaining capacity is WARN, not FAIL).
    queryQueue.push({ rows: [{ total: 45 }] });

    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('OVERRIDE_REQUIRED');
    expect(res.body.requires_justification).toBe(true);
    const cap = res.body.checks.find((c) => c.check === 'capacity');
    expect(cap.status).toBe('fail');
    expect(cap.overridable).toBe(true);
  });

  it('US-VAL-4: allows override with override_reason and emits assignment.overridden', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp()] });
    // committed=45 ≥ cap=40 → available ≤ 0 → FAIL overridable.
    queryQueue.push({ rows: [{ total: 45 }] });
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] });
    queryQueue.push({ rows: [] });                      // notification context lookup

    const res = await client.call('POST', '/api/assignments', {
      ...validBody,
      override_reason: 'Cliente estratégico — aprobado por COO para cubrir hito crítico.',
    });
    expect(res.status).toBe(201);
    expect(res.body.validation.valid).toBe(false);
    expect(res.body.validation.can_override).toBe(true);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'assignment.overridden');
    expect(evt).toBeTruthy();
    expect(evt[1].payload.reason).toMatch(/COO/);
  });

  it('US-VAL-4: rejects 409 VALIDATION_FAILED when there is a non-overridable fail (dates do not overlap)', async () => {
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp()] });
    queryQueue.push({ rows: [{ total: 0 }] });

    const res = await client.call('POST', '/api/assignments', {
      ...validBody,
      start_date: '2030-01-01', end_date: '2030-06-01', // Outside request window
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const dateCheck = res.body.checks.find((c) => c.check === 'date_conflict');
    expect(dateCheck.status).toBe('fail');
    expect(dateCheck.overridable).toBe(false);
  });

  it('US-VAL-4: rejects override_reason shorter than 10 chars', async () => {
    const res = await client.call('POST', '/api/assignments', {
      ...validBody, override_reason: 'muy corto',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/override_reason/);
  });

  it('notifies the assigned employee when their user_id is linked (different from actor)', async () => {
    const { notify } = require('../utils/notifications');
    notify.mockClear();
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp()] });
    queryQueue.push({ rows: [{ total: 10 }] });
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] });
    // Producer context: employee has user_id u42, managers are somebody else.
    queryQueue.push({ rows: [{
      employee_user_id: 'u42', employee_name: 'Ana G',
      contract_name: 'MSA-2026',
      delivery_manager_id: 'dm1', capacity_manager_id: null,
    }] });

    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(201);
    const target = notify.mock.calls.find((c) => c[1].user_id === 'u42');
    expect(target).toBeTruthy();
    expect(target[1].type).toBe('assignment.created');
    expect(target[1].title).toMatch(/asignaron/i);
  });

  it('does NOT notify the employee when they are the actor', async () => {
    const { notify } = require('../utils/notifications');
    notify.mockClear();
    mockCurrentUser = { id: 'u42', role: 'admin' }; // actor == employee user
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp()] });
    queryQueue.push({ rows: [{ total: 10 }] });
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] });
    queryQueue.push({ rows: [{
      employee_user_id: 'u42', employee_name: 'Ana G',
      contract_name: 'MSA-2026',
      delivery_manager_id: null, capacity_manager_id: null,
    }] });

    await client.call('POST', '/api/assignments', validBody);
    expect(notify.mock.calls.find((c) => c[1].user_id === 'u42')).toBeFalsy();
  });

  it('notifies delivery + capacity managers on override (excluding the actor)', async () => {
    const { notifyMany } = require('../utils/notifications');
    notifyMany.mockClear();
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp()] });
    queryQueue.push({ rows: [{ total: 45 }] });            // saturates → fail override
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] });
    queryQueue.push({ rows: [{
      employee_user_id: null, employee_name: 'Ana G',
      contract_name: 'MSA-2026',
      delivery_manager_id: 'dm1', capacity_manager_id: 'u1', // u1 is the actor — should be filtered out
    }] });

    const res = await client.call('POST', '/api/assignments', {
      ...validBody,
      override_reason: 'Cliente estratégico — aprobado por COO para cubrir hito crítico.',
    });
    expect(res.status).toBe(201);
    const call = notifyMany.mock.calls[0];
    expect(call[1]).toEqual(['dm1']); // capacity manager (u1) == actor, dropped
    expect(call[2].type).toBe('assignment.overridden');
  });

  it('creates assignment within capacity (clean validation)', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp()] });
    queryQueue.push({ rows: [{ total: 10 }] });
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] });
    queryQueue.push({ rows: [] });                      // notification context lookup

    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(201);
    expect(res.body.validation.valid).toBe(true);
    expect(res.body.validation.summary.pass).toBe(4);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'assignment.created');
    expect(evt).toBeTruthy();
    const override = emitEvent.mock.calls.find((c) => c[1].event_type === 'assignment.overridden');
    expect(override).toBeFalsy();
  });
});

/**
 * Row factories: the POST handler now joins areas and loads level for
 * the validation engine, so the mocked employee/request rows need to
 * carry those columns. Using factories keeps individual tests focused
 * on the behavior under test instead of wiring boilerplate.
 */
function happyRR(overrides = {}) {
  return {
    id: 'rr1', contract_id: 'ct1', status: 'open',
    level: 'L5', weekly_hours: 20,
    start_date: '2026-05-01', end_date: '2026-08-01',
    area_id: 1, area_name: 'Desarrollo',
    ...overrides,
  };
}
function happyEmp(overrides = {}) {
  return {
    id: 'e1', first_name: 'Ana', last_name: 'G',
    weekly_capacity_hours: 40, status: 'active',
    level: 'L5', area_id: 1, area_name: 'Desarrollo',
    ...overrides,
  };
}

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
    // committed=30 + requested=20 on cap=40 → available=10 (>0, <requested)
    // → partial-coverage WARN (engine only escalates to FAIL when saturated).
    expect(cap.status).toBe('warn');
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
