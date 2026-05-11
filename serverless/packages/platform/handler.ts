import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, error } from '@shared/http/response';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin, requireSuperadmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createAuthService } from './auth.service';
import { createUsersRepository } from './users.repository';
import { createNotificationsRepository } from './notifications.repository';

const db = getPool();
const events = createEventEmitter();
const authService = createAuthService(db);
const usersRepo = createUsersRepository(db);
const notifRepo = createNotificationsRepository(db);

const router = createRouter();

/* ==================================================================
 * AUTH — /api/auth/*
 * ================================================================== */

router.post('/api/auth/login', async (event, _user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await authService.login(body.email, body.password));
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
  { method: 'GET', path: '/api/health' },
];

function isNoAuthRoute(event: APIGatewayProxyEventV2): boolean {
  const method = event.requestContext.http.method.toUpperCase();
  const path = event.rawPath;
  return NO_AUTH_ROUTES.some((r) => r.method === method && r.path === path);
}

/** Synthetic "anonymous" user for no-auth routes. */
const ANON_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'anonymous@system',
  name: 'Anonymous',
  role: 'viewer' as const,
};

export const handler = async (event: APIGatewayProxyEventV2) => {
  if (isNoAuthRoute(event)) {
    return router.resolve(event, ANON_USER);
  }
  return withAuth(event, (e, user) => router.resolve(e, user));
};
