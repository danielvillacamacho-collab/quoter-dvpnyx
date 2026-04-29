/**
 * Tests para server/routes/internal_initiatives.js (SPEC-II-00).
 */

const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (mockControlSql.has(sql)) return { rows: [] };
    if (typeof sql === 'string' && sql.startsWith('SAVEPOINT')) return { rows: [] };
    if (typeof sql === 'string' && sql.startsWith('RELEASE SAVEPOINT')) return { rows: [] };
    if (typeof sql === 'string' && sql.startsWith('ROLLBACK TO SAVEPOINT')) return { rows: [] };
    if (!queryQueue.length) {
      throw new Error(`Unexpected query (no mock enqueued): ${String(sql).slice(0, 100)}`);
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
  emitEvent: jest.fn(async () => ({ id: 'evt' })),
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
  requireRole: () => (_req, _res, next) => next(),
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

const router = require('./internal_initiatives');
const app = express();
app.use(express.json());
app.use('/api/internal-initiatives', router);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'admin' };
});

const validId = '11111111-1111-1111-1111-111111111111';
const ownerId = '22222222-2222-2222-2222-222222222222';
const empId   = '33333333-3333-3333-3333-333333333333';

describe('GET /', () => {
  it('lista paginada', async () => {
    queryQueue.push({ rows: [{ total: 2 }] });
    queryQueue.push({ rows: [
      { id: validId, name: 'Quoter v3', initiative_code: 'II-PROD-2026-00001' },
      { id: 'b', name: 'AWS Comp',  initiative_code: 'II-TECH-2026-00001' },
    ] });
    const r = await client.call('GET', '/api/internal-initiatives');
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.pagination.total).toBe(2);
  });

  it('filtros aplicados al SQL', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/internal-initiatives?status=active&business_area=product');
    const lastListQuery = issuedQueries[issuedQueries.length - 1];
    expect(lastListQuery.sql).toMatch(/business_area_id =/);
    expect(lastListQuery.sql).toMatch(/status =/);
  });
});

describe('GET /:id', () => {
  it('404 si no existe', async () => {
    queryQueue.push({ rows: [] });
    const r = await client.call('GET', `/api/internal-initiatives/${validId}`);
    expect(r.status).toBe(404);
  });
  it('400 si UUID inválido', async () => {
    const r = await client.call('GET', '/api/internal-initiatives/not-uuid');
    expect(r.status).toBe(400);
  });
  it('200 con assignments + metrics', async () => {
    queryQueue.push({ rows: [{
      id: validId, name: 'X', business_area_id: 'product', status: 'active',
      budget_usd: 10000, hours_estimated: 100, start_date: '2026-04-01',
      operations_owner_id: ownerId,
    }] });
    queryQueue.push({ rows: [{ id: 'a1', employee_id: empId, weekly_hours: 20 }] });
    queryQueue.push({ rows: [{ hours_consumed: 40, consumed_usd: 1800 }] });
    const r = await client.call('GET', `/api/internal-initiatives/${validId}`);
    expect(r.status).toBe(200);
    expect(r.body.assignments).toHaveLength(1);
    expect(r.body.metrics.consumed_usd).toBe(1800);
    expect(r.body.metrics.budget_remaining_usd).toBe(8200);
  });
});

describe('POST /', () => {
  const validBody = {
    name: 'Construir el Quoter v3',
    business_area_id: 'product',
    budget_usd: 500000,
    hours_estimated: 8000,
    start_date: '2026-04-01',
    target_end_date: '2027-03-31',
    operations_owner_id: ownerId,
  };

  it('admin crea correctamente', async () => {
    queryQueue.push({ rows: [{ id: 'product' }] });          // business_areas
    queryQueue.push({ rows: [{ id: ownerId }] });             // users
    queryQueue.push({ rows: [] });                            // pg_advisory_xact_lock
    queryQueue.push({ rows: [] });                            // nextSequence: no rows previas
    queryQueue.push({ rows: [{                                // INSERT
      id: validId, initiative_code: 'II-PROD-2026-00001', name: validBody.name,
    }] });
    queryQueue.push({ rows: [{ id: 'evt' }] });               // emitEvent INSERT events
    const r = await client.call('POST', '/api/internal-initiatives', validBody);
    expect(r.status).toBe(201);
    expect(r.body.initiative_code).toBe('II-PROD-2026-00001');
  });

  it('non-admin → 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const r = await client.call('POST', '/api/internal-initiatives', validBody);
    expect(r.status).toBe(403);
  });

  it('400 si name muy corto', async () => {
    const r = await client.call('POST', '/api/internal-initiatives', { ...validBody, name: 'AB' });
    expect(r.status).toBe(400);
  });

  it('400 si budget negativo', async () => {
    const r = await client.call('POST', '/api/internal-initiatives', { ...validBody, budget_usd: -10 });
    expect(r.status).toBe(400);
  });

  it('400 si fecha inválida', async () => {
    const r = await client.call('POST', '/api/internal-initiatives', { ...validBody, start_date: '2026/04/01' });
    expect(r.status).toBe(400);
  });

  it('400 si target_end_date < start_date', async () => {
    const r = await client.call('POST', '/api/internal-initiatives', {
      ...validBody, start_date: '2026-04-01', target_end_date: '2026-03-01',
    });
    expect(r.status).toBe(400);
  });

  it('400 si business_area no existe', async () => {
    queryQueue.push({ rows: [] }); // business_areas → vacío
    const r = await client.call('POST', '/api/internal-initiatives', validBody);
    expect(r.status).toBe(400);
  });

  it('400 si operations_owner no existe', async () => {
    queryQueue.push({ rows: [{ id: 'product' }] });
    queryQueue.push({ rows: [] }); // users → vacío
    const r = await client.call('POST', '/api/internal-initiatives', validBody);
    expect(r.status).toBe(400);
  });
});

describe('POST /:id/transitions', () => {
  it('transición válida active → paused', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'active', operations_owner_id: ownerId, actual_end_date: null }] });
    queryQueue.push({ rows: [{ id: validId, status: 'paused' }] });
    queryQueue.push({ rows: [{ id: 'evt' }] });
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/transitions`, { to_status: 'paused' });
    expect(r.status).toBe(200);
  });

  it('rechaza transición active → cancelled sin reason', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'active', operations_owner_id: ownerId }] });
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/transitions`, { to_status: 'cancelled' });
    expect(r.status).toBe(400);
  });

  it('rechaza transición desde terminal', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'completed', operations_owner_id: ownerId }] });
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/transitions`, { to_status: 'active' });
    expect(r.status).toBe(409);
  });

  it('non-admin → 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/transitions`, { to_status: 'paused' });
    expect(r.status).toBe(403);
  });

  it('completed cancela asignaciones planeadas/activas', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'active', operations_owner_id: ownerId, actual_end_date: null }] });
    queryQueue.push({ rows: [{ id: validId, status: 'completed', actual_end_date: '2026-04-30' }] });
    queryQueue.push({ rows: [] }); // UPDATE iia
    queryQueue.push({ rows: [{ id: 'evt' }] });
    await client.call('POST', `/api/internal-initiatives/${validId}/transitions`, { to_status: 'completed' });
    // verificamos que se haya emitido el UPDATE de iia
    const updateIia = issuedQueries.find((q) => /UPDATE internal_initiative_assignments/.test(q.sql || ''));
    expect(updateIia).toBeDefined();
  });
});

describe('DELETE /:id', () => {
  it('admin elimina si no hay asignaciones activas', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'active' }] });
    queryQueue.push({ rows: [{ n: 0 }] });
    queryQueue.push({ rows: [] }); // UPDATE soft-delete
    queryQueue.push({ rows: [{ id: 'evt' }] });
    const r = await client.call('DELETE', `/api/internal-initiatives/${validId}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('409 si tiene asignaciones activas', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'active' }] });
    queryQueue.push({ rows: [{ n: 3 }] });
    const r = await client.call('DELETE', `/api/internal-initiatives/${validId}`);
    expect(r.status).toBe(409);
  });

  it('non-admin → 403', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const r = await client.call('DELETE', `/api/internal-initiatives/${validId}`);
    expect(r.status).toBe(403);
  });
});

describe('POST /:id/assignments', () => {
  const body = {
    employee_id: empId,
    start_date: '2026-05-01',
    end_date: '2026-12-31',
    weekly_hours: 20,
    role_description: 'Senior Backend',
  };

  it('admin asigna y deriva tarifa horaria', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'active', operations_owner_id: ownerId }] });
    queryQueue.push({ rows: [{
      id: empId, weekly_capacity_hours: 40, emp_status: 'active',
      cost_usd: 7800, period: '202604',
    }] });
    queryQueue.push({ rows: [{ id: 'iia1', hourly_rate_usd: 45 }] });
    queryQueue.push({ rows: [{ id: 'evt' }] });
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/assignments`, body);
    expect(r.status).toBe(201);
    expect(r.body.missing_rate).toBe(false);
  });

  it('asigna OK sin cost_usd → missing_rate flag', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'active', operations_owner_id: ownerId }] });
    queryQueue.push({ rows: [{ id: empId, weekly_capacity_hours: 40, emp_status: 'active', cost_usd: null }] });
    queryQueue.push({ rows: [{ id: 'iia1', hourly_rate_usd: null }] });
    queryQueue.push({ rows: [{ id: 'evt' }] });
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/assignments`, body);
    expect(r.status).toBe(201);
    expect(r.body.missing_rate).toBe(true);
  });

  it('409 si iniciativa completed', async () => {
    queryQueue.push({ rows: [{ id: validId, status: 'completed', operations_owner_id: ownerId }] });
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/assignments`, body);
    expect(r.status).toBe(409);
  });

  it('403 si no es admin ni operations_owner', async () => {
    mockCurrentUser = { id: 'someone-else', role: 'member' };
    queryQueue.push({ rows: [{ id: validId, status: 'active', operations_owner_id: ownerId }] });
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/assignments`, body);
    expect(r.status).toBe(403);
  });

  it('operations_owner (no admin) puede asignar', async () => {
    mockCurrentUser = { id: ownerId, role: 'member' };
    queryQueue.push({ rows: [{ id: validId, status: 'active', operations_owner_id: ownerId }] });
    queryQueue.push({ rows: [{ id: empId, weekly_capacity_hours: 40, emp_status: 'active', cost_usd: 7800 }] });
    queryQueue.push({ rows: [{ id: 'iia1' }] });
    queryQueue.push({ rows: [{ id: 'evt' }] });
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/assignments`, body);
    expect(r.status).toBe(201);
  });

  it('400 si weekly_hours fuera de rango', async () => {
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/assignments`,
      { ...body, weekly_hours: 100 });
    expect(r.status).toBe(400);
  });

  it('400 si end_date < start_date', async () => {
    const r = await client.call('POST', `/api/internal-initiatives/${validId}/assignments`,
      { ...body, start_date: '2026-12-01', end_date: '2026-11-01' });
    expect(r.status).toBe(400);
  });
});
