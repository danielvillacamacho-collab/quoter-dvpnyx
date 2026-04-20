/**
 * Unit tests for server/routes/parameters.js.
 *
 * EP-2 additions: PUT now emits a structured `parameter.updated` event
 * with before/after/changed_fields, on top of the legacy audit_log row.
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

jest.mock('../utils/events', () => ({
  emitEvent: jest.fn(async () => ({ id: 'evt', created_at: new Date().toISOString() })),
  buildUpdatePayload: jest.requireActual('../utils/events').buildUpdatePayload,
}));

let mockCurrentUser = { id: 'u-admin', role: 'admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
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

const paramsRouter = require('./parameters');
const app = express();
app.use(express.json());
app.use('/api/parameters', paramsRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u-admin', role: 'admin' };
});

describe('PUT /api/parameters/:id (EP-2)', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('PUT', '/api/parameters/1', { value: 0.40 });
    expect(res.status).toBe(403);
  });

  it('returns 404 when the parameter does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('PUT', '/api/parameters/999', { value: 0.40 });
    expect(res.status).toBe(404);
  });

  it('updates + writes to audit_log (legacy) + emits parameter.updated event (V2)', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 1, category: 'margin', key: 'talent', value: 0.35, label: 'Margen talento', note: null }] });  // SELECT before
    queryQueue.push({ rows: [{ id: 1, category: 'margin', key: 'talent', value: 0.40, label: 'Margen talento', note: null }] });  // UPDATE
    queryQueue.push({ rows: [] });                                                                                                // INSERT audit_log

    const res = await client.call('PUT', '/api/parameters/1', { value: 0.40 });
    expect(res.status).toBe(200);
    expect(Number(res.body.value)).toBe(0.40);

    // The V2 event should carry the diff + category/key.
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'parameter.updated');
    expect(evt).toBeTruthy();
    expect(evt[1].payload.category).toBe('margin');
    expect(evt[1].payload.key).toBe('talent');
    expect(evt[1].payload.changed_fields).toContain('value');
    expect(Number(evt[1].payload.before.value)).toBe(0.35);
    expect(Number(evt[1].payload.after.value)).toBe(0.40);

    // Legacy audit_log INSERT still runs — V1 readers rely on it.
    const auditInsert = issuedQueries.find((q) => String(q.sql).match(/INSERT INTO audit_log/));
    expect(auditInsert).toBeTruthy();
  });
});
