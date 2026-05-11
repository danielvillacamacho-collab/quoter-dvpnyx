import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
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
    status: qs.status,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort }));
});

router.get('/api/assignments/export.csv', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const filters: AssignmentFilters = {
    search: qs.search, contract_id: qs.contract_id,
    employee_id: qs.employee_id, resource_request_id: qs.resource_request_id,
    status: qs.status,
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
  const body = JSON.parse(event.body || '{}');
  return created(await service.create(body, user));
});

router.post('/api/assignments/validate', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.validate(body));
});

router.put('/api/assignments/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

router.delete('/api/assignments/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Asignación eliminada');
});

export const handler = async (event: APIGatewayProxyEventV2) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
