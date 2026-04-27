/**
 * Tests for server/routes/revenue.js — RR-MVP-00.1.
 * Mismo harness pattern que opportunities.test.js.
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

let mockUser = { id: 'u1', role: 'admin', name: 'Test' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  adminOnly: (_req, _res, next) => next(),
  superadminOnly: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const router = require('./revenue');
const { expandMonths } = router._internal;

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

const app = express(); app.use(express.json()); app.use('/api/revenue', router);
const client = request(app);

beforeEach(() => { queryQueue.length = 0; issuedQueries.length = 0; });

describe('expandMonths utility', () => {
  it('expands single month', () => {
    expect(expandMonths('202601', '202601')).toEqual(['202601']);
  });
  it('expands across years', () => {
    expect(expandMonths('202511', '202602')).toEqual(['202511', '202512', '202601', '202602']);
  });
  it('rejects invalid format', () => {
    expect(expandMonths('foo', 'bar')).toEqual([]);
  });
});

describe('GET /api/revenue', () => {
  it('rejects invalid from/to', async () => {
    const res = await client.call('GET', '/api/revenue?from=foo&to=bar');
    expect(res.status).toBe(400);
  });

  it('returns matrix with months, rows, col_totals, global_total', async () => {
    queryQueue.push({ rows: [
      { id: 'k1', name: 'Contract A', type: 'capacity', status: 'active', start_date: '2026-01-01',
        total_value_usd: 30000, client_id: 'c1', client_name: 'Acme', client_country: 'CO',
        owner_id: 'u1', owner_name: 'Laura' },
    ] });
    queryQueue.push({ rows: [
      { contract_id: 'k1', yyyymm: '202602', projected_usd: 5000, real_usd: 5200, status: 'closed', notes: null, closed_at: new Date(), updated_at: new Date() },
      { contract_id: 'k1', yyyymm: '202603', projected_usd: 5500, real_usd: null, status: 'open', notes: null, closed_at: null, updated_at: new Date() },
    ] });
    const res = await client.call('GET', '/api/revenue?from=202602&to=202603');
    expect(res.status).toBe(200);
    expect(res.body.months).toEqual(['202602', '202603']);
    expect(res.body.rows).toHaveLength(1);
    const row = res.body.rows[0];
    expect(row.cells['202602'].real_usd).toBe(5200);
    expect(row.cells['202603'].real_usd).toBeNull();
    expect(row.row_total.projected_usd).toBe(10500);
    expect(row.row_total.real_usd).toBe(5200);
    expect(res.body.col_totals['202602'].projected_usd).toBe(5000);
    expect(res.body.global_total.projected_usd).toBe(10500);
  });

  it('handles contract with no periods (all cells null)', async () => {
    queryQueue.push({ rows: [
      { id: 'k1', name: 'C', type: 'capacity', status: 'planned', start_date: '2026-01-01',
        total_value_usd: 0, client_id: 'c1', client_name: 'X', client_country: 'CO',
        owner_id: 'u1', owner_name: 'Y' },
    ] });
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/revenue?from=202601&to=202602');
    expect(res.status).toBe(200);
    expect(res.body.rows[0].cells['202601']).toBeNull();
    expect(res.body.rows[0].row_total.projected_usd).toBe(0);
  });
});

describe('PUT /api/revenue/:contract_id/:yyyymm (REAL only after RR-MVP-00.2)', () => {
  it('rejects invalid yyyymm', async () => {
    const res = await client.call('PUT', '/api/revenue/k1/abcdef', { real_usd: 1000 });
    expect(res.status).toBe(400);
  });

  it('returns 409 when no plan period exists yet (PROY must be declared first)', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'capacity', total_value_usd: 0 }] });   // contract exists
    queryQueue.push({ rows: [] });               // no existing period
    const res = await client.call('PUT', '/api/revenue/k1/202602', { real_usd: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/plan/i);
  });

  it('updates real_usd when period exists (capacity)', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'capacity', total_value_usd: 0 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', projected_usd: 1000, real_usd: null, real_pct: null, status: 'open' }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', projected_usd: 1000, real_usd: 1500, real_pct: null, status: 'open' }] });
    queryQueue.push({ rows: [] });               // audit_log
    const res = await client.call('PUT', '/api/revenue/k1/202602', { real_usd: 1500 });
    expect(res.status).toBe(200);
    expect(res.body.real_usd).toBe(1500);
  });

  it('returns 404 when contract is missing', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('PUT', '/api/revenue/k-missing/202602', { real_usd: 100 });
    expect(res.status).toBe(404);
  });
});

describe('GET/PUT /api/revenue/:contract_id/plan (RR-MVP-00.2)', () => {
  it('GET plan returns contract metadata + existing periods', async () => {
    queryQueue.push({ rows: [{ id: 'k1', name: 'C', type: 'project', total_value_usd: 100000, original_currency: 'USD',
                                start_date: '2026-01-01', end_date: '2026-12-31', status: 'active',
                                client_id: 'c1', client_name: 'Acme', client_country: 'CO', owner_name: 'Laura' }] });
    queryQueue.push({ rows: [
      { yyyymm: '202602', projected_usd: 20000, projected_pct: 0.2, real_usd: null, status: 'open' },
      { yyyymm: '202603', projected_usd: 30000, projected_pct: 0.3, real_usd: null, status: 'open' },
    ] });
    const res = await client.call('GET', '/api/revenue/k1/plan');
    expect(res.status).toBe(200);
    expect(res.body.contract.type).toBe('project');
    expect(res.body.periods).toHaveLength(2);
  });

  it('PUT plan rejects when entries[] missing', async () => {
    const res = await client.call('PUT', '/api/revenue/k1/plan', {});
    expect(res.status).toBe(400);
  });

  it('PUT plan for project: validates pct required + computes projected_usd from total_value_usd', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 100000 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', projected_usd: 20000, projected_pct: 0.2 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202603', projected_usd: 50000, projected_pct: 0.5 }] });
    queryQueue.push({ rows: [] }); // audit_log
    const res = await client.call('PUT', '/api/revenue/k1/plan', {
      entries: [{ yyyymm: '202602', pct: 0.2 }, { yyyymm: '202603', pct: 0.5 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    // The INSERT call sent projected_usd = pct × total_value_usd = 0.2 × 100000 = 20000
    const insert1 = issuedQueries.find((q) => q.sql.includes('INSERT INTO revenue_periods'));
    expect(insert1.params[2]).toBe(20000);
  });

  it('PUT plan for project: rejects pct out of range', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 100000 }] });
    const res = await client.call('PUT', '/api/revenue/k1/plan', {
      entries: [{ yyyymm: '202602', pct: 1.5 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pct/);
  });

  it('PUT plan for capacity: takes projected_usd directly', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'capacity', total_value_usd: 0 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', projected_usd: 7500 }] });
    queryQueue.push({ rows: [] }); // audit_log
    const res = await client.call('PUT', '/api/revenue/k1/plan', {
      entries: [{ yyyymm: '202602', projected_usd: 7500 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.entries[0].projected_usd).toBe(7500);
  });

  it('RR-MVP-00.3: PUT plan also updates contracts.total_value_usd + original_currency when sent in body', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 0, original_currency: 'USD' }] });
    queryQueue.push({ rows: [] }); // UPDATE contracts
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', projected_usd: 30000, projected_pct: 0.3 }] });
    queryQueue.push({ rows: [] }); // audit_log
    const res = await client.call('PUT', '/api/revenue/k1/plan', {
      total_value_usd: 100000,
      original_currency: 'cop',
      entries: [{ yyyymm: '202602', pct: 0.3 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.contract.total_value_usd).toBe(100000);
    expect(res.body.contract.original_currency).toBe('COP');
    // INSERT projected_usd computed from NEW total_value_usd: 0.3 × 100000 = 30000
    const insertCall = issuedQueries.find((q) => q.sql.includes('INSERT INTO revenue_periods'));
    expect(insertCall.params[2]).toBe(30000);
    const updateContract = issuedQueries.find((q) => q.sql.includes('UPDATE contracts SET total_value_usd'));
    expect(updateContract).toBeTruthy();
    expect(updateContract.params).toEqual(['k1', 100000, 'COP']);
  });

  it('RR-MVP-00.3: PUT plan rejects negative total_value_usd', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 50000, original_currency: 'USD' }] });
    const res = await client.call('PUT', '/api/revenue/k1/plan', {
      total_value_usd: -500,
      entries: [{ yyyymm: '202602', pct: 0.3 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/total_value_usd/);
  });

  it('RR-MVP-00.4: PUT plan for project BLOCKS (400) when pct sum exceeds 1', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 100000, original_currency: 'USD' }] });
    const res = await client.call('PUT', '/api/revenue/k1/plan', {
      entries: [{ yyyymm: '202602', pct: 0.7 }, { yyyymm: '202603', pct: 0.6 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('pct_sum_exceeds_1');
    expect(res.body.error).toMatch(/100%/);
  });
});

describe('POST /api/revenue/:contract_id/:yyyymm/close', () => {
  it('rejects close on non-existing contract (404)', async () => {
    queryQueue.push({ rows: [] }); // contract not found
    const res = await client.call('POST', '/api/revenue/k1/202602/close', { real_usd: 1000 });
    expect(res.status).toBe(404);
  });

  it('rejects close on non-existing period', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'capacity', total_value_usd: 0 }] });
    queryQueue.push({ rows: [] }); // period missing
    const res = await client.call('POST', '/api/revenue/k1/202602/close', { real_usd: 1000 });
    expect(res.status).toBe(404);
  });

  it('rejects close without real_usd when none set yet (capacity)', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'capacity', total_value_usd: 0 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', real_usd: null, real_pct: null, status: 'open' }] });
    const res = await client.call('POST', '/api/revenue/k1/202602/close', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/real_usd/);
  });

  it('closes a period with provided real_usd (capacity)', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'capacity', total_value_usd: 0 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', real_usd: null, real_pct: null, status: 'open' }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', real_usd: 5000, status: 'closed' }] });
    queryQueue.push({ rows: [] }); // audit_log
    const res = await client.call('POST', '/api/revenue/k1/202602/close', { real_usd: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  it('RR-MVP-00.5: closes a project period using real_pct, derives real_usd', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 100000 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', real_usd: null, real_pct: null, status: 'open' }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', real_usd: 30000, real_pct: 0.3, status: 'closed' }] });
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/revenue/k1/202602/close', { real_pct: 0.3 });
    expect(res.status).toBe(200);
    // The UPDATE was issued with real_usd = 0.3 × 100000 = 30000, real_pct = 0.3
    const update = issuedQueries.find((q) => q.sql.includes('UPDATE revenue_periods SET') && q.sql.includes("status='closed'"));
    expect(update.params[2]).toBe(30000);
    expect(update.params[3]).toBe(0.3);
  });
});

describe('RR-MVP-00.5: PUT real_pct for project contracts', () => {
  it('rejects real_pct out of range (0..1)', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 100000 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', real_usd: null, real_pct: null, status: 'open' }] });
    const res = await client.call('PUT', '/api/revenue/k1/202602', { real_pct: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/real_pct/);
  });

  it('blocks (400) when cumulative SUM(real_pct) would exceed 1', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 100000 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202603', real_usd: null, real_pct: null, status: 'open' }] });
    queryQueue.push({ rows: [{ sum_pct: 0.8 }] }); // existing other months sum to 80%
    const res = await client.call('PUT', '/api/revenue/k1/202603', { real_pct: 0.3 }); // 0.8 + 0.3 = 1.1
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('real_pct_sum_exceeds_1');
  });

  it('happy path: persists real_pct + derived real_usd', async () => {
    queryQueue.push({ rows: [{ id: 'k1', type: 'project', total_value_usd: 100000 }] });
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', real_usd: null, real_pct: null, status: 'open' }] });
    queryQueue.push({ rows: [{ sum_pct: 0.4 }] }); // other months sum to 40%
    queryQueue.push({ rows: [{ contract_id: 'k1', yyyymm: '202602', real_usd: 30000, real_pct: 0.3, status: 'open' }] }); // UPDATE
    queryQueue.push({ rows: [] }); // audit_log
    const res = await client.call('PUT', '/api/revenue/k1/202602', { real_pct: 0.3 });
    expect(res.status).toBe(200);
    expect(res.body.real_pct).toBe(0.3);
    expect(res.body.real_usd).toBe(30000);
    const update = issuedQueries.find((q) => q.sql.includes('UPDATE revenue_periods SET') && q.sql.includes("real_pct"));
    // params: [contract_id, yyyymm, real_usd, real_pct, notes, user_id]
    expect(update.params[2]).toBe(30000);
    expect(update.params[3]).toBe(0.3);
  });
});
