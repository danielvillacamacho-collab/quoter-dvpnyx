/**
 * Tests para /api/ai-interactions.
 */
const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (!queryQueue.length) throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
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

let mockUser = { id: 'u-admin', role: 'admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockUser }; next(); },
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
const router = require('./ai_interactions');

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

const app = express(); app.use(express.json()); app.use('/api/ai-interactions', router);
const client = request(app);
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockUser = { id: 'u-admin', role: 'admin' };
});

describe('GET /api/ai-interactions', () => {
  it('member recibe 403', async () => {
    mockUser = { id: 'u-mem', role: 'member' };
    const res = await client.call('GET', '/api/ai-interactions');
    expect(res.status).toBe(403);
  });

  it('admin obtiene listado paginado', async () => {
    queryQueue.push({ rows: [{ total: 2 }] });
    queryQueue.push({ rows: [
      { id: 'i1', agent_name: 'claude-4.5', prompt_template: 't1', created_at: new Date() },
      { id: 'i2', agent_name: 'gpt-4o',     prompt_template: 't2', created_at: new Date() },
    ]});
    const res = await client.call('GET', '/api/ai-interactions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it('filtra por human_decision=pending → IS NULL', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/ai-interactions?human_decision=pending');
    const dataQuery = issuedQueries.find((q) => q.sql.includes('FROM ai_interactions') && q.sql.includes('LIMIT'));
    expect(dataQuery.sql).toMatch(/human_decision IS NULL/);
  });

  it('rechaza user_id no-UUID', async () => {
    const res = await client.call('GET', '/api/ai-interactions?user_id=foo');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/ai-interactions/:id', () => {
  it('rechaza id no-UUID', async () => {
    const res = await client.call('GET', '/api/ai-interactions/not-uuid');
    expect(res.status).toBe(400);
  });
  it('404 si no existe', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', `/api/ai-interactions/${VALID_UUID}`);
    expect(res.status).toBe(404);
  });
  it('200 con detalle completo', async () => {
    queryQueue.push({ rows: [{ id: VALID_UUID, agent_name: 'x', input_payload: { foo: 1 } }] });
    const res = await client.call('GET', `/api/ai-interactions/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.input_payload).toEqual({ foo: 1 });
  });
});

describe('POST /api/ai-interactions/:id/decision', () => {
  it('rechaza decision inválida', async () => {
    const res = await client.call('POST', `/api/ai-interactions/${VALID_UUID}/decision`, { decision: 'foo' });
    expect(res.status).toBe(400);
  });

  it('admin puede registrar decisión sobre interacción de otro usuario', async () => {
    queryQueue.push({ rows: [{ user_id: 'u-other', human_decision: null }] });
    queryQueue.push({ rows: [{ id: VALID_UUID, human_decision: 'accepted' }] });
    const res = await client.call('POST', `/api/ai-interactions/${VALID_UUID}/decision`, { decision: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.human_decision).toBe('accepted');
  });

  it('member NO puede modificar decisión de otro usuario', async () => {
    mockUser = { id: 'u-mem', role: 'member' };
    queryQueue.push({ rows: [{ user_id: 'u-other', human_decision: null }] });
    const res = await client.call('POST', `/api/ai-interactions/${VALID_UUID}/decision`, { decision: 'accepted' });
    expect(res.status).toBe(403);
  });

  it('member SÍ puede modificar la propia', async () => {
    mockUser = { id: 'u-self', role: 'member' };
    queryQueue.push({ rows: [{ user_id: 'u-self', human_decision: null }] });
    queryQueue.push({ rows: [{ id: VALID_UUID, human_decision: 'rejected' }] });
    const res = await client.call('POST', `/api/ai-interactions/${VALID_UUID}/decision`, { decision: 'rejected' });
    expect(res.status).toBe(200);
  });

  it('409 si ya hay decisión registrada', async () => {
    queryQueue.push({ rows: [{ user_id: 'u-admin', human_decision: 'accepted' }] });
    const res = await client.call('POST', `/api/ai-interactions/${VALID_UUID}/decision`, { decision: 'modified' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_decided');
  });

  it('404 si no existe', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', `/api/ai-interactions/${VALID_UUID}/decision`, { decision: 'accepted' });
    expect(res.status).toBe(404);
  });
});
