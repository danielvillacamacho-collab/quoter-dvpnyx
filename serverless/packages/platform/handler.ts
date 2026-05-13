import { AppError } from '@shared/errors';
import { createRouter, getEventMethod, getEventPath, type RouterEvent } from '@shared/http/router';
import { ok, created, message, error } from '@shared/http/response';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin, requireSuperadmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createAuthService } from './auth.service';
import { createUsersRepository } from './users.repository';
import { createNotificationsRepository } from './notifications.repository';
import { createEmployeeRepository } from '../employees/repository';
import { createEmployeeService } from '../employees/service';

const db = getPool();
const events = createEventEmitter();
const authService = createAuthService(db);
const usersRepo = createUsersRepository(db);
const notifRepo = createNotificationsRepository(db);
const empRepo = createEmployeeRepository(db);
const empService = createEmployeeService(empRepo, events, db);

const router = createRouter();

/* ==================================================================
 * AUTH — /api/auth/*
 * ================================================================== */

router.post('/api/auth/login', async (event, _user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await authService.login(body.email, body.password));
});

router.post('/api/auth/google', async (event, _user) => {
  const body = parseJsonBody(event);
  return ok(await authService.googleLogin(body.credential as string | undefined, getSourceIp(event)));
});

router.post('/api/auth/google-callback', async (event, _user) => {
  const credential = parseFormBody(event).get('credential') || undefined;
  try {
    const result = await authService.googleLogin(credential, getSourceIp(event));
    return redirect(`/login?google_token=${encodeURIComponent(result.token)}`);
  } catch (err) {
    return redirect(`/login?error=${encodeURIComponent(toGoogleCallbackError(err))}`);
  }
});

router.get('/api/auth/me', async (_event, user) => {
  return ok(await authService.getMe(user.id));
});

router.post('/api/auth/change-password', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  await authService.changePassword(user.id, body.current_password, body.new_password);
  return message('Contraseña actualizada');
});

router.put('/api/auth/me/preferences', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await authService.updatePreferences(user.id, body));
});

/* ==================================================================
 * USERS — /api/users/*  (admin+, except /lookup)
 * ================================================================== */

router.get('/api/users/lookup', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  return ok(await usersRepo.lookup(qs.function));
});

router.get('/api/users', async (_event, user) => {
  requireAdmin(user);
  return ok(await usersRepo.findAll());
});

router.get('/api/users/:id', async (event, user) => {
  requireAdmin(user);
  const found = await usersRepo.findById(event.pathParameters!.id!);
  if (!found) return error(404, { error: 'Usuario no encontrado' });
  return ok(found);
});

router.post('/api/users', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const result = await usersRepo.create(body, user);

  await events.emit(db, {
    event_type: 'user.created',
    entity_type: 'user',
    entity_id: result.id,
    actor_user_id: user.id,
    payload: { email: result.email, role: result.role },
  });

  return created(result);
});

router.put('/api/users/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const result = await usersRepo.update(event.pathParameters!.id!, body, user);

  await events.emit(db, {
    event_type: 'user.updated',
    entity_type: 'user',
    entity_id: result.id,
    actor_user_id: user.id,
    payload: { name: result.name, role: result.role },
  });

  return ok(result);
});

router.delete('/api/users/:id', async (event, user) => {
  requireSuperadmin(user);
  await usersRepo.softDelete(event.pathParameters!.id!, user);

  await events.emit(db, {
    event_type: 'user.deleted',
    entity_type: 'user',
    entity_id: event.pathParameters!.id!,
    actor_user_id: user.id,
    payload: {},
  });

  return message('Usuario eliminado');
});

/* ==================================================================
 * NOTIFICATIONS — /api/notifications/*
 * ================================================================== */

router.get('/api/notifications', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const unreadOnly = qs.unread === 'true' || qs.unread === '1';
  return ok(await notifRepo.list(user.id, unreadOnly));
});

router.get('/api/notifications/unread-count', async (_event, user) => {
  return ok(await notifRepo.unreadCount(user.id));
});

router.put('/api/notifications/:id/read', async (event, user) => {
  return ok(await notifRepo.markRead(event.pathParameters!.id!, user.id));
});

router.post('/api/notifications/read-all', async (_event, user) => {
  return ok(await notifRepo.markAllRead(user.id));
});

/* ==================================================================
 * PARAMETERS — /api/parameters
 * ================================================================== */

router.get('/api/parameters', async (_event, _user) => {
  const { rows } = await db.query('SELECT * FROM parameters ORDER BY category, sort_order');
  const grouped: Record<string, unknown[]> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row);
  }
  return ok(grouped);
});

router.put('/api/parameters/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const { value, label, note } = body;

  const { rows } = await db.query(
    'UPDATE parameters SET value=COALESCE($1,value), label=COALESCE($2,label), note=COALESCE($3,note), updated_at=NOW(), updated_by=$4 WHERE id=$5 RETURNING *',
    [value, label, note, user.id, event.pathParameters!.id!],
  );
  if (!rows.length) return error(404, { error: 'Parámetro no encontrado' });

  await events.emit(db, {
    event_type: 'parameter.updated',
    entity_type: 'parameter',
    entity_id: String(rows[0].id),
    actor_user_id: user.id,
    payload: { category: rows[0].category, key: rows[0].key, value },
  });

  return ok(rows[0]);
});

/* ==================================================================
 * SELF-SERVICE — /api/me/*
 * ================================================================== */

router.get('/api/me/profile', async (_event, user) => {
  return ok(await authService.getMe(user.id));
});

router.put('/api/me/profile', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  // Self-service: only allow name update (not role/function)
  const { rows } = await db.query(
    `UPDATE users SET name = COALESCE($1, name), updated_at = NOW()
     WHERE id = $2 RETURNING id, email, name, role, function`,
    [body.name ?? null, user.id],
  );
  if (!rows.length) return error(404, { error: 'Usuario no encontrado' });
  return ok(rows[0]);
});

router.get('/api/me/assignments', async (_event, user) => {
  const { rows: empRows } = await db.query(
    'SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL',
    [user.id],
  );
  if (!empRows.length) return ok({ data: [] });

  const { rows } = await db.query(
    `SELECT a.*, c.name AS contract_name, cl.name AS client_name
       FROM assignments a
       LEFT JOIN contracts c ON c.id = a.contract_id
       LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE a.employee_id = $1 AND a.status IN ('planned','active') AND a.deleted_at IS NULL
      ORDER BY a.start_date`,
    [empRows[0].id],
  );
  return ok({ data: rows });
});

async function getEmployeeId(userId: string): Promise<string | null> {
  const { rows } = await db.query(
    'SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL',
    [userId],
  );
  return rows.length ? rows[0].id : null;
}

router.get('/api/me/skills', async (_event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const skills = await empService.getSkills(empId);
  return ok({ data: skills });
});

router.post('/api/me/skills', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const body = JSON.parse(event.body || '{}');
  const { skill_ids } = body;

  if (!Array.isArray(skill_ids)) return error(400, { error: 'skill_ids debe ser un array' });

  const skills = await empService.setSkills(empId, skill_ids, user);
  return ok({ data: skills });
});

router.get('/api/me/education', async (_event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const { rows } = await db.query(
    'SELECT * FROM employee_education WHERE employee_id=$1 ORDER BY start_date DESC',
    [empId],
  );
  return ok({ data: rows });
});

router.post('/api/me/education', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const body = JSON.parse(event.body || '{}');
  const { institution, degree, field_of_study, start_date, end_date, gpa, description } = body;

  const { rows } = await db.query(
    `INSERT INTO employee_education
     (employee_id, institution, degree, field_of_study, start_date, end_date, gpa, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     RETURNING *`,
    [empId, institution, degree, field_of_study, start_date, end_date, gpa, description],
  );

  await events.emit(db, {
    event_type: 'employee.education_created',
    entity_type: 'employee_education',
    entity_id: rows[0].id,
    actor_user_id: user.id,
    payload: { institution, degree },
  });

  return created(rows[0]);
});

router.put('/api/me/education/:id', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const body = JSON.parse(event.body || '{}');
  const { institution, degree, field_of_study, start_date, end_date, gpa, description } = body;

  const { rows } = await db.query(
    `UPDATE employee_education SET
     institution = COALESCE($1, institution),
     degree = COALESCE($2, degree),
     field_of_study = COALESCE($3, field_of_study),
     start_date = COALESCE($4, start_date),
     end_date = COALESCE($5, end_date),
     gpa = COALESCE($6, gpa),
     description = COALESCE($7, description),
     updated_at = NOW()
     WHERE id = $8 AND employee_id = $9
     RETURNING *`,
    [institution, degree, field_of_study, start_date, end_date, gpa, description, event.pathParameters!.id!, empId],
  );

  if (!rows.length) return error(404, { error: 'Educación no encontrada' });

  await events.emit(db, {
    event_type: 'employee.education_updated',
    entity_type: 'employee_education',
    entity_id: rows[0].id,
    actor_user_id: user.id,
    payload: { institution, degree },
  });

  return ok(rows[0]);
});

router.delete('/api/me/education/:id', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const { rows } = await db.query(
    'DELETE FROM employee_education WHERE id=$1 AND employee_id=$2 RETURNING *',
    [event.pathParameters!.id!, empId],
  );

  if (!rows.length) return error(404, { error: 'Educación no encontrada' });

  await events.emit(db, {
    event_type: 'employee.education_deleted',
    entity_type: 'employee_education',
    entity_id: rows[0].id,
    actor_user_id: user.id,
    payload: { institution: rows[0].institution, degree: rows[0].degree },
  });

  return message('Educación eliminada');
});

router.get('/api/me/completeness', async (_event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const emp = await empService.getById(empId);

  // Count skills and education
  const { rows: skills } = await db.query(
    'SELECT COUNT(*)::int AS cnt FROM employee_skills WHERE employee_id=$1',
    [empId],
  );
  const { rows: edu } = await db.query(
    'SELECT COUNT(*)::int AS cnt FROM employee_education WHERE employee_id=$1',
    [empId],
  );

  const checks = [
    { key: 'bio', done: !!emp.bio },
    { key: 'city', done: !!emp.city },
    { key: 'linkedin', done: !!emp.linkedin_url },
    { key: 'skills', done: skills[0].cnt >= 3 },
    { key: 'education', done: edu[0].cnt >= 1 },
    { key: 'languages', done: Array.isArray(emp.languages) && emp.languages.length > 0 },
  ];
  const done = checks.filter((c) => c.done).length;
  return ok({ pct: Math.round((done / checks.length) * 100), checks });
});

/* ==================================================================
 * BULK IMPORT — /api/bulk-import/*
 * ================================================================== */

router.post('/api/bulk-import/:entity', async (event, user) => {
  requireAdmin(user);
  const entity = event.pathParameters!.entity!;
  // Placeholder: actual bulk import logic would go here
  return ok({ message: `Bulk import for ${entity} — not yet implemented in serverless` });
});

router.get('/api/bulk-import/templates/:entity', async (event, user) => {
  requireAdmin(user);
  const entity = event.pathParameters!.entity!;
  return ok({ message: `Template for ${entity} — not yet implemented in serverless` });
});

/* ==================================================================
 * HEALTH — /api/health (NO AUTH)
 * ================================================================== */

router.get('/api/health', async (_event, _user) => {
  const version = process.env.APP_VERSION || '2.0.0-dev';
  const git_sha = (process.env.GIT_SHA || 'unknown').slice(0, 12);
  let dbStatus = 'down';
  try {
    await db.query('SELECT 1');
    dbStatus = 'up';
  } catch {
    /* health check — continue */
  }
  const isOk = dbStatus === 'up';
  return {
    statusCode: isOk ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ ok: isOk, version, git_sha, db: dbStatus }),
  };
});

/* ==================================================================
 * SEARCH — /api/search
 * ================================================================== */

router.get('/api/search', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const q = (qs.q || '').trim();
  if (q.length < 2) return ok({ query: q, total: 0, results: [] });

  const like = `%${q}%`;
  const limit = Math.min(Math.max(Number(qs.limit) || 5, 1), 10);

  const [clients, opportunities, contracts, employees, quotations] = await Promise.all([
    db.query(
      `SELECT id, name, country FROM clients
       WHERE deleted_at IS NULL AND (name ILIKE $1 OR COALESCE(legal_name,'') ILIKE $1)
       ORDER BY name LIMIT $2`,
      [like, limit],
    ),
    db.query(
      `SELECT id, name, status FROM opportunities
       WHERE deleted_at IS NULL AND name ILIKE $1
       ORDER BY name LIMIT $2`,
      [like, limit],
    ),
    db.query(
      `SELECT id, name, status FROM contracts
       WHERE deleted_at IS NULL AND name ILIKE $1
       ORDER BY name LIMIT $2`,
      [like, limit],
    ),
    db.query(
      `SELECT id, first_name, last_name, level FROM employees
       WHERE deleted_at IS NULL AND ((first_name || ' ' || last_name) ILIKE $1 OR COALESCE(corporate_email,'') ILIKE $1)
       ORDER BY last_name LIMIT $2`,
      [like, limit],
    ),
    db.query(
      `SELECT id, name, status FROM quotations
       WHERE name ILIKE $1
       ORDER BY name LIMIT $2`,
      [like, limit],
    ),
  ]);

  const results = [
    ...clients.rows.map((r: Record<string, unknown>) => ({
      type: 'client', id: r.id, title: r.name, subtitle: (r.country as string) || 'Cliente', url: `/clients/${r.id}`,
    })),
    ...opportunities.rows.map((r: Record<string, unknown>) => ({
      type: 'opportunity', id: r.id, title: r.name, subtitle: r.status, url: `/opportunities/${r.id}`,
    })),
    ...contracts.rows.map((r: Record<string, unknown>) => ({
      type: 'contract', id: r.id, title: r.name, subtitle: r.status, url: `/contracts/${r.id}`,
    })),
    ...employees.rows.map((r: Record<string, unknown>) => ({
      type: 'employee', id: r.id, title: `${r.first_name} ${r.last_name}`, subtitle: r.level, url: `/employees/${r.id}`,
    })),
    ...quotations.rows.map((r: Record<string, unknown>) => ({
      type: 'quotation', id: r.id, title: r.name, subtitle: r.status, url: `/quotations/${r.id}`,
    })),
  ];

  return ok({ query: q, total: results.length, results });
});

/* ==================================================================
 * HANDLER — special handling for no-auth routes
 * ================================================================== */

/** Routes that bypass authentication. */
const NO_AUTH_ROUTES: { method: string; path: string }[] = [
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/google' },
  { method: 'POST', path: '/api/auth/google-callback' },
  { method: 'GET', path: '/api/health' },
];

function isNoAuthRoute(event: RouterEvent): boolean {
  const method = getEventMethod(event);
  const path = getEventPath(event);
  return NO_AUTH_ROUTES.some((r) => r.method === method && r.path === path);
}

/** Synthetic "anonymous" user for no-auth routes. */
const ANON_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'anonymous@system',
  name: 'Anonymous',
  role: 'viewer' as const,
};

function getRawBody(event: RouterEvent): string {
  const body = event.body || '';
  if ('isBase64Encoded' in event && event.isBase64Encoded) {
    return Buffer.from(body, 'base64').toString('utf8');
  }
  return body;
}

function parseJsonBody(event: RouterEvent): Record<string, unknown> {
  const raw = getRawBody(event);
  return raw ? JSON.parse(raw) : {};
}

function parseFormBody(event: RouterEvent): URLSearchParams {
  return new URLSearchParams(getRawBody(event));
}

function getSourceIp(event: RouterEvent): string | null {
  const context = event.requestContext as {
    identity?: { sourceIp?: string };
    http?: { sourceIp?: string };
  };
  return context.identity?.sourceIp || context.http?.sourceIp || null;
}

function redirect(location: string) {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      'Access-Control-Allow-Origin': '*',
    },
    body: '',
  };
}

function toGoogleCallbackError(err: unknown): string {
  if (err instanceof AppError) {
    if (err.code === 'google_not_configured') return 'google_not_configured';
    if (err.statusCode === 403) return 'domain_not_allowed';
    if (err.statusCode === 400) return 'missing_credential';
  }
  return 'google_auth_failed';
}

export const handler = async (event: RouterEvent) => {
  if (isNoAuthRoute(event)) {
    return router.resolve(event, ANON_USER);
  }
  return withAuth(event, (e, user) => router.resolve(e, user));
};
