/**
 * Integration tests for GET /api/capacity/planner (US-BK-1).
 *
 * Same harness shape as routes/assignments.test.js: pg.Pool is mocked
 * and each test enqueues canned rows in the order the route issues
 * them. The order is stable:
 *
 *   1. employees list
 *   2. assignments overlapping viewport (skipped if no employees)
 *   3. open/partially-filled resource_requests overlapping viewport
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

let mockCurrentUser = { id: 'u1', role: 'admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, res, next) => { next(); },
  superadminOnly: (req, res, next) => { next(); },
  requireRole: () => (req, res, next) => next(),
}));

const express = require('express');
const request = (app) => {
  const http = require('http');
  return {
    async call(method, url) {
      return new Promise((resolve, reject) => {
        const srv = http.createServer(app).listen(0, () => {
          const { port } = srv.address();
          http.request({ host: '127.0.0.1', port, path: url, method, headers: { authorization: 'Bearer fake' } }, (res) => {
            let buf = '';
            res.on('data', (c) => (buf += c));
            res.on('end', () => {
              srv.close();
              let parsed = null;
              try { parsed = buf ? JSON.parse(buf) : null; } catch { parsed = buf; }
              resolve({ status: res.statusCode, body: parsed });
            });
          }).on('error', (e) => { srv.close(); reject(e); }).end();
        });
      });
    },
  };
};

const capRouter = require('./capacity');
const app = express();
app.use('/api/capacity', capRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'admin' };
});

/* ---------- Fixtures ---------- */
const empAna = {
  id: 'e1', first_name: 'Ana', last_name: 'García', level: 'L5',
  area_id: 1, status: 'active', weekly_capacity_hours: 40, area_name: 'Desarrollo',
};
const empPedro = {
  id: 'e2', first_name: 'Pedro', last_name: 'Zúñiga', level: 'L3',
  area_id: 2, status: 'active', weekly_capacity_hours: 40, area_name: 'Testing',
};
const asgAlpha = {
  id: 'a1', employee_id: 'e1', contract_id: 'ct1', resource_request_id: 'rr1',
  role_title: 'Backend Lead', weekly_hours: 20,
  start_date: '2026-04-20', end_date: '2026-06-14', status: 'active',
  contract_name: 'Contrato Alpha', contract_status: 'active', client_name: 'Acme',
};
const asgBeta = {
  id: 'a2', employee_id: 'e1', contract_id: 'ct2', resource_request_id: 'rr2',
  role_title: 'Tech Lead', weekly_hours: 25,
  start_date: '2026-05-04', end_date: '2026-05-24', status: 'planned',
  contract_name: 'Contrato Beta', contract_status: 'active', client_name: 'Globex',
};
const rrOpen = {
  id: 'rr9', contract_id: 'ct3', role_title: 'QA Sr', level: 'L6', area_id: 2,
  weekly_hours: 40, start_date: '2026-05-01', end_date: '2026-07-01', quantity: 2,
  status: 'open', contract_name: 'Contrato Gamma', client_name: 'Initech',
  area_name: 'Testing', filled_count: 0,
};

describe('GET /api/capacity/planner', () => {
  it('returns window, employees with weekly utilization, and meta', async () => {
    queryQueue.push({ rows: [empAna, empPedro] });
    queryQueue.push({ rows: [asgAlpha, asgBeta] });
    queryQueue.push({ rows: [rrOpen] });

    const res = await client.call('GET', '/api/capacity/planner?start=2026-04-20&weeks=12');
    expect(res.status).toBe(200);

    expect(res.body.window).toEqual({ start_date: '2026-04-20', end_date: '2026-07-12', weeks: 12 });
    expect(res.body.weeks).toHaveLength(12);
    expect(res.body.weeks[0]).toMatchObject({ index: 0, start_date: '2026-04-20', iso_week: 17 });

    // Ana has 2 assignments; Pedro has none.
    const ana = res.body.employees.find((e) => e.id === 'e1');
    const pedro = res.body.employees.find((e) => e.id === 'e2');
    expect(ana.full_name).toBe('Ana García');
    expect(ana.assignments).toHaveLength(2);
    expect(ana.weekly).toHaveLength(12);
    // W17 (index 0): only Alpha (20h/40 = 50%)
    expect(ana.weekly[0]).toMatchObject({ hours: 20, utilization_pct: 50, bucket: 'light' });
    // W19 (index 2): Alpha 20 + Beta 25 = 45 → 112.5% overbooked
    expect(ana.weekly[2].hours).toBe(45);
    expect(ana.weekly[2].bucket).toBe('overbooked');

    expect(pedro.assignments).toHaveLength(0);
    expect(pedro.weekly.every((w) => w.hours === 0)).toBe(true);

    // Open requests enriched with color + week_range.
    expect(res.body.open_requests).toHaveLength(1);
    expect(res.body.open_requests[0]).toMatchObject({ id: 'rr9', missing: 2, filled_count: 0 });
    expect(res.body.open_requests[0].week_range).not.toBeNull();

    // Contracts list de-duplicated.
    expect(res.body.contracts.map((c) => c.id).sort()).toEqual(['ct1','ct2','ct3']);

    // Meta
    expect(res.body.meta).toMatchObject({
      total_employees: 2,
      active_employees: 1,       // only Ana has any booked hours
      overbooked_count: 1,
      open_request_count: 1,
    });
  });

  it('defaults to current-week Monday and 12 weeks when params are omitted', async () => {
    queryQueue.push({ rows: [] });          // employees
    // No assignments query when no employees.
    queryQueue.push({ rows: [] });          // open requests

    const res = await client.call('GET', '/api/capacity/planner');
    expect(res.status).toBe(200);
    expect(res.body.window.weeks).toBe(12);
    expect(res.body.weeks).toHaveLength(12);
    // Start date must be a Monday.
    const d = new Date(res.body.window.start_date + 'T00:00:00Z');
    expect(d.getUTCDay()).toBe(1);
  });

  it('clamps weeks to [1, 26]', async () => {
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/capacity/planner?start=2026-04-20&weeks=100');
    expect(res.status).toBe(200);
    expect(res.body.weeks).toHaveLength(26);
  });

  it('returns 400 on invalid start', async () => {
    const res = await client.call('GET', '/api/capacity/planner?start=nope');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start/);
  });

  it('applies contract_id filter to both employees assignments and open_requests', async () => {
    queryQueue.push({ rows: [empAna] });
    queryQueue.push({ rows: [asgAlpha] });      // filtered server-side in SQL
    queryQueue.push({ rows: [rrOpen] });

    const res = await client.call('GET', '/api/capacity/planner?start=2026-04-20&weeks=4&contract_id=ct1');
    expect(res.status).toBe(200);

    // Second issued query is the assignments query — must include the contract_id filter.
    const asgSql = issuedQueries[1].sql;
    expect(asgSql).toMatch(/asg\.contract_id =/);
    expect(issuedQueries[1].params).toContain('ct1');

    // Third query is open_requests — must also include contract_id filter.
    const rrSql = issuedQueries[2].sql;
    expect(rrSql).toMatch(/rr\.contract_id =/);
    expect(issuedQueries[2].params).toContain('ct1');
  });

  it('applies search filter on employee name', async () => {
    queryQueue.push({ rows: [empAna] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });

    const res = await client.call('GET', '/api/capacity/planner?start=2026-04-20&search=Ana');
    expect(res.status).toBe(200);
    const empSql = issuedQueries[0].sql;
    expect(empSql).toMatch(/LOWER\(e\.first_name\)/);
    expect(issuedQueries[0].params[issuedQueries[0].params.length - 1]).toBe('%ana%');
  });

  it('applies level_min and level_max correctly (L1..L11 lexical fix)', async () => {
    queryQueue.push({ rows: [empAna] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });

    const res = await client.call('GET', '/api/capacity/planner?start=2026-04-20&level_min=L4&level_max=L6');
    expect(res.status).toBe(200);
    // params should include arrays of allowed level strings.
    const params = issuedQueries[0].params;
    const hasMinArr = params.some((p) => Array.isArray(p) && p.includes('L4') && !p.includes('L3'));
    const hasMaxArr = params.some((p) => Array.isArray(p) && p.includes('L6') && !p.includes('L7'));
    expect(hasMinArr).toBe(true);
    expect(hasMaxArr).toBe(true);
  });

  it('skips the assignments query when there are no employees', async () => {
    queryQueue.push({ rows: [] });  // employees
    queryQueue.push({ rows: [] });  // open_requests (assignments query is skipped)
    const res = await client.call('GET', '/api/capacity/planner?start=2026-04-20&weeks=4');
    expect(res.status).toBe(200);
    expect(issuedQueries).toHaveLength(2);
  });

  it('filters out terminated employees server-side (SQL guard)', async () => {
    queryQueue.push({ rows: [empAna] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/capacity/planner?start=2026-04-20&weeks=4');
    expect(issuedQueries[0].sql).toMatch(/e\.status <> 'terminated'/);
  });
});
