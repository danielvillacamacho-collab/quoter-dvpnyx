import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createClientRepository } from './repository';
import { createClientService } from './service';
import { SORTABLE } from './types';
import type { ClientFilters } from './types';

const db = getPool();
const repo = createClientRepository(db);
const events = createEventEmitter();
const service = createClientService(repo, events, db);

const router = createRouter();

router.get('/api/clients', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, SORTABLE, { defaultField: 'name', defaultDir: 'asc', tieBreaker: 'c.id ASC' });
  const filters: ClientFilters = {
    search: qs.search, country: qs.country,
    industry: qs.industry, tier: qs.tier, active: qs.active,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort }));
});

router.get('/api/clients/:id', async (event) => {
  return ok(await service.getById(event.pathParameters!.id!));
});

router.post('/api/clients', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await service.create(body, user));
});

router.put('/api/clients/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

router.post('/api/clients/:id/activate', async (event, user) => {
  requireAdmin(user);
  return ok(await service.activate(event.pathParameters!.id!, user));
});

router.post('/api/clients/:id/deactivate', async (event, user) => {
  requireAdmin(user);
  return ok(await service.deactivate(event.pathParameters!.id!, user));
});

router.delete('/api/clients/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Cliente eliminado');
});

export const handler = async (event: APIGatewayProxyEventV2) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
