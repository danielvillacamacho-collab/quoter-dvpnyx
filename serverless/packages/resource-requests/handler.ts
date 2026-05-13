import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createResourceRequestRepository } from './repository';
import { createResourceRequestService } from './service';
import { SORTABLE } from './types';
import type { ResourceRequestFilters } from './types';

const db = getPool();
const repo = createResourceRequestRepository(db);
const events = createEventEmitter();
const service = createResourceRequestService(repo, events, db);

const router = createRouter();

router.get('/api/resource-requests', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, SORTABLE, { defaultField: 'created_at', defaultDir: 'desc', tieBreaker: 'rr.id ASC' });
  const filters: ResourceRequestFilters = {
    search: qs.search, contract_id: qs.contract_id,
    area_id: qs.area_id, level: qs.level,
    status: qs.status, priority: qs.priority,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort }));
});

router.get('/api/resource-requests/:id', async (event) => {
  return ok(await service.getById(event.pathParameters!.id!));
});

router.get('/api/resource-requests/:id/candidates', async (event) => {
  return ok(await service.getCandidates(event.pathParameters!.id!));
});

router.post('/api/resource-requests', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await service.create(body, user));
});

router.put('/api/resource-requests/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

router.delete('/api/resource-requests/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Requerimiento eliminado');
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
