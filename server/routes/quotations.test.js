/**
 * Unit tests for server/routes/quotations.js
 *
 * Scope (EX-1): POST /api/quotations now REQUIRES client_id + opportunity_id
 * and validates that the opportunity belongs to the referenced client.
 *
 * Same harness shape as clients.test.js / opportunities.test.js: pg is
 * mocked at the module level, the auth middleware is stubbed, and an
 * http harness drives the route.
 */

const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  // See commit 098a644 / opportunities.test.js for why this must start with `mock`.
  const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (mockControlSql.has(sql)) return { rows: [] };
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

let mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
  superadminOnly: (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
    next();
  },
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

const quotationsRouter = require('./quotations');
const app = express();
app.use(express.json());
app.use('/api/quotations', quotationsRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
});

describe('POST /api/quotations — EX-1 linking requirements', () => {
  const validBody = {
    type: 'staff_aug', project_name: 'P1',
    client_id: 'c1', opportunity_id: 'o1',
  };

  it('rejects when client_id is missing', async () => {
    const res = await client.call('POST', '/api/quotations', { ...validBody, client_id: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/client_id/);
    expect(issuedQueries).toHaveLength(0);
  });

  it('rejects when opportunity_id is missing', async () => {
    const res = await client.call('POST', '/api/quotations', { ...validBody, opportunity_id: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/opportunity_id/);
    expect(issuedQueries).toHaveLength(0);
  });

  it('rejects when the referenced client does not exist', async () => {
    queryQueue.push({ rows: [] }); // client lookup empty
    const res = await client.call('POST', '/api/quotations', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cliente no existe/i);
  });

  it('rejects when the referenced opportunity does not exist', async () => {
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }] });       // client lookup OK
    queryQueue.push({ rows: [] });                                 // opp lookup empty
    const res = await client.call('POST', '/api/quotations', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Oportunidad no existe/i);
  });

  it('rejects with 409 when opportunity does not belong to client', async () => {
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }] });
    queryQueue.push({ rows: [{ id: 'o1', name: 'Deal', client_id: 'c-other' }] });
    const res = await client.call('POST', '/api/quotations', validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no pertenece al cliente/i);
    expect(res.body.opportunity_client_id).toBe('c-other');
  });

  it('creates when client_id + opportunity_id are valid and emits event', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }] });                       // client lookup
    queryQueue.push({ rows: [{ id: 'o1', name: 'Deal', client_id: 'c1' }] });      // opp lookup
    queryQueue.push({ rows: [{ id: 'q-new', type: 'staff_aug', project_name: 'P1', client_id: 'c1', opportunity_id: 'o1', status: 'draft' }] }); // INSERT quotation
    queryQueue.push({ rows: [] }); // audit_log insert
    const res = await client.call('POST', '/api/quotations', validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('q-new');
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'quotation.created');
    expect(call).toBeTruthy();
    expect(call[1].payload.client_id).toBe('c1');
    expect(call[1].payload.opportunity_id).toBe('o1');
  });

  it('PUT on staff_aug recalcs lines server-side and emits quotation.calc_drift when client outputs are wrong', async () => {
    const { emitEvent } = require('../utils/events');
    // 1) UPDATE quotation (returns row)
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft', project_name: 'P1' }] });
    // 2) loadCanonicalParams — SELECT parameters
    queryQueue.push({ rows: [
      { category: 'level',     key: 'L2',            value: 2000 },
      { category: 'geo',       key: 'Colombia',      value: 1.0 },
      { category: 'bilingual', key: 'No',            value: 1.0 },
      { category: 'stack',     key: 'Especializada', value: 1.0 },
      { category: 'tools',     key: 'Básico',        value: 50 },
      { category: 'modality',  key: 'Remoto',        value: 1.0 },
      { category: 'project',   key: 'hours_month',   value: 160 },
      { category: 'margin',    key: 'talent',        value: 0.35 },
      { category: 'margin',    key: 'tools',         value: 0 },
    ] });
    // 3) DELETE lines
    queryQueue.push({ rows: [] });
    // 4) INSERT line (one line)
    queryQueue.push({ rows: [] });

    const res = await client.call('PUT', '/api/quotations/q1', {
      lines: [{
        level: 2, country: 'Colombia', bilingual: false, stack: 'Especializada',
        modality: 'Remoto', tools: 'Básico', quantity: 1, duration_months: 1,
        cost_hour: 999, rate_hour: 999, rate_month: 999, total: 9999, // wrong client outputs
      }],
    });
    expect(res.status).toBe(200);
    const driftEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'quotation.calc_drift');
    expect(driftEvt).toBeTruthy();
    expect(driftEvt[1].payload.total_drifted_fields).toBeGreaterThan(0);
    // Response carries canonical values — NOT the bogus 999/9999 the client sent.
    expect(res.body.lines[0].cost_hour).toBeCloseTo(12.5, 2);
    expect(res.body.lines[0].total).not.toBe(9999);
    expect(res.body.drift.drifted).toBe(true);
  });

  it('PUT on staff_aug does NOT emit drift event when client outputs match server', async () => {
    const { emitEvent } = require('../utils/events');
    // Reset the shared mock so we can assert "not called" cleanly.
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft' }] });
    queryQueue.push({ rows: [
      { category: 'level',     key: 'L2',            value: 2000 },
      { category: 'geo',       key: 'Colombia',      value: 1.0 },
      { category: 'bilingual', key: 'No',            value: 1.0 },
      { category: 'stack',     key: 'Especializada', value: 1.0 },
      { category: 'tools',     key: 'Básico',        value: 50 },
      { category: 'modality',  key: 'Remoto',        value: 1.0 },
      { category: 'project',   key: 'hours_month',   value: 160 },
      { category: 'margin',    key: 'talent',        value: 0.35 },
      { category: 'margin',    key: 'tools',         value: 0 },
    ] });
    queryQueue.push({ rows: [] }); // DELETE lines
    queryQueue.push({ rows: [] }); // INSERT line

    // Correct client outputs (same as what server computes)
    const res = await client.call('PUT', '/api/quotations/q1', {
      lines: [{
        level: 2, country: 'Colombia', bilingual: false, stack: 'Especializada',
        modality: 'Remoto', tools: 'Básico', quantity: 1, duration_months: 1,
        cost_hour: 12.5,
        rate_hour: 12.5 / 0.65,
        rate_month: (12.5 / 0.65) * 160 + 50,
        total: ((12.5 / 0.65) * 160 + 50) * 1 * 1,
      }],
    });
    expect(res.status).toBe(200);
    const driftEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'quotation.calc_drift');
    expect(driftEvt).toBeFalsy();
    expect(res.body.drift.drifted).toBe(false);
  });

  it('defaults client_name from the client row if not provided', async () => {
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme Corp' }] });
    queryQueue.push({ rows: [{ id: 'o1', name: 'Deal', client_id: 'c1' }] });
    queryQueue.push({ rows: [{ id: 'q-new' }] });
    queryQueue.push({ rows: [] }); // audit log
    await client.call('POST', '/api/quotations', { ...validBody, client_name: undefined });
    // Query order: [0] client lookup, [1] opp lookup, [2] BEGIN, [3] INSERT quotation
    const insertQ = issuedQueries.find((q) => String(q.sql).match(/^\s*INSERT INTO quotations/));
    expect(insertQ).toBeTruthy();
    // param order: type, project_name, client_id, opportunity_id, client_name, ...
    expect(insertQ.params[4]).toBe('Acme Corp');
  });
});
