/**
 * Unit tests for server/routes/opportunities.js
 *
 * Same harness shape as clients.test.js: pg.Pool is mocked at the module
 * level and each test enqueues canned result rows. The auth middleware
 * is stubbed so we can drive role gating without issuing real tokens.
 */

const queryQueue = [];
const issuedQueries = [];

// Track transactional state so BEGIN/COMMIT/ROLLBACK in the status route
// don't consume real rows from the queue.
// Must start with `mock` so jest-hoist lets the jest.mock() factory below
// reference it (see commit 098a644 for the same rename applied to currentUser).
const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);

jest.mock('../database/pool', () => {
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
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Acceso solo para administradores' });
    next();
  },
  superadminOnly: (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Acceso solo para superadmin' });
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

const oppsRouter = require('./opportunities');
const app = express();
app.use(express.json());
app.use('/api/opportunities', oppsRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'member', function: 'comercial' };
});

/* ---------- GET / ---------- */
describe('GET /api/opportunities', () => {
  it('returns paginated list with defaults', async () => {
    queryQueue.push({ rows: [{ total: 2 }] });
    queryQueue.push({ rows: [
      { id: 'o1', name: 'Opp 1', client_name: 'Acme', status: 'lead', quotations_count: 0 },
      { id: 'o2', name: 'Opp 2', client_name: 'Globex', status: 'qualified', quotations_count: 1 },
    ] });
    const res = await client.call('GET', '/api/opportunities');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ page: 1, limit: 25, total: 2, pages: 1 });
    expect(issuedQueries[0].sql).toMatch(/deleted_at IS NULL/);
  });

  it('applies status + client_id filter', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/opportunities?status=proposal&client_id=c1');
    const firstSql = issuedQueries[0].sql;
    expect(firstSql).toMatch(/o\.status =/);
    expect(firstSql).toMatch(/o\.client_id =/);
  });
});

/* ---------- GET /:id ---------- */
describe('GET /api/opportunities/:id', () => {
  it('returns 404 when not found', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/opportunities/missing');
    expect(res.status).toBe(404);
  });

  it('returns opportunity with embedded client and quotations list', async () => {
    queryQueue.push({ rows: [{
      id: 'o1', name: 'Deal A', status: 'lead', client_id: 'c1',
      client__id: 'c1', client__name: 'Acme', client__country: 'Colombia', client__tier: 'enterprise',
      quotations_count: 2,
    }] });
    queryQueue.push({ rows: [
      { id: 'q1', project_name: 'P1', type: 'staff_aug', status: 'draft', total_usd: 1000 },
      { id: 'q2', project_name: 'P2', type: 'fixed_scope', status: 'sent',  total_usd: 2000 },
    ] });
    const res = await client.call('GET', '/api/opportunities/o1');
    expect(res.status).toBe(200);
    expect(res.body.client).toEqual({ id: 'c1', name: 'Acme', country: 'Colombia', tier: 'enterprise' });
    expect(res.body.quotations).toHaveLength(2);
    expect(res.body.client__id).toBeUndefined();
  });
});

/* ---------- POST / ---------- */
describe('POST /api/opportunities', () => {
  const validBody = {
    client_id: 'c1', name: 'Deal A', account_owner_id: 'u1', squad_id: 's1',
  };

  it('rejects when client_id is missing', async () => {
    const res = await client.call('POST', '/api/opportunities', { ...validBody, client_id: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/client_id/);
  });

  it('rejects when name is missing', async () => {
    const res = await client.call('POST', '/api/opportunities', { ...validBody, name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nombre/i);
  });

  it('rejects when the referenced client does not exist', async () => {
    queryQueue.push({ rows: [] }); // client lookup empty
    const res = await client.call('POST', '/api/opportunities', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cliente no existe/i);
  });

  it('defaults owner to current user and squad from users table when omitted', async () => {
    queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] }); // client lookup
    queryQueue.push({ rows: [{ squad_id: 's-from-user' }] });                     // user squad lookup
    queryQueue.push({ rows: [{ next_seq: 1 }] });                                  // opportunity_number seq
    queryQueue.push({ rows: [{ id: 'o-new', name: 'Deal A', client_id: 'c1', status: 'lead', opportunity_number: 'OPP-COLO-2026-00001' }] });
    const res = await client.call('POST', '/api/opportunities', {
      client_id: 'c1', name: 'Deal A',   // no owner, no squad
    });
    expect(res.status).toBe(201);
    const insertParams = issuedQueries[issuedQueries.length - 1].params;
    expect(insertParams[3]).toBe('u1');            // ownerId defaulted to req.user.id
    expect(insertParams[5]).toBe('s-from-user');   // squad pulled from users table
    expect(insertParams[10]).toBe('Colombia');     // country denormalized from client
    expect(insertParams[11]).toMatch(/^OPP-COLO-\d{4}-\d{5}$/); // opportunity_number generado
  });

  it('self-heals by auto-creating the default squad when the user has none', async () => {
    // Squads are internal (hidden from UI). When the user has no squad AND
    // no default squad exists yet, the route auto-creates "DVPNYX Global".
    queryQueue.push({ rows: [{ id: 'c1', active: true, country: null }] }); // client (no country → cc='XX')
    queryQueue.push({ rows: [{ squad_id: null }] });                         // user squad
    queryQueue.push({ rows: [] });                                           // no default squad
    queryQueue.push({ rows: [{ id: 's-auto' }] });                           // INSERT default squad
    queryQueue.push({ rows: [{ next_seq: 1 }] });                             // opp number seq
    queryQueue.push({ rows: [{ id: 'o-new', name: 'Deal A', client_id: 'c1', status: 'lead' }] });
    const res = await client.call('POST', '/api/opportunities', {
      client_id: 'c1', name: 'Deal A',
    });
    expect(res.status).toBe(201);
    const insertParams = issuedQueries[issuedQueries.length - 1].params;
    expect(insertParams[5]).toBe('s-auto'); // opportunity inserted with auto-created squad
    expect(insertParams[11]).toMatch(/^OPP-XX-\d{4}-\d{5}$/); // sin país → cc='XX'
  });

  it('creates an opportunity and emits opportunity.created with opportunity_number', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear(); // garantizar test self-contained
    queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'México' }] });
    queryQueue.push({ rows: [{ next_seq: 42 }] });
    queryQueue.push({ rows: [{ id: 'o-new', name: 'Deal A', client_id: 'c1', status: 'lead', opportunity_number: 'OPP-MEXI-2026-00042' }] });
    const res = await client.call('POST', '/api/opportunities', validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('o-new');
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.created');
    expect(call).toBeTruthy();
    expect(call[1].entity_id).toBe('o-new');
    expect(call[1].payload.opportunity_number).toBe('OPP-MEXI-2026-00042');
  });

  it('trims the name before inserting', async () => {
    queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
    queryQueue.push({ rows: [{ next_seq: 1 }] });
    queryQueue.push({ rows: [{ id: 'o', name: 'Deal A' }] });
    await client.call('POST', '/api/opportunities', { ...validBody, name: '   Deal A   ' });
    const insertCall = issuedQueries[issuedQueries.length - 1];
    expect(insertCall.params[1]).toBe('Deal A');
  });
});

/* ---------- PUT /:id ---------- */
describe('PUT /api/opportunities/:id', () => {
  it('returns 404 if opportunity does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('PUT', '/api/opportunities/missing', { name: 'x' });
    expect(res.status).toBe(404);
  });

  it('rejects empty name on update', async () => {
    queryQueue.push({ rows: [{ id: 'o1', name: 'Deal A' }] });
    const res = await client.call('PUT', '/api/opportunities/o1', { name: '   ' });
    expect(res.status).toBe(400);
  });

  it('updates fields and emits opportunity.updated with changed_fields', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 'o1', name: 'Deal A', description: null, tags: null }] });
    queryQueue.push({ rows: [{ id: 'o1', name: 'Deal A', description: 'new desc', tags: null }] });
    const res = await client.call('PUT', '/api/opportunities/o1', { description: 'new desc' });
    expect(res.status).toBe(200);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.updated');
    expect(call).toBeTruthy();
    expect(call[1].payload.changed_fields).toContain('description');
  });
});

/* ---------- POST /:id/status ---------- */
describe('POST /api/opportunities/:id/status', () => {
  it('rejects unknown status', async () => {
    const res = await client.call('POST', '/api/opportunities/o1/status', { new_status: 'whatever' });
    expect(res.status).toBe(400);
  });

  it('CRM-MVP-00.1: allows non-linear transitions with soft warnings (no longer 409)', async () => {
    // open → won used to be 409. Ahora se permite porque el Kanban
    // necesita drag-and-drop libre. La integridad se mantiene vía
    // winning_quotation_id obligatorio (probado abajo).
    queryQueue.push({ rows: [{ id: 'o1', status: 'lead', client_id: 'c1', account_owner_id: 'u1', squad_id: 's1', name: 'Deal' }] }); // SELECT current
    queryQueue.push({ rows: [{ id: 'q1', status: 'sent', type: 'staff_aug', project_name: 'P1' }] }); // quotation lookup
    queryQueue.push({ rows: [{ id: 'q1' }] });                                   // UPDATE quotations -> approved
    queryQueue.push({ rows: [] });                                               // RR-MVP: SELECT existing contract (empty)
    queryQueue.push({ rows: [{ total: 5000 }] });                                // RR-MVP: SUM lines
    queryQueue.push({ rows: [{ id: 'k1', name: 'P1', type: 'capacity', total_value_usd: 5000 }] }); // RR-MVP: INSERT contract
    queryQueue.push({ rows: [{ id: 'o1', status: 'closed_won', booking_amount_usd: 0, winning_quotation_id: 'q1' }] }); // UPDATE opp
    const res = await client.call('POST', '/api/opportunities/o1/status', {
      new_status: 'closed_won', winning_quotation_id: 'q1',
    });
    expect(res.status).toBe(200);
    // amount_zero warning porque booking_amount_usd=0
    expect(res.body.warnings.some((w) => w.code === 'amount_zero')).toBe(true);
  });

  it('rejects won without winning_quotation_id', async () => {
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated' }] });
    const res = await client.call('POST', '/api/opportunities/o1/status', { new_status: 'closed_won' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/winning_quotation_id/);
  });

  it('rejects lost without outcome_reason', async () => {
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated' }] });
    const res = await client.call('POST', '/api/opportunities/o1/status', { new_status: 'closed_lost' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outcome_reason/);
  });

  it('rejects won when the quotation does not belong to the opportunity', async () => {
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated' }] });  // SELECT current
    queryQueue.push({ rows: [] });                                   // quotation lookup empty
    const res = await client.call('POST', '/api/opportunities/o1/status', {
      new_status: 'closed_won', winning_quotation_id: 'q-foreign',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no pertenece/);
  });

  it('marks as won, promotes sent quotation to approved, and emits events', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated', client_id: 'c1', account_owner_id: 'u1', squad_id: 's1', name: 'Deal' }] }); // SELECT current
    queryQueue.push({ rows: [{ id: 'q1', status: 'sent', type: 'fixed_scope', project_name: 'P1' }] }); // quotation lookup
    queryQueue.push({ rows: [{ id: 'q1' }] });                              // UPDATE quotations -> approved
    queryQueue.push({ rows: [] });                                          // RR-MVP: SELECT existing contract (empty)
    queryQueue.push({ rows: [{ total: 12000 }] });                          // RR-MVP: SUM lines
    queryQueue.push({ rows: [{ id: 'k1', name: 'P1', type: 'project', total_value_usd: 12000 }] }); // RR-MVP: INSERT contract
    queryQueue.push({ rows: [{ id: 'o1', status: 'closed_won', winning_quotation_id: 'q1' }] }); // UPDATE opp
    const res = await client.call('POST', '/api/opportunities/o1/status', {
      new_status: 'closed_won', winning_quotation_id: 'q1',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed_won');
    const changed = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.status_changed');
    const wonEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.won');
    expect(changed).toBeTruthy();
    expect(wonEvt).toBeTruthy();
    expect(wonEvt[1].payload.winning_quotation_id).toBe('q1');
  });

  it('RR-MVP-00.1: skips contract creation when one already exists for the opportunity (idempotency)', async () => {
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated', client_id: 'c1', account_owner_id: 'u1', squad_id: 's1', name: 'Deal' }] }); // SELECT current
    queryQueue.push({ rows: [{ id: 'q1', status: 'sent', type: 'fixed_scope', project_name: 'P1' }] }); // quotation lookup
    queryQueue.push({ rows: [{ id: 'q1' }] });                              // UPDATE quotations -> approved
    queryQueue.push({ rows: [{ id: 'k-existing' }] });                      // existing contract found → no INSERT
    queryQueue.push({ rows: [{ id: 'o1', status: 'closed_won', winning_quotation_id: 'q1' }] }); // UPDATE opp
    const res = await client.call('POST', '/api/opportunities/o1/status', {
      new_status: 'closed_won', winning_quotation_id: 'q1',
    });
    expect(res.status).toBe(200);
  });

  it('marks as lost, rejects sent quotations, emits opportunity.lost', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated' }] });      // SELECT current
    queryQueue.push({ rows: [{ id: 'q1' }, { id: 'q2' }] });             // UPDATE quotations -> rejected
    queryQueue.push({ rows: [{ id: 'o1', status: 'closed_lost' }] });           // UPDATE opp
    const res = await client.call('POST', '/api/opportunities/o1/status', {
      new_status: 'closed_lost', outcome_reason: 'price', outcome_notes: 'too expensive',
    });
    expect(res.status).toBe(200);
    const lostEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.lost');
    expect(lostEvt).toBeTruthy();
    expect(lostEvt[1].payload).toEqual({ reason: 'price', notes: 'too expensive' });
  });

  // ============================================================
  // SPEC-CRM-00 v1.1 — Postponed transitions
  // ============================================================
  describe('SPEC-CRM-00 v1.1: Postponed', () => {
    const futureDate = (() => {
      const d = new Date(); d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    })();
    const pastDate = '2020-01-01';

    it('rejects 400 when transitioning to postponed without postponed_until_date', async () => {
      queryQueue.push({ rows: [{ id: 'o1', status: 'qualified' }] });
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'postponed',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/postponed_until_date/);
    });

    it('rejects 400 when postponed_until_date is in the past', async () => {
      queryQueue.push({ rows: [{ id: 'o1', status: 'qualified' }] });
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'postponed', postponed_until_date: pastDate,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/futura/);
    });

    it('rejects 400 when postponed_until_date is malformed', async () => {
      queryQueue.push({ rows: [{ id: 'o1', status: 'qualified' }] });
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'postponed', postponed_until_date: 'not-a-date',
      });
      expect(res.status).toBe(400);
    });

    it('postpones an opportunity, persists fields, emits opportunity.postponed', async () => {
      const { emitEvent } = require('../utils/events');
      emitEvent.mockClear();
      queryQueue.push({ rows: [{ id: 'o1', status: 'negotiation', booking_amount_usd: 50000 }] }); // SELECT current
      queryQueue.push({ rows: [{ id: 'o1', status: 'postponed', postponed_until_date: futureDate, postponed_reason: 'restructura' }] }); // UPDATE opp
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'postponed',
        postponed_until_date: futureDate,
        postponed_reason: 'restructura',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('postponed');
      const postponedEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.postponed');
      expect(postponedEvt).toBeTruthy();
      expect(postponedEvt[1].payload).toEqual({
        until_date: futureDate,
        reason: 'restructura',
        previous_status: 'negotiation',
      });
    });

    it('reactivates from postponed → qualified, clears postponed fields, emits opportunity.reactivated', async () => {
      const { emitEvent } = require('../utils/events');
      emitEvent.mockClear();
      queryQueue.push({ rows: [{
        id: 'o1', status: 'postponed',
        postponed_until_date: futureDate, postponed_reason: 'restructura',
      }] }); // SELECT current
      queryQueue.push({ rows: [{ id: 'o1', status: 'qualified', postponed_until_date: null, postponed_reason: null }] });
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'qualified',
      });
      expect(res.status).toBe(200);
      const reactivatedEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.reactivated');
      expect(reactivatedEvt).toBeTruthy();
      expect(reactivatedEvt[1].payload.to).toBe('qualified');
    });

    it('blocks invalid transition postponed → solution_design (only qualified or closed_lost allowed)', async () => {
      queryQueue.push({ rows: [{ id: 'o1', status: 'postponed' }] });
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'solution_design',
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Transición inválida/);
      expect(res.body.valid_transitions).toEqual(expect.arrayContaining(['qualified', 'closed_lost']));
    });
  });
});

/* ---------- DELETE /:id ---------- */
describe('DELETE /api/opportunities/:id (admin+)', () => {
  it('rejects non-admin users with 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('DELETE', '/api/opportunities/o1');
    expect(res.status).toBe(403);
    expect(issuedQueries).toHaveLength(0);
  });

  it('rejects deletion when the opportunity has quotations', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ quots: 2 }] });
    const res = await client.call('DELETE', '/api/opportunities/o1');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/2 cotización/);
  });

  it('soft-deletes when there are no quotations', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ quots: 0 }] });
    queryQueue.push({ rows: [{ id: 'o1', name: 'Deal A' }] });
    const res = await client.call('DELETE', '/api/opportunities/o1');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/eliminada/i);
  });
});

describe('GET /api/opportunities/export.csv', () => {
  it('streams a CSV with BOM + header + rows and honors status filter', async () => {
    queryQueue.push({ rows: [
      { id: 'o1', name: 'Deal A', status: 'lead', outcome: null, outcome_reason: null,
        expected_close_date: '2026-06-30', closed_at: null, description: 'big "one"',
        created_at: '2026-01-01T00:00:00Z', client_name: 'Acme' },
    ] });
    const res = await client.call('GET', '/api/opportunities/export.csv?status=lead');
    expect(res.status).toBe(200);
    expect(res.body.charCodeAt(0)).toBe(0xFEFF);
    expect(res.body).toMatch(/Nombre,Cliente,Estado/);
    expect(res.body).toMatch(/Deal A,Acme,lead/);
    // Embedded quote in description must be CSV-escaped
    expect(res.body).toMatch(/"big ""one"""/);
    const exec = issuedQueries.find((q) => /FROM opportunities o/.test(q.sql));
    expect(exec.params).toContain('lead');
  });

  it('returns 500 when the DB throws', async () => {
    queryQueue.push(new Error('boom'));
    const res = await client.call('GET', '/api/opportunities/export.csv');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/opportunities/kanban (CRM-MVP-00.1)', () => {
  it('groups opportunities by stage with summaries and global summary', async () => {
    queryQueue.push({ rows: [
      { id: 'o1', name: 'Deal A', status: 'lead',        booking_amount_usd: 10000, weighted_amount_usd: 500,   probability: 5,  client_name: 'Acme',  owner_name: 'Laura', last_stage_change_at: new Date(), days_in_current_stage: 1 },
      { id: 'o2', name: 'Deal B', status: 'qualified',   booking_amount_usd: 50000, weighted_amount_usd: 10000, probability: 20, client_name: 'Beta',  owner_name: 'Laura', last_stage_change_at: new Date(), days_in_current_stage: 4 },
      { id: 'o3', name: 'Deal C', status: 'qualified',   booking_amount_usd: 80000, weighted_amount_usd: 16000, probability: 20, client_name: 'Gamma', owner_name: 'Pablo', last_stage_change_at: new Date(), days_in_current_stage: 2 },
      { id: 'o4', name: 'Deal D', status: 'closed_won',         booking_amount_usd: 30000, weighted_amount_usd: 30000, probability: 100, client_name: 'Delta', owner_name: 'Laura', last_stage_change_at: new Date(), days_in_current_stage: 0 },
    ] });
    const res = await client.call('GET', '/api/opportunities/kanban');
    expect(res.status).toBe(200);
    // SPEC-CRM-00 v1.1: 9 columnas (lead, qualified, solution_design,
    // proposal_validated, negotiation, verbal_commit, closed_won,
    // closed_lost, postponed).
    expect(res.body.stages).toHaveLength(9);
    const lead = res.body.stages.find((s) => s.id === 'lead');
    expect(lead.summary.count).toBe(1);
    expect(lead.summary.total_amount_usd).toBe(10000);
    expect(lead.summary.weighted_amount_usd).toBe(500);
    const qualified = res.body.stages.find((s) => s.id === 'qualified');
    expect(qualified.summary.count).toBe(2);
    expect(qualified.summary.total_amount_usd).toBe(130000);
    // probability de qualified bajó de 20→15 en v1.1; el server lee del row
    // sin recalcular, así que respeta el valor inyectado en el mock (20).
    expect(qualified.summary.weighted_amount_usd).toBe(26000);
    expect(res.body.global_summary.total_opportunities).toBe(4);
    expect(res.body.global_summary.total_amount_usd).toBe(170000);
  });

  it('applies filters from query params (owner_id, min_amount_usd)', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/opportunities/kanban?owner_id=u9&min_amount_usd=50000');
    const sql = issuedQueries.find((q) => q.sql.includes('FROM opportunities o'))?.sql || '';
    expect(sql).toMatch(/account_owner_id =/);
    expect(sql).toMatch(/booking_amount_usd >=/);
  });

  it('respects per-column cap (KANBAN_PER_COLUMN=100): summary.has_more flag', async () => {
    // 105 opportunities all in 'lead' stage
    const rows = Array.from({ length: 105 }, (_, i) => ({
      id: `o${i}`, name: `Deal ${i}`, status: 'lead',
      booking_amount_usd: 1000, weighted_amount_usd: 50, probability: 5,
      client_name: 'X', owner_name: 'Y', last_stage_change_at: new Date(), days_in_current_stage: 0,
    }));
    queryQueue.push({ rows });
    const res = await client.call('GET', '/api/opportunities/kanban');
    expect(res.status).toBe(200);
    const lead = res.body.stages.find((s) => s.id === 'lead');
    expect(lead.summary.count).toBe(105);
    expect(lead.opportunities).toHaveLength(100);
    expect(lead.summary.has_more).toBe(true);
  });
});
