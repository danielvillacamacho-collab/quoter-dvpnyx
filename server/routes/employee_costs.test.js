/**
 * Tests para /api/employee-costs (spec_costos_empleado.docx).
 */
const queryQueue = [];
const issuedQueries = [];
const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);

jest.mock('../database/pool', () => {
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (mockControlSql.has(String(sql).trim())) return { rows: [] };
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

let mockUser = { id: 'u-admin', role: 'admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin','superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
  superadminOnly: (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const router = require('./employee_costs');
const app = express(); app.use(express.json()); app.use('/api/employee-costs', router);

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
const client = request(app);

const UUID_E = '550e8400-e29b-41d4-a716-446655440001';
const UUID_E2 = '550e8400-e29b-41d4-a716-446655440002';
const UUID_C = '550e8400-e29b-41d4-a716-44665544000c';

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockUser = { id: 'u-admin', role: 'admin' };
});

describe('Permisos de acceso (PII salarial)', () => {
  it('member recibe 403 en GET', async () => {
    mockUser = { id: 'u-mem', role: 'member' };
    const res = await client.call('GET', '/api/employee-costs?period=202604');
    expect(res.status).toBe(403);
  });
  it('lead recibe 403 en GET', async () => {
    mockUser = { id: 'u-lead', role: 'lead' };
    const res = await client.call('GET', '/api/employee-costs?period=202604');
    expect(res.status).toBe(403);
  });
  it('viewer recibe 403 en GET', async () => {
    mockUser = { id: 'u-v', role: 'viewer' };
    const res = await client.call('GET', '/api/employee-costs?period=202604');
    expect(res.status).toBe(403);
  });
  it('admin tiene acceso', async () => {
    queryQueue.push({ rows: [] }); // empleados
    queryQueue.push({ rows: [] }); // costs
    queryQueue.push({ rows: [] }); // theoretical
    const res = await client.call('GET', '/api/employee-costs?period=202604');
    expect(res.status).toBe(200);
  });
  it('superadmin tiene acceso', async () => {
    mockUser = { id: 'u-sa', role: 'superadmin' };
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/employee-costs?period=202604');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/employee-costs (mass view)', () => {
  it('rechaza period inválido', async () => {
    const res = await client.call('GET', '/api/employee-costs?period=foo');
    expect(res.status).toBe(400);
  });
  it('devuelve mass view con summary', async () => {
    queryQueue.push({ rows: [
      { id: UUID_E, first_name: 'Ana', last_name: 'G', level: 'L4', country: 'CO', status: 'active', start_date: new Date('2025-01-01'), end_date: null, area_name: 'Desarrollo' },
    ]});
    queryQueue.push({ rows: [
      { id: UUID_C, employee_id: UUID_E, period: '202604', currency: 'COP', gross_cost: 12000000, cost_usd: 3000, exchange_rate_used: 4000, locked: false },
    ]});
    queryQueue.push({ rows: [{ key: 'L4', value: 2800 }] }); // theoretical
    const res = await client.call('GET', '/api/employee-costs?period=202604');
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('202604');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].cost.cost_usd).toBe(3000);
    expect(res.body.data[0].delta.deltaPct).toBeCloseTo((3000 - 2800) / 2800 * 100, 1);
    expect(res.body.summary.with_cost).toBe(1);
    expect(res.body.summary.total_cost_usd).toBe(3000);
  });
  it('cuenta empleados sin costo separadamente', async () => {
    queryQueue.push({ rows: [
      { id: UUID_E, first_name: 'A', last_name: 'B', level: 'L4', country: 'CO', status: 'active', start_date: new Date('2025-01-01'), end_date: null, area_name: 'Desarrollo' },
      { id: UUID_E2, first_name: 'C', last_name: 'D', level: 'L5', country: 'MX', status: 'active', start_date: new Date('2025-01-01'), end_date: null, area_name: 'Testing' },
    ]});
    queryQueue.push({ rows: [] }); // ningún costo
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/employee-costs?period=202604');
    expect(res.body.summary.with_cost).toBe(0);
    expect(res.body.summary.without_cost).toBe(2);
    expect(res.body.summary.total_cost_usd).toBe(0);
  });
});

describe('POST /api/employee-costs (upsert)', () => {
  const validBody = {
    employee_id: UUID_E, period: '202604', currency: 'COP', gross_cost: 12000000, notes: null,
  };

  it('rechaza employee_id inválido', async () => {
    const res = await client.call('POST', '/api/employee-costs', { ...validBody, employee_id: 'foo' });
    expect(res.status).toBe(400);
  });
  it('rechaza period inválido', async () => {
    const res = await client.call('POST', '/api/employee-costs', { ...validBody, period: 'foo' });
    expect(res.status).toBe(400);
  });
  it('rechaza currency inválida', async () => {
    const res = await client.call('POST', '/api/employee-costs', { ...validBody, currency: 'BTC' });
    expect(res.status).toBe(400);
  });
  it('rechaza gross_cost negativo', async () => {
    const res = await client.call('POST', '/api/employee-costs', { ...validBody, gross_cost: -100 });
    expect(res.status).toBe(400);
  });
  it('404 si empleado no existe', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/employee-costs', validBody);
    expect(res.status).toBe(404);
  });
  it('rechaza period antes del start_date del empleado', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2026-05-01'), end_date: null, status: 'active' }] });
    const res = await client.call('POST', '/api/employee-costs', { ...validBody, period: '202601' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('period_before_employee_start');
  });

  it('crea costo nuevo en COP con conversión USD', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [] }); // no existing
    queryQueue.push({ rows: [{ usd_rate: 4000 }] }); // FX direct hit
    queryQueue.push({ rows: [{
      id: UUID_C, employee_id: UUID_E, period: '202604', currency: 'COP',
      gross_cost: 12000000, cost_usd: 3000, exchange_rate_used: 4000, locked: false,
    }] });
    const res = await client.call('POST', '/api/employee-costs', validBody);
    expect(res.status).toBe(201);
    expect(res.body.row.cost_usd).toBe(3000);
    expect(res.body.warnings).toEqual([]);
  });

  it('warning fx_fallback_used cuando no hay tasa del período', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [] }); // no existing
    queryQueue.push({ rows: [] }); // FX direct miss
    queryQueue.push({ rows: [{ yyyymm: '202602', usd_rate: 3900 }] }); // fallback
    queryQueue.push({ rows: [{ id: UUID_C, cost_usd: 3076.92 }] });
    const res = await client.call('POST', '/api/employee-costs', validBody);
    expect(res.status).toBe(201);
    expect(res.body.warnings.some((w) => w.code === 'fx_fallback_used')).toBe(true);
  });

  it('warning fx_missing cuando no hay NINGUNA tasa', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] }); // no fallback either
    queryQueue.push({ rows: [{ id: UUID_C, cost_usd: null }] });
    const res = await client.call('POST', '/api/employee-costs', validBody);
    expect(res.status).toBe(201);
    expect(res.body.warnings.some((w) => w.code === 'fx_missing')).toBe(true);
  });

  it('USD: rate 1, cost_usd = gross_cost', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [{ id: UUID_C, cost_usd: 5000 }] });
    const res = await client.call('POST', '/api/employee-costs', { ...validBody, currency: 'USD', gross_cost: 5000 });
    expect(res.status).toBe(201);
  });

  it('upsert: si existe row abierta → update', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [{ id: UUID_C, locked: false, currency: 'COP', gross_cost: 11000000 }] });
    queryQueue.push({ rows: [{ usd_rate: 4000 }] });
    queryQueue.push({ rows: [{ id: UUID_C, cost_usd: 3000 }] });
    const res = await client.call('POST', '/api/employee-costs', validBody);
    expect(res.status).toBe(200);
  });

  it('admin: row existente locked → 403', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [{ id: UUID_C, locked: true, currency: 'COP', gross_cost: 11000000 }] });
    const res = await client.call('POST', '/api/employee-costs', validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('period_locked');
  });

  it('superadmin: row existente locked → puede editar', async () => {
    mockUser = { id: 'u-sa', role: 'superadmin' };
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [{ id: UUID_C, locked: true, currency: 'COP', gross_cost: 11000000 }] });
    queryQueue.push({ rows: [{ usd_rate: 4000 }] });
    queryQueue.push({ rows: [{ id: UUID_C, cost_usd: 3000 }] });
    const res = await client.call('POST', '/api/employee-costs', validBody);
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/employee-costs/:id', () => {
  it('rechaza id no UUID', async () => {
    const res = await client.call('PUT', '/api/employee-costs/foo', {});
    expect(res.status).toBe(400);
  });
  it('404 si no existe', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('PUT', `/api/employee-costs/${UUID_C}`, {});
    expect(res.status).toBe(404);
  });
  it('admin: locked → 403', async () => {
    queryQueue.push({ rows: [{ id: UUID_C, locked: true, currency: 'COP', gross_cost: 1000, cost_usd: 0.25, period: '202604' }] });
    const res = await client.call('PUT', `/api/employee-costs/${UUID_C}`, { gross_cost: 2000 });
    expect(res.status).toBe(403);
  });
  it('actualiza notes sin recalcular FX', async () => {
    queryQueue.push({ rows: [{ id: UUID_C, locked: false, currency: 'COP', gross_cost: 1000, cost_usd: 0.25, exchange_rate_used: 4000, period: '202604', notes: 'old' }] });
    queryQueue.push({ rows: [{ id: UUID_C, notes: 'new' }] });
    const res = await client.call('PUT', `/api/employee-costs/${UUID_C}`, { notes: 'new' });
    expect(res.status).toBe(200);
  });
  it('si cambia gross_cost recalcula FX', async () => {
    queryQueue.push({ rows: [{ id: UUID_C, locked: false, currency: 'COP', gross_cost: 1000, cost_usd: 0.25, exchange_rate_used: 4000, period: '202604' }] });
    queryQueue.push({ rows: [{ usd_rate: 4000 }] }); // FX
    queryQueue.push({ rows: [{ id: UUID_C, cost_usd: 0.5 }] });
    const res = await client.call('PUT', `/api/employee-costs/${UUID_C}`, { gross_cost: 2000 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/employee-costs/:id', () => {
  it('admin abierta → OK', async () => {
    queryQueue.push({ rows: [{ id: UUID_C, locked: false, period: '202604', employee_id: UUID_E }] });
    queryQueue.push({ rows: [] }); // delete
    const res = await client.call('DELETE', `/api/employee-costs/${UUID_C}`);
    expect(res.status).toBe(200);
  });
  it('admin locked → 403', async () => {
    queryQueue.push({ rows: [{ id: UUID_C, locked: true, period: '202604' }] });
    const res = await client.call('DELETE', `/api/employee-costs/${UUID_C}`);
    expect(res.status).toBe(403);
  });
  it('superadmin locked → OK', async () => {
    mockUser = { id: 'u-sa', role: 'superadmin' };
    queryQueue.push({ rows: [{ id: UUID_C, locked: true, period: '202604', employee_id: UUID_E }] });
    queryQueue.push({ rows: [] });
    const res = await client.call('DELETE', `/api/employee-costs/${UUID_C}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/employee-costs/lock/:period y /unlock/:period', () => {
  it('lock por admin', async () => {
    queryQueue.push({ rows: [{ id: UUID_C }, { id: 'c2' }] });
    const res = await client.call('POST', '/api/employee-costs/lock/202604');
    expect(res.status).toBe(200);
    expect(res.body.locked_count).toBe(2);
  });
  it('unlock requiere superadmin', async () => {
    const res = await client.call('POST', '/api/employee-costs/unlock/202604');
    expect(res.status).toBe(403);
  });
  it('unlock OK con superadmin', async () => {
    mockUser = { id: 'u-sa', role: 'superadmin' };
    queryQueue.push({ rows: [{ id: UUID_C }] });
    const res = await client.call('POST', '/api/employee-costs/unlock/202604');
    expect(res.status).toBe(200);
    expect(res.body.unlocked_count).toBe(1);
  });
  it('rechaza period inválido', async () => {
    const res = await client.call('POST', '/api/employee-costs/lock/foo');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/employee-costs/bulk/preview', () => {
  it('rechaza period inválido', async () => {
    const res = await client.call('POST', '/api/employee-costs/bulk/preview', { period: 'foo', items: [] });
    expect(res.status).toBe(400);
  });
  it('rechaza items > 5000', async () => {
    const items = Array(5001).fill({ employee_id: UUID_E, currency: 'USD', gross_cost: 1000 });
    const res = await client.call('POST', '/api/employee-costs/bulk/preview', { period: '202604', items });
    expect(res.status).toBe(413);
  });
  it('preview agrupa errores y warnings', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [] }); // no existing
    queryQueue.push({ rows: [] }); // no FX rows
    const res = await client.call('POST', '/api/employee-costs/bulk/preview', {
      period: '202604',
      items: [
        { employee_id: UUID_E, currency: 'USD', gross_cost: 5000 },           // OK
        { employee_id: 'foo', currency: 'USD', gross_cost: 1000 },            // employee_id_invalid
        { employee_id: UUID_E2, currency: 'USD', gross_cost: 1000 },          // employee_not_found
        { employee_id: UUID_E, currency: 'BTC', gross_cost: 1000 },           // currency_invalid
        { employee_id: UUID_E, currency: 'USD', gross_cost: -1 },             // gross_cost_invalid
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied.length).toBe(1);
    expect(res.body.applied[0].action).toBe('would_create');
    expect(res.body.errors.length).toBeGreaterThanOrEqual(4);
    const codes = new Set(res.body.errors.map((e) => e.code));
    expect(codes.has('employee_id_invalid')).toBe(true);
    expect(codes.has('employee_not_found')).toBe(true);
    expect(codes.has('currency_invalid')).toBe(true);
    expect(codes.has('gross_cost_invalid')).toBe(true);
  });
});

describe('POST /api/employee-costs/bulk/commit', () => {
  it('si hay errores → rollback completo (atomicidad)', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' }] });
    queryQueue.push({ rows: [] });
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/employee-costs/bulk/commit', {
      period: '202604',
      items: [
        { employee_id: UUID_E, currency: 'USD', gross_cost: 5000 },
        { employee_id: UUID_E, currency: 'BTC', gross_cost: 1000 }, // mata todo
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ningún cambio/i);
  });
  it('todo válido → applied con created/updated', async () => {
    queryQueue.push({ rows: [
      { id: UUID_E,  start_date: new Date('2025-01-01'), end_date: null, status: 'active' },
      { id: UUID_E2, start_date: new Date('2025-01-01'), end_date: null, status: 'active' },
    ]});
    queryQueue.push({ rows: [{ id: 'c-existing', employee_id: UUID_E2, locked: false }] }); // E2 ya tiene
    // (USD only — no FX query)
    // Items en orden: UUID_E (insert), UUID_E2 (update)
    queryQueue.push({ rows: [{ id: 'c-new' }] }); // INSERT (UUID_E)
    queryQueue.push({ rows: [] }); // UPDATE (UUID_E2)
    const res = await client.call('POST', '/api/employee-costs/bulk/commit', {
      period: '202604',
      items: [
        { employee_id: UUID_E, currency: 'USD', gross_cost: 4000 },
        { employee_id: UUID_E2, currency: 'USD', gross_cost: 5000 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied.length).toBe(2);
    expect(res.body.applied.find((a) => a.employee_id === UUID_E).action).toBe('created');
    expect(res.body.applied.find((a) => a.employee_id === UUID_E2).action).toBe('updated');
  });
});

describe('POST /api/employee-costs/copy-from-previous', () => {
  it('copia rows del mes anterior, skip empleados ya en el nuevo', async () => {
    queryQueue.push({ rows: [{ id: UUID_E }, { id: UUID_E2 }] }); // active emps en el nuevo período
    queryQueue.push({ rows: [
      { employee_id: UUID_E,  currency: 'USD', gross_cost: 5000, notes: null },
      { employee_id: UUID_E2, currency: 'USD', gross_cost: 4000, notes: 'foo' },
    ]}); // prev costs
    queryQueue.push({ rows: [{ employee_id: UUID_E2 }] }); // already in new period
    // FX query no se ejecuta porque ambos son USD
    queryQueue.push({ rows: [] }); // INSERT (sólo UUID_E)
    const res = await client.call('POST', '/api/employee-costs/copy-from-previous', { period: '202604' });
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.from_period).toBe('202603');
    expect(res.body.to_period).toBe('202604');
  });
});

describe('POST /api/employee-costs/recalculate-usd/:period', () => {
  it('rechaza period inválido', async () => {
    const res = await client.call('POST', '/api/employee-costs/recalculate-usd/foo');
    expect(res.status).toBe(400);
  });
  it('recalcula y respeta locked', async () => {
    queryQueue.push({ rows: [
      { id: 'c1', currency: 'COP', gross_cost: 4000000, cost_usd: 1000, exchange_rate_used: 4000, locked: false },
      { id: 'c2', currency: 'USD', gross_cost: 5000, cost_usd: 5000, exchange_rate_used: 1, locked: false },
    ]});
    queryQueue.push({ rows: [{ yyyymm: '202604', currency: 'COP', usd_rate: 4200 }] });
    queryQueue.push({ rows: [] }); // UPDATE c1 (rate cambió)
    // c2 es USD: no cambia, no UPDATE
    const res = await client.call('POST', '/api/employee-costs/recalculate-usd/202604');
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.unchanged).toBe(1);
  });
});

describe('POST /api/employee-costs/project-to-future', () => {
  it('rechaza months_ahead fuera de rango', async () => {
    let res = await client.call('POST', '/api/employee-costs/project-to-future', { months_ahead: 0 });
    expect(res.status).toBe(400);
    res = await client.call('POST', '/api/employee-costs/project-to-future', { months_ahead: 13 });
    expect(res.status).toBe(400);
    res = await client.call('POST', '/api/employee-costs/project-to-future', { months_ahead: 'foo' });
    expect(res.status).toBe(400);
  });

  it('rechaza growth_pct fuera de rango', async () => {
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      months_ahead: 3, growth_pct: 500,
    });
    expect(res.status).toBe(400);
  });

  it('400 con code:no_base_period si la DB está vacía y no se manda base', async () => {
    queryQueue.push({ rows: [] }); // SELECT period DESC LIMIT 1
    const res = await client.call('POST', '/api/employee-costs/project-to-future', { months_ahead: 3 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_base_period');
  });

  it('400 con code:base_period_empty si el base elegido no tiene rows', async () => {
    queryQueue.push({ rows: [] }); // baseCosts vacío para 202602
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      base_period: '202602', months_ahead: 3,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('base_period_empty');
  });

  it('dry_run no escribe — devuelve preview', async () => {
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202604', currency: 'USD', gross_cost: 5000, cost_usd: 5000, exchange_rate_used: 1, locked: false, source: 'manual' },
    ] }); // baseCosts
    queryQueue.push({ rows: [
      { id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' },
    ] }); // emps
    queryQueue.push({ rows: [] }); // existingFuture
    // No FX query (USD only).
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      base_period: '202604', months_ahead: 3, dry_run: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.target_periods).toEqual(['202605', '202606', '202607']);
    expect(res.body.would_create).toBe(3);
    expect(res.body.created).toBe(0); // dry-run: no escribió
    expect(res.body.details).toHaveLength(3);
    // Sin growth: gross debe ser idéntico al base.
    res.body.details.forEach((d) => {
      expect(d.gross_cost).toBe(5000);
    });
  });

  it('aplica growth_pct anual repartido mensualmente', async () => {
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202604', currency: 'USD', gross_cost: 1000, cost_usd: 1000, exchange_rate_used: 1, locked: false, source: 'manual' },
    ] });
    queryQueue.push({ rows: [
      { id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' },
    ] });
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      base_period: '202604', months_ahead: 12, growth_pct: 12, dry_run: true,
    });
    expect(res.status).toBe(200);
    // Mes 12 (período 202704): 1000 * 1.12 ≈ 1120 (con +12%/año split mensual).
    const lastMonth = res.body.details[res.body.details.length - 1];
    expect(lastMonth.gross_cost).toBeGreaterThan(1115);
    expect(lastMonth.gross_cost).toBeLessThan(1125);
    // Mes 1 (período 202605): apenas 1% sobre base.
    const firstMonth = res.body.details.find((d) => d.period === '202605');
    expect(firstMonth.gross_cost).toBeGreaterThan(1009);
    expect(firstMonth.gross_cost).toBeLessThan(1011);
  });

  it('NO sobreescribe rows con source != projected (manual override gana)', async () => {
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202604', currency: 'USD', gross_cost: 1000, cost_usd: 1000, exchange_rate_used: 1, locked: false, source: 'manual' },
    ] });
    queryQueue.push({ rows: [
      { id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' },
    ] });
    // Existing future: ya hay un row 'manual' en 202605.
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202605', locked: false, source: 'manual' },
    ] });
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      base_period: '202604', months_ahead: 3, dry_run: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.skipped_existing).toBe(1);
    expect(res.body.would_create).toBe(2); // sólo 2 períodos (202606, 202607)
  });

  it('NO toca rows locked (incluso si source=projected)', async () => {
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202604', currency: 'USD', gross_cost: 1000, cost_usd: 1000, exchange_rate_used: 1, locked: false, source: 'manual' },
    ] });
    queryQueue.push({ rows: [
      { id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' },
    ] });
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202605', locked: true, source: 'projected' },
    ] });
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      base_period: '202604', months_ahead: 3, dry_run: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.skipped_locked).toBe(1);
    expect(res.body.would_create).toBe(2);
  });

  it('SI sobreescribe rows con source=projected si no están locked (idempotente)', async () => {
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202604', currency: 'USD', gross_cost: 1000, cost_usd: 1000, exchange_rate_used: 1, locked: false, source: 'manual' },
    ] });
    queryQueue.push({ rows: [
      { id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' },
    ] });
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202605', locked: false, source: 'projected' },
    ] });
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      base_period: '202604', months_ahead: 3, dry_run: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.would_update).toBe(1); // 202605
    expect(res.body.would_create).toBe(2); // 202606, 202607
  });

  it('skip empleados terminados antes del período destino', async () => {
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202604', currency: 'USD', gross_cost: 1000, cost_usd: 1000, exchange_rate_used: 1, locked: false, source: 'manual' },
    ] });
    queryQueue.push({ rows: [
      // empleado terminado en mayo: 202605 OK, 202606+ inactivo.
      { id: UUID_E, start_date: new Date('2025-01-01'), end_date: new Date('2026-05-15'), status: 'terminated' },
    ] });
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      base_period: '202604', months_ahead: 4, dry_run: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.would_create).toBe(1); // sólo 202605
    expect(res.body.skipped_inactive).toBe(3); // 202606, 202607, 202608
  });

  it('commit real (no dry-run) ejecuta INSERTs/UPDATEs', async () => {
    queryQueue.push({ rows: [
      { employee_id: UUID_E, period: '202604', currency: 'USD', gross_cost: 5000, cost_usd: 5000, exchange_rate_used: 1, locked: false, source: 'manual' },
    ] });
    queryQueue.push({ rows: [
      { id: UUID_E, start_date: new Date('2025-01-01'), end_date: null, status: 'active' },
    ] });
    queryQueue.push({ rows: [] });
    // Sin FX.
    // 2 INSERTs (no enqueue results para INSERT-without-RETURNING; las control queries son ignored).
    queryQueue.push({ rows: [] }); // INSERT 202605
    queryQueue.push({ rows: [] }); // INSERT 202606
    const res = await client.call('POST', '/api/employee-costs/project-to-future', {
      base_period: '202604', months_ahead: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.updated).toBe(0);
    expect(res.body.dry_run).toBe(false);
  });
});

describe('GET /api/employee-costs/employee/:employeeId', () => {
  it('rechaza employeeId no UUID', async () => {
    const res = await client.call('GET', '/api/employee-costs/employee/foo');
    expect(res.status).toBe(400);
  });
  it('404 si empleado no existe', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', `/api/employee-costs/employee/${UUID_E}`);
    expect(res.status).toBe(404);
  });
  it('200 con history ordenado DESC', async () => {
    queryQueue.push({ rows: [{ id: UUID_E, first_name: 'Ana', last_name: 'G', level: 'L4' }] });
    queryQueue.push({ rows: [
      { period: '202604', cost_usd: 3000 },
      { period: '202603', cost_usd: 2900 },
    ]});
    const res = await client.call('GET', `/api/employee-costs/employee/${UUID_E}`);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(2);
    expect(res.body.employee.first_name).toBe('Ana');
  });
});
