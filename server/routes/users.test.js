/**
 * Unit tests for server/routes/users.js (V2 role model).
 *
 * Validates:
 *  – GET /  returns users with function field
 *  – POST / validates V2 roles (rejects 'preventa', accepts 'member'/'lead'/'viewer'/'admin')
 *  – POST / saves function field
 *  – PUT /:id validates V2 roles
 *  – DELETE /:id does soft-delete
 *  – POST /:id/reset-password resets password
 */

const queryQueue = [];
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
  return { query: jest.fn(async (sql, params) => pushAndPop(sql, params)) };
});

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => '$2a$12$hashedpassword'),
}));

let mockCurrentUser = { id: 'u-admin', role: 'admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
}));

const express = require('express');
const http = require('http');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', require('./users'));
  return app;
}

function req(app) {
  return {
    async call(method, url, body = null) {
      return new Promise((resolve, reject) => {
        const srv = http.createServer(app).listen(0, () => {
          const { port } = srv.address();
          const data = body ? Buffer.from(JSON.stringify(body)) : null;
          const options = {
            hostname: '127.0.0.1', port, path: url, method,
            headers: {
              'Content-Type': 'application/json',
              ...(data ? { 'Content-Length': data.length } : {}),
            },
          };
          const r = http.request(options, (res) => {
            let raw = '';
            res.on('data', c => (raw += c));
            res.on('end', () => {
              srv.close();
              resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
            });
          });
          r.on('error', reject);
          if (data) r.write(data);
          r.end();
        });
      });
    },
  };
}

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u-admin', role: 'admin' };
});

/* ── GET / ──────────────────────────────────────────────────────── */
describe('GET /', () => {
  it('returns user list with function field', async () => {
    queryQueue.push({
      rows: [
        { id: 'u1', email: 'a@x.com', name: 'Ana', role: 'member', function: 'comercial', active: true, must_change_password: false, created_at: new Date().toISOString() },
      ],
    });
    const res = await req(makeApp()).call('GET', '/');
    expect(res.status).toBe(200);
    expect(res.body[0].function).toBe('comercial');
    expect(res.body[0].role).toBe('member');
  });
});

/* ── POST / ─────────────────────────────────────────────────────── */
describe('POST /', () => {
  it('rejects legacy role "preventa"', async () => {
    const res = await req(makeApp()).call('POST', '/', { email: 'x@x.com', name: 'X', role: 'preventa' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Rol inválido/);
  });

  it('rejects role "superadmin" from an admin user', async () => {
    const res = await req(makeApp()).call('POST', '/', { email: 'x@x.com', name: 'X', role: 'superadmin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Rol inválido/);
  });

  it('creates a member user with function=comercial', async () => {
    queryQueue.push({
      rows: [{ id: 'u2', email: 'b@x.com', name: 'B', role: 'member', function: 'comercial', active: true, must_change_password: true, created_at: new Date().toISOString() }],
    });
    queryQueue.push({ rows: [] }); // audit log

    const res = await req(makeApp()).call('POST', '/', {
      email: 'b@x.com', name: 'B', role: 'member', function: 'comercial',
    });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('member');
    expect(res.body.function).toBe('comercial');
  });

  it('rejects invalid function value', async () => {
    const res = await req(makeApp()).call('POST', '/', { email: 'x@x.com', name: 'X', role: 'member', function: 'hacker' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Función inválida/);
  });

  it('returns 409 for duplicate email', async () => {
    const pgError = Object.assign(new Error('dup'), { code: '23505' });
    queryQueue.push(pgError);
    const res = await req(makeApp()).call('POST', '/', { email: 'dup@x.com', name: 'Dup', role: 'viewer' });
    expect(res.status).toBe(409);
  });

  it('blocks admin creation by non-superadmin', async () => {
    mockCurrentUser = { id: 'u-admin', role: 'admin' };
    const res = await req(makeApp()).call('POST', '/', { email: 'z@x.com', name: 'Z', role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('allows admin creation by superadmin', async () => {
    mockCurrentUser = { id: 'u-super', role: 'superadmin' };
    queryQueue.push({
      rows: [{ id: 'u3', email: 'adm@x.com', name: 'Adm', role: 'admin', function: 'admin', active: true, must_change_password: true, created_at: new Date().toISOString() }],
    });
    queryQueue.push({ rows: [] }); // audit

    const res = await req(makeApp()).call('POST', '/', { email: 'adm@x.com', name: 'Adm', role: 'admin', function: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('admin');
  });
});

/* ── PUT /:id ───────────────────────────────────────────────────── */
describe('PUT /:id', () => {
  it('rejects V1 role "preventa" on update', async () => {
    mockCurrentUser = { id: 'u-super', role: 'superadmin' };
    // target lookup
    queryQueue.push({ rows: [{ id: 'u1', role: 'member' }] });
    const res = await req(makeApp()).call('PUT', '/u1', { role: 'preventa' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Rol inválido/);
  });

  it('changes role when superadmin', async () => {
    mockCurrentUser = { id: 'u-super', role: 'superadmin' };
    queryQueue.push({ rows: [{ id: 'u1', role: 'member' }] }); // target
    queryQueue.push({ rows: [{ id: 'u1', email: 'b@x.com', name: 'B', role: 'lead', function: null, active: true }] }); // update
    queryQueue.push({ rows: [] }); // audit

    const res = await req(makeApp()).call('PUT', '/u1', { role: 'lead' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('lead');
  });
});

/* ── DELETE /:id ────────────────────────────────────────────────── */
describe('DELETE /:id', () => {
  it('returns 403 for non-superadmin', async () => {
    mockCurrentUser = { id: 'u-admin', role: 'admin' };
    const res = await req(makeApp()).call('DELETE', '/u1');
    expect(res.status).toBe(403);
  });

  it('soft-deletes user with no quotations', async () => {
    mockCurrentUser = { id: 'u-super', role: 'superadmin' };
    queryQueue.push({ rows: [{ id: 'u1', email: 'x@x.com', role: 'member' }] }); // target
    queryQueue.push({ rows: [{ count: 0 }] }); // quotation count
    queryQueue.push({ rows: [] }); // soft-delete UPDATE
    queryQueue.push({ rows: [] }); // audit

    const res = await req(makeApp()).call('DELETE', '/u1');
    expect(res.status).toBe(200);
    // Confirm soft-delete (UPDATE … deleted_at) was issued, not a hard DELETE
    const deleteQuery = issuedQueries.find(q => q.sql.includes('deleted_at'));
    expect(deleteQuery).toBeDefined();
  });

  it('returns 409 when user has quotations', async () => {
    mockCurrentUser = { id: 'u-super', role: 'superadmin' };
    queryQueue.push({ rows: [{ id: 'u1', email: 'x@x.com', role: 'member' }] });
    queryQueue.push({ rows: [{ count: 3 }] }); // has quotations

    const res = await req(makeApp()).call('DELETE', '/u1');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cotización/);
  });
});

/* ── POST /:id/reset-password ───────────────────────────────────── */
describe('POST /:id/reset-password', () => {
  it('resets password and marks must_change_password', async () => {
    queryQueue.push({ rows: [] });
    const res = await req(makeApp()).call('POST', '/u1/reset-password');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Contraseña reseteada/);
    const q = issuedQueries[0];
    expect(q.sql).toMatch(/must_change_password=true/);
  });
});
