const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (mockControlSql.has(sql)) return { rows: [] };
    if (typeof sql === 'string' && (
      sql.startsWith('SAVEPOINT') || sql.startsWith('RELEASE SAVEPOINT') || sql.startsWith('ROLLBACK TO SAVEPOINT')
    )) return { rows: [] };
    if (!queryQueue.length) {
      throw new Error(`Unexpected query: ${String(sql).slice(0, 100)}`);
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

jest.mock('../utils/events', () => ({ emitEvent: jest.fn(async () => ({})), buildUpdatePayload: () => ({}) }));

let mockUser = { id: 'u1', role: 'admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
  superadminOnly: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const http = require('http');
function call(app, method, url, body = null) {
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
}

const router = require('./idle_time');
const app = express();
app.use(express.json());
app.use('/api/idle-time', router);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockUser = { id: 'u1', role: 'admin' };
});

const empId = '11111111-1111-1111-1111-111111111111';

describe('GET /users/:employee_id/periods/:yyyymm', () => {
  it('400 employee_id inválido', async () => {
    const r = await call(app, 'GET', '/api/idle-time/users/abc/periods/2026-04');
    expect(r.status).toBe(400);
  });
  it('400 period inválido', async () => {
    const r = await call(app, 'GET', `/api/idle-time/users/${empId}/periods/2026-13`);
    expect(r.status).toBe(400);
  });
  it('200 con snapshot persistido', async () => {
    queryQueue.push({ rows: [{
      employee_id: empId, period_yyyymm: '2026-04',
      total_capacity_hours: 176, idle_hours: 16, idle_pct: 0.10, idle_cost_usd: 720,
      calculation_status: 'final',
    }] });
    const r = await call(app, 'GET', `/api/idle-time/users/${empId}/periods/2026-04`);
    expect(r.status).toBe(200);
    expect(r.body.persisted).toBe(true);
    expect(r.body.calculation_status).toBe('final');
  });
  it('200 calculando on-the-fly si no hay snapshot', async () => {
    queryQueue.push({ rows: [] }); // no snapshot
    queryQueue.push({ rows: [{   // employee+cost
      id: empId, weekly_capacity_hours: 40, hire_date: '2020-01-01', end_date: null,
      country_id: 'CO', cost_usd: 7800,
    }] });
    queryQueue.push({ rows: [{ id: 'CO', standard_workday_hours: 8, standard_workdays_per_week: 5 }] });
    queryQueue.push({ rows: [] }); // holidays
    queryQueue.push({ rows: [] }); // novelties
    queryQueue.push({ rows: [] }); // contracts
    queryQueue.push({ rows: [] }); // internals
    const r = await call(app, 'GET', `/api/idle-time/users/${empId}/periods/2026-04`);
    expect(r.status).toBe(200);
    expect(r.body.persisted).toBe(false);
    expect(r.body.calculation_status).toBe('preliminary');
  });
});

describe('POST /calculate', () => {
  it('admin corre cálculo de un employee', async () => {
    queryQueue.push({ rows: [{ id: empId }] });   // employees con employee_ids filter
    // load: employee+cost, country, holidays, novelties, contracts, internals
    queryQueue.push({ rows: [{
      id: empId, weekly_capacity_hours: 40, hire_date: '2020-01-01', end_date: null,
      country_id: 'CO', cost_usd: 7800,
    }] });
    queryQueue.push({ rows: [{ id: 'CO', standard_workday_hours: 8 }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    // existing snapshot check
    queryQueue.push({ rows: [] });
    // INSERT
    queryQueue.push({ rows: [] });
    const r = await call(app, 'POST', '/api/idle-time/calculate',
      { period_yyyymm: '2026-04', employee_ids: [empId] });
    expect(r.status).toBe(200);
    expect(r.body.processed).toBe(1);
  });
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'member' };
    const r = await call(app, 'POST', '/api/idle-time/calculate', { period_yyyymm: '2026-04' });
    expect(r.status).toBe(403);
  });
  it('400 period inválido', async () => {
    const r = await call(app, 'POST', '/api/idle-time/calculate', { period_yyyymm: 'bad' });
    expect(r.status).toBe(400);
  });
  it('skipped_final cuenta cuando ya hay final', async () => {
    queryQueue.push({ rows: [{ id: empId }] });
    queryQueue.push({ rows: [{
      id: empId, weekly_capacity_hours: 40, hire_date: '2020-01-01', end_date: null,
      country_id: 'CO', cost_usd: 7800,
    }] });
    queryQueue.push({ rows: [{ id: 'CO', standard_workday_hours: 8 }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [{ id: 'snap-1', calculation_status: 'final' }] });
    const r = await call(app, 'POST', '/api/idle-time/calculate',
      { period_yyyymm: '2026-04', employee_ids: [empId] });
    expect(r.status).toBe(200);
    expect(r.body.skipped_final).toBe(1);
    expect(r.body.processed).toBe(0);
  });
});

describe('POST /finalize', () => {
  it('admin marca como final', async () => {
    queryQueue.push({ rowCount: 130 });
    const r = await call(app, 'POST', '/api/idle-time/finalize', { period_yyyymm: '2026-04' });
    expect(r.status).toBe(200);
    expect(r.body.finalized_count).toBe(130);
  });
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'member' };
    const r = await call(app, 'POST', '/api/idle-time/finalize', { period_yyyymm: '2026-04' });
    expect(r.status).toBe(403);
  });
});

describe('POST /recalculate', () => {
  it('admin con reason válido', async () => {
    queryQueue.push({ rows: [] }); // DELETE
    const r = await call(app, 'POST', '/api/idle-time/recalculate', {
      period_yyyymm: '2026-04', reason: 'Festivo retroactivo CO 2026-04-19',
    });
    expect(r.status).toBe(200);
  });
  it('400 reason muy corto', async () => {
    const r = await call(app, 'POST', '/api/idle-time/recalculate', {
      period_yyyymm: '2026-04', reason: 'corto',
    });
    expect(r.status).toBe(400);
  });
});

describe('GET /aggregate', () => {
  it('admin obtiene totals', async () => {
    queryQueue.push({ rows: [{
      users_count: 10, total_capacity_hours: 1760, idle_hours: 80,
      idle_cost_usd: 3600, average_idle_pct: 0.05,
    }] });
    const r = await call(app, 'GET', '/api/idle-time/aggregate?period=2026-04');
    expect(r.status).toBe(200);
    expect(r.body.totals.users_count).toBe(10);
  });
  it('group_by=country', async () => {
    queryQueue.push({ rows: [{ users_count: 10, idle_hours: 80, idle_cost_usd: 3600, average_idle_pct: 0.05 }] });
    queryQueue.push({ rows: [{ country_id: 'CO', users_count: 8, idle_pct: 0.05, idle_cost_usd: 3000 }] });
    const r = await call(app, 'GET', '/api/idle-time/aggregate?period=2026-04&group_by=country');
    expect(r.status).toBe(200);
    expect(r.body.groups).toHaveLength(1);
    expect(r.body.groups[0].country_id).toBe('CO');
  });
  it('400 group_by inválido', async () => {
    const r = await call(app, 'GET', '/api/idle-time/aggregate?period=2026-04&group_by=banana');
    expect(r.status).toBe(400);
  });
  it('member sin lead → 403', async () => {
    mockUser = { id: 'u1', role: 'member' };
    const r = await call(app, 'GET', '/api/idle-time/aggregate?period=2026-04');
    expect(r.status).toBe(403);
  });
});

describe('GET /capacity-utilization', () => {
  it('admin', async () => {
    queryQueue.push({ rows: [{
      users_count: 10, total_capacity_hours: 1760,
      holiday_hours: 160, novelty_hours: 80,
      billable_hours: 1200, internal_hours: 200,
      idle_hours: 120, idle_cost_usd: 5400,
    }] });
    const r = await call(app, 'GET', '/api/idle-time/capacity-utilization?period=2026-04');
    expect(r.status).toBe(200);
    expect(r.body.breakdown.idle.hours).toBe(120);
    expect(r.body.indicators.utilization_rate_billable_pct).toBeGreaterThan(0);
  });
});

describe('GET /initiative-cost-summary', () => {
  it('admin', async () => {
    queryQueue.push({ rows: [{ active_initiatives: 5, total_budget_usd: 1000000, total_consumed_usd_period: 50000, total_hours_period: 1100 }] });
    queryQueue.push({ rows: [{ area: 'product', consumed_usd: 30000, hours: 600 }] });
    const r = await call(app, 'GET', '/api/idle-time/initiative-cost-summary?period=2026-04');
    expect(r.status).toBe(200);
    expect(r.body.totals.active_initiatives).toBe(5);
    expect(r.body.by_business_area).toHaveLength(1);
  });
});
