/**
 * Unit tests for server/routes/time_entries.js (ET-*).
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
  superadminOnly: (req, res, next) => { next(); },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Rol insuficiente' });
    next();
  },
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

const teRouter = require('./time_entries');
const app = express();
app.use(express.json());
app.use('/api/time-entries', teRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u-admin', role: 'admin' };
});

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const validBody = () => ({ assignment_id: 'a1', work_date: yesterday, hours: 8 });

describe('POST /api/time-entries (ET-2, ET-6, ET-7)', () => {
  it('rejects missing required fields', async () => {
    for (const miss of ['assignment_id', 'work_date', 'hours']) {
      const body = { ...validBody(), [miss]: undefined };
      // eslint-disable-next-line no-await-in-loop
      const res = await client.call('POST', '/api/time-entries', body);
      expect(res.status).toBe(400);
    }
  });

  it('rejects future work_date (ET-7)', async () => {
    const res = await client.call('POST', '/api/time-entries', { ...validBody(), work_date: tomorrow });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/futuras/i);
  });

  it('rejects hours out of range', async () => {
    let res = await client.call('POST', '/api/time-entries', { ...validBody(), hours: 0 });
    expect(res.status).toBe(400);
    res = await client.call('POST', '/api/time-entries', { ...validBody(), hours: 30 });
    expect(res.status).toBe(400);
  });

  it('rejects when assignment does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/time-entries', validBody());
    expect(res.status).toBe(400);
  });

  it('rejects when assignment is cancelled', async () => {
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e1', start_date: '2026-01-01', end_date: null, status: 'cancelled' }] });
    const res = await client.call('POST', '/api/time-entries', validBody());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancelada/);
  });

  it('rejects when work_date is before assignment start_date', async () => {
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e1', start_date: tomorrow, end_date: null, status: 'active' }] });
    const res = await client.call('POST', '/api/time-entries', { ...validBody(), work_date: yesterday });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rango/);
  });

  it('ET-2 daily cap: rejects 409 when sum would exceed 16h', async () => {
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e1', start_date: '2026-01-01', end_date: null, status: 'active' }] });
    // authorizeWrite bypasses DB when admin
    queryQueue.push({ rows: [{ total: 10 }] });
    const res = await client.call('POST', '/api/time-entries', { ...validBody(), hours: 10 });
    expect(res.status).toBe(409);
    expect(res.body.existing_hours).toBe(10);
    expect(res.body.daily_max).toBe(16);
  });

  it('admin creates time entry (bypasses window/self checks)', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e1', start_date: '2026-01-01', end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [{ id: 'te-new', hours: 8, work_date: yesterday }] });
    const res = await client.call('POST', '/api/time-entries', validBody());
    expect(res.status).toBe(201);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'time_entry.created');
    expect(evt).toBeTruthy();
  });

  it('employee creates their OWN entry within window', async () => {
    mockCurrentUser = { id: 'u-ana', role: 'member', function: 'engineer' };
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e1', start_date: '2026-01-01', end_date: null, status: 'active' }] });
    // authorizeWrite looks up actor's employee row — returns self (match)
    queryQueue.push({ rows: [{ employee_id: 'e1', squad_id: 's1' }] });
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [{ id: 'te-new', hours: 8 }] });

    const res = await client.call('POST', '/api/time-entries', validBody());
    expect(res.status).toBe(201);
  });

  it('rejects 403 when employee tries to write for someone else', async () => {
    mockCurrentUser = { id: 'u-ana', role: 'member', function: 'engineer' };
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e-other', start_date: '2026-01-01', end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [{ employee_id: 'e1', squad_id: 's1' }] }); // actor's employee row
    const res = await client.call('POST', '/api/time-entries', validBody());
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('not_authorized');
  });

  it('capacity-function user can write for a squad mate', async () => {
    mockCurrentUser = { id: 'u-lead', role: 'member', function: 'capacity' };
    queryQueue.push({ rows: [{ id: 'a1', employee_id: 'e-other', start_date: '2026-01-01', end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [{ employee_id: 'e-lead', squad_id: 's1' }] }); // actor
    queryQueue.push({ rows: [{ squad_id: 's1' }] });                        // target — same squad
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [{ id: 'te-new' }] });

    const res = await client.call('POST', '/api/time-entries', validBody());
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/time-entries/:id', () => {
  it('recomputes daily cap on hours change', async () => {
    queryQueue.push({ rows: [{ id: 'te1', employee_id: 'e1', work_date: yesterday, hours: 4 }] });
    // authorizeWrite (admin) → no DB
    queryQueue.push({ rows: [{ total: 14 }] }); // other entries for that day
    const res = await client.call('PUT', '/api/time-entries/te1', { hours: 5 });
    expect(res.status).toBe(409);
  });

  it('rejects future work_date on update', async () => {
    queryQueue.push({ rows: [{ id: 'te1', employee_id: 'e1', work_date: yesterday, hours: 4 }] });
    const res = await client.call('PUT', '/api/time-entries/te1', { work_date: tomorrow });
    expect(res.status).toBe(400);
  });

  it('updates hours under cap', async () => {
    queryQueue.push({ rows: [{ id: 'te1', employee_id: 'e1', work_date: yesterday, hours: 4 }] });
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [{ id: 'te1', hours: 5 }] });
    const res = await client.call('PUT', '/api/time-entries/te1', { hours: 5 });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/time-entries/copy-week (ET-3)', () => {
  it('rejects missing params', async () => {
    let res = await client.call('POST', '/api/time-entries/copy-week', {});
    expect(res.status).toBe(400);
    res = await client.call('POST', '/api/time-entries/copy-week', { employee_id: 'e1' });
    expect(res.status).toBe(400);
  });

  it('returns copied:0 when source week is empty', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/time-entries/copy-week', { employee_id: 'e1', source_week_start: '2020-01-06' });
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(0);
  });

  it('skips rows whose new date would be in the future', async () => {
    // Single source entry from a week that maps forward into the future
    queryQueue.push({ rows: [
      { id: 'te-src', employee_id: 'e1', assignment_id: 'a1', work_date: today, hours: 8, description: null },
    ] });
    const res = await client.call('POST', '/api/time-entries/copy-week', { employee_id: 'e1', source_week_start: today });
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(0);
    expect(res.body.skipped[0].reason).toBe('future_entry');
  });

  it('copies eligible entries + emits summary event', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    // Source entry 14 days ago → new date is 7 days ago (past)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const sourceWeek = fourteenDaysAgo;
    queryQueue.push({ rows: [
      { id: 'te-src', employee_id: 'e1', assignment_id: 'a1', work_date: fourteenDaysAgo, hours: 8, description: 'work' },
    ] });
    // authorizeWrite (admin) — no DB
    queryQueue.push({ rows: [{ status: 'active', start_date: '2020-01-01', end_date: null }] }); // assignment check
    queryQueue.push({ rows: [{ total: 0 }] }); // daily cap query
    queryQueue.push({ rows: [{ id: 'te-new' }] }); // INSERT

    const res = await client.call('POST', '/api/time-entries/copy-week', { employee_id: 'e1', source_week_start: sourceWeek });
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(1);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'time_entry.copied_week');
    expect(evt).toBeTruthy();
    expect(evt[1].payload.copied).toBe(1);
  });
});
