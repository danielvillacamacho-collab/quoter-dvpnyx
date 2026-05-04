/**
 * routes/help.test.js — Manual de usuario vivo
 *
 * @docs-required: ayuda-bienvenida
 */

const request = require('supertest');
const app = require('../index');

// ─── Shared mocks ────────────────────────────────────────────────────────────

jest.mock('../database/pool', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  auth:        (req, res, next) => { req.user = { id: 'user-1', role: req.headers['x-role'] || 'member' }; next(); },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const pool = require('../database/pool');

beforeEach(() => jest.clearAllMocks());

// ─── Sample article fixture ───────────────────────────────────────────────────

const ARTICLE = {
  id:          'art-1',
  slug:        'ayuda-bienvenida',
  category:    'general',
  sort_order:  1,
  title:       'Bienvenida al Quoter',
  body_md:     '# Hola\nContenido.',
  is_published: true,
  created_at:  '2026-05-01T00:00:00Z',
  updated_at:  '2026-05-01T00:00:00Z',
  updated_by:  null,
};

// ─── GET /api/help ────────────────────────────────────────────────────────────

describe('GET /api/help', () => {
  it('returns published articles grouped by category for regular users', async () => {
    pool.query.mockResolvedValueOnce({ rows: [ARTICLE] });

    const res = await request(app).get('/api/help').set('x-role', 'member');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.byCategory.general).toHaveLength(1);
  });

  it('returns all articles (including drafts) for admins', async () => {
    const draft = { ...ARTICLE, slug: 'borrador', is_published: false };
    pool.query.mockResolvedValueOnce({ rows: [ARTICLE, draft] });

    const res = await request(app).get('/api/help').set('x-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 500 on DB error', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app).get('/api/help').set('x-role', 'member');
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/help/:slug ──────────────────────────────────────────────────────

describe('GET /api/help/:slug', () => {
  it('returns the article when found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...ARTICLE, updated_by_name: null }] });
    const res = await request(app).get('/api/help/ayuda-bienvenida').set('x-role', 'member');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('ayuda-bienvenida');
  });

  it('returns 404 when article is not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/help/no-existe').set('x-role', 'member');
    expect(res.status).toBe(404);
  });

  it('returns 500 on DB error', async () => {
    pool.query.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/help/ayuda-bienvenida').set('x-role', 'member');
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/help ───────────────────────────────────────────────────────────

describe('POST /api/help', () => {
  const validBody = { slug: 'nuevo-articulo', title: 'Nuevo', category: 'crm', body_md: '# Hola', is_published: false };

  it('creates an article when admin', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...ARTICLE, slug: 'nuevo-articulo' }] });
    const res = await request(app).post('/api/help').set('x-role', 'admin').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('nuevo-articulo');
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).post('/api/help').set('x-role', 'member').send(validBody);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid slug', async () => {
    const res = await request(app).post('/api/help').set('x-role', 'admin').send({ ...validBody, slug: 'INVALID SLUG' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slug/);
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/help').set('x-role', 'admin').send({ ...validBody, title: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when category is invalid', async () => {
    const res = await request(app).post('/api/help').set('x-role', 'admin').send({ ...validBody, category: 'inexistente' });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate slug', async () => {
    const dupErr = new Error('duplicate'); dupErr.code = '23505';
    pool.query.mockRejectedValueOnce(dupErr);
    const res = await request(app).post('/api/help').set('x-role', 'admin').send(validBody);
    expect(res.status).toBe(409);
  });
});

// ─── PUT /api/help/:slug ──────────────────────────────────────────────────────

describe('PUT /api/help/:slug', () => {
  it('updates the article when admin', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...ARTICLE, title: 'Actualizado' }] });
    const res = await request(app).put('/api/help/ayuda-bienvenida').set('x-role', 'admin').send({ title: 'Actualizado' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Actualizado');
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).put('/api/help/ayuda-bienvenida').set('x-role', 'viewer').send({ title: 'X' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when nothing to update', async () => {
    const res = await request(app).put('/api/help/ayuda-bienvenida').set('x-role', 'admin').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid new_slug', async () => {
    const res = await request(app).put('/api/help/ayuda-bienvenida').set('x-role', 'admin').send({ new_slug: 'INVALID SLUG!' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when article not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/api/help/no-existe').set('x-role', 'admin').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 409 on slug conflict', async () => {
    const dupErr = new Error('dup'); dupErr.code = '23505';
    pool.query.mockRejectedValueOnce(dupErr);
    const res = await request(app).put('/api/help/ayuda-bienvenida').set('x-role', 'admin').send({ new_slug: 'crm-alertas' });
    expect(res.status).toBe(409);
  });
});

// ─── DELETE /api/help/:slug ───────────────────────────────────────────────────

describe('DELETE /api/help/:slug', () => {
  it('deletes the article when admin', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete('/api/help/ayuda-bienvenida').set('x-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).delete('/api/help/ayuda-bienvenida').set('x-role', 'member');
    expect(res.status).toBe(403);
  });

  it('returns 404 when article not found', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete('/api/help/no-existe').set('x-role', 'admin');
    expect(res.status).toBe(404);
  });

  it('returns 500 on DB error', async () => {
    pool.query.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).delete('/api/help/ayuda-bienvenida').set('x-role', 'admin');
    expect(res.status).toBe(500);
  });
});
