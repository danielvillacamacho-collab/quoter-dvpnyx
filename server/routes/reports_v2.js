/**
 * Reports V2 — Dashboard-oriented aggregate endpoints.
 *
 * Unlike reports.js (table-level detail), these endpoints return pre-shaped
 * payloads with KPIs, distributions, and by-area breakdowns so the frontend
 * dashboard can render them directly.
 *
 * Conventions match reports.js:
 *   - Utilization = COALESCE(SUM(active_assignment_hours), 0) / weekly_capacity_hours
 *   - Bench = utilization < 0.30 AND weekly_capacity_hours > 0
 *   - Coverage = assigned_hours / requested_hours per contract
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { serverError } = require('../utils/http');

router.use(auth);

// Placeholder — aggregate endpoints will be added in Phase 2-5.
router.get('/health', (_req, res) => res.json({ ok: true, module: 'reports_v2' }));

/** Delivery summary — KPIs, utilization by area, and distribution. */
router.get('/delivery', async (req, res) => {
  try {
    const areaFilter = req.query.area_id ? `AND e.area_id = $1` : '';
    const empParams = req.query.area_id ? [Number(req.query.area_id)] : [];

    const [empResult, contractResult, requestResult] = await Promise.all([
      // 1) Employee utilization with area — derives KPIs, by-area, and distribution.
      pool.query(
        `SELECT e.id,
                e.weekly_capacity_hours,
                a.name AS area_name,
                COALESCE(SUM(asg.weekly_hours), 0)::numeric AS assigned_hours,
                CASE WHEN e.weekly_capacity_hours > 0
                     THEN COALESCE(SUM(asg.weekly_hours), 0) / e.weekly_capacity_hours
                     ELSE 0
                END AS utilization
           FROM employees e
           LEFT JOIN assignments asg
                  ON asg.employee_id = e.id
                 AND asg.status = 'active'
                 AND asg.deleted_at IS NULL
           LEFT JOIN areas a ON a.id = e.area_id
          WHERE e.deleted_at IS NULL
            AND e.status IN ('active', 'on_leave', 'bench')
            ${areaFilter}
          GROUP BY e.id, a.name`,
        empParams
      ),

      // 2) Coverage per contract — derives active_contracts and avg_coverage.
      pool.query(
        `SELECT c.id,
                COALESCE(SUM(rr.weekly_hours * rr.quantity)
                  FILTER (WHERE rr.status IN ('open','partially_filled','filled')
                            AND rr.deleted_at IS NULL), 0)::numeric AS requested_hours,
                COALESCE(SUM(asg.weekly_hours)
                  FILTER (WHERE asg.status = 'active'
                            AND asg.deleted_at IS NULL), 0)::numeric AS assigned_hours
           FROM contracts c
           LEFT JOIN resource_requests rr  ON rr.contract_id = c.id
           LEFT JOIN assignments       asg ON asg.contract_id = c.id
          WHERE c.deleted_at IS NULL
            AND c.status IN ('planned', 'active', 'paused')
          GROUP BY c.id`
      ),

      // 3) Open / critical request counts.
      pool.query(
        `SELECT COUNT(*)::int AS open_count,
                COUNT(*) FILTER (WHERE priority = 'critical')::int AS critical_count
           FROM resource_requests
          WHERE deleted_at IS NULL
            AND status IN ('open', 'partially_filled')`
      ),
    ]);

    // --- Derive employee-level KPIs ---
    const employees = empResult.rows;
    const activeEmployees = employees.length;
    const totalUtilization = employees.reduce((s, e) => s + Number(e.utilization), 0);
    const avgUtilization = activeEmployees > 0
      ? Math.round((totalUtilization / activeEmployees) * 100) / 100
      : 0;
    const benchCount = employees.filter(
      (e) => Number(e.utilization) < 0.30 && Number(e.weekly_capacity_hours) > 0
    ).length;

    // --- Utilization by area ---
    const areaMap = {};
    for (const e of employees) {
      const name = e.area_name || 'Sin área';
      if (!areaMap[name]) areaMap[name] = { total: 0, count: 0 };
      areaMap[name].total += Number(e.utilization);
      areaMap[name].count += 1;
    }
    const utilizationByArea = Object.entries(areaMap)
      .map(([name, v]) => ({
        name,
        avg_utilization: Math.round((v.total / v.count) * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.avg_utilization - a.avg_utilization);

    // --- Utilization distribution buckets ---
    // Buckets: [0, 0.25), [0.25, 0.50), [0.50, 0.75), [0.75, 1.00], (1.00, ∞)
    const dist = [0, 0, 0, 0, 0];
    for (const e of employees) {
      const u = Number(e.utilization);
      if (u > 1.00) dist[4]++;
      else if (u >= 0.75) dist[3]++;
      else if (u >= 0.50) dist[2]++;
      else if (u >= 0.25) dist[1]++;
      else dist[0]++;
    }
    const utilizationDistribution = [
      { name: '0-25%', value: dist[0] },
      { name: '25-50%', value: dist[1] },
      { name: '50-75%', value: dist[2] },
      { name: '75-100%', value: dist[3] },
      { name: '>100%', value: dist[4] },
    ];

    // --- Contract coverage KPIs ---
    const contracts = contractResult.rows;
    const activeContracts = contracts.length;
    const coverages = contracts.map((c) => {
      const req = Number(c.requested_hours);
      const asg = Number(c.assigned_hours);
      return req > 0 ? asg / req : 1;
    });
    const avgCoverage = activeContracts > 0
      ? Math.round((coverages.reduce((s, c) => s + c, 0) / activeContracts) * 100) / 100
      : 0;

    // --- Request KPIs ---
    const reqRow = requestResult.rows[0];
    const openRequests = reqRow.open_count;
    const criticalRequests = reqRow.critical_count;

    res.json({
      kpis: {
        active_employees: activeEmployees,
        avg_utilization: avgUtilization,
        bench_count: benchCount,
        active_contracts: activeContracts,
        avg_coverage: avgCoverage,
        open_requests: openRequests,
        critical_requests: criticalRequests,
      },
      utilization_by_area: utilizationByArea,
      utilization_distribution: utilizationDistribution,
    });
  } catch (err) { serverError(res, 'GET /reports_v2/delivery', err); }
});

/** People summary — compliance KPIs, by-area breakdown, and distribution. */
router.get('/people', async (req, res) => {
  try {
    const now = new Date();
    const fromDate = req.query.from || new Date(now.getTime() - 28 * 86400000).toISOString().slice(0, 10);
    const toDate = req.query.to || now.toISOString().slice(0, 10);

    // Number of weeks in the range (at least 1 to avoid division by zero).
    const msInRange = new Date(toDate).getTime() - new Date(fromDate).getTime();
    const weeks = Math.max(msInRange / (7 * 86400000), 1);

    const [complianceResult, benchResult, openPosResult] = await Promise.all([
      // 1) Compliance per active employee: logged hours vs expected (capacity × weeks).
      pool.query(
        `SELECT e.id,
                e.weekly_capacity_hours,
                a.name AS area_name,
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
          WHERE e.deleted_at IS NULL
            AND e.status = 'active'
          GROUP BY e.id, a.name`,
        [fromDate, toDate, weeks]
      ),

      // 2) Bench count — employees with utilization < 0.30.
      pool.query(
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
                END < 0.30`
      ),

      // 3) Open positions — SUM(quantity - filled) from resource_requests.
      pool.query(
        `SELECT COALESCE(SUM(rr.quantity - COALESCE(filled.cnt, 0)), 0)::int AS open_positions
           FROM resource_requests rr
           LEFT JOIN (
             SELECT asg.resource_request_id, COUNT(*)::int AS cnt
               FROM assignments asg
              WHERE asg.status = 'active'
                AND asg.deleted_at IS NULL
              GROUP BY asg.resource_request_id
           ) filled ON filled.resource_request_id = rr.id
          WHERE rr.deleted_at IS NULL
            AND rr.status IN ('open', 'partially_filled')`
      ),
    ]);

    // --- Derive compliance KPIs ---
    const employees = complianceResult.rows;
    const totalActive = employees.length;
    const totalCompliance = employees.reduce((s, e) => s + Number(e.compliance), 0);
    const avgCompliance = totalActive > 0
      ? Math.round((totalCompliance / totalActive) * 100) / 100
      : 0;
    const lowComplianceCount = employees.filter((e) => Number(e.compliance) < 0.75).length;
    const benchCount = benchResult.rows.length;
    const openPositions = openPosResult.rows[0]?.open_positions ?? 0;

    // --- Compliance by area ---
    const areaMap = {};
    for (const e of employees) {
      const name = e.area_name || 'Sin área';
      if (!areaMap[name]) areaMap[name] = { total: 0, count: 0 };
      areaMap[name].total += Number(e.compliance);
      areaMap[name].count += 1;
    }
    const complianceByArea = Object.entries(areaMap)
      .map(([name, v]) => ({
        name,
        avg_compliance: Math.round((v.total / v.count) * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.avg_compliance - a.avg_compliance);

    // --- Compliance distribution buckets ---
    const dist = [0, 0, 0, 0, 0];
    for (const e of employees) {
      const c = Number(e.compliance);
      if (c > 1.00) dist[4]++;
      else if (c >= 0.75) dist[3]++;
      else if (c >= 0.50) dist[2]++;
      else if (c >= 0.25) dist[1]++;
      else dist[0]++;
    }
    const complianceDistribution = [
      { name: '0-25%', value: dist[0] },
      { name: '25-50%', value: dist[1] },
      { name: '50-75%', value: dist[2] },
      { name: '75-100%', value: dist[3] },
      { name: '>100%', value: dist[4] },
    ];

    res.json({
      kpis: {
        total_active: totalActive,
        avg_compliance: avgCompliance,
        low_compliance_count: lowComplianceCount,
        open_positions: openPositions,
        bench_count: benchCount,
      },
      compliance_by_area: complianceByArea,
      compliance_distribution: complianceDistribution,
    });
  } catch (err) { serverError(res, 'GET /reports_v2/people', err); }
});

module.exports = router;
