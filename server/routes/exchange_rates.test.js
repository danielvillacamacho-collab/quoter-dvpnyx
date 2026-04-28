/**
 * Tests for server/routes/exchange_rates.js — RR-MVP-00.6.
 */
const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (!queryQueue.length) throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
    const next = queryQueue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    query: jest.fn(async (sql, params) => pushAndPop(sql, params)),
  };
});

let mockUser = { id: 'u1', role: 'admin', name: 'Admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Acceso solo para administradores' });
    next();
  },
  superadminOnly: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const router = require('./exchange_rates');

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

const app = express(); app.use(express.json()); app.use('/api/admin/exchange-rates', router);
const client = request(app);

beforeEach(() => { queryQueue.length = 0; issuedQueries.length = 0; mockUser = { id: 'u1', role: 'admin', name: 'Admin' }; });

describe('GET /api/admin/exchange-rates', () => {
  it('rejects invalid from/to', async () => {
    const res = await client.call('GET', '/api/admin/exchange-rates?from=foo&to=bar');
    expect(res.status).toBe(400);
  });

  it('returns matrix grouped by currency × month', async () => {
    queryQueue.push({ rows: [
      { yyyymm: '202602', currency: 'COP', usd_rate: '4000', notes: null, updated_at: new Date(), updated_by: 'u1' },
      { yyyymm: '202603', currency: 'COP', usd_rate: '4100', notes: null, updated_at: new Date(), updated_by: 'u1' },
      { yyyymm: '202602', currency: 'MXN', usd_rate: '17', notes: null, updated_at: new Date(), updated_by: 'u1' },
    ] });
    const res = await client.call('GET', '/api/admin/exchange-rates?from=202602&to=202603');
    expect(res.status).toBe(200);
    expect(res.body.months).toEqual(['202602', '202603']);
    expect(res.body.currencies).toEqual(['COP', 'MXN']);
    expect(res.body.cells['COP|202602'].usd_rate).toBe(4000);
    expect(res.body.cells['MXN|202602'].usd_rate).toBe(17);
  });

  it('filters by currency when provided', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/admin/exchange-rates?from=202601&to=202612&currency=cop');
    const sql = issuedQueries[0].sql;
    expect(sql).toMatch(/currency = \$3/);
    expect(issuedQueries[0].params[2]).toBe('COP');
  });
});

describe('PUT /api/admin/exchange-rates/:yyyymm/:currency', () => {
  it('rejects non-admin (403)', async () => {
    mockUser = { id: 'u2', role: 'member', name: 'Member' };
    const res = await client.call('PUT', '/api/admin/exchange-rates/202602/COP', { usd_rate: 4000 });
    expect(res.status).toBe(403);
  });

  it('rejects invalid yyyymm', async () => {
    const res = await client.call('PUT', '/api/admin/exchange-rates/foobar/COP', { usd_rate: 4000 });
    expect(res.status).toBe(400);
  });

  it('rejects USD (rate=1 implícito)', async () => {
    const res = await client.call('PUT', '/api/admin/exchange-rates/202602/USD', { usd_rate: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/USD/);
  });

  it('rejects negative or zero usd_rate', async () => {
    const res = await client.call('PUT', '/api/admin/exchange-rates/202602/COP', { usd_rate: 0 });
    expect(res.status).toBe(400);
  });

  it('upserts a rate (admin path)', async () => {
    queryQueue.push({ rows: [{ yyyymm: '202602', currency: 'COP', usd_rate: '4000' }] });
    queryQueue.push({ rows: [] }); // audit_log
    const res = await client.call('PUT', '/api/admin/exchange-rates/202602/cop', { usd_rate: 4000, notes: 'BanRep oficial' });
    expect(res.status).toBe(200);
    expect(res.body.usd_rate).toBe('4000');
    const upsert = issuedQueries.find((q) => q.sql.includes('INSERT INTO exchange_rates'));
    expect(upsert.params[1]).toBe('COP'); // uppercased
  });
});

describe('DELETE /api/admin/exchange-rates/:yyyymm/:currency', () => {
  it('rejects non-admin', async () => {
    mockUser = { id: 'u2', role: 'member', name: 'Member' };
    const res = await client.call('DELETE', '/api/admin/exchange-rates/202602/COP');
    expect(res.status).toBe(403);
  });

  it('returns 404 when nothing to delete', async () => {
    queryQueue.push({ rowCount: 0, rows: [] });
    const res = await client.call('DELETE', '/api/admin/exchange-rates/202602/COP');
    expect(res.status).toBe(404);
  });

  it('deletes successfully', async () => {
    queryQueue.push({ rowCount: 1, rows: [] });
    queryQueue.push({ rows: [] }); // audit_log
    const res = await client.call('DELETE', '/api/admin/exchange-rates/202602/COP');
    expect(res.status).toBe(200);
  });
});
