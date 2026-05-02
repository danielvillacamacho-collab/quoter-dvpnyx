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
  // SPEC-CRM-00 v1.1 PR4 — RBAC constants consumed by opportunities.js.
  ROLES: ['superadmin', 'admin', 'director', 'lead', 'member', 'viewer', 'external'],
  SEE_ALL_ROLES: new Set(['superadmin', 'admin', 'director']),
  WRITE_ROLES: new Set(['superadmin', 'admin', 'director', 'lead', 'member']),
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
  // Default admin: no RBAC scoping. Tests que necesitan member/viewer/external
  // overridean explícitamente.
  mockCurrentUser = { id: 'u1', role: 'admin', function: 'comercial' };
});

// SPEC-CRM-00 v1.1 PR4 — RBAC scoping + alerts.
describe('SPEC-CRM-00 v1.1 PR4: RBAC scoping', () => {
  it('director sees all opportunities (no squad/owner filter)', async () => {
    mockCurrentUser = { id: 'u1', role: 'director', squad_id: 's1' };
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/opportunities');
    const sql = issuedQueries[0].sql;
    expect(sql).not.toMatch(/squad_id/);
    expect(sql).not.toMatch(/account_owner_id/);
  });

  it('lead only sees opportunities from their squad', async () => {
    mockCurrentUser = { id: 'u2', role: 'lead', squad_id: 's7' };
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/opportunities');
    const sql = issuedQueries[0].sql;
    expect(sql).toMatch(/o\.squad_id =/);
    expect(issuedQueries[0].params).toContain('s7');
  });

  it('member only sees own opportunities (account_owner or presales_lead)', async () => {
    mockCurrentUser = { id: 'u3', role: 'member' };
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/opportunities');
    const sql = issuedQueries[0].sql;
    expect(sql).toMatch(/account_owner_id/);
    expect(sql).toMatch(/presales_lead_id/);
  });

  it('external role gets 403 on GET /', async () => {
    mockCurrentUser = { id: 'u4', role: 'external' };
    const res = await client.call('GET', '/api/opportunities');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/restringido/i);
  });

  it('external role gets 403 on GET /kanban', async () => {
    mockCurrentUser = { id: 'u4', role: 'external' };
    const res = await client.call('GET', '/api/opportunities/kanban');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/opportunities/check-alerts (SPEC-CRM-00 v1.1 PR4)', () => {
  it('creates A1+A2 notifications for stale opp with overdue next_step', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    // SELECT active opportunities
    queryQueue.push({ rows: [{
      id: 'o1', name: 'Deal Stale', status: 'qualified',
      account_owner_id: 'u5', days_in_stage: 45,
      next_step: 'Call cliente', next_step_due_date: '2026-01-15',
      expected_close_date: '2026-12-30',
      champion_identified: true, economic_buyer_identified: true,
    }] });
    // INSERT for A1 → created
    queryQueue.push({ rows: [{ id: 'n1' }] });
    // INSERT for A2 → created
    queryQueue.push({ rows: [{ id: 'n2' }] });
    const res = await client.call('POST', '/api/opportunities/check-alerts', {});
    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(1);
    expect(res.body.created).toBe(2);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alert: 'a1_stale' }),
        expect.objectContaining({ alert: 'a2_next_step' }),
      ]),
    );
  });

  it('creates A3 notification for opp in solution_design without champion', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{
      id: 'o2', name: 'Deal No Champ', status: 'solution_design',
      account_owner_id: 'u5', days_in_stage: 5,
      next_step_due_date: null, expected_close_date: null,
      champion_identified: false, economic_buyer_identified: true,
    }] });
    queryQueue.push({ rows: [{ id: 'n3' }] }); // A3 INSERT
    const res = await client.call('POST', '/api/opportunities/check-alerts', {});
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.details[0].alert).toBe('a3_meddpicc');
  });

  it('dedup: returns 0 created when notifications already exist (empty RETURNING)', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{
      id: 'o1', name: 'Deal', status: 'qualified',
      account_owner_id: 'u5', days_in_stage: 45,
      next_step_due_date: null, expected_close_date: null,
      champion_identified: true, economic_buyer_identified: true,
    }] });
    queryQueue.push({ rows: [] }); // A1 INSERT → dedup'd (empty rows)
    const res = await client.call('POST', '/api/opportunities/check-alerts', {});
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
  });

  it('rejects external and viewer roles with 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'viewer' };
    const res1 = await client.call('POST', '/api/opportunities/check-alerts', {});
    expect(res1.status).toBe(403);

    mockCurrentUser = { id: 'u1', role: 'external' };
    const res2 = await client.call('POST', '/api/opportunities/check-alerts', {});
    expect(res2.status).toBe(403);
  });

  it('lead scoping: only scans squad opportunities', async () => {
    mockCurrentUser = { id: 'u2', role: 'lead', squad_id: 's3' };
    queryQueue.push({ rows: [] }); // SELECT (empty — scoped to squad)
    await client.call('POST', '/api/opportunities/check-alerts', {});
    const sql = issuedQueries[0].sql;
    expect(sql).toMatch(/o\.squad_id =/);
    expect(issuedQueries[0].params).toContain('s3');
  });
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

  // SPEC-CRM-00 v1.1 PR2 — filtros nuevos.
  it('aplica revenue_type + has_champion + funding_source filters', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/opportunities?revenue_type=recurring&has_champion=true&funding_source=aws_mdf');
    const firstSql = issuedQueries[0].sql;
    expect(firstSql).toMatch(/o\.revenue_type =/);
    expect(firstSql).toMatch(/o\.champion_identified = true/);
    expect(firstSql).toMatch(/o\.funding_source =/);
  });

  it('ignora revenue_type / funding_source con valores fuera del enum (no inyecta SQL)', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/opportunities?revenue_type=foo&funding_source=bar');
    const firstSql = issuedQueries[0].sql;
    expect(firstSql).not.toMatch(/o\.revenue_type =/);
    expect(firstSql).not.toMatch(/o\.funding_source =/);
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

  // ============================================================
  // SPEC-CRM-00 v1.1 PR2 — Revenue model + Champion/EB + Funding
  // ============================================================
  describe('SPEC-CRM-00 v1.1 PR2: Revenue model', () => {
    it('rechaza recurring sin mrr_usd', async () => {
      queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
      const res = await client.call('POST', '/api/opportunities', {
        ...validBody, revenue_type: 'recurring', contract_length_months: 12,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mrr_usd/);
    });

    it('rechaza recurring sin contract_length_months', async () => {
      queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
      const res = await client.call('POST', '/api/opportunities', {
        ...validBody, revenue_type: 'recurring', mrr_usd: 5000,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/contract_length_months/);
    });

    it('rechaza mixed sin one_time_amount_usd', async () => {
      queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
      const res = await client.call('POST', '/api/opportunities', {
        ...validBody, revenue_type: 'mixed', mrr_usd: 5000, contract_length_months: 12,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/one_time_amount_usd/);
    });

    it('crea opp recurring y persiste mrr_usd × months como booking', async () => {
      queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
      queryQueue.push({ rows: [{ next_seq: 1 }] });
      queryQueue.push({ rows: [{
        id: 'o-rec', name: 'Recurring Deal', revenue_type: 'recurring',
        mrr_usd: 5000, contract_length_months: 24, booking_amount_usd: 120000,
      }] });
      const res = await client.call('POST', '/api/opportunities', {
        ...validBody, name: 'Recurring Deal',
        revenue_type: 'recurring', mrr_usd: 5000, contract_length_months: 24,
      });
      expect(res.status).toBe(201);
      const insertParams = issuedQueries[issuedQueries.length - 1].params;
      expect(insertParams[12]).toBe('recurring');                  // revenue_type
      expect(insertParams[14]).toBe(5000);                          // mrr_usd
      expect(insertParams[15]).toBe(24);                            // contract_length_months
      expect(insertParams[21]).toBe(120000);                        // computedBooking
    });

    it('crea opp mixed con booking = one_time + mrr × months', async () => {
      queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
      queryQueue.push({ rows: [{ next_seq: 1 }] });
      queryQueue.push({ rows: [{ id: 'o-mix', name: 'Mixed' }] });
      const res = await client.call('POST', '/api/opportunities', {
        ...validBody, name: 'Mixed',
        revenue_type: 'mixed', one_time_amount_usd: 20000,
        mrr_usd: 3000, contract_length_months: 12,
      });
      expect(res.status).toBe(201);
      const insertParams = issuedQueries[issuedQueries.length - 1].params;
      expect(insertParams[21]).toBe(56000); // 20000 + 3000*12
    });

    it('legacy compat: POST sin revenue_type → default one_time con booking 0', async () => {
      queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
      queryQueue.push({ rows: [{ next_seq: 1 }] });
      queryQueue.push({ rows: [{ id: 'o', name: 'Deal A' }] });
      const res = await client.call('POST', '/api/opportunities', validBody);
      expect(res.status).toBe(201);
      const insertParams = issuedQueries[issuedQueries.length - 1].params;
      expect(insertParams[12]).toBe('one_time');  // revenue_type defaulted
      expect(insertParams[13]).toBe(0);            // one_time_amount_usd = 0
      expect(insertParams[18]).toBe('client_direct'); // funding_source defaulted
    });

    it('rechaza funding_source != client_direct sin funding_amount_usd', async () => {
      queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
      const res = await client.call('POST', '/api/opportunities', {
        ...validBody, funding_source: 'aws_mdf',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/funding_amount_usd/);
    });

    it('persiste flags Champion + Economic Buyer + drive_url', async () => {
      queryQueue.push({ rows: [{ id: 'c1', active: true, country: 'Colombia' }] });
      queryQueue.push({ rows: [{ next_seq: 1 }] });
      queryQueue.push({ rows: [{ id: 'o' }] });
      await client.call('POST', '/api/opportunities', {
        ...validBody, champion_identified: true, economic_buyer_identified: true,
        drive_url: 'https://drive.google.com/folder/abc',
      });
      const insertParams = issuedQueries[issuedQueries.length - 1].params;
      expect(insertParams[16]).toBe(true);   // champion_identified
      expect(insertParams[17]).toBe(true);   // economic_buyer_identified
      expect(insertParams[20]).toBe('https://drive.google.com/folder/abc'); // drive_url
    });
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
    // Compat: el payload conserva `reason`/`notes` pero ahora también
    // expone los campos formales del v1.1 (loss_reason, loss_reason_detail).
    expect(lostEvt[1].payload.reason).toBe('price');
    expect(lostEvt[1].payload.notes).toBe('too expensive');
  });

  // ============================================================
  // SPEC-CRM-00 v1.1 PR2 — Loss reason formal (enum extendido + detail)
  // ============================================================
  describe('SPEC-CRM-00 v1.1 PR2: Loss reason formal', () => {
    it('rechaza closed_lost cuando loss_reason_detail < 30 chars', async () => {
      queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated' }] });
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'closed_lost', loss_reason: 'price', loss_reason_detail: 'corto',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/30 caracteres/);
    });

    it('rechaza loss_reason fuera del enum extendido', async () => {
      queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated' }] });
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'closed_lost', loss_reason: 'made_up', loss_reason_detail: 'a'.repeat(40),
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/loss_reason/);
    });

    it('persiste loss_reason + loss_reason_detail y los emite en el evento', async () => {
      const { emitEvent } = require('../utils/events');
      emitEvent.mockClear();
      queryQueue.push({ rows: [{ id: 'o1', status: 'negotiation' }] });
      queryQueue.push({ rows: [] }); // UPDATE quotations rejected (nada)
      queryQueue.push({ rows: [{ id: 'o1', status: 'closed_lost', loss_reason: 'competitor_won' }] });
      const detail = 'Cliente eligió competidor por feature X que no soportamos. Plan: roadmap Q3.';
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'closed_lost', loss_reason: 'competitor_won', loss_reason_detail: detail,
      });
      expect(res.status).toBe(200);
      const updateOppCall = issuedQueries.find((q) => /UPDATE opportunities SET\s+status/m.test(q.sql));
      expect(updateOppCall.params).toContain('competitor_won');
      expect(updateOppCall.params).toContain(detail);
      const lostEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.lost');
      expect(lostEvt[1].payload.loss_reason).toBe('competitor_won');
      expect(lostEvt[1].payload.loss_reason_detail).toBe(detail);
    });

    it('legacy compat: outcome_reason sin loss_reason sigue funcionando', async () => {
      queryQueue.push({ rows: [{ id: 'o1', status: 'negotiation' }] });
      queryQueue.push({ rows: [] });
      queryQueue.push({ rows: [{ id: 'o1', status: 'closed_lost' }] });
      const res = await client.call('POST', '/api/opportunities/o1/status', {
        new_status: 'closed_lost', outcome_reason: 'price', outcome_notes: 'x',
      });
      expect(res.status).toBe(200);
    });
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

// SPEC-CRM-00 v1.1 PR3 — check-margin endpoint + Alerta A4.
describe('POST /api/opportunities/:id/check-margin', () => {
  const { emitEvent } = require('../utils/events');
  const baseOpp = { id: 'o1', booking_amount_usd: 100000 };

  it('computes margin correctly with explicit estimated_cost_usd (high margin)', async () => {
    queryQueue.push({ rows: [baseOpp] });                   // SELECT opp
    queryQueue.push({ rows: [{ id: 'o1', booking_amount_usd: 100000, estimated_cost_usd: 60000, margin_pct: 40 }] }); // UPDATE RETURNING
    const res = await client.call('POST', '/api/opportunities/o1/check-margin', { estimated_cost_usd: 60000 });
    expect(res.status).toBe(200);
    expect(res.body.margin_pct).toBe(40);
    expect(res.body.estimated_cost_usd).toBe(60000);
    expect(res.body.booking_amount_usd).toBe(100000);
    expect(res.body.alert_fired).toBe(false);
    // No debe emitir opportunity.margin_low cuando margen >= umbral.
    const marginEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.margin_low');
    expect(marginEvt).toBeUndefined();
  });

  it('auto-computes from quotation lines when estimated_cost_usd is not provided', async () => {
    queryQueue.push({ rows: [baseOpp] });                              // SELECT opp
    queryQueue.push({ rows: [{ estimated_cost_usd: 45000 }] });       // auto-compute from lines
    queryQueue.push({ rows: [{ id: 'o1', booking_amount_usd: 100000, estimated_cost_usd: 45000, margin_pct: 55 }] }); // UPDATE
    const res = await client.call('POST', '/api/opportunities/o1/check-margin', {});
    expect(res.status).toBe(200);
    expect(res.body.margin_pct).toBe(55);
    // Verifica que se lanzó la query de auto-cómputo (JOIN quotation_lines).
    const autoQ = issuedQueries.find((q) => /quotation_lines/.test(q.sql));
    expect(autoQ).toBeTruthy();
  });

  it('emits opportunity.margin_low (Alerta A4) when margin < 20%', async () => {
    queryQueue.push({ rows: [baseOpp] });                    // SELECT opp
    // explicit cost → costo = 88000, margen = 12%
    queryQueue.push({ rows: [{ id: 'o1', booking_amount_usd: 100000, estimated_cost_usd: 88000, margin_pct: 12 }] });
    const res = await client.call('POST', '/api/opportunities/o1/check-margin', { estimated_cost_usd: 88000 });
    expect(res.status).toBe(200);
    expect(res.body.margin_pct).toBe(12);
    expect(res.body.alert_fired).toBe(true);
    const marginEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'opportunity.margin_low');
    expect(marginEvt).toBeTruthy();
    expect(marginEvt[1].payload.margin_pct).toBe(12);
    expect(marginEvt[1].payload.threshold).toBe(20);
  });

  it('returns 400 when booking_amount_usd is 0 (cannot compute margin)', async () => {
    // Snapshot call count before this test so accumulated calls from
    // prior tests don't pollute the assertion.
    const callsBefore = emitEvent.mock.calls.length;
    queryQueue.push({ rows: [{ id: 'o1', booking_amount_usd: 0 }] });
    const res = await client.call('POST', '/api/opportunities/o1/check-margin', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/booking_amount_usd debe ser > 0/);
    expect(emitEvent.mock.calls.length).toBe(callsBefore); // no new events
  });

  it('returns 400 when estimated_cost_usd is negative', async () => {
    const res = await client.call('POST', '/api/opportunities/o1/check-margin', { estimated_cost_usd: -500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no negativo/);
    expect(issuedQueries).toHaveLength(0);
  });

  it('returns 404 when opportunity does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/opportunities/o99/check-margin', {});
    expect(res.status).toBe(404);
  });

  it('status transition includes A4 warning when margin_pct < 20% at proposal_validated', async () => {
    // Simulamos una opp en qualified con margin_pct=12 que avanza a proposal_validated.
    queryQueue.push({ rows: [{ id: 'o1', status: 'qualified', margin_pct: 12 }] }); // SELECT current (FOR UPDATE)
    // UPDATE opp → after row incluye margin_pct=12
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated', booking_amount_usd: 50000, margin_pct: 12 }] });
    const res = await client.call('POST', '/api/opportunities/o1/status', { new_status: 'proposal_validated' });
    expect(res.status).toBe(200);
    const a4 = res.body.warnings.find((w) => w.code === 'a4_margin_low');
    expect(a4).toBeTruthy();
    expect(a4.message).toMatch(/A4/);
    expect(a4.message).toMatch(/12%/);
  });

  it('status transition does NOT include A4 warning when margin_pct >= 20%', async () => {
    queryQueue.push({ rows: [{ id: 'o1', status: 'qualified', margin_pct: 35 }] });
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated', booking_amount_usd: 50000, margin_pct: 35 }] });
    const res = await client.call('POST', '/api/opportunities/o1/status', { new_status: 'proposal_validated' });
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w) => w.code === 'a4_margin_low')).toBe(false);
  });

  it('status transition does NOT include A4 warning when margin_pct is null (not yet computed)', async () => {
    queryQueue.push({ rows: [{ id: 'o1', status: 'qualified', margin_pct: null }] });
    queryQueue.push({ rows: [{ id: 'o1', status: 'proposal_validated', booking_amount_usd: 50000, margin_pct: null }] });
    const res = await client.call('POST', '/api/opportunities/o1/status', { new_status: 'proposal_validated' });
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w) => w.code === 'a4_margin_low')).toBe(false);
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
