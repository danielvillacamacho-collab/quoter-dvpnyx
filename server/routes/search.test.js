/**
 * Unit tests for server/routes/search.js (Command Palette backend).
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
  auth: (req, _res, next) => { req.user = { id: 'u1', role: 'member' }; next(); },
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

const router = require('./search');
const app = express();
app.use(express.json());
app.use('/api/search', router);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
});

function enqueueEmptyAll() {
  for (let i = 0; i < 6; i++) queryQueue.push({ rows: [] });
}

describe('GET /api/search', () => {
  it('returns empty results when query is shorter than 2 chars (no queries issued)', async () => {
    const res = await client.call('GET', '/api/search?q=a');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ query: 'a', total: 0, results: [] });
    expect(issuedQueries).toHaveLength(0);
  });

  it('returns empty results when q is missing', async () => {
    const res = await client.call('GET', '/api/search');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(issuedQueries).toHaveLength(0);
  });

  it('fans out to 6 queries and flattens results with normalized shape', async () => {
    // clients
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme',       country: 'CO', tier: 'enterprise' }] });
    // opportunities
    queryQueue.push({ rows: [{ id: 'o1', name: 'Deal Alpha', status: 'open',     client_name: 'Acme' }] });
    // contracts
    queryQueue.push({ rows: [{ id: 'k1', name: 'MSA-2026',   status: 'active',   type: 'capacity',  client_name: 'Acme' }] });
    // employees
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'G', level: 'L5', country: 'CO', status: 'active', area_name: 'Dev' }] });
    // quotations
    queryQueue.push({ rows: [{ id: 'q1', project_name: 'Alpha Platform', client_name: 'Acme', type: 'staff_aug', status: 'sent' }] });
    // resource_requests
    queryQueue.push({ rows: [{ id: 'r1', role_title: 'Senior Dev', level: 'L5', status: 'open', contract_name: 'MSA-2026', client_name: 'Acme' }] });

    const res = await client.call('GET', '/api/search?q=acme');
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('acme');
    expect(res.body.total).toBe(6);

    const byType = Object.fromEntries(res.body.results.map((r) => [r.type, r]));
    expect(byType.client).toEqual(expect.objectContaining({ id: 'c1', title: 'Acme', url: '/clients/c1' }));
    expect(byType.opportunity).toEqual(expect.objectContaining({ title: 'Deal Alpha', url: '/opportunities/o1' }));
    expect(byType.contract).toEqual(expect.objectContaining({ title: 'MSA-2026', url: '/contracts/k1' }));
    expect(byType.employee).toEqual(expect.objectContaining({ title: 'Ana G', url: '/employees/e1' }));
    expect(byType.quotation).toEqual(expect.objectContaining({ title: 'Alpha Platform', url: '/quotation/q1' }));
    expect(byType.resource_request).toEqual(expect.objectContaining({ title: 'Senior Dev', url: '/resource-requests/r1' }));
  });

  it('uses ILIKE with wildcard-escaped query', async () => {
    enqueueEmptyAll();
    await client.call('GET', '/api/search?q=100%25'); // URL-encoded "100%"
    // Every query should receive a params array starting with an escaped like pattern.
    for (const q of issuedQueries) {
      expect(q.params[0]).toBe('%100\\%%');
    }
  });

  it('caps limit at 10 per type', async () => {
    enqueueEmptyAll();
    await client.call('GET', '/api/search?q=ana&limit=9999');
    for (const q of issuedQueries) {
      expect(q.params[1]).toBe(10);
    }
  });

  it('defaults limit to 5 per type when absent', async () => {
    enqueueEmptyAll();
    await client.call('GET', '/api/search?q=ana');
    for (const q of issuedQueries) {
      expect(q.params[1]).toBe(5);
    }
  });

  it('returns 500 when any per-type query throws', async () => {
    queryQueue.push(new Error('db down'));
    // Promise.all still fires all 6 — provide resolved placeholders.
    for (let i = 0; i < 5; i++) queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/search?q=ana');
    expect(res.status).toBe(500);
    expect(res.body.errorId).toMatch(/^ERR-/);
    expect(res.body.where).toBe('GET /search');
  });
});
