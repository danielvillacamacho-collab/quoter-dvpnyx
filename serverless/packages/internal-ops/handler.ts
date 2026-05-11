import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter, buildUpdatePayload } from '@shared/events/emitter';
import { createInitiativesRepository } from './initiatives.repository';
import { createNoveltiesRepository } from './novelties.repository';
import { createHolidaysRepository } from './holidays.repository';
import { INITIATIVE_EDITABLE_FIELDS } from './types';
import type { InitiativeFilters, InitiativeStatus, NoveltyFilters, HolidayFilters } from './types';

const db = getPool();
const events = createEventEmitter();
const initiativesRepo = createInitiativesRepository(db);
const noveltiesRepo = createNoveltiesRepository(db);
const holidaysRepo = createHolidaysRepository(db);

const router = createRouter();

/* ==================================================================
 * INTERNAL INITIATIVES — /api/internal-initiatives/*
 * ================================================================== */

router.get('/api/internal-initiatives', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const filters: InitiativeFilters = {
    search: qs.search,
    status: qs.status,
    business_area: qs.business_area,
    operations_owner_id: qs.operations_owner_id,
  };
  return paginated(await initiativesRepo.findAll({ page, limit, offset, filters }));
});

router.get('/api/internal-initiatives/:id', async (event, _user) => {
  const initiative = await initiativesRepo.findById(event.pathParameters!.id!);
  if (!initiative) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Iniciativa no encontrada' }) };
  return ok(initiative);
});

router.post('/api/internal-initiatives', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const initiative = await initiativesRepo.create(body, user, conn);

    await events.emit(conn, {
      event_type: 'internal_initiative.created',
      entity_type: 'internal_initiative',
      entity_id: initiative.id,
      actor_user_id: user.id,
      payload: { name: initiative.name, business_area_id: initiative.business_area_id, budget_usd: initiative.budget_usd },
    });

    await conn.query('COMMIT');
    return created(initiative);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

router.put('/api/internal-initiatives/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  const id = event.pathParameters!.id!;

  const before = await initiativesRepo.findById(id);

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const after = await initiativesRepo.update(id, body, user, conn);

    await events.emit(conn, {
      event_type: 'internal_initiative.updated',
      entity_type: 'internal_initiative',
      entity_id: id,
      actor_user_id: user.id,
      payload: before ? buildUpdatePayload(before as Record<string, unknown>, after as Record<string, unknown>, [...INITIATIVE_EDITABLE_FIELDS]) : {},
    });

    await conn.query('COMMIT');
    return ok(after);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

router.post('/api/internal-initiatives/:id/transitions', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const id = event.pathParameters!.id!;

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const result = await initiativesRepo.transition(id, body.to_status as InitiativeStatus, body.reason || null, user, conn);

    await events.emit(conn, {
      event_type: 'internal_initiative.status_changed',
      entity_type: 'internal_initiative',
      entity_id: id,
      actor_user_id: user.id,
      payload: { to: body.to_status, reason: body.reason || null },
    });

    await conn.query('COMMIT');
    return ok(result);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

router.delete('/api/internal-initiatives/:id', async (event, user) => {
  requireAdmin(user);
  const id = event.pathParameters!.id!;
  const body = JSON.parse(event.body || '{}');
  const reason = body.reason || null;

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    await initiativesRepo.softDelete(id, reason, user, conn);

    await events.emit(conn, {
      event_type: 'internal_initiative.deleted',
      entity_type: 'internal_initiative',
      entity_id: id,
      actor_user_id: user.id,
      payload: { reason },
    });

    await conn.query('COMMIT');
    return message('Iniciativa eliminada');
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
});

/* ==================================================================
 * NOVELTIES — /api/novelties/*
 * ================================================================== */

router.get('/api/novelties', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const filters: NoveltyFilters = {
    employee_id: qs.employee_id,
    status: qs.status,
    from: qs.from,
    to: qs.to,
  };
  return paginated(await noveltiesRepo.findAll({ page, limit, offset, filters, user }));
});

router.get('/api/novelties/:id', async (event, _user) => {
  const novelty = await noveltiesRepo.findById(event.pathParameters!.id!);
  if (!novelty) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Novedad no encontrada' }) };
  return ok(novelty);
});

router.post('/api/novelties', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  const novelty = await noveltiesRepo.create(body, user);

  await events.emit(db, {
    event_type: 'novelty.created',
    entity_type: 'employee_novelty',
    entity_id: novelty.id,
    actor_user_id: user.id,
    payload: { employee_id: novelty.employee_id, start_date: novelty.start_date, end_date: novelty.end_date },
  });

  return created(novelty);
});

router.put('/api/novelties/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  const novelty = await noveltiesRepo.update(event.pathParameters!.id!, body, user);

  await events.emit(db, {
    event_type: 'novelty.updated',
    entity_type: 'employee_novelty',
    entity_id: novelty.id,
    actor_user_id: user.id,
    payload: { start_date: novelty.start_date, end_date: novelty.end_date },
  });

  return ok(novelty);
});

router.delete('/api/novelties/:id', async (event, user) => {
  await noveltiesRepo.softDelete(event.pathParameters!.id!, user);

  await events.emit(db, {
    event_type: 'novelty.deleted',
    entity_type: 'employee_novelty',
    entity_id: event.pathParameters!.id!,
    actor_user_id: user.id,
    payload: {},
  });

  return message('Novedad eliminada');
});

/* ==================================================================
 * IDLE TIME — /api/idle-time (read-only summary)
 * ================================================================== */

router.get('/api/idle-time', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const period = qs.period;
  if (!period) return ok({ data: [], message: 'Parámetro period requerido (YYYY-MM)' });

  const { rows } = await db.query(
    `SELECT itc.*, (e.first_name || ' ' || e.last_name) AS employee_name
       FROM idle_time_calculations itc
       LEFT JOIN employees e ON e.id = itc.employee_id
      WHERE itc.period_yyyymm = $1
      ORDER BY itc.idle_pct DESC`,
    [period],
  );
  return ok({ data: rows });
});

/* ==================================================================
 * HOLIDAYS — /api/holidays/*
 * ================================================================== */

router.get('/api/holidays', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const filters: HolidayFilters = {
    country: qs.country, year: qs.year, from: qs.from, to: qs.to,
  };
  return ok(await holidaysRepo.findAll(filters));
});

router.post('/api/holidays', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const holiday = await holidaysRepo.create(body, user.id);

  await events.emit(db, {
    event_type: 'holiday.created',
    entity_type: 'country_holiday',
    entity_id: holiday.id,
    actor_user_id: user.id,
    payload: { country_id: holiday.country_id, holiday_date: holiday.holiday_date, label: holiday.label },
  });

  return created(holiday);
});

router.put('/api/holidays/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const holiday = await holidaysRepo.update(event.pathParameters!.id!, body);

  await events.emit(db, {
    event_type: 'holiday.updated',
    entity_type: 'country_holiday',
    entity_id: holiday.id,
    actor_user_id: user.id,
    payload: body,
  });

  return ok(holiday);
});

router.delete('/api/holidays/:id', async (event, user) => {
  requireAdmin(user);
  await holidaysRepo.hardDelete(event.pathParameters!.id!);

  await events.emit(db, {
    event_type: 'holiday.deleted',
    entity_type: 'country_holiday',
    entity_id: event.pathParameters!.id!,
    actor_user_id: user.id,
    payload: {},
  });

  return message('Festivo eliminado');
});

/* ==================================================================
 * HANDLER
 * ================================================================== */

export const handler = async (event: APIGatewayProxyEventV2) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
