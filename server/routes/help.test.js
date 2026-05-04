/**
 * routes/help.test.js — Manual de usuario vivo
 *
 * Patrón: misma arquitectura que areas.test.js (queryQueue + http harness sin supertest).
 *
 * @docs-required: ayuda-bienvenida
 */

const queryQueue    = [];
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

let mockCurrentUser = { id: 'u1', role: 'member' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Rol insuficiente' });
    next();
  },
}));

const express    = require('express');
const helpRouter = require('./help');

// ─── HTTP harness (sin supertest) ────────────────────────────────────────────

const makeClient = (app) => {
  const http = require('http');
  return {
    async call(method, url, body = null) {
      return new Promise((resolve, reject) => {
        const srv = http.createServer(app).listen(0, () => {
          const { port } = srv.address();
          const data     = body ? Buffer.from(JSON.stringify(body)) : null;
          const req      = http.request(
            {
              host: '127.0.0.1', port, path: url, method,
              headers: {
                'content-type':   'application/json',
                'content-length': data ? data.length : 0,
                authorization:    'Bearer fake',
              },
            },
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

const app = express();
app.use(express.json());
app.use('/api/help', helpRouter);
const client = makeClient(app);

beforeEach(() => {
  queryQueue.length    = 0;
  issuedQueries.length = 0;
  mockCurrentUser      = { id: 'u1', role: 'member' };
});

// ─── Sample fixture ───────────────────────────────────────────────────────────

const ART = {
  id:           'art-1',
  slug:         'ayuda-bienvenida',
  category:     'general',
  sort_order:   1,
  title:        'Bienvenida al Quoter',
  body_md:      '# Hola\nContenido.',
  is_published: true,
  created_at:   '2026-05-01T00:00:00Z',
  updated_at:   '2026-05-01T00:00:00Z',
  updated_by:   null,
};

// ─── GET /api/help ────────────────────────────────────────────────────────────

describe('GET /api/help', () => {
  it('returns published articles grouped by category', async () => {
    queryQueue.push({ rows: [ART] });
    const { status, body } = await client.call('GET', '/api/help');
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.byCategory.general).toHaveLength(1);
  });

  it('admin sees all articles (no WHERE filter)', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const draft = { ...ART, slug: 'borrador', is_published: false };
    queryQueue.push({ rows: [ART, draft] });
    const { status, body } = await client.call('GET', '/api/help');
    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
  });

  it('returns 500 on DB error', async () => {
    queryQueue.push(new Error('DB down'));
    const { status } = await client.call('GET', '/api/help');
    expect(status).toBe(500);
  });
});

// ─── GET /api/help/:slug ──────────────────────────────────────────────────────

describe('GET /api/help/:slug', () => {
  it('returns the article when found', async () => {
    queryQueue.push({ rows: [{ ...ART, updated_by_name: null }] });
    const { status, body } = await client.call('GET', '/api/help/ayuda-bienvenida');
    expect(status).toBe(200);
    expect(body.slug).toBe('ayuda-bienvenida');
  });

  it('returns 404 when article not found', async () => {
    queryQueue.push({ rows: [] });
    const { status } = await client.call('GET', '/api/help/no-existe');
    expect(status).toBe(404);
  });

  it('returns 500 on DB error', async () => {
    queryQueue.push(new Error('fail'));
    const { status } = await client.call('GET', '/api/help/ayuda-bienvenida');
    expect(status).toBe(500);
  });
});

// ─── POST /api/help ───────────────────────────────────────────────────────────

const VALID_POST = { slug: 'nuevo-articulo', title: 'Nuevo', category: 'crm', body_md: '# Hola', is_published: false };

describe('POST /api/help', () => {
  it('creates article when admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ ...ART, slug: 'nuevo-articulo' }] });
    const { status, body } = await client.call('POST', '/api/help', VALID_POST);
    expect(status).toBe(201);
    expect(body.slug).toBe('nuevo-articulo');
  });

  it('returns 403 for non-admin', async () => {
    const { status } = await client.call('POST', '/api/help', VALID_POST);
    expect(status).toBe(403);
  });

  it('returns 400 for invalid slug (uppercase)', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const { status, body } = await client.call('POST', '/api/help', { ...VALID_POST, slug: 'INVALID SLUG' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/slug/);
  });

  it('returns 400 when title is empty', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const { status } = await client.call('POST', '/api/help', { ...VALID_POST, title: '' });
    expect(status).toBe(400);
  });

  it('returns 400 for invalid category', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const { status } = await client.call('POST', '/api/help', { ...VALID_POST, category: 'inexistente' });
    expect(status).toBe(400);
  });

  it('returns 409 on duplicate slug', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const dupErr = Object.assign(new Error('dup'), { code: '23505' });
    queryQueue.push(dupErr);
    const { status } = await client.call('POST', '/api/help', VALID_POST);
    expect(status).toBe(409);
  });
});

// ─── PUT /api/help/:slug ──────────────────────────────────────────────────────

describe('PUT /api/help/:slug', () => {
  it('updates title when admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [{ ...ART, title: 'Actualizado' }] });
    const { status, body } = await client.call('PUT', '/api/help/ayuda-bienvenida', { title: 'Actualizado' });
    expect(status).toBe(200);
    expect(body.title).toBe('Actualizado');
  });

  it('returns 403 for viewer', async () => {
    mockCurrentUser = { id: 'u1', role: 'viewer' };
    const { status } = await client.call('PUT', '/api/help/ayuda-bienvenida', { title: 'X' });
    expect(status).toBe(403);
  });

  it('returns 400 when nothing to update', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const { status } = await client.call('PUT', '/api/help/ayuda-bienvenida', {});
    expect(status).toBe(400);
  });

  it('returns 400 for invalid new_slug', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const { status } = await client.call('PUT', '/api/help/ayuda-bienvenida', { new_slug: 'INVALID SLUG!' });
    expect(status).toBe(400);
  });

  it('returns 404 when article not found', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rows: [] });
    const { status } = await client.call('PUT', '/api/help/no-existe', { title: 'Artículo actualizado' });
    expect(status).toBe(404);
  });

  it('returns 409 on slug conflict', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    const dupErr = Object.assign(new Error('dup'), { code: '23505' });
    queryQueue.push(dupErr);
    const { status } = await client.call('PUT', '/api/help/ayuda-bienvenida', { new_slug: 'crm-alertas' });
    expect(status).toBe(409);
  });
});

// ─── DELETE /api/help/:slug ───────────────────────────────────────────────────

describe('DELETE /api/help/:slug', () => {
  it('deletes the article when admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rowCount: 1 });
    const { status, body } = await client.call('DELETE', '/api/help/ayuda-bienvenida');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    const { status } = await client.call('DELETE', '/api/help/ayuda-bienvenida');
    expect(status).toBe(403);
  });

  it('returns 404 when article not found', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push({ rowCount: 0 });
    const { status } = await client.call('DELETE', '/api/help/no-existe');
    expect(status).toBe(404);
  });

  it('returns 500 on DB error', async () => {
    mockCurrentUser = { id: 'u1', role: 'admin' };
    queryQueue.push(new Error('fail'));
    const { status } = await client.call('DELETE', '/api/help/ayuda-bienvenida');
    expect(status).toBe(500);
  });
});
