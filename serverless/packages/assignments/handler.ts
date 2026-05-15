import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter, parseBody } from '@shared/http/router';
import { ok, created, message, paginated, error } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createAssignmentRepository } from './repository';
import { createAssignmentService } from './service';
import { SORTABLE } from './types';
import type { AssignmentFilters } from './types';

const db = getPool();
const repo = createAssignmentRepository(db);
const events = createEventEmitter();
const service = createAssignmentService(repo, events, db);

const router = createRouter();

router.get('/api/assignments', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, SORTABLE, { defaultField: 'created_at', defaultDir: 'desc', tieBreaker: 'asg.id ASC' });
  const filters: AssignmentFilters = {
    search: qs.search, contract_id: qs.contract_id,
    employee_id: qs.employee_id, resource_request_id: qs.resource_request_id,
    status: qs.status, date_from: qs.date_from, date_to: qs.date_to,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort }));
});

router.get('/api/assignments/export.csv', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const filters: AssignmentFilters = {
    search: qs.search, contract_id: qs.contract_id,
    employee_id: qs.employee_id, resource_request_id: qs.resource_request_id,
    status: qs.status, date_from: qs.date_from, date_to: qs.date_to,
  };
  const csv = await service.exportCsv(filters);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="assignments.csv"',
      'Access-Control-Allow-Origin': '*',
    },
    body: csv,
  };
});

router.get('/api/assignments/:id', async (event) => {
  return ok(await service.getById(event.pathParameters!.id!));
});

router.post('/api/assignments', async (event, user) => {
  const body = parseBody(event);
  return created(await service.create(body, user));
});

router.post('/api/assignments/validate', async (event, user) => {
  const body = parseBody(event);
  return ok(await service.validate(body));
});

router.put('/api/assignments/:id', async (event, user) => {
  const body = parseBody(event);
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

router.delete('/api/assignments/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Asignación eliminada');
});

// ── Rate History ────────────────────────────────────────────────────

router.get('/api/assignments/:id/rate-history', async (event) => {
  const { rows } = await db.query(
    `SELECT h.id, h.effective_date, h.client_rate, h.client_rate_currency,
            h.reason, h.created_by, h.created_at, u.name AS created_by_name
       FROM assignment_rate_history h
       LEFT JOIN users u ON u.id = h.created_by
      WHERE h.assignment_id = $1
      ORDER BY h.effective_date ASC, h.created_at ASC`,
    [event.pathParameters!.id!],
  );
  return ok(rows);
});

router.post('/api/assignments/:id/rate-history', async (event, user) => {
  requireAdmin(user);
  const body = parseBody(event);
  const { effective_date, client_rate, client_rate_currency, reason } = body;

  if (!effective_date) return error(400, { error: 'effective_date es requerido' });
  if (client_rate == null || Number(client_rate) <= 0) return error(400, { error: 'client_rate debe ser mayor a 0' });

  const { rows: asgRows } = await db.query(
    `SELECT id, contract_id, client_rate_currency FROM assignments WHERE id=$1 AND deleted_at IS NULL`,
    [event.pathParameters!.id!],
  );
  if (!asgRows.length) return error(404, { error: 'Asignación no encontrada' });

  const { rows: existing } = await db.query(
    `SELECT id FROM assignment_rate_history WHERE assignment_id=$1 AND effective_date=$2`,
    [event.pathParameters!.id!, effective_date],
  );
  if (existing.length) return error(409, { error: 'Ya existe una tarifa para esta fecha' });

  const ccy = (client_rate_currency || asgRows[0].client_rate_currency || 'USD') as string;
  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `INSERT INTO assignment_rate_history
         (assignment_id, effective_date, client_rate, client_rate_currency, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [event.pathParameters!.id!, effective_date, Number(client_rate), ccy, reason || null, user.id],
    );
    // Update assignment's current client_rate to the latest entry.
    const { rows: latest } = await conn.query(
      `SELECT client_rate, client_rate_currency FROM assignment_rate_history
        WHERE assignment_id=$1 ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
      [event.pathParameters!.id!],
    );
    if (latest.length) {
      await conn.query(
        `UPDATE assignments SET client_rate=$1, client_rate_currency=$2 WHERE id=$3`,
        [latest[0].client_rate, latest[0].client_rate_currency, event.pathParameters!.id!],
      );
    }
    await conn.query('COMMIT');
    return created(rows[0]);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

router.delete('/api/assignments/:id/rate-history/:rateId', async (event, user) => {
  requireAdmin(user);
  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `DELETE FROM assignment_rate_history WHERE id=$1 AND assignment_id=$2 RETURNING *`,
      [event.pathParameters!.rateId!, event.pathParameters!.id!],
    );
    if (!rows.length) return error(404, { error: 'Entrada no encontrada' });

    const { rows: latest } = await conn.query(
      `SELECT client_rate, client_rate_currency FROM assignment_rate_history
        WHERE assignment_id=$1 ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
      [event.pathParameters!.id!],
    );
    if (latest.length) {
      await conn.query(
        `UPDATE assignments SET client_rate=$1, client_rate_currency=$2 WHERE id=$3`,
        [latest[0].client_rate, latest[0].client_rate_currency, event.pathParameters!.id!],
      );
    } else {
      await conn.query(`UPDATE assignments SET client_rate=NULL WHERE id=$1`, [event.pathParameters!.id!]);
    }
    await conn.query('COMMIT');
    return ok({ message: 'Entrada eliminada' });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
