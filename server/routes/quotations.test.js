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

// Mock the export generators so we don't require exceljs / pdfkit in tests
// and can assert on what the route does around them (headers, filename, etc.).
jest.mock('../utils/quotation_export', () => ({
  generateXlsx: jest.fn(async () => Buffer.from('FAKE_XLSX_BYTES')),
  generatePdf: jest.fn(async () => Buffer.from('FAKE_PDF_BYTES')),
  buildFilename: jest.fn((q, ext) => `DVPNYX_Proyecto_Test_2026-04-22.${ext}`),
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

  // Reusable fixture for the parameters SELECT that happens inside PUT.
  const PARAM_ROWS = [
    { category: 'level',     key: 'L2',            value: 2000 },
    { category: 'geo',       key: 'Colombia',      value: 1.0 },
    { category: 'bilingual', key: 'No',            value: 1.0 },
    { category: 'stack',     key: 'Especializada', value: 1.0 },
    { category: 'tools',     key: 'Básico',        value: 50 },
    { category: 'modality',  key: 'Remoto',        value: 1.0 },
    { category: 'project',   key: 'hours_month',   value: 160 },
    { category: 'margin',    key: 'talent',        value: 0.35 },
    { category: 'margin',    key: 'tools',         value: 0 },
  ];

  // PUT query sequence (EX-3):
  //   [0] SELECT before  → { id, type, status, parameters_snapshot }
  //   [1] loadCanonicalParams (only when needed for snapshot capture or staff_aug recalc)
  //   [2] UPDATE quotations  → returns the updated row
  //   [3+] DELETE/INSERT lines, phases, etc.

  it('PUT on staff_aug recalcs lines server-side and emits quotation.calc_drift when client outputs are wrong', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft', parameters_snapshot: null }] });
    queryQueue.push({ rows: PARAM_ROWS });
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft', project_name: 'P1' }] });
    queryQueue.push({ rows: [] }); // DELETE lines
    queryQueue.push({ rows: [] }); // INSERT line

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
    expect(res.body.lines[0].cost_hour).toBeCloseTo(12.5, 2);
    expect(res.body.lines[0].total).not.toBe(9999);
    expect(res.body.drift.drifted).toBe(true);
  });

  it('PUT on staff_aug does NOT emit drift event when client outputs match server', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft', parameters_snapshot: null }] });
    queryQueue.push({ rows: PARAM_ROWS });
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft' }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });

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

  it('PUT returns 404 when the quotation does not exist', async () => {
    queryQueue.push({ rows: [] }); // SELECT before → empty
    const res = await client.call('PUT', '/api/quotations/missing', { project_name: 'X' });
    expect(res.status).toBe(404);
  });

  it('EX-3: captures parameters_snapshot when transitioning draft → sent', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft', parameters_snapshot: null }] });
    queryQueue.push({ rows: PARAM_ROWS });
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'sent' }] });
    // no lines in body → no DELETE/INSERT loop

    const res = await client.call('PUT', '/api/quotations/q1', { status: 'sent' });
    expect(res.status).toBe(200);

    const snapshotEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'quotation.snapshot_captured');
    expect(snapshotEvt).toBeTruthy();
    expect(snapshotEvt[1].payload).toEqual({ trigger_status: 'sent', previous_status: 'draft' });

    // UPDATE call should have carried a non-null parameters_snapshot JSON.
    const updateCall = issuedQueries.find((q) => String(q.sql).match(/UPDATE quotations SET project_name/));
    expect(updateCall).toBeTruthy();
    // param[8] is the snapshot (COALESCE arg). Should be a stringified JSON, not null.
    expect(updateCall.params[8]).not.toBeNull();
    expect(typeof updateCall.params[8]).toBe('string');
    const parsed = JSON.parse(updateCall.params[8]);
    expect(parsed.level).toBeDefined();
    expect(parsed.geo).toBeDefined();
  });

  it('EX-3: captures snapshot when transitioning draft → approved (skipping sent)', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft', parameters_snapshot: null }] });
    queryQueue.push({ rows: PARAM_ROWS });
    queryQueue.push({ rows: [{ id: 'q1', status: 'approved' }] });

    const res = await client.call('PUT', '/api/quotations/q1', { status: 'approved' });
    expect(res.status).toBe(200);
    const snapshotEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'quotation.snapshot_captured');
    expect(snapshotEvt).toBeTruthy();
    expect(snapshotEvt[1].payload.trigger_status).toBe('approved');
  });

  it('EX-3: does NOT re-capture snapshot when quotation already has one (sent → approved)', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    const existingSnapshot = { level: [{ key: 'L2', value: 2000 }] };
    // SELECT before returns an already-snapshotted row
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'sent', parameters_snapshot: existingSnapshot }] });
    // No loadCanonicalParams call expected (snapshot already exists, no lines to recalc)
    queryQueue.push({ rows: [{ id: 'q1', status: 'approved' }] });

    const res = await client.call('PUT', '/api/quotations/q1', { status: 'approved' });
    expect(res.status).toBe(200);
    const snapshotEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'quotation.snapshot_captured');
    expect(snapshotEvt).toBeFalsy();

    // The UPDATE's snapshot param should be null (no fresh capture).
    const updateCall = issuedQueries.find((q) => String(q.sql).match(/UPDATE quotations SET project_name/));
    expect(updateCall.params[8]).toBeNull();
  });

  it('EX-3: does NOT capture when PUT keeps status in draft', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'draft', parameters_snapshot: null }] });
    // No params load (no snapshot capture, no lines)
    queryQueue.push({ rows: [{ id: 'q1', status: 'draft' }] });

    const res = await client.call('PUT', '/api/quotations/q1', { project_name: 'P-new' });
    expect(res.status).toBe(200);
    const snapshotEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'quotation.snapshot_captured');
    expect(snapshotEvt).toBeFalsy();
  });

  it('EX-3: recalc on a snapshotted quotation uses the snapshot, not current DB params', async () => {
    // Frozen snapshot: talent margin was 0.35 (normal).
    const frozenSnapshot = {
      level:     [{ key: 'L2', value: 2000 }],
      geo:       [{ key: 'Colombia', value: 1.0 }],
      bilingual: [{ key: 'No', value: 1.0 }],
      stack:     [{ key: 'Especializada', value: 1.0 }],
      tools:     [{ key: 'Básico', value: 50 }],
      modality:  [{ key: 'Remoto', value: 1.0 }],
      project:   [{ key: 'hours_month', value: 160 }],
      margin:    [{ key: 'talent', value: 0.35 }, { key: 'tools', value: 0 }],
    };
    // SELECT before returns the snapshot
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'sent', parameters_snapshot: frozenSnapshot }] });
    // No loadCanonicalParams call should fire because the snapshot is used directly.
    queryQueue.push({ rows: [{ id: 'q1', type: 'staff_aug', status: 'sent' }] });
    queryQueue.push({ rows: [] }); // DELETE lines
    queryQueue.push({ rows: [] }); // INSERT line

    const res = await client.call('PUT', '/api/quotations/q1', {
      lines: [{
        level: 2, country: 'Colombia', bilingual: false, stack: 'Especializada',
        modality: 'Remoto', tools: 'Básico', quantity: 1, duration_months: 1,
      }],
    });
    expect(res.status).toBe(200);
    // cost_hour = 2000/160 × 1 × 1 × 1 = 12.5 — matches the frozen snapshot math
    expect(res.body.lines[0].cost_hour).toBeCloseTo(12.5, 2);

    // Confirm loadCanonicalParams was NOT called (no SELECT parameters).
    const paramsCall = issuedQueries.find((q) => String(q.sql).includes("SELECT category, key, value FROM parameters"));
    expect(paramsCall).toBeFalsy();
  });

  it('EX-4: dual-writes metadata.allocation to quotation_allocations when phases are provided', async () => {
    queryQueue.push({ rows: [{ id: 'q1', type: 'fixed_scope', status: 'draft', parameters_snapshot: null }] }); // SELECT before
    queryQueue.push({ rows: [{ id: 'q1', type: 'fixed_scope', status: 'draft' }] });                            // UPDATE quotations
    queryQueue.push({ rows: [] });                                                                              // DELETE phases
    queryQueue.push({ rows: [{ id: 'phase-a' }] });                                                             // INSERT phase 0 RETURNING
    queryQueue.push({ rows: [{ id: 'phase-b' }] });                                                             // INSERT phase 1 RETURNING
    queryQueue.push({ rows: [] });                                                                              // INSERT allocation line=0 phase=phase-a hours=20
    queryQueue.push({ rows: [] });                                                                              // INSERT allocation line=0 phase=phase-b hours=15
    queryQueue.push({ rows: [] });                                                                              // INSERT allocation line=1 phase=phase-a hours=10

    const res = await client.call('PUT', '/api/quotations/q1', {
      phases: [
        { name: 'Planeación', weeks: 2 },
        { name: 'Desarrollo', weeks: 8 },
      ],
      metadata: {
        allocation: {
          '0': { '0': 20, '1': 15 },
          '1': { '0': 10 },
        },
      },
    });
    expect(res.status).toBe(200);
    const allocInserts = issuedQueries.filter((q) => String(q.sql).match(/INSERT INTO quotation_allocations/));
    expect(allocInserts).toHaveLength(3);
    // Sample: first insert is (q1, line=0, phase-a, 20)
    expect(allocInserts[0].params).toEqual(['q1', 0, 'phase-a', 20]);
    expect(allocInserts[1].params).toEqual(['q1', 0, 'phase-b', 15]);
    expect(allocInserts[2].params).toEqual(['q1', 1, 'phase-a', 10]);
  });

  it('EX-4: when allocation is sent without phases, reads existing phase IDs from DB', async () => {
    queryQueue.push({ rows: [{ id: 'q1', type: 'fixed_scope', status: 'draft', parameters_snapshot: null }] }); // SELECT before
    queryQueue.push({ rows: [{ id: 'q1', type: 'fixed_scope', status: 'draft' }] });                            // UPDATE
    queryQueue.push({ rows: [{ id: 'existing-phase-a', sort_order: 0 }, { id: 'existing-phase-b', sort_order: 1 }] }); // SELECT existing phases
    queryQueue.push({ rows: [] }); // DELETE allocations
    queryQueue.push({ rows: [] }); // INSERT allocation

    const res = await client.call('PUT', '/api/quotations/q1', {
      metadata: { allocation: { '0': { '1': 30 } } },
    });
    expect(res.status).toBe(200);
    const allocInserts = issuedQueries.filter((q) => String(q.sql).match(/INSERT INTO quotation_allocations/));
    expect(allocInserts).toHaveLength(1);
    expect(allocInserts[0].params).toEqual(['q1', 0, 'existing-phase-b', 30]);
  });

  it('EX-4: skips zero-hour cells and orphan phase indices', async () => {
    queryQueue.push({ rows: [{ id: 'q1', type: 'fixed_scope', status: 'draft', parameters_snapshot: null }] });
    queryQueue.push({ rows: [{ id: 'q1', type: 'fixed_scope', status: 'draft' }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [{ id: 'phase-a' }] }); // only 1 phase
    queryQueue.push({ rows: [] }); // INSERT allocation for line 0 phase 0 = 5

    const res = await client.call('PUT', '/api/quotations/q1', {
      phases: [{ name: 'Only', weeks: 4 }],
      metadata: {
        allocation: {
          '0': { '0': 5, '1': 10 }, // phase 1 doesn't exist — skip
          '1': { '0': 0 },          // zero hours — skip
        },
      },
    });
    expect(res.status).toBe(200);
    const allocInserts = issuedQueries.filter((q) => String(q.sql).match(/INSERT INTO quotation_allocations/));
    expect(allocInserts).toHaveLength(1);
    expect(allocInserts[0].params).toEqual(['q1', 0, 'phase-a', 5]);
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

describe('POST /api/quotations/:id/export — fixed-scope export', () => {
  // Second helper that exposes response headers (the default one only returns
  // body, and we need Content-Type / Content-Disposition for these tests).
  const http = require('http');
  const callWithHeaders = (method, url, body = null) => new Promise((resolve, reject) => {
    const srv = http.createServer(app).listen(0, () => {
      const { port } = srv.address();
      const headers = { authorization: 'Bearer fake' };
      let payload = null;
      if (body) {
        payload = JSON.stringify(body);
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(payload);
      }
      const req = http.request(
        { host: '127.0.0.1', port, path: url, method, headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            srv.close();
            const bodyBuf = Buffer.concat(chunks);
            let parsedJson = null;
            try { parsedJson = JSON.parse(bodyBuf.toString()); } catch { /* binary */ }
            resolve({ status: res.statusCode, headers: res.headers, body: parsedJson, raw: bodyBuf });
          });
        },
      );
      req.on('error', (e) => { srv.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });

  const pushQuotation = (overrides = {}) => {
    queryQueue.push({ rows: [{
      id: 'q1',
      type: 'fixed_scope',
      created_by: 'u1',
      project_name: 'Proyecto Demo',
      parameters_snapshot: { project: [] },
      ...overrides,
    }] });
  };

  const pushChildren = ({ lines = [{ id: 'l1' }], phases = [{ id: 'p1', weeks: 4 }], epics = [], milestones = [] } = {}) => {
    queryQueue.push({ rows: lines });     // SELECT quotation_lines
    queryQueue.push({ rows: phases });    // SELECT quotation_phases
    queryQueue.push({ rows: epics });     // SELECT quotation_epics
    queryQueue.push({ rows: milestones });// SELECT quotation_milestones
  };

  it('rejects unsupported format without touching the DB', async () => {
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format/);
    expect(issuedQueries).toHaveLength(0);
  });

  it('returns 404 when the quotation does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await callWithHeaders('POST', '/api/quotations/missing/export?format=xlsx');
    expect(res.status).toBe(404);
  });

  it('returns 403 when non-owner non-admin tries to export', async () => {
    pushQuotation({ created_by: 'other-user' });
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(403);
  });

  it('allows admin to export someone else\u2019s quotation', async () => {
    mockCurrentUser = { id: 'admin1', role: 'admin', function: 'ops' };
    pushQuotation({ created_by: 'other-user' });
    pushChildren();
    queryQueue.push({ rows: [] }); // audit_log insert
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(200);
  });

  it('accepts staff_aug quotations with ≥1 priced line (xlsx)', async () => {
    pushQuotation({ type: 'staff_aug' });
    pushChildren({ lines: [{ id: 'l1', rate_month: 5000 }], phases: [] });
    queryQueue.push({ rows: [] }); // audit log
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });

  it('accepts staff_aug quotations with ≥1 priced line (pdf)', async () => {
    pushQuotation({ type: 'staff_aug' });
    pushChildren({ lines: [{ id: 'l1', rate_month: 5000 }], phases: [] });
    queryQueue.push({ rows: [] }); // audit log
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  it('rejects staff_aug with no lines', async () => {
    pushQuotation({ type: 'staff_aug' });
    pushChildren({ lines: [], phases: [] });
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recurso/);
  });

  it('rejects staff_aug when no line has rate_month > 0', async () => {
    pushQuotation({ type: 'staff_aug' });
    pushChildren({ lines: [{ id: 'l1', rate_month: 0 }], phases: [] });
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tarifa/);
  });

  it('rejects when the quotation has no profile lines', async () => {
    pushQuotation();
    pushChildren({ lines: [], phases: [{ id: 'p1', weeks: 4 }] });
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/perfil/);
  });

  it('rejects when no phase has weeks > 0', async () => {
    pushQuotation();
    pushChildren({ phases: [{ id: 'p1', weeks: 0 }] });
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/semanas/);
  });

  it('returns xlsx buffer with proper headers when valid', async () => {
    pushQuotation();
    pushChildren();
    queryQueue.push({ rows: [] }); // audit log
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/\.xlsx/);
    expect(res.raw.toString()).toBe('FAKE_XLSX_BYTES');
  });

  it('returns pdf buffer with proper headers when valid', async () => {
    pushQuotation();
    pushChildren();
    queryQueue.push({ rows: [] }); // audit log
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
    expect(res.raw.toString()).toBe('FAKE_PDF_BYTES');
  });

  it('SPEC-FIX-01: applies override_state from body so export reflects unsaved client changes', async () => {
    pushQuotation({ project_name: 'Old Name', discount_pct: 0 });
    pushChildren();
    queryQueue.push({ rows: [] }); // audit log
    const quotationExport = require('../utils/quotation_export');
    quotationExport.generateXlsx.mockClear();
    const res = await callWithHeaders(
      'POST',
      '/api/quotations/q1/export?format=xlsx',
      { override_state: { project_name: 'New Name From Editor', discount_pct: 0.15 } },
    );
    expect(res.status).toBe(200);
    expect(quotationExport.generateXlsx).toHaveBeenCalledTimes(1);
    const calledWith = quotationExport.generateXlsx.mock.calls[0][0];
    expect(calledWith.project_name).toBe('New Name From Editor');
    expect(calledWith.discount_pct).toBe(0.15);
  });

  it('SPEC-FIX-01: ignores override_state when missing/invalid (falls back to DB)', async () => {
    pushQuotation({ project_name: 'Persisted Name' });
    pushChildren();
    queryQueue.push({ rows: [] }); // audit log
    const quotationExport = require('../utils/quotation_export');
    quotationExport.generateXlsx.mockClear();
    const res = await callWithHeaders('POST', '/api/quotations/q1/export?format=xlsx');
    expect(res.status).toBe(200);
    const calledWith = quotationExport.generateXlsx.mock.calls[0][0];
    expect(calledWith.project_name).toBe('Persisted Name');
  });
});
