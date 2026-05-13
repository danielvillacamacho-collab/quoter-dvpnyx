import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok } from '@shared/http/response';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin, isAtLeast } from '@shared/auth/rbac';
import { BadRequest } from '@shared/errors';
import { getPool } from '@shared/db/connection';
import { createReportsRepository } from './repository';

const db = getPool();
const repo = createReportsRepository(db);

const router = createRouter();

/* ---- EI-2: Utilization ---- */
router.get('/api/reports/utilization', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  return ok(await repo.utilization({ area_id: qs.area_id }));
});

/* ---- EI-3: Bench ---- */
router.get('/api/reports/bench', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const threshold = qs.threshold ? Number(qs.threshold) : undefined;
  return ok(await repo.bench(threshold));
});

/* ---- EI-4: Pending Requests ---- */
router.get('/api/reports/pending-requests', async (_event, _user) => {
  return ok(await repo.pendingRequests());
});

/* ---- EI-5: Hiring Needs ---- */
router.get('/api/reports/hiring-needs', async (_event, _user) => {
  return ok(await repo.hiringNeeds());
});

/* ---- EI-6: Coverage ---- */
router.get('/api/reports/coverage', async (_event, _user) => {
  return ok(await repo.coverage());
});

/* ---- EI-7: Time Compliance ---- */
router.get('/api/reports/time-compliance', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const from = qs.from || new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
  const to = qs.to || new Date().toISOString().slice(0, 10);
  return ok(await repo.timeCompliance(from, to));
});

/* ---- EI-8: Plan vs Real ---- */
router.get('/api/reports/plan-vs-real', async (event, user) => {
  const qs = event.queryStringParameters || {};
  return ok(await repo.planVsReal({
    week_start: qs.week_start,
    employee_id: qs.employee_id,
    manager_id: qs.manager_id,
  }, user));
});

/* ---- ED-1: My Dashboard ---- */
router.get('/api/reports/my-dashboard', async (_event, user) => {
  return ok(await repo.myDashboard(user.id));
});

/* ---- V2 generic aggregate endpoint ---- */
router.get('/api/reports/v2/:type', async (event, user) => {
  const type = event.pathParameters?.type;
  if (!type) throw new BadRequest('Tipo de reporte requerido');

  if (type === 'delivery') {
    if (!isAtLeast(user, 'lead')) {
      requireAdmin(user);
    }
    const qs = event.queryStringParameters || {};
    const areaFilter = qs.area_id ? `AND e.area_id = $1` : '';
    const empParams: unknown[] = qs.area_id ? [Number(qs.area_id)] : [];

    const [empResult, contractResult, requestResult] = await Promise.all([
      db.query(
        `SELECT e.id, e.weekly_capacity_hours, a.name AS area_name,
                COALESCE(SUM(asg.weekly_hours), 0)::numeric AS assigned_hours,
                CASE WHEN e.weekly_capacity_hours > 0
                     THEN COALESCE(SUM(asg.weekly_hours), 0) / e.weekly_capacity_hours
                     ELSE 0
                END AS utilization
           FROM employees e
           LEFT JOIN assignments asg ON asg.employee_id = e.id AND asg.status = 'active' AND asg.deleted_at IS NULL
           LEFT JOIN areas a ON a.id = e.area_id
          WHERE e.deleted_at IS NULL AND e.status IN ('active', 'on_leave', 'bench') ${areaFilter}
          GROUP BY e.id, a.name`,
        empParams,
      ),
      db.query(
        `SELECT c.id,
                COALESCE(SUM(rr.weekly_hours * rr.quantity) FILTER (WHERE rr.status IN ('open','partially_filled','filled') AND rr.deleted_at IS NULL), 0)::numeric AS requested_hours,
                COALESCE(SUM(asg.weekly_hours) FILTER (WHERE asg.status = 'active' AND asg.deleted_at IS NULL), 0)::numeric AS assigned_hours
           FROM contracts c
           LEFT JOIN resource_requests rr ON rr.contract_id = c.id
           LEFT JOIN assignments asg ON asg.contract_id = c.id
          WHERE c.deleted_at IS NULL AND c.status IN ('planned', 'active', 'paused')
          GROUP BY c.id`,
      ),
      db.query(
        `SELECT COUNT(*)::int AS open_count,
                COUNT(*) FILTER (WHERE priority = 'critical')::int AS critical_count
           FROM resource_requests
          WHERE deleted_at IS NULL AND status IN ('open', 'partially_filled')`,
      ),
    ]);

    const employees = empResult.rows;
    const activeEmployees = employees.length;
    const totalUtilization = employees.reduce((s: number, e: Record<string, unknown>) => s + Number(e.utilization), 0);
    const avgUtilization = activeEmployees > 0 ? Math.round((totalUtilization / activeEmployees) * 100) / 100 : 0;
    const benchCount = employees.filter(
      (e: Record<string, unknown>) => Number(e.utilization) < 0.30 && Number(e.weekly_capacity_hours) > 0,
    ).length;

    const areaMap: Record<string, { total: number; count: number }> = {};
    for (const e of employees) {
      const name = (e.area_name as string) || 'Sin área';
      if (!areaMap[name]) areaMap[name] = { total: 0, count: 0 };
      areaMap[name].total += Number(e.utilization);
      areaMap[name].count += 1;
    }
    const utilizationByArea = Object.entries(areaMap)
      .map(([name, v]) => ({ name, avg_utilization: Math.round((v.total / v.count) * 100) / 100, count: v.count }))
      .sort((a, b) => b.avg_utilization - a.avg_utilization);

    const dist = [0, 0, 0, 0, 0];
    for (const e of employees) {
      const u = Number(e.utilization);
      if (u > 1.00) dist[4]++;
      else if (u >= 0.75) dist[3]++;
      else if (u >= 0.50) dist[2]++;
      else if (u >= 0.25) dist[1]++;
      else dist[0]++;
    }

    const contracts = contractResult.rows;
    const activeContracts = contracts.length;
    const coverages = contracts.map((c: Record<string, unknown>) => {
      const req = Number(c.requested_hours);
      const asg = Number(c.assigned_hours);
      return req > 0 ? asg / req : 1;
    });
    const avgCoverage = activeContracts > 0
      ? Math.round((coverages.reduce((s: number, c: number) => s + c, 0) / activeContracts) * 100) / 100
      : 0;

    const reqRow = requestResult.rows[0];

    return ok({
      kpis: {
        active_employees: activeEmployees,
        avg_utilization: avgUtilization,
        bench_count: benchCount,
        active_contracts: activeContracts,
        avg_coverage: avgCoverage,
        open_requests: reqRow.open_count,
        critical_requests: reqRow.critical_count,
      },
      utilization_by_area: utilizationByArea,
      utilization_distribution: [
        { name: '0-25%', value: dist[0] },
        { name: '25-50%', value: dist[1] },
        { name: '50-75%', value: dist[2] },
        { name: '75-100%', value: dist[3] },
        { name: '>100%', value: dist[4] },
      ],
    });
  }

  throw new BadRequest(`Tipo de reporte no soportado: ${type}`);
});

/* ---- Dashboard Overview ---- */
router.get('/api/dashboard/overview', async (_event, _user) => {
  return ok(await repo.overview());
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
