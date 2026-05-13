import type { APIGatewayProxyEvent } from 'aws-lambda';
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

  const [plannerResult, { rows: requestRows }] = await Promise.all([
    service.getPlanner(filters),
    db.query(
      `SELECT rr.id, rr.contract_id, rr.role_title, rr.level, rr.area_id, rr.weekly_hours,
              rr.start_date, rr.end_date, rr.quantity, rr.status,
              c.name AS contract_name, cl.name AS client_name, a.name AS area_name,
              COALESCE(filled.cnt, 0)::int AS filled_count
         FROM resource_requests rr
         JOIN contracts c ON c.id = rr.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN areas a ON a.id = rr.area_id
         LEFT JOIN (
           SELECT resource_request_id, COUNT(*)::int AS cnt
             FROM assignments
             WHERE deleted_at IS NULL AND status <> 'cancelled'
             GROUP BY resource_request_id
         ) filled ON filled.resource_request_id = rr.id
         WHERE rr.deleted_at IS NULL
           AND rr.status IN ('open', 'partially_filled')
         ORDER BY rr.start_date, rr.level
         LIMIT 200`,
    ),
  ]);

  const open_requests = (requestRows as Record<string, unknown>[]).map(rr => ({
    ...rr,
    weekly_hours: Number(rr.weekly_hours),
    quantity: Number(rr.quantity) || 1,
    filled_count: Number(rr.filled_count) || 0,
    missing: Math.max(0, (Number(rr.quantity) || 1) - (Number(rr.filled_count) || 0)),
  }));

  return ok({ ...plannerResult, open_requests });
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
