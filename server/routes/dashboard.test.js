/**
 * Unit tests for server/routes/dashboard.js (Executive Dashboard v2).
 *
 * Same pool.query + auth mock pattern used across the rest of the
 * route test suite. We queue one mock result per domain query and
 * verify the response shape + aggregation.
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

jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { id: 'u1', role: 'member', function: 'comercial' }; next(); },
  adminOnly: (_req, _res, next) => next(),
  superadminOnly: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const request = (app) => {
  const http = require('http');
  return {
    async call(method, url) {
      return new Promise((resolve, reject) => {
        const srv = http.createServer(app).listen(0, () => {
          const { port } = srv.address();
          const req = http.request(
            { host: '127.0.0.1', port, path: url, method, headers: { authorization: 'Bearer fake' } },
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
          req.end();
        });
      });
    },
  };
};

const dashboardRouter = require('./dashboard');
const app = express();
app.use(express.json());
app.use('/api/dashboard', dashboardRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
});

// Helper: enqueue the 6 domain queries in order.
function enqueueAllOk() {
  queryQueue.push({ rows: [{ active_count: 7, planned_count: 2, weekly_hours: '245.5' }] }); // assignments
  queryQueue.push({ rows: [{ open_count: 3, open_hours_weekly: '80' }] });                    // requests
  queryQueue.push({ rows: [{ total: 22, bench: 4, utilized: 15 }] });                         // employees
  queryQueue.push({ rows: [                                                                    // contracts
    { status: 'active',  n: 5 },
    { status: 'planned', n: 2 },
    { status: 'paused',  n: 1 },
  ] });
  queryQueue.push({ rows: [                                                                    // opportunities
    { status: 'open',        n: 4 },
    { status: 'qualified',   n: 2 },
    { status: 'won',         n: 1 },
  ] });
  queryQueue.push({ rows: [                                                                    // quotations
    { status: 'draft',    n: 3 },
    { status: 'sent',     n: 2 },
    { status: 'approved', n: 1 },
  ] });
}

describe('GET /api/dashboard/overview', () => {
  it('returns a flat KPI payload aggregated across domains', async () => {
    enqueueAllOk();
    const res = await client.call('GET', '/api/dashboard/overview');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      assignments: { active_count: 7, planned_count: 2, weekly_hours: 245.5 },
      requests: { open_count: 3, open_hours_weekly: 80 },
      employees: { total: 22, bench: 4, utilized: 15 },
      contracts: expect.objectContaining({
        active_count: 5,
        planned_count: 2,
        by_status: { active: 5, planned: 2, paused: 1 },
      }),
      opportunities: expect.objectContaining({
        pipeline_count: 6, // open + qualified
        by_status: { open: 4, qualified: 2, won: 1 },
      }),
      quotations: { total: 6, by_status: { draft: 3, sent: 2, approved: 1 } },
    }));
    expect(typeof res.body.generated_at).toBe('string');
  });

  it('is resilient to empty tables (every domain returns zero)', async () => {
    queryQueue.push({ rows: [{ active_count: 0, planned_count: 0, weekly_hours: '0' }] });
    queryQueue.push({ rows: [{ open_count: 0, open_hours_weekly: '0' }] });
    queryQueue.push({ rows: [{ total: 0, bench: 0, utilized: 0 }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });

    const res = await client.call('GET', '/api/dashboard/overview');
    expect(res.status).toBe(200);
    expect(res.body.assignments.active_count).toBe(0);
    expect(res.body.contracts.by_status).toEqual({});
    expect(res.body.opportunities.pipeline_count).toBe(0);
    expect(res.body.quotations.total).toBe(0);
  });

  it('returns 500 when a domain query fails', async () => {
    // First query fails — short-circuits the Promise.all.
    queryQueue.push(new Error('boom'));
    // Promise.all still fires every query; enqueue placeholders so subsequent
    // resolves don't throw "no mock enqueued" in the other branches.
    queryQueue.push({ rows: [{ open_count: 0, open_hours_weekly: '0' }] });
    queryQueue.push({ rows: [{ total: 0, bench: 0, utilized: 0 }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });

    const res = await client.call('GET', '/api/dashboard/overview');
    expect(res.status).toBe(500);
    expect(res.body.errorId).toMatch(/^ERR-/);
    expect(res.body.where).toBe('GET /dashboard/overview');
  });

  it('issues exactly 6 queries (one per domain)', async () => {
    enqueueAllOk();
    await client.call('GET', '/api/dashboard/overview');
    expect(issuedQueries).toHaveLength(6);
  });
});
