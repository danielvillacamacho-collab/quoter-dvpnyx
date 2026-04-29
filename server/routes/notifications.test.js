/**
 * Unit tests for server/routes/notifications.js + server/utils/notifications.js.
 */

const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (!queryQueue.length) {
      throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
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

let mockCurrentUser = { id: 'u1', role: 'member' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
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
          const r = http.request(
            { host: '127.0.0.1', port, path: url, method, headers: { authorization: 'Bearer x' } },
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
          r.on('error', (e) => { srv.close(); reject(e); });
          r.end();
        });
      });
    },
  };
};

const router = require('./notifications');
const app = express();
app.use(express.json());
app.use('/api/notifications', router);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'member' };
});

describe('GET /api/notifications', () => {
  it('returns my notifications scoped by user_id', async () => {
    queryQueue.push({ rows: [
      { id: 'n1', type: 'assignment.created', title: 'Te asignaron', body: null, link: '/assignments',
        entity_type: 'assignment', entity_id: 'a1', read_at: null, created_at: '2026-04-21T10:00:00Z' },
    ] });
    const res = await client.call('GET', '/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(issuedQueries[0].params[0]).toBe('u1');
    expect(issuedQueries[0].params[1]).toBe(50);
  });

  it('returns 500 when the DB throws', async () => {
    queryQueue.push(new Error('boom'));
    const res = await client.call('GET', '/api/notifications');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('returns the unread count for the current user', async () => {
    queryQueue.push({ rows: [{ count: 4 }] });
    const res = await client.call('GET', '/api/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 4 });
    expect(issuedQueries[0].sql).toMatch(/read_at IS NULL/);
    expect(issuedQueries[0].params).toEqual(['u1']);
  });

  it('defaults to 0 when the DB returns an empty shape', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/notifications/unread-count');
    expect(res.body).toEqual({ count: 0 });
  });
});

describe('POST /api/notifications/:id/read', () => {
  it('marks a notification I own as read', async () => {
    queryQueue.push({ rows: [{ id: 'n1', read_at: '2026-04-21T10:05:00Z' }] });
    const res = await client.call('POST', '/api/notifications/n1/read');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('n1');
    expect(issuedQueries[0].params).toEqual(['n1', 'u1']);
  });

  it('returns 404 when the row does not belong to me', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/notifications/n1/read');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('bulk-updates my unread notifications', async () => {
    queryQueue.push({ rowCount: 7 });
    const res = await client.call('POST', '/api/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 7 });
    expect(issuedQueries[0].params).toEqual(['u1']);
  });
});

describe('notify() helper', () => {
  // Run the helper directly to make sure it never throws on a DB error
  // and silently drops writes when user_id is null.
  const { notify, notifyMany } = require('../utils/notifications');

  it('returns null when user_id is missing (no DB call)', async () => {
    const spy = jest.fn();
    const res = await notify({ query: spy }, { type: 't', title: 'x' });
    expect(res).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('swallows DB errors and returns null (pool path)', async () => {
    // Pool-shaped (has .connect) → no savepoint, single query that throws.
    const fakePool = {
      connect: () => {},
      query: async () => { throw new Error('boom'); },
    };
    const res = await notify(fakePool, { user_id: 'u1', type: 't', title: 'x' });
    expect(res).toBeNull();
  });

  it('swallows DB errors AND rolls back to savepoint when called with a txn client (INC-002)', async () => {
    const calls = [];
    const fakeClient = {
      // No .connect → treated as txn client → savepoint path.
      query: async (sql) => {
        calls.push(sql);
        if (/^SAVEPOINT /.test(sql) || /^ROLLBACK TO SAVEPOINT /.test(sql)) return { rows: [] };
        if (/^INSERT INTO notifications/.test(sql)) throw new Error('FK violation');
        return { rows: [] };
      },
    };
    const res = await notify(fakeClient, { user_id: 'u1', type: 't', title: 'x' });
    expect(res).toBeNull();
    expect(calls.some((s) => /^SAVEPOINT /.test(s))).toBe(true);
    expect(calls.some((s) => /^ROLLBACK TO SAVEPOINT /.test(s))).toBe(true);
  });

  it('notifyMany dedupes and skips falsy ids', async () => {
    // Use pool-shaped fake (has .connect) so the helper takes the
    // single-query path — control SQL isn't generated.
    const inserted = [];
    const fakePool = {
      connect: () => {},
      query: async (_sql, params) => {
        inserted.push(params[0]);
        return { rows: [{ id: 'n-' + params[0] }] };
      },
    };
    const rows = await notifyMany(fakePool, ['a', 'b', 'a', null, undefined, 'c'], {
      type: 't', title: 'x',
    });
    expect(inserted).toEqual(['a', 'b', 'c']);
    expect(rows).toHaveLength(3);
  });
});
