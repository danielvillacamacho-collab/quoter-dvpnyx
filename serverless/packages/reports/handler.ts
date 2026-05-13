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

  if (type === 'people') {
    const qs = event.queryStringParameters || {};
    const now = new Date();
    const fromDate = qs.from || new Date(now.getTime() - 28 * 86400000).toISOString().slice(0, 10);
    const toDate = qs.to || now.toISOString().slice(0, 10);
    const msInRange = new Date(toDate).getTime() - new Date(fromDate).getTime();
    const weeks = Math.max(msInRange / (7 * 86400000), 1);

    const [complianceResult, benchResult, openPosResult] = await Promise.all([
      db.query(
        `SELECT e.id, e.weekly_capacity_hours, a.name AS area_name,
                COALESCE(SUM(te.hours), 0)::numeric AS logged_hours,
                CASE WHEN e.weekly_capacity_hours > 0
                     THEN COALESCE(SUM(te.hours), 0) / (e.weekly_capacity_hours * $3)
                     ELSE 0
                END AS compliance
           FROM employees e
           LEFT JOIN time_entries te
                  ON te.employee_id = e.id
                 AND te.work_date BETWEEN $1 AND $2
                 AND te.deleted_at IS NULL
           LEFT JOIN areas a ON a.id = e.area_id
          WHERE e.deleted_at IS NULL AND e.status = 'active'
          GROUP BY e.id, a.name`,
        [fromDate, toDate, weeks],
      ),
      db.query(
        `SELECT COUNT(*)::int AS bench_count
           FROM employees e
           LEFT JOIN assignments asg
                  ON asg.employee_id = e.id
                 AND asg.status = 'active'
                 AND asg.deleted_at IS NULL
          WHERE e.deleted_at IS NULL
            AND e.status IN ('active', 'on_leave', 'bench')
            AND e.weekly_capacity_hours > 0
          GROUP BY e.id, e.weekly_capacity_hours
         HAVING CASE WHEN e.weekly_capacity_hours > 0
                     THEN COALESCE(SUM(asg.weekly_hours), 0) / e.weekly_capacity_hours
                     ELSE 0
                END < 0.30`,
      ),
      db.query(
        `SELECT COALESCE(SUM(rr.quantity - COALESCE(filled.cnt, 0)), 0)::int AS open_positions
           FROM resource_requests rr
           LEFT JOIN (
             SELECT asg.resource_request_id, COUNT(*)::int AS cnt
               FROM assignments asg
              WHERE asg.status = 'active' AND asg.deleted_at IS NULL
              GROUP BY asg.resource_request_id
           ) filled ON filled.resource_request_id = rr.id
          WHERE rr.deleted_at IS NULL AND rr.status IN ('open', 'partially_filled')`,
      ),
    ]);

    const employees = complianceResult.rows as Record<string, unknown>[];
    const totalActive = employees.length;
    const totalCompliance = employees.reduce((s, e) => s + Number(e.compliance), 0);
    const avgCompliance = totalActive > 0 ? Math.round((totalCompliance / totalActive) * 100) / 100 : 0;
    const lowComplianceCount = employees.filter((e) => Number(e.compliance) < 0.75).length;
    const benchCount = benchResult.rows.length;
    const openPositions = openPosResult.rows[0]?.open_positions ?? 0;

    const areaMap: Record<string, { total: number; count: number }> = {};
    for (const e of employees) {
      const name = (e.area_name as string) || 'Sin área';
      if (!areaMap[name]) areaMap[name] = { total: 0, count: 0 };
      areaMap[name].total += Number(e.compliance);
      areaMap[name].count += 1;
    }
    const complianceByArea = Object.entries(areaMap)
      .map(([name, v]) => ({ name, avg_compliance: Math.round((v.total / v.count) * 100) / 100, count: v.count }))
      .sort((a, b) => b.avg_compliance - a.avg_compliance);

    const dist = [0, 0, 0, 0, 0];
    for (const e of employees) {
      const c = Number(e.compliance);
      if (c > 1.00) dist[4]++;
      else if (c >= 0.75) dist[3]++;
      else if (c >= 0.50) dist[2]++;
      else if (c >= 0.25) dist[1]++;
      else dist[0]++;
    }

    return ok({
      kpis: { total_active: totalActive, avg_compliance: avgCompliance, low_compliance_count: lowComplianceCount, open_positions: openPositions, bench_count: benchCount },
      compliance_by_area: complianceByArea,
      compliance_distribution: [
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

/* ---- Deviations (plan vs actual hours) ---- */
router.get('/api/reports/deviations', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const now = new Date();
  const from = qs.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const toDefault = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = qs.to || toDefault.toISOString().slice(0, 10);
  const groupBy = qs.group_by === 'project' ? 'project' : 'person';
  const areaId = qs.area_id ? Number(qs.area_id) : null;
  const contractId = qs.contract_id ? String(qs.contract_id) : null;

  function businessDays(f: string, t: string): number {
    let count = 0;
    const d = new Date(f);
    const end = new Date(t);
    while (d <= end) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  function clampDate(dateStr: string, lo: string, hi: string): string {
    if (dateStr < lo) return lo;
    if (dateStr > hi) return hi;
    return dateStr;
  }

  if (groupBy === 'person') {
    const empFilters = [`e.deleted_at IS NULL`, `e.status IN ('active','on_leave','bench')`];
    const empParams: unknown[] = [];
    if (areaId) { empParams.push(areaId); empFilters.push(`e.area_id = $${empParams.length}`); }

    const { rows: employees } = await db.query(
      `SELECT e.id, (e.first_name || ' ' || e.last_name) AS employee_name,
              a.name AS area_name, e.level
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
        WHERE ${empFilters.join(' AND ')}
        ORDER BY e.last_name, e.first_name`,
      empParams,
    );
    if (!employees.length) return ok({ data: [] });

    const empIds = employees.map((e: Record<string, unknown>) => e.id);

    const asgParams: unknown[] = [empIds, from, to];
    let asgFilter = '';
    if (contractId) { asgParams.push(contractId); asgFilter = ` AND asg.contract_id = $${asgParams.length}`; }

    const { rows: assignments } = await db.query(
      `SELECT asg.employee_id, asg.weekly_hours, asg.start_date, asg.end_date
         FROM assignments asg
        WHERE asg.employee_id = ANY($1::uuid[])
          AND asg.deleted_at IS NULL
          AND asg.status IN ('active','planned')
          AND asg.start_date <= $3::date
          AND (asg.end_date IS NULL OR asg.end_date >= $2::date)
          ${asgFilter}`,
      asgParams,
    );

    const teParams: unknown[] = [empIds, from, to];
    let teFilter = '';
    let teJoin = '';
    if (contractId) {
      teParams.push(contractId);
      teJoin = 'JOIN assignments asg ON asg.id = te.assignment_id';
      teFilter = ` AND asg.contract_id = $${teParams.length}::uuid`;
    }

    const { rows: timeRows } = await db.query(
      `SELECT te.employee_id, COALESCE(SUM(te.hours), 0)::numeric AS total_hours
         FROM time_entries te ${teJoin}
        WHERE te.employee_id = ANY($1::uuid[])
          AND te.work_date >= $2::date AND te.work_date <= $3::date
          AND te.deleted_at IS NULL ${teFilter}
        GROUP BY te.employee_id`,
      teParams,
    );
    const actualMap: Record<string, number> = {};
    (timeRows as Record<string, unknown>[]).forEach((r) => { actualMap[r.employee_id as string] = Number(r.total_hours); });

    const plannedMap: Record<string, number> = {};
    (assignments as Record<string, unknown>[]).forEach((asg) => {
      const asgStart = asg.start_date ? String(asg.start_date).slice(0, 10) : from;
      const asgEnd   = asg.end_date   ? String(asg.end_date).slice(0, 10)   : to;
      const bDays = businessDays(clampDate(asgStart, from, to), clampDate(asgEnd, from, to));
      plannedMap[asg.employee_id as string] = (plannedMap[asg.employee_id as string] || 0) + (Number(asg.weekly_hours) / 5) * bDays;
    });

    const data = (employees as Record<string, unknown>[]).map((emp) => {
      const planned  = Math.round((plannedMap[emp.id as string] || 0) * 100) / 100;
      const actual   = Math.round((actualMap[emp.id as string] || 0) * 100) / 100;
      const deviation = Math.round((actual - planned) * 100) / 100;
      return {
        employee_id: emp.id, employee_name: emp.employee_name, area_name: emp.area_name, level: emp.level,
        planned_hours: planned, actual_hours: actual, deviation_hours: deviation,
        deviation_pct: planned > 0 ? Math.round((deviation / planned) * 10000) / 100 : 0,
      };
    });

    return ok({ data });
  }

  // --- Project view ---
  const cFilters = [`c.deleted_at IS NULL`, `c.status IN ('planned','active','paused')`];
  const cParams: unknown[] = [];
  if (contractId) { cParams.push(contractId); cFilters.push(`c.id = $${cParams.length}`); }

  const { rows: contracts } = await db.query(
    `SELECT c.id, c.name AS contract_name, cl.name AS client_name
       FROM contracts c
       LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE ${cFilters.join(' AND ')}
      ORDER BY c.name`,
    cParams,
  );
  if (!contracts.length) return ok({ data: [] });

  const contractIds = (contracts as Record<string, unknown>[]).map((c) => c.id);

  const asgParams2: unknown[] = [contractIds, from, to];
  let asgFilter2 = '';
  if (areaId) { asgParams2.push(areaId); asgFilter2 = ` AND e.area_id = $${asgParams2.length}`; }

  const { rows: assignments2 } = await db.query(
    `SELECT asg.contract_id, asg.weekly_hours, asg.start_date, asg.end_date
       FROM assignments asg
       ${areaId ? 'JOIN employees e ON e.id = asg.employee_id' : ''}
      WHERE asg.contract_id = ANY($1::uuid[])
        AND asg.deleted_at IS NULL
        AND asg.status IN ('active','planned')
        AND asg.start_date <= $3::date
        AND (asg.end_date IS NULL OR asg.end_date >= $2::date)
        ${asgFilter2}`,
    asgParams2,
  );

  const teParams2: unknown[] = [contractIds, from, to];
  let teFilter2 = '';
  if (areaId) { teParams2.push(areaId); teFilter2 = ` AND e.area_id = $${teParams2.length}`; }

  const { rows: timeRows2 } = await db.query(
    `SELECT asg.contract_id, COALESCE(SUM(te.hours), 0)::numeric AS total_hours
       FROM time_entries te
       JOIN assignments asg ON asg.id = te.assignment_id
       ${areaId ? 'JOIN employees e ON e.id = te.employee_id' : ''}
      WHERE asg.contract_id = ANY($1::uuid[])
        AND te.work_date >= $2::date AND te.work_date <= $3::date
        AND te.deleted_at IS NULL ${teFilter2}
      GROUP BY asg.contract_id`,
    teParams2,
  );
  const actualMap2: Record<string, number> = {};
  (timeRows2 as Record<string, unknown>[]).forEach((r) => { actualMap2[r.contract_id as string] = Number(r.total_hours); });

  const plannedMap2: Record<string, number> = {};
  (assignments2 as Record<string, unknown>[]).forEach((asg) => {
    const asgStart = asg.start_date ? String(asg.start_date).slice(0, 10) : from;
    const asgEnd   = asg.end_date   ? String(asg.end_date).slice(0, 10)   : to;
    const bDays = businessDays(clampDate(asgStart, from, to), clampDate(asgEnd, from, to));
    plannedMap2[asg.contract_id as string] = (plannedMap2[asg.contract_id as string] || 0) + (Number(asg.weekly_hours) / 5) * bDays;
  });

  const data = (contracts as Record<string, unknown>[]).map((c) => {
    const planned  = Math.round((plannedMap2[c.id as string] || 0) * 100) / 100;
    const actual   = Math.round((actualMap2[c.id as string] || 0) * 100) / 100;
    const deviation = Math.round((actual - planned) * 100) / 100;
    return {
      contract_id: c.id, contract_name: c.contract_name, client_name: c.client_name,
      planned_hours: planned, actual_hours: actual, deviation_hours: deviation,
      deviation_pct: planned > 0 ? Math.round((deviation / planned) * 10000) / 100 : 0,
    };
  });

  return ok({ data });
});

/* ---- Dashboard Overview ---- */
router.get('/api/dashboard/overview', async (_event, _user) => {
  return ok(await repo.overview());
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
