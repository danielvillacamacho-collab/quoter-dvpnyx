import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { Forbidden } from '@shared/errors';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createOpportunityRepository } from './repository';
import { createOpportunityService } from './service';
import { SORTABLE } from './types';
import type { OpportunityFilters } from './types';

const db = getPool();
const repo = createOpportunityRepository(db);
const events = createEventEmitter();
const service = createOpportunityService(repo, events, db);

const router = createRouter();

/* ---- LIST (RBAC-scoped) ---- */
router.get('/api/opportunities', async (event, user) => {
  if (user.role === 'external') throw new Forbidden('Acceso restringido para usuarios externos');

  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, SORTABLE, { defaultField: 'created_at', defaultDir: 'desc', tieBreaker: 'o.id ASC' });
  const filters: OpportunityFilters = {
    search: qs.search,
    client_id: qs.client_id,
    status: qs.status,
    stage: qs.stage,
    deal_type: qs.deal_type,
    contract_type: qs.contract_type,
    account_owner_id: qs.owner_id || qs.account_owner_id,
    squad_id: qs.squad_id,
    revenue_type: qs.revenue_type,
    funding_source: qs.funding_source,
    from_expected_close: qs.from_expected_close,
    to_expected_close: qs.to_expected_close,
    has_champion: qs.has_champion,
    has_economic_buyer: qs.has_economic_buyer,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort, user }));
});

/* ---- KANBAN ---- */
router.get('/api/opportunities/kanban', async (event, user) => {
  if (user.role === 'external') throw new Forbidden('Acceso restringido para usuarios externos');

  const qs = event.queryStringParameters || {};
  const filters: OpportunityFilters = {
    search: qs.search,
    client_id: qs.client_id,
    account_owner_id: qs.owner_id || qs.account_owner_id,
    squad_id: qs.squad_id,
    from_expected_close: qs.from_expected_close,
    to_expected_close: qs.to_expected_close,
  };
  return ok(await service.kanban({ filters, user }));
});

/* ---- LOOKUP (lightweight for dropdowns) ---- */
router.get('/api/opportunities/lookup', async (event, user) => {
  const qs = event.queryStringParameters || {};
  return ok(await service.lookup({ search: qs.search, client_id: qs.client_id, user }));
});

/* ---- GET ONE ---- */
router.get('/api/opportunities/:id', async (event) => {
  return ok(await service.getById(event.pathParameters!.id!));
});

/* ---- CREATE ---- */
router.post('/api/opportunities', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await service.create(body, user));
});

/* ---- UPDATE ---- */
router.put('/api/opportunities/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

/* ---- SOFT DELETE (admin only) ---- */
router.delete('/api/opportunities/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Oportunidad eliminada');
});

/* ---- STATUS TRANSITION ---- */
router.put('/api/opportunities/:id/status', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.changeStatus(event.pathParameters!.id!, body, user));
});

/* ---- CHECK MARGIN ---- */
router.post('/api/opportunities/:id/check-margin', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.checkMargin(
    event.pathParameters!.id!,
    body.estimated_cost_usd ?? null,
    user,
  ));
});

/* ---- Lambda handler ---- */
export const handler = async (event: APIGatewayProxyEventV2) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
