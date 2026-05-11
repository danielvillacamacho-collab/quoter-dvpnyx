import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok } from '@shared/http/response';
import { withAuth } from '@shared/auth/middleware';
import { getPool } from '@shared/db/connection';
import { createCapacityRepository } from './repository';
import { createCapacityService } from './service';
import type { PlannerFilters } from './types';

const db = getPool();
const repo = createCapacityRepository(db);
const service = createCapacityService(repo);

const router = createRouter();

router.get('/api/capacity/planner', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const filters: PlannerFilters = {
    date_from: qs.date_from,
    date_to: qs.date_to,
    area_id: qs.area_id,
    level: qs.level,
    status: qs.status,
    employee_id: qs.employee_id,
    country: qs.country,
  };
  return ok(await service.getPlanner(filters));
});

export const handler = async (event: APIGatewayProxyEventV2) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
