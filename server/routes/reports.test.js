/**
 * Unit tests for server/routes/reports.js (EI-2..7 + ED-1).
 *
 * These don't assert SQL text exhaustively — the queries are complex
 * and brittle to minor refactors. Instead we verify each endpoint
 * returns the expected JSON shape with the mock rows enqueued.
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

let mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, _res, next) => next(),
  superadminOnly: (req, _res, next) => next(),
  requireRole: () => (req, _res, next) => next(),
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

const reportsRouter = require('./reports');
const app = express();
app.use(express.json());
app.use('/api/reports', reportsRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
});

describe('GET /api/reports/utilization (EI-2)', () => {
  it('returns per-employee utilization', async () => {
    queryQueue.push({ rows: [
      { id: 'e1', first_name: 'Ana',  last_name: 'G', utilization: 0.95, assigned_weekly_hours: 38 },
      { id: 'e2', first_name: 'Luis', last_name: 'P', utilization: 0.50, assigned_weekly_hours: 20 },
    ] });
    const res = await client.call('GET', '/api/reports/utilization');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('accepts area_id filter', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/reports/utilization?area_id=3');
    expect(issuedQueries[0].sql).toMatch(/e\.area_id = \$1/);
    expect(issuedQueries[0].params).toEqual([3]);
  });
});

describe('GET /api/reports/bench (EI-3)', () => {
  it('respects the threshold query param', async () => {
    queryQueue.push({ rows: [{ id: 'e2', utilization: 0.1 }] });
    const res = await client.call('GET', '/api/reports/bench?threshold=0.2');
    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(0.2);
    expect(issuedQueries[0].params).toEqual([0.2]);
  });

  it('defaults threshold to 0.30', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/reports/bench');
    expect(res.body.threshold).toBe(0.30);
  });
});

describe('GET /api/reports/pending-requests (EI-4)', () => {
  it('returns pending requests with age', async () => {
    queryQueue.push({ rows: [
      { id: 'r1', role_title: 'Senior Dev', priority: 'critical', age_days: 3, active_assignments: 0 },
    ] });
    const res = await client.call('GET', '/api/reports/pending-requests');
    expect(res.status).toBe(200);
    expect(res.body.data[0].priority).toBe('critical');
  });
});

describe('GET /api/reports/hiring-needs (EI-5)', () => {
  it('returns open slots grouped by area + level + country', async () => {
    queryQueue.push({ rows: [
      { area_name: 'Desarrollo', level: 'L3', country: 'Colombia', open_slots: 5, requests_count: 2 },
    ] });
    const res = await client.call('GET', '/api/reports/hiring-needs');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/reports/coverage (EI-6)', () => {
  it('returns contract coverage percentages', async () => {
    queryQueue.push({ rows: [
      { id: 'ct1', name: 'Alpha', client_name: 'Acme', requested_weekly_hours: 100, assigned_weekly_hours: 70, coverage_pct: 0.70, open_requests_count: 1 },
    ] });
    const res = await client.call('GET', '/api/reports/coverage');
    expect(res.status).toBe(200);
    expect(res.body.data[0].coverage_pct).toBe(0.70);
  });
});

describe('GET /api/reports/time-compliance (EI-7)', () => {
  it('returns compliance with default date range', async () => {
    queryQueue.push({ rows: [
      { id: 'e1', total_logged_hours: 120, expected_hours: 160, compliance_pct: 0.75 },
    ] });
    const res = await client.call('GET', '/api/reports/time-compliance');
    expect(res.status).toBe(200);
    expect(res.body.from).toBeTruthy();
    expect(res.body.to).toBeTruthy();
  });

  it('uses the provided date range', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/reports/time-compliance?from=2026-01-01&to=2026-01-31');
    expect(issuedQueries[0].params).toEqual(['2026-01-01', '2026-01-31']);
  });
});

describe('GET /api/reports/my-dashboard (ED-1)', () => {
  it('returns minimal payload when user has no employee row', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/reports/my-dashboard');
    expect(res.status).toBe(200);
    expect(res.body.employee).toBeNull();
    expect(res.body.active_assignments).toEqual([]);
  });

  it('returns employee rollup with assignments and week hours', async () => {
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'G', weekly_capacity_hours: 40 }] });
    queryQueue.push({ rows: [{ id: 'a1', contract_name: 'Alpha', weekly_hours: 20, status: 'active' }] });
    queryQueue.push({ rows: [{ logged: 18 }] });

    const res = await client.call('GET', '/api/reports/my-dashboard');
    expect(res.status).toBe(200);
    expect(res.body.employee.first_name).toBe('Ana');
    expect(res.body.active_assignments).toHaveLength(1);
    expect(res.body.week_hours.logged).toBe(18);
    expect(res.body.week_hours.capacity).toBe(40);
  });
});
