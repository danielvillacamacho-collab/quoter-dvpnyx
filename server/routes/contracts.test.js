/**
 * Unit tests for server/routes/contracts.js (EK-1 + EK-2).
 */

const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
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

let mockCurrentUser = { id: 'u1', role: 'admin' };
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

const contractsRouter = require('./contracts');
const app = express();
app.use(express.json());
app.use('/api/contracts', contractsRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'admin' };
});

const validBody = {
  name: 'Contract Alpha', client_id: 'c1', type: 'project',
  start_date: '2026-05-01', squad_id: 's1',
};

describe('POST /api/contracts — EK-1 validations', () => {
  it('rejects non-admin with 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/contracts', validBody);
    expect(res.status).toBe(403);
  });

  it('rejects when required fields missing', async () => {
    // squad_id is no longer required — the server resolves it automatically
    // from the creator's squad or the global default.
    for (const miss of ['name', 'client_id', 'type', 'start_date']) {
      const body = { ...validBody, [miss]: undefined };
      // eslint-disable-next-line no-await-in-loop
      const res = await client.call('POST', '/api/contracts', body);
      expect(res.status).toBe(400);
    }
  });

  it('rejects invalid type', async () => {
    const res = await client.call('POST', '/api/contracts', { ...validBody, type: 'weird' });
    expect(res.status).toBe(400);
  });

  it('rejects when client does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/contracts', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cliente no existe/i);
  });

  it('rejects 409 when opportunity belongs to a different client', async () => {
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }] });
    queryQueue.push({ rows: [{ id: 'o1', client_id: 'c-other' }] });
    const res = await client.call('POST', '/api/contracts', { ...validBody, opportunity_id: 'o1' });
    expect(res.status).toBe(409);
  });

  it('creates contract with event emission', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }] });
    queryQueue.push({ rows: [{ id: 'ct-new', name: 'Contract Alpha', type: 'project', client_id: 'c1', status: 'planned' }] });
    const res = await client.call('POST', '/api/contracts', validBody);
    expect(res.status).toBe(201);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'contract.created');
    expect(evt).toBeTruthy();
  });

  it('auto-resolves squad_id from creator when not provided', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    const { squad_id: _unused, ...bodyNoSquad } = validBody;
    queryQueue.push({ rows: [{ squad_id: 'user-squad-uuid' }] });  // SELECT user squad
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }] });        // client check
    queryQueue.push({ rows: [{ id: 'ct-new', name: 'Contract Alpha', type: 'project', client_id: 'c1', status: 'planned' }] });
    const res = await client.call('POST', '/api/contracts', bodyNoSquad);
    expect(res.status).toBe(201);
  });

  it('auto-resolves squad_id from global squad when creator has none', async () => {
    const { squad_id: _unused, ...bodyNoSquad } = validBody;
    queryQueue.push({ rows: [{ squad_id: null }] });                // user has no squad
    queryQueue.push({ rows: [{ id: 'global-squad-uuid' }] });       // global squad fallback
    queryQueue.push({ rows: [{ id: 'c1', name: 'Acme' }] });        // client check
    queryQueue.push({ rows: [{ id: 'ct-new', name: 'Contract Alpha', type: 'project', client_id: 'c1', status: 'planned' }] });
    const res = await client.call('POST', '/api/contracts', bodyNoSquad);
    expect(res.status).toBe(201);
  });
});

describe('POST /api/contracts/:id/status — EK-2 transitions', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/contracts/ct1/status', { new_status: 'active' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid status', async () => {
    const res = await client.call('POST', '/api/contracts/ct1/status', { new_status: 'whatever' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid transition (planned → completed)', async () => {
    queryQueue.push({ rows: [{ id: 'ct1', status: 'planned' }] });
    const res = await client.call('POST', '/api/contracts/ct1/status', { new_status: 'completed' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Transición inválida/);
  });

  it('accepts spec alias "draft" and normalizes to "planned"', async () => {
    // Transition from active → draft is invalid anyway; this confirms the
    // alias is recognized before the transition check runs.
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    const res = await client.call('POST', '/api/contracts/ct1/status', { new_status: 'draft' });
    expect(res.status).toBe(409); // not 400 — alias recognized
    expect(res.body.error).toMatch(/Transición inválida: active → planned/);
  });

  it('completes an active contract: ends active assignments + cancels open requests', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });                    // SELECT current
    queryQueue.push({ rows: [{ id: 'a1' }, { id: 'a2' }] });                          // UPDATE active → ended
    queryQueue.push({ rows: [{ id: 'a3' }] });                                        // UPDATE planned → cancelled
    queryQueue.push({ rows: [{ id: 'r1' }, { id: 'r2' }] });                          // UPDATE requests → cancelled
    queryQueue.push({ rows: [{ id: 'ct1', status: 'completed' }] });                  // UPDATE contract

    const res = await client.call('POST', '/api/contracts/ct1/status', { new_status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.ended_assignments).toBe(2);
    expect(res.body.cancelled_assignments).toBe(1);
    expect(res.body.cancelled_requests).toBe(2);

    const statusEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'contract.status_changed');
    const doneEvt   = emitEvent.mock.calls.find((c) => c[1].event_type === 'contract.completed');
    expect(statusEvt).toBeTruthy();
    expect(doneEvt).toBeTruthy();
    expect(doneEvt[1].payload.ended_assignments).toEqual(['a1', 'a2']);
  });

  it('cancels an active contract: cancels assignments + requests', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'a1' }] }); // UPDATE active+planned → cancelled
    queryQueue.push({ rows: [{ id: 'r1' }] }); // UPDATE requests → cancelled
    queryQueue.push({ rows: [{ id: 'ct1', status: 'cancelled' }] });

    const res = await client.call('POST', '/api/contracts/ct1/status', { new_status: 'cancelled' });
    expect(res.status).toBe(200);
    const cancelEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'contract.cancelled');
    expect(cancelEvt).toBeTruthy();
  });

  it('transitions active → paused without side effects', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'ct1', status: 'paused' }] });

    const res = await client.call('POST', '/api/contracts/ct1/status', { new_status: 'paused' });
    expect(res.status).toBe(200);
    expect(res.body.ended_assignments).toBe(0);
    expect(res.body.cancelled_assignments).toBe(0);
    expect(res.body.cancelled_requests).toBe(0);
    const doneEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'contract.completed');
    expect(doneEvt).toBeFalsy();
  });

  it('rolls back on downstream failure', async () => {
    queryQueue.push({ rows: [{ id: 'ct1', status: 'active' }] });
    queryQueue.push(new Error('boom'));
    const res = await client.call('POST', '/api/contracts/ct1/status', { new_status: 'completed' });
    expect(res.status).toBe(500);
    const rollback = issuedQueries.find((q) => q.sql === 'ROLLBACK');
    expect(rollback).toBeTruthy();
  });
});

describe('DELETE /api/contracts/:id', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('DELETE', '/api/contracts/ct1');
    expect(res.status).toBe(403);
  });

  it('rejects 409 when active assignments exist', async () => {
    queryQueue.push({ rows: [{ active_assignments: 2, open_requests: 0 }] });
    const res = await client.call('DELETE', '/api/contracts/ct1');
    expect(res.status).toBe(409);
    expect(res.body.active_assignments).toBe(2);
  });

  it('soft-deletes when clean + emits event', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ active_assignments: 0, open_requests: 0 }] });
    queryQueue.push({ rows: [{ id: 'ct1', name: 'Alpha' }] });
    const res = await client.call('DELETE', '/api/contracts/ct1');
    expect(res.status).toBe(200);
    const evt = emitEvent.mock.calls.find((c) => c[1].event_type === 'contract.deleted');
    expect(evt).toBeTruthy();
  });
});

describe('GET /api/contracts/export.csv', () => {
  it('streams a CSV with header row + data rows using the same filters as list', async () => {
    queryQueue.push({ rows: [
      { id: 'ct1', name: 'Alpha', type: 'project', status: 'active',
        start_date: '2026-01-01', end_date: null, notes: 'keep, going',
        created_at: '2026-01-01T00:00:00Z', client_name: 'Acme' },
    ] });
    const res = await client.call('GET', '/api/contracts/export.csv?status=active');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    const csv = res.body;
    // UTF-8 BOM so Excel opens it correctly on Windows
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toMatch(/Nombre,Cliente,Tipo,Estado/);
    expect(csv).toMatch(/Alpha,Acme,project,active/);
    // Comma-bearing notes must be quoted
    expect(csv).toMatch(/"keep, going"/);
    // Filter was pushed into the WHERE
    const exec = issuedQueries.find((q) => /FROM contracts c/.test(q.sql));
    expect(exec.params).toContain('active');
  });

  it('returns a header-only CSV when there are no rows', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/contracts/export.csv');
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/Nombre,Cliente,Tipo,Estado/);
  });

  it('returns 500 when the DB throws', async () => {
    queryQueue.push(new Error('boom'));
    const res = await client.call('GET', '/api/contracts/export.csv');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/contracts/:id/kick-off — siembra resource_requests desde la cotización ganadora', () => {
  const mkContract = (overrides = {}) => ({
    id: 'ct1', name: 'Acme Project', status: 'planned',
    winning_quotation_id: 'q1',
    delivery_manager_id: 'u-dm', account_owner_id: 'u-owner', capacity_manager_id: null,
    ...overrides,
  });

  it('rechaza si falta kick_off_date o no es ISO', async () => {
    const res = await client.call('POST', '/api/contracts/ct1/kick-off', { kick_off_date: 'foo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/kick_off_date/i);
  });

  it('admin puede invocar aunque no sea DM', async () => {
    mockCurrentUser = { id: 'u-admin', role: 'admin' };
    queryQueue.push({ rows: [mkContract()] });        // load contract
    queryQueue.push({ rows: [] });                     // existing RRs (none)
    queryQueue.push({ rows: [                           // quotation_lines
      { id: 'l1', sort_order: 1, specialty: 'Desarrollo', role_title: 'Senior Dev', level: 5, country: 'CO', quantity: 2, duration_months: 6, hours_per_week: 40, phase: null },
    ] });
    queryQueue.push({ rows: [                           // areas
      { id: 1, key: 'development', name: 'Desarrollo' },
    ] });
    queryQueue.push({ rows: [{ id: 'rr1', role_title: 'Senior Dev', level: 'L5', quantity: 2, weekly_hours: 40 }] }); // INSERT rr
    queryQueue.push({ rows: [mkContract({ metadata: { kick_off_date: '2026-05-04' } })] }); // UPDATE contract

    const res = await client.call('POST', '/api/contracts/ct1/kick-off', { kick_off_date: '2026-05-04' });
    expect(res.status).toBe(201);
    expect(res.body.kick_off_date).toBe('2026-05-04');
    expect(res.body.created_requests).toHaveLength(1);
    expect(res.body.created_requests[0].level).toBe('L5');
  });

  it('member que NO es DM/owner/cap-manager recibe 403', async () => {
    mockCurrentUser = { id: 'u-stranger', role: 'member' };
    queryQueue.push({ rows: [mkContract()] });
    const res = await client.call('POST', '/api/contracts/ct1/kick-off', { kick_off_date: '2026-05-04' });
    expect(res.status).toBe(403);
  });

  it('lead que ES delivery_manager puede invocar', async () => {
    mockCurrentUser = { id: 'u-dm', role: 'lead' };
    queryQueue.push({ rows: [mkContract()] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [
      { id: 'l1', sort_order: 1, specialty: 'QA', role_title: null, level: 3, country: 'MX', quantity: 1, duration_months: 3, hours_per_week: 20, phase: 'Fase 1' },
    ] });
    queryQueue.push({ rows: [{ id: 1, key: 'testing', name: 'Testing' }] });
    queryQueue.push({ rows: [{ id: 'rr2', role_title: 'QA L3', level: 'L3' }] });
    queryQueue.push({ rows: [mkContract()] });

    const res = await client.call('POST', '/api/contracts/ct1/kick-off', { kick_off_date: '2026-06-01' });
    expect(res.status).toBe(201);
    expect(res.body.created_requests[0].level).toBe('L3');
  });

  it('contrato sin winning_quotation_id → 400 con code', async () => {
    queryQueue.push({ rows: [mkContract({ winning_quotation_id: null })] });
    const res = await client.call('POST', '/api/contracts/ct1/kick-off', { kick_off_date: '2026-05-04' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_winning_quotation');
  });

  it('si ya tiene RRs y no hay force=1 → 409 already_seeded', async () => {
    queryQueue.push({ rows: [mkContract()] });
    queryQueue.push({ rows: [{ id: 'rr-prev' }] }); // existing RR
    const res = await client.call('POST', '/api/contracts/ct1/kick-off', { kick_off_date: '2026-05-04' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_seeded');
  });

  it('contrato completed/cancelled rechaza', async () => {
    queryQueue.push({ rows: [mkContract({ status: 'completed' })] });
    const res = await client.call('POST', '/api/contracts/ct1/kick-off', { kick_off_date: '2026-05-04' });
    expect(res.status).toBe(400);
  });
});
