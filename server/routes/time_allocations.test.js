/**
 * Tests for server/routes/time_allocations.js — Time-MVP-00.1.
 */
const queryQueue = [];
const issuedQueries = [];
const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);

jest.mock('../database/pool', () => {
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (mockControlSql.has(sql)) return { rows: [] };
    if (!queryQueue.length) throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
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

let mockUser = { id: 'u1', role: 'member', name: 'Member' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  adminOnly: (_req, _res, next) => next(),
  superadminOnly: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const router = require('./time_allocations');
const { mondayOf } = router._internal;

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

const app = express(); app.use(express.json()); app.use('/api/time-allocations', router);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockUser = { id: 'u1', role: 'member', name: 'Member' };
});

describe('mondayOf', () => {
  it('snaps Tuesday to Monday', () => {
    expect(mondayOf('2026-04-28')).toBe('2026-04-27'); // Tuesday → Monday
  });
  it('snaps Sunday to previous Monday', () => {
    expect(mondayOf('2026-05-03')).toBe('2026-04-27'); // Sunday → Monday
  });
  it('keeps Monday', () => {
    expect(mondayOf('2026-04-27')).toBe('2026-04-27');
  });
  it('returns null for invalid', () => {
    expect(mondayOf('foo')).toBeNull();
  });
});

describe('GET /api/time-allocations', () => {
  it('rejects invalid week_start', async () => {
    const res = await client.call('GET', '/api/time-allocations?week_start=foo');
    expect(res.status).toBe(400);
  });

  it('returns 404 if user has no employee linked', async () => {
    queryQueue.push({ rows: [] }); // no employee for user
    const res = await client.call('GET', '/api/time-allocations?week_start=2026-04-27');
    expect(res.status).toBe(404);
  });

  it('returns active assignments + allocations + summary', async () => {
    queryQueue.push({ rows: [{ id: 'e1', name: 'Laura' }] }); // employee
    queryQueue.push({ rows: [
      { id: 'a1', employee_id: 'e1', contract_id: 'c1', role_title: 'Senior Dev', weekly_hours: 40,
        start_date: '2026-01-01', end_date: '2026-12-31', status: 'active',
        contract_name: 'Bancolombia', contract_type: 'capacity', original_currency: 'USD' },
      { id: 'a2', employee_id: 'e1', contract_id: 'c2', role_title: 'PM', weekly_hours: 20,
        start_date: '2026-04-01', end_date: null, status: 'active',
        contract_name: 'Acme', contract_type: 'project', original_currency: 'USD' },
    ] });
    queryQueue.push({ rows: [
      { id: 'wta1', assignment_id: 'a1', pct: '60', notes: null, updated_at: new Date(), updated_by: 'u1' },
      { id: 'wta2', assignment_id: 'a2', pct: '30', notes: null, updated_at: new Date(), updated_by: 'u1' },
    ] });
    const res = await client.call('GET', '/api/time-allocations?week_start=2026-04-27');
    expect(res.status).toBe(200);
    expect(res.body.active_assignments).toHaveLength(2);
    expect(res.body.allocations[0].pct).toBe(60);
    expect(res.body.summary.total_pct).toBe(90);
    expect(res.body.summary.bench_pct).toBe(10);
  });

  it('member is forbidden from querying another employee_id', async () => {
    queryQueue.push({ rows: [] }); // verification fails
    const res = await client.call('GET', '/api/time-allocations?week_start=2026-04-27&employee_id=e-other');
    expect(res.status).toBe(403);
  });

  it('admin can query any employee_id', async () => {
    mockUser = { id: 'u1', role: 'admin', name: 'Admin' };
    queryQueue.push({ rows: [{ id: 'e2', name: 'Pablo' }] }); // admin lookup of e2
    queryQueue.push({ rows: [] }); // assignments
    queryQueue.push({ rows: [] }); // allocations
    const res = await client.call('GET', '/api/time-allocations?week_start=2026-04-27&employee_id=e2');
    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe('e2');
  });
});

describe('PUT /api/time-allocations/bulk', () => {
  it('rejects invalid week_start_date', async () => {
    const res = await client.call('PUT', '/api/time-allocations/bulk', {
      week_start_date: 'foo', allocations: [],
    });
    expect(res.status).toBe(400);
  });

  it('rejects when sum > 100', async () => {
    const res = await client.call('PUT', '/api/time-allocations/bulk', {
      week_start_date: '2026-04-27',
      allocations: [
        { assignment_id: 'a1', pct: 70 },
        { assignment_id: 'a2', pct: 50 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('pct_sum_exceeds_100');
  });

  it('rejects pct out of range', async () => {
    const res = await client.call('PUT', '/api/time-allocations/bulk', {
      week_start_date: '2026-04-27',
      allocations: [{ assignment_id: 'a1', pct: 150 }],
    });
    expect(res.status).toBe(400);
  });

  it('happy path: deletes prev rows, inserts new, returns warning if < 100', async () => {
    queryQueue.push({ rows: [{ id: 'e1', name: 'Laura' }] }); // employee
    queryQueue.push({ rows: [{ id: 'a1' }, { id: 'a2' }] });   // assignments validation
    queryQueue.push({ rows: [] });                              // DELETE prev
    queryQueue.push({ rows: [{ id: 'wta1', assignment_id: 'a1', pct: '60', notes: null, updated_at: new Date(), updated_by: 'u1' }] }); // INSERT 1
    queryQueue.push({ rows: [{ id: 'wta2', assignment_id: 'a2', pct: '30', notes: null, updated_at: new Date(), updated_by: 'u1' }] }); // INSERT 2
    queryQueue.push({ rows: [] });                              // audit_log

    const res = await client.call('PUT', '/api/time-allocations/bulk', {
      week_start_date: '2026-04-28', // Tuesday → snaps to Monday 2026-04-27
      allocations: [
        { assignment_id: 'a1', pct: 60 },
        { assignment_id: 'a2', pct: 30 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.week_start_date).toBe('2026-04-27');
    expect(res.body.allocations).toHaveLength(2);
    expect(res.body.summary.total_pct).toBe(90);
    expect(res.body.summary.bench_pct).toBe(10);
    // Warning soft de bench
    expect(res.body.warnings.some((w) => w.code === 'bench')).toBe(true);
  });

  it('omits 0% allocations from persistence (no INSERT for them)', async () => {
    queryQueue.push({ rows: [{ id: 'e1', name: 'Laura' }] });
    queryQueue.push({ rows: [{ id: 'a1' }] });   // only one assignment validated
    queryQueue.push({ rows: [] });                // DELETE
    queryQueue.push({ rows: [{ id: 'wta1', assignment_id: 'a1', pct: '100', notes: null, updated_at: new Date(), updated_by: 'u1' }] });
    queryQueue.push({ rows: [] });                // audit_log

    const res = await client.call('PUT', '/api/time-allocations/bulk', {
      week_start_date: '2026-04-27',
      allocations: [
        { assignment_id: 'a1', pct: 100 },
        { assignment_id: 'a2', pct: 0 }, // skipped
      ],
    });
    expect(res.status).toBe(400); // a2 not in valid assignments → block
  });

  it('rejects assignments not belonging to the employee', async () => {
    queryQueue.push({ rows: [{ id: 'e1', name: 'Laura' }] });
    queryQueue.push({ rows: [{ id: 'a1' }] }); // sólo 1 válido cuando se mandan 2
    const res = await client.call('PUT', '/api/time-allocations/bulk', {
      week_start_date: '2026-04-27',
      allocations: [
        { assignment_id: 'a1', pct: 50 },
        { assignment_id: 'a-foreign', pct: 50 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválidos|pertenecen/i);
  });
});
