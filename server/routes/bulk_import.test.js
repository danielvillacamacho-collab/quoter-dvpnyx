/**
 * End-to-end-ish test for the /api/bulk-import router.
 *
 * We mock the pool (so nothing hits Postgres), the auth middleware
 * (to inject a fake admin user), and the runBulkImport runner itself
 * (to assert routing without re-testing the validator).
 *
 * A tiny raw http driver stands in for supertest to keep zero deps.
 */

let mockCurrentUser = { id: 'u1', role: 'admin', function: 'admin' };

jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockCurrentUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Acceso solo para administradores' });
    }
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

jest.mock('../database/pool', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../utils/bulk_import', () => {
  const actual = jest.requireActual('../utils/bulk_import');
  return {
    ...actual,
    runBulkImport: jest.fn(),
  };
});

const express = require('express');
const http = require('http');
const router = require('./bulk_import');
const { runBulkImport } = require('../utils/bulk_import');

const app = express();
app.use(express.json());
app.use('/api/bulk-import', router);

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app).listen(0, () => {
      const { port } = srv.address();
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = http.request(
        {
          host: '127.0.0.1', port, path, method,
          headers: {
            'content-type': 'application/json',
            'content-length': data ? data.length : 0,
            authorization: 'Bearer fake',
          },
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            srv.close();
            let parsed = null;
            try { parsed = buf ? JSON.parse(buf) : null; } catch { parsed = buf; }
            resolve({ status: res.statusCode, body: parsed, raw: buf, headers: res.headers });
          });
        },
      );
      req.on('error', (e) => { srv.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockCurrentUser = { id: 'u1', role: 'admin', function: 'admin' };
});

describe('GET /api/bulk-import/entities', () => {
  it('returns the list of supported entities', async () => {
    const res = await call('GET', '/api/bulk-import/entities');
    expect(res.status).toBe(200);
    expect(res.body.entities).toEqual(
      expect.arrayContaining(['areas', 'skills', 'clients', 'employees', 'employee-skills']),
    );
  });

  it('rejects non-admin users with 403', async () => {
    mockCurrentUser = { id: 'u2', role: 'member' };
    const res = await call('GET', '/api/bulk-import/entities');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/bulk-import/templates/:entity', () => {
  it('returns a CSV file with the right headers + example rows', async () => {
    const res = await call('GET', '/api/bulk-import/templates/employees');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/template_employees\.csv/);
    const lines = res.raw.split('\n');
    expect(lines[0]).toContain('first_name');
    expect(lines[0]).toContain('area_key');
    expect(lines[0]).toContain('level');
    expect(lines[1]).toContain('Ana');
  });

  it('returns 404 for an unknown template', async () => {
    const res = await call('GET', '/api/bulk-import/templates/robots');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/bulk-import/:entity/preview', () => {
  it('forwards to runBulkImport with dryRun=true', async () => {
    runBulkImport.mockResolvedValue({ entity: 'skills', total: 2, counts: { total: 2, created: 0, updated: 0, skipped: 0, error: 0 }, report: [], dry_run: true });
    const res = await call('POST', '/api/bulk-import/skills/preview', { rows: [{ name: 'React' }, { name: 'Vue' }] });
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(runBulkImport).toHaveBeenCalledWith(expect.objectContaining({
      entity: 'skills', dryRun: true, userId: 'u1',
    }));
  });

  it('rejects unsupported entity with 400', async () => {
    const res = await call('POST', '/api/bulk-import/robots/preview', { rows: [] });
    expect(res.status).toBe(400);
  });

  it('rejects missing rows array with 400', async () => {
    const res = await call('POST', '/api/bulk-import/skills/preview', { foo: 'bar' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rows/);
  });

  it('rejects payloads larger than 5000 rows with 413', async () => {
    const rows = new Array(5001).fill({ name: 'X' });
    const res = await call('POST', '/api/bulk-import/skills/preview', { rows });
    expect(res.status).toBe(413);
  });
});

describe('POST /api/bulk-import/:entity/commit', () => {
  it('forwards to runBulkImport with dryRun=false and returns report', async () => {
    runBulkImport.mockResolvedValue({
      entity: 'clients', total: 1,
      counts: { total: 1, created: 1, updated: 0, skipped: 0, error: 0 },
      report: [{ row_number: 2, status: 'created', id: 'c-new' }],
    });
    const res = await call('POST', '/api/bulk-import/clients/commit', { rows: [{ name: 'New Inc' }] });
    expect(res.status).toBe(200);
    expect(res.body.counts.created).toBe(1);
    expect(runBulkImport).toHaveBeenCalledWith(expect.objectContaining({
      entity: 'clients', dryRun: false,
    }));
  });

  it('returns 500 when the runner throws', async () => {
    runBulkImport.mockRejectedValue(new Error('boom'));
    const res = await call('POST', '/api/bulk-import/clients/commit', { rows: [{ name: 'A' }] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/boom/);
  });

  it('rejects non-admin users with 403', async () => {
    mockCurrentUser = { id: 'u2', role: 'member' };
    const res = await call('POST', '/api/bulk-import/clients/commit', { rows: [] });
    expect(res.status).toBe(403);
  });
});
