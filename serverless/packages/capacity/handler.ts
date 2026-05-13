import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok } from '@shared/http/response';
import { withAuth } from '@shared/auth/middleware';
import { getPool } from '@shared/db/connection';
import { createCapacityRepository } from './repository';
import { createCapacityService } from './service';
import type { PlannerFilters } from './types';

const CONTRACT_COLORS = [
  '#7c3aed','#0ea5e9','#10b981','#f59e0b',
  '#ef4444','#8b5cf6','#06b6d4','#84cc16',
  '#f97316','#ec4899','#64748b','#a855f7',
];

function colorFor(contractId: string): string {
  if (!contractId) return CONTRACT_COLORS[0];
  let h = 0;
  for (let i = 0; i < contractId.length; i++) h = ((h << 5) - h + contractId.charCodeAt(i)) | 0;
  return CONTRACT_COLORS[Math.abs(h) % CONTRACT_COLORS.length];
}

function isoWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function transformPlannerResult(result: { employees: any[]; weeks: string[]; summary: any }) {
  const weekObjs = result.weeks.map((start: string, index: number) => {
    const w = isoWeekNumber(start);
    return { index, start_date: start, iso_week: w, label: `S${w}` };
  });

  const employees = result.employees.map((emp: any) => {
    const assignmentMap = new Map<string, any>();
    (emp.weeks as any[]).forEach((weekData: any, wi: number) => {
      for (const asg of weekData.assignments as any[]) {
        const id = asg.assignment_id;
        if (!assignmentMap.has(id)) {
          assignmentMap.set(id, {
            id,
            contract_id: asg.contract_id,
            contract_name: asg.contract_name,
            client_name: asg.client_name,
            role_title: asg.role_title,
            weekly_hours: asg.weekly_hours,
            status: asg.status,
            color: colorFor(asg.contract_id),
            week_range: [wi, wi],
          });
        } else {
          const e = assignmentMap.get(id)!;
          e.week_range = [Math.min(e.week_range[0], wi), Math.max(e.week_range[1], wi)];
        }
      }
    });

    return {
      ...emp,
      id: emp.employee_id,
      full_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
      weekly: (emp.weeks as any[]).map((w: any) => ({
        hours: w.total_hours,
        utilization_pct: w.utilization_pct,
        bucket: w.bucket,
        actual_hours: 0,
      })),
      assignments: Array.from(assignmentMap.values()),
      inactive: emp.status !== 'active',
    };
  });

  return { ...result, weeks: weekObjs, employees };
}

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

  return ok({ ...transformPlannerResult(plannerResult), open_requests });
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
