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

  /**
   * INC-002 regression: when notify() throws (e.g. employee.user_id
   * points to a deleted users row → FK violation on notifications),
   * the assignment must STILL be created. Pre-fix the notify call ran
   * inside the open transaction with the txn client, so a failed
   * INSERT poisoned the txn and the COMMIT failed → 500. Post-fix
   * notify runs against the pool AFTER the COMMIT, so any failure is
   * isolated and the user-facing mutation succeeds.
   */
  it('INC-002: assignment is created (201) even when notify() throws (broken FK on user_id)', async () => {
    const { notify } = require('../utils/notifications');
    notify.mockClear();
    notify.mockImplementationOnce(async () => {
      throw new Error('insert or update on table "notifications" violates foreign key constraint "notifications_user_id_fkey"');
    });

    queryQueue.push({ rows: [happyRR()] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [happyEmp()] });
    queryQueue.push({ rows: [{ total: 10 }] });
    queryQueue.push({ rows: [{ id: 'a-new', status: 'planned' }] });
    queryQueue.push({ rows: [{
      employee_user_id: 'orphaned-user-id', employee_name: 'Alejandro Vertel',
      contract_name: 'MSA-2026',
      delivery_manager_id: null, capacity_manager_id: null,
    }] });

    const res = await client.call('POST', '/api/assignments', validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('a-new');
    expect(notify).toHaveBeenCalled();
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

describe('GET /api/assignments/export.csv', () => {
  it('streams a CSV with header + rows and honors status filter', async () => {
    queryQueue.push({ rows: [
      { id: 'a1', status: 'active', weekly_hours: 40,
        start_date: '2026-01-01', end_date: null, role_title: 'Dev', notes: null,
        created_at: '2026-01-01T00:00:00Z',
        employee_name: 'Ana García', contract_name: 'Acme', request_role_title: 'Senior Dev' },
    ] });
    const res = await client.call('GET', '/api/assignments/export.csv?status=active');
    expect(res.status).toBe(200);
    expect(res.body.charCodeAt(0)).toBe(0xFEFF);
    expect(res.body).toMatch(/Empleado,Contrato,Rol \(solicitud\),Rol \(asignación\),Estado/);
    expect(res.body).toMatch(/Ana García,Acme,Senior Dev,Dev,active,40/);
    const exec = issuedQueries.find((q) => /FROM assignments a/.test(q.sql));
    expect(exec.params).toContain('active');
  });

  it('returns 500 when the DB throws', async () => {
    queryQueue.push(new Error('boom'));
    const res = await client.call('GET', '/api/assignments/export.csv');
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-007 — Filtros por empleado y rango de fechas
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/assignments — SPEC-007 filtro por empleado', () => {
  // Each paginated list call triggers two queries: COUNT then SELECT.
  const pushList = (rows = []) => {
    queryQueue.push({ rows: [{ total: rows.length }] });
    queryQueue.push({ rows });
  };

  it('filters by single employee_id (backward-compat param)', async () => {
    pushList();
    const res = await client.call('GET', '/api/assignments?employee_id=e1');
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT/.test(r.sql));
    expect(q.params).toContain('e1');
    expect(q.sql).toMatch(/a\.employee_id\s*=\s*\$\d+/);
  });

  it('filters by employee_ids (comma-separated, OR logic)', async () => {
    pushList();
    const res = await client.call('GET', '/api/assignments?employee_ids=e1,e2');
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT/.test(r.sql));
    expect(q.params).toContain('e1');
    expect(q.params).toContain('e2');
    expect(q.sql).toMatch(/a\.employee_id\s+IN\s*\(/);
  });

  it('deduplicates when employee_id and employee_ids overlap', async () => {
    pushList();
    const res = await client.call('GET', '/api/assignments?employee_id=e1&employee_ids=e1,e2');
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT/.test(r.sql));
    // e1 must appear exactly once in the bound params
    expect(q.params.filter((p) => p === 'e1')).toHaveLength(1);
    expect(q.params).toContain('e2');
  });

  it('returns 200 with empty data when no assignments match the employee', async () => {
    pushList([]);
    const res = await client.call('GET', '/api/assignments?employee_ids=nobody');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});

describe('GET /api/assignments — SPEC-007 filtro por rango de fechas', () => {
  const pushList = (rows = []) => {
    queryQueue.push({ rows: [{ total: rows.length }] });
    queryQueue.push({ rows });
  };

  it('returns 400 for an invalid date_from value', async () => {
    const res = await client.call('GET', '/api/assignments?date_from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date_from/);
  });

  it('returns 400 for an invalid date_to value', async () => {
    const res = await client.call('GET', '/api/assignments?date_to=31-13-2026');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date_to/);
  });

  it('returns 400 for a logically impossible date (e.g. Feb 30)', async () => {
    const res = await client.call('GET', '/api/assignments?date_from=2026-02-30');
    expect(res.status).toBe(400);
  });

  it('date_from only → end_date IS NULL OR end_date >= date_from', async () => {
    pushList();
    const res = await client.call('GET', '/api/assignments?date_from=2026-05-01');
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT/.test(r.sql));
    expect(q.params).toContain('2026-05-01');
    // The generated SQL must check NULL or >= bound
    expect(q.sql).toMatch(/end_date IS NULL OR a\.end_date >= \$\d+::date/);
  });

  it('date_to only → start_date <= date_to', async () => {
    pushList();
    const res = await client.call('GET', '/api/assignments?date_to=2026-12-31');
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT/.test(r.sql));
    expect(q.params).toContain('2026-12-31');
    expect(q.sql).toMatch(/a\.start_date <= \$\d+::date/);
  });

  it('both dates → full intersection (start_date <= date_to AND end_date >= date_from)', async () => {
    pushList();
    const res = await client.call('GET', '/api/assignments?date_from=2026-05-01&date_to=2026-08-31');
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT/.test(r.sql));
    expect(q.params).toContain('2026-05-01');
    expect(q.params).toContain('2026-08-31');
    expect(q.sql).toMatch(/end_date IS NULL OR a\.end_date >= \$\d+::date/);
    expect(q.sql).toMatch(/a\.start_date <= \$\d+::date/);
  });

  it('returns 200 empty list when no assignment intersects the range', async () => {
    pushList([]);
    const res = await client.call('GET', '/api/assignments?date_from=2030-01-01&date_to=2030-12-31');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/assignments — SPEC-007 filtros combinados', () => {
  const pushList = (rows = []) => {
    queryQueue.push({ rows: [{ total: rows.length }] });
    queryQueue.push({ rows });
  };

  it('combines status + employee_ids + date range (AND logic)', async () => {
    pushList();
    const res = await client.call(
      'GET',
      '/api/assignments?status=active&employee_ids=e1,e2&date_from=2026-05-01&date_to=2026-08-31',
    );
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT/.test(r.sql));
    expect(q.params).toContain('active');
    expect(q.params).toContain('e1');
    expect(q.params).toContain('e2');
    expect(q.params).toContain('2026-05-01');
    expect(q.params).toContain('2026-08-31');
  });

  it('employee_ids filter is respected in CSV export', async () => {
    queryQueue.push({ rows: [
      { id: 'a1', status: 'active', weekly_hours: 40,
        start_date: '2026-05-01', end_date: '2026-08-01', role_title: 'Dev', notes: null,
        created_at: '2026-05-01T00:00:00Z',
        employee_name: 'Ana García', contract_name: 'Acme', request_role_title: 'Senior Dev' },
    ] });
    const res = await client.call('GET', '/api/assignments/export.csv?employee_ids=e1,e2');
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT 10000/.test(r.sql));
    expect(q.params).toContain('e1');
    expect(q.params).toContain('e2');
    expect(q.sql).toMatch(/IN\s*\(/);
  });

  it('date_from + date_to filters are respected in CSV export', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/assignments/export.csv?date_from=2026-05-01&date_to=2026-08-31');
    expect(res.status).toBe(200);
    const q = issuedQueries.find((r) => /FROM assignments a/.test(r.sql) && /LIMIT 10000/.test(r.sql));
    expect(q.params).toContain('2026-05-01');
    expect(q.params).toContain('2026-08-31');
  });

  it('CSV export returns 400 for invalid date_from', async () => {
    const res = await client.call('GET', '/api/assignments/export.csv?date_from=bad-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date_from/);
  });
});
