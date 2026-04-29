/**
 * Unit tests for server/routes/employees.js (EE-1).
 *
 * Same harness pattern as areas/skills tests.
 */

const queryQueue = [];
const issuedQueries = [];

jest.mock('../database/pool', () => {
  // Transactional control statements don't consume real rows (see
  // opportunities.test.js / quotations.test.js for the same pattern).
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

const empRouter = require('./employees');
const app = express();
app.use(express.json());
app.use('/api/employees', empRouter);
const client = request(app);

beforeEach(() => {
  queryQueue.length = 0;
  issuedQueries.length = 0;
  mockCurrentUser = { id: 'u1', role: 'admin' };
});

const validBody = {
  first_name: 'Ana', last_name: 'García',
  country: 'Colombia', area_id: 1, level: 'L3',
  start_date: '2026-01-15',
};

describe('GET /api/employees', () => {
  it('returns paginated list with defaults', async () => {
    queryQueue.push({ rows: [{ total: 2 }] });
    queryQueue.push({ rows: [
      { id: 'e1', first_name: 'Ana',  last_name: 'G', area_name: 'Desarrollo', skills_count: 3 },
      { id: 'e2', first_name: 'Luis', last_name: 'P', area_name: 'QA',         skills_count: 0 },
    ] });
    const res = await client.call('GET', '/api/employees');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ page: 1, limit: 25, total: 2, pages: 1 });
    expect(issuedQueries[0].sql).toMatch(/deleted_at IS NULL/);
  });

  it('applies filter combination', async () => {
    queryQueue.push({ rows: [{ total: 0 }] });
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/employees?search=ana&area_id=1&level=L3&status=active&country=Colombia');
    const sql = issuedQueries[0].sql;
    expect(sql).toMatch(/LOWER\(e\.first_name\) LIKE/);
    expect(sql).toMatch(/e\.area_id =/);
    expect(sql).toMatch(/e\.level =/);
    expect(sql).toMatch(/e\.status =/);
  });
});

describe('GET /api/employees/:id', () => {
  it('returns 404 when missing', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('GET', '/api/employees/missing');
    expect(res.status).toBe(404);
  });

  it('returns employee with counts', async () => {
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', skills_count: 3, active_assignments_count: 1 }] });
    const res = await client.call('GET', '/api/employees/e1');
    expect(res.status).toBe(200);
    expect(res.body.skills_count).toBe(3);
    expect(res.body.active_assignments_count).toBe(1);
  });
});

describe('POST /api/employees (admin+)', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('POST', '/api/employees', validBody);
    expect(res.status).toBe(403);
  });

  it('rejects when required fields are missing', async () => {
    for (const miss of ['first_name','last_name','country','area_id','level','start_date']) {
      const body = { ...validBody, [miss]: undefined };
      // eslint-disable-next-line no-await-in-loop
      const res = await client.call('POST', '/api/employees', body);
      expect(res.status).toBe(400);
    }
  });

  it('rejects invalid level', async () => {
    const res = await client.call('POST', '/api/employees', { ...validBody, level: 'L99' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/level/i);
  });

  it('rejects invalid status', async () => {
    const res = await client.call('POST', '/api/employees', { ...validBody, status: 'ghosted' });
    expect(res.status).toBe(400);
  });

  it('rejects when area does not exist', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('POST', '/api/employees', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/area_id no existe/);
  });

  it('rejects when area is inactive', async () => {
    queryQueue.push({ rows: [{ id: 1, active: false }] });
    const res = await client.call('POST', '/api/employees', validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/área está inactiva/i);
  });

  it('rejects duplicate corporate_email', async () => {
    queryQueue.push({ rows: [{ id: 1, active: true }] });
    queryQueue.push({ rows: [{ id: 'existing' }] });
    const res = await client.call('POST', '/api/employees', { ...validBody, corporate_email: 'ana@dvpnyx.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/corporate_email/);
  });

  it('rejects when user_id is already linked to another employee', async () => {
    queryQueue.push({ rows: [{ id: 1, active: true }] });
    queryQueue.push({ rows: [{ id: 'other-employee' }] });
    const res = await client.call('POST', '/api/employees', { ...validBody, user_id: 'u42' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/usuario ya está asociado/i);
  });

  it('creates employee with user_id=null (employee without system account)', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 1, active: true }] });
    queryQueue.push({ rows: [{ id: 'e-new', first_name: 'Ana', last_name: 'García', status: 'active' }] });
    const res = await client.call('POST', '/api/employees', validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('e-new');
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.created');
    expect(call).toBeTruthy();
  });
});

describe('PUT /api/employees/:id (admin+)', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('PUT', '/api/employees/e1', { first_name: 'X' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when missing', async () => {
    queryQueue.push({ rows: [] });
    const res = await client.call('PUT', '/api/employees/missing', { first_name: 'X' });
    expect(res.status).toBe(404);
  });

  it('rejects empty first_name', async () => {
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'A' }] });
    const res = await client.call('PUT', '/api/employees/e1', { first_name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid level on update', async () => {
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'A' }] });
    const res = await client.call('PUT', '/api/employees/e1', { level: 'L999' });
    expect(res.status).toBe(400);
  });

  it('updates and emits event with changed_fields', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'García', status: 'active', level: 'L3' }] });
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'García', status: 'active', level: 'L4' }] });
    const res = await client.call('PUT', '/api/employees/e1', { level: 'L4' });
    expect(res.status).toBe(200);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.updated');
    expect(call).toBeTruthy();
    expect(call[1].payload.changed_fields).toContain('level');
  });
});

describe('EE-2 status transitions via PUT', () => {
  it('transition to terminated cancels planned/active assignments and emits employee.terminated', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'G', status: 'active' }] }); // SELECT before
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'G', status: 'terminated' }] }); // UPDATE employee
    queryQueue.push({ rows: [{ id: 'a1' }, { id: 'a2' }] }); // UPDATE assignments RETURNING

    const res = await client.call('PUT', '/api/employees/e1', { status: 'terminated' });
    expect(res.status).toBe(200);
    expect(res.body.cancelled_assignments).toBe(2);

    const statusEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.status_changed');
    const termEvt   = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.terminated');
    expect(statusEvt).toBeTruthy();
    expect(statusEvt[1].payload).toEqual({ from: 'active', to: 'terminated', cancelled_assignments: 2 });
    expect(termEvt).toBeTruthy();
    expect(termEvt[1].payload.cancelled_assignments).toEqual(['a1', 'a2']);

    // Verify we ran the UPDATE assignments SET status='cancelled' query.
    const cancelQ = issuedQueries.find((q) => String(q.sql).match(/UPDATE assignments SET status='cancelled'/));
    expect(cancelQ).toBeTruthy();
    expect(cancelQ.params).toEqual(['e1']);
  });

  it('transition to on_leave emits employee.leave_started (no assignment cancellation)', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'e1', status: 'active', manager_user_id: 'mgr1' }] });
    queryQueue.push({ rows: [{ id: 'e1', status: 'on_leave', manager_user_id: 'mgr1' }] });

    const res = await client.call('PUT', '/api/employees/e1', { status: 'on_leave' });
    expect(res.status).toBe(200);
    expect(res.body.cancelled_assignments).toBe(0);

    const leaveEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.leave_started');
    expect(leaveEvt).toBeTruthy();
    expect(leaveEvt[1].payload).toEqual({ manager_user_id: 'mgr1', from: 'active' });

    // No UPDATE assignments query should have run.
    const cancelQ = issuedQueries.find((q) => String(q.sql).match(/UPDATE assignments SET status='cancelled'/));
    expect(cancelQ).toBeFalsy();
  });

  it('transition from on_leave back to active emits employee.leave_ended', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'e1', status: 'on_leave' }] });
    queryQueue.push({ rows: [{ id: 'e1', status: 'active' }] });

    const res = await client.call('PUT', '/api/employees/e1', { status: 'active' });
    expect(res.status).toBe(200);

    const endEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.leave_ended');
    expect(endEvt).toBeTruthy();
  });

  it('no status change → no status_changed event emitted', async () => {
    const { emitEvent } = require('../utils/events');
    emitEvent.mockClear();
    queryQueue.push({ rows: [{ id: 'e1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'e1', status: 'active' }] });

    await client.call('PUT', '/api/employees/e1', { notes: 'ping' });
    const statusEvt = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.status_changed');
    expect(statusEvt).toBeFalsy();
  });

  it('termination rolls back on downstream failure (transaction safety)', async () => {
    queryQueue.push({ rows: [{ id: 'e1', status: 'active' }] });
    queryQueue.push({ rows: [{ id: 'e1', status: 'terminated' }] });
    // UPDATE assignments throws — the whole transaction must roll back
    queryQueue.push(new Error('assignments table is on fire'));

    const res = await client.call('PUT', '/api/employees/e1', { status: 'terminated' });
    expect(res.status).toBe(500);
    const rollback = issuedQueries.find((q) => q.sql === 'ROLLBACK');
    expect(rollback).toBeTruthy();
  });
});

describe('EE-3 employee_skills nested routes', () => {
  describe('GET /api/employees/:id/skills', () => {
    it('lists the employee skills joined with the catalog', async () => {
      queryQueue.push({ rows: [
        { id: 'es1', employee_id: 'e1', skill_id: 1, proficiency: 'advanced', skill_name: 'JavaScript', skill_category: 'language', skill_active: true },
        { id: 'es2', employee_id: 'e1', skill_id: 5, proficiency: 'expert',    skill_name: 'React',      skill_category: 'framework', skill_active: true },
      ] });
      const res = await client.call('GET', '/api/employees/e1/skills');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('POST /api/employees/:id/skills (admin+)', () => {
    it('rejects non-admin', async () => {
      mockCurrentUser = { id: 'u1', role: 'member' };
      const res = await client.call('POST', '/api/employees/e1/skills', { skill_id: 1 });
      expect(res.status).toBe(403);
    });

    it('rejects when skill_id is missing', async () => {
      const res = await client.call('POST', '/api/employees/e1/skills', {});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/skill_id/);
    });

    it('rejects invalid proficiency', async () => {
      const res = await client.call('POST', '/api/employees/e1/skills', { skill_id: 1, proficiency: 'ninja' });
      expect(res.status).toBe(400);
    });

    it('rejects when the skill does not exist', async () => {
      queryQueue.push({ rows: [] }); // skill lookup
      const res = await client.call('POST', '/api/employees/e1/skills', { skill_id: 999 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no existe/);
    });

    it('rejects when the skill is inactive', async () => {
      queryQueue.push({ rows: [{ id: 5, name: 'Flash', active: false }] });
      const res = await client.call('POST', '/api/employees/e1/skills', { skill_id: 5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/inactivo/);
    });

    it('rejects when the employee does not exist', async () => {
      queryQueue.push({ rows: [{ id: 1, name: 'JS', active: true }] }); // skill
      queryQueue.push({ rows: [] });                                    // employee lookup empty
      const res = await client.call('POST', '/api/employees/missing/skills', { skill_id: 1 });
      expect(res.status).toBe(404);
    });

    it('creates an assignment + emits employee_skill.assigned', async () => {
      const { emitEvent } = require('../utils/events');
      emitEvent.mockClear();
      queryQueue.push({ rows: [{ id: 1, name: 'JavaScript', active: true }] });  // skill lookup
      queryQueue.push({ rows: [{ id: 'e1' }] });                                  // employee lookup
      queryQueue.push({ rows: [{ id: 'es-new', employee_id: 'e1', skill_id: 1, proficiency: 'advanced' }] });
      const res = await client.call('POST', '/api/employees/e1/skills', {
        skill_id: 1, proficiency: 'advanced', years_experience: 4, notes: 'fullstack',
      });
      expect(res.status).toBe(201);
      const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee_skill.assigned');
      expect(call).toBeTruthy();
      expect(call[1].payload.skill_name).toBe('JavaScript');
    });

    it('returns 409 on duplicate (UNIQUE violation propagates)', async () => {
      const uniqueErr = new Error('dup');
      uniqueErr.code = '23505';
      queryQueue.push({ rows: [{ id: 1, name: 'JS', active: true }] });
      queryQueue.push({ rows: [{ id: 'e1' }] });
      queryQueue.push(uniqueErr);
      const res = await client.call('POST', '/api/employees/e1/skills', { skill_id: 1 });
      expect(res.status).toBe(409);
    });
  });

  describe('PUT /api/employees/:id/skills/:skillId (admin+)', () => {
    it('rejects non-admin', async () => {
      mockCurrentUser = { id: 'u1', role: 'member' };
      const res = await client.call('PUT', '/api/employees/e1/skills/1', { proficiency: 'expert' });
      expect(res.status).toBe(403);
    });

    it('rejects invalid proficiency', async () => {
      const res = await client.call('PUT', '/api/employees/e1/skills/1', { proficiency: 'ninja' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the assignment does not exist', async () => {
      queryQueue.push({ rows: [] });
      const res = await client.call('PUT', '/api/employees/e1/skills/999', { proficiency: 'expert' });
      expect(res.status).toBe(404);
    });

    it('updates proficiency + emits employee_skill.updated', async () => {
      const { emitEvent } = require('../utils/events');
      emitEvent.mockClear();
      queryQueue.push({ rows: [{ id: 'es1', employee_id: 'e1', skill_id: 1, proficiency: 'expert', years_experience: 6 }] });
      const res = await client.call('PUT', '/api/employees/e1/skills/1', { proficiency: 'expert', years_experience: 6 });
      expect(res.status).toBe(200);
      const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee_skill.updated');
      expect(call).toBeTruthy();
    });
  });

  describe('DELETE /api/employees/:id/skills/:skillId (admin+)', () => {
    it('rejects non-admin', async () => {
      mockCurrentUser = { id: 'u1', role: 'member' };
      const res = await client.call('DELETE', '/api/employees/e1/skills/1');
      expect(res.status).toBe(403);
    });

    it('returns 404 when nothing was removed', async () => {
      queryQueue.push({ rows: [] });
      const res = await client.call('DELETE', '/api/employees/e1/skills/999');
      expect(res.status).toBe(404);
    });

    it('removes and emits employee_skill.removed', async () => {
      const { emitEvent } = require('../utils/events');
      emitEvent.mockClear();
      queryQueue.push({ rows: [{ id: 'es1' }] });
      const res = await client.call('DELETE', '/api/employees/e1/skills/1');
      expect(res.status).toBe(200);
      const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee_skill.removed');
      expect(call).toBeTruthy();
    });
  });
});

describe('DELETE /api/employees/:id (admin+)', () => {
  it('rejects non-admin', async () => {
    mockCurrentUser = { id: 'u1', role: 'member' };
    const res = await client.call('DELETE', '/api/employees/e1');
    expect(res.status).toBe(403);
  });

  it('rejects with 409 when has active assignments', async () => {
    queryQueue.push({ rows: [{ active_assignments: 2 }] });
    const res = await client.call('DELETE', '/api/employees/e1');
    expect(res.status).toBe(409);
    expect(res.body.active_assignments).toBe(2);
  });

  it('soft-deletes when no active assignments + emits event', async () => {
    const { emitEvent } = require('../utils/events');
    queryQueue.push({ rows: [{ active_assignments: 0 }] });
    queryQueue.push({ rows: [{ id: 'e1', first_name: 'Ana', last_name: 'García' }] });
    const res = await client.call('DELETE', '/api/employees/e1');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/eliminado/i);
    const call = emitEvent.mock.calls.find((c) => c[1].event_type === 'employee.deleted');
    expect(call).toBeTruthy();
  });
});


describe('GET /api/employees/lookup — INC-003 (unpaginated dropdown source)', () => {
  it('returns ALL non-terminated employees, no pagination cap', async () => {
    // Simulate >100 employees: pre-fix the paginated GET / would cap at 100.
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: 'e' + i, first_name: 'F' + i, last_name: 'L' + String(i).padStart(3, '0'),
      level: 'L4', status: 'active', area_id: 1, area_name: 'Dev', weekly_capacity_hours: 40,
    }));
    queryQueue.push({ rows: many });
    const res = await client.call('GET', '/api/employees/lookup');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(250);
  });

  it('excludes terminated employees by default', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/employees/lookup');
    const sql = issuedQueries[issuedQueries.length - 1].sql;
    expect(sql).toMatch(/status <> 'terminated'/);
  });

  it('honors include_terminated=true', async () => {
    queryQueue.push({ rows: [] });
    await client.call('GET', '/api/employees/lookup?include_terminated=true');
    const sql = issuedQueries[issuedQueries.length - 1].sql;
    expect(sql).not.toMatch(/status <> 'terminated'/);
  });
});
