import type { Pool } from 'pg';
import type {
  UtilizationRow,
  BenchRow,
  PendingRequestRow,
  HiringNeedsRow,
  CoverageRow,
  TimeComplianceRow,
  PlanVsRealResult,
  PlanVsRealRow,
  PlanVsRealLine,
  MyDashboardResult,
  OverviewResult,
  UtilizationFilters,
  TimeComplianceFilters,
  PlanVsRealFilters,
} from './types';
import type { AuthUser } from '@shared/types';

const TOLERANCE_PP = 10;

/** Snap a date string to its Monday. */
function toMonday(raw?: string): string {
  const d = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(raw + 'T00:00:00Z')
    : new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface ReportsRepository {
  utilization(filters: UtilizationFilters): Promise<{ data: UtilizationRow[] }>;
  bench(threshold?: number): Promise<{ data: BenchRow[]; threshold: number }>;
  pendingRequests(): Promise<{ data: PendingRequestRow[] }>;
  hiringNeeds(): Promise<{ data: HiringNeedsRow[] }>;
  coverage(): Promise<{ data: CoverageRow[] }>;
  timeCompliance(from: string, to: string): Promise<{ data: TimeComplianceRow[]; from: string; to: string }>;
  planVsReal(filters: PlanVsRealFilters, user: AuthUser): Promise<PlanVsRealResult>;
  myDashboard(userId: string): Promise<MyDashboardResult>;
  overview(): Promise<OverviewResult>;
}

export function createReportsRepository(db: Pool): ReportsRepository {
  return {
    /* ---- Utilization ---- */
    async utilization(filters) {
      const areaFilter = filters.area_id ? 'AND e.area_id = $1' : '';
      const params: unknown[] = filters.area_id ? [Number(filters.area_id)] : [];

      const { rows } = await db.query(
        `SELECT e.id, e.first_name, e.last_name, e.level, e.country, e.status,
                e.weekly_capacity_hours,
                a.name AS area_name,
                COALESCE(SUM(asg.weekly_hours), 0)::numeric AS assigned_weekly_hours,
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
          GROUP BY e.id, a.name
          ORDER BY utilization DESC, e.last_name, e.first_name`,
        params,
      );
      return { data: rows };
    },

    /* ---- Bench ---- */
    async bench(threshold = 0.30) {
      const { rows } = await db.query(
        `SELECT e.id, e.first_name, e.last_name, e.level, e.country, e.status,
                e.weekly_capacity_hours,
                a.name AS area_name,
                COALESCE(SUM(asg.weekly_hours), 0)::numeric AS assigned_weekly_hours,
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
            AND e.status IN ('active', 'bench')
          GROUP BY e.id, a.name
          HAVING e.weekly_capacity_hours > 0 AND
                 (COALESCE(SUM(asg.weekly_hours), 0) / e.weekly_capacity_hours) < $1
          ORDER BY utilization ASC, e.last_name`,
        [threshold],
      );
      return { data: rows, threshold };
    },

    /* ---- Pending Requests ---- */
    async pendingRequests() {
      const { rows } = await db.query(
        `SELECT rr.id, rr.role_title, rr.level, rr.country, rr.quantity,
                rr.priority, rr.status, rr.start_date, rr.created_at,
                c.name AS contract_name, cl.name AS client_name,
                (SELECT COUNT(*)::int FROM assignments
                   WHERE resource_request_id=rr.id AND status='active' AND deleted_at IS NULL) AS active_assignments,
                EXTRACT(EPOCH FROM (NOW() - rr.created_at))/86400.0 AS age_days
           FROM resource_requests rr
           LEFT JOIN contracts c  ON c.id = rr.contract_id
           LEFT JOIN clients   cl ON cl.id = c.client_id
          WHERE rr.deleted_at IS NULL
            AND rr.status IN ('open','partially_filled')
          ORDER BY
            CASE rr.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            rr.created_at ASC`,
      );
      return { data: rows };
    },

    /* ---- Hiring Needs ---- */
    async hiringNeeds() {
      const { rows } = await db.query(
        `SELECT a.id AS area_id, a.name AS area_name,
                rr.level, COALESCE(rr.country, 'Sin definir') AS country,
                SUM(rr.quantity - COALESCE(filled.count, 0)) AS open_slots,
                COUNT(DISTINCT rr.id)::int AS requests_count,
                ARRAY_AGG(DISTINCT rr.priority) AS priorities
           FROM resource_requests rr
           JOIN areas a ON a.id = rr.area_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS count
               FROM assignments asg
              WHERE asg.resource_request_id = rr.id
                AND asg.status = 'active'
                AND asg.deleted_at IS NULL
           ) filled ON true
          WHERE rr.deleted_at IS NULL
            AND rr.status IN ('open','partially_filled')
          GROUP BY a.id, a.name, rr.level, rr.country
          HAVING SUM(rr.quantity - COALESCE(filled.count, 0)) > 0
          ORDER BY open_slots DESC, a.name, rr.level`,
      );
      return { data: rows };
    },

    /* ---- Coverage ---- */
    async coverage() {
      const { rows } = await db.query(
        `SELECT c.id, c.name, c.type, c.status,
                cl.name AS client_name,
                COALESCE(SUM(rr.weekly_hours * rr.quantity) FILTER (WHERE rr.status IN ('open','partially_filled','filled') AND rr.deleted_at IS NULL), 0)::numeric AS requested_weekly_hours,
                COALESCE(SUM(asg.weekly_hours) FILTER (WHERE asg.status='active' AND asg.deleted_at IS NULL), 0)::numeric AS assigned_weekly_hours,
                CASE WHEN COALESCE(SUM(rr.weekly_hours * rr.quantity) FILTER (WHERE rr.status IN ('open','partially_filled','filled') AND rr.deleted_at IS NULL), 0) > 0
                     THEN COALESCE(SUM(asg.weekly_hours) FILTER (WHERE asg.status='active' AND asg.deleted_at IS NULL), 0)
                          / SUM(rr.weekly_hours * rr.quantity) FILTER (WHERE rr.status IN ('open','partially_filled','filled') AND rr.deleted_at IS NULL)
                     ELSE 1
                END AS coverage_pct,
                (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests_count
           FROM contracts c
           LEFT JOIN clients           cl  ON cl.id = c.client_id
           LEFT JOIN resource_requests rr  ON rr.contract_id = c.id
           LEFT JOIN assignments       asg ON asg.contract_id = c.id
          WHERE c.deleted_at IS NULL
            AND c.status IN ('planned','active','paused')
          GROUP BY c.id, cl.name
          ORDER BY coverage_pct ASC, c.name`,
      );
      return { data: rows };
    },

    /* ---- Time Compliance ---- */
    async timeCompliance(from, to) {
      const { rows } = await db.query(
        `SELECT e.id, e.first_name, e.last_name, e.level,
                a.name AS area_name,
                e.weekly_capacity_hours,
                COALESCE(te.total_hours, 0)::numeric AS total_logged_hours,
                (e.weekly_capacity_hours * GREATEST(1, ($2::date - $1::date + 1) / 7.0))::numeric AS expected_hours,
                CASE WHEN e.weekly_capacity_hours > 0
                  THEN COALESCE(te.total_hours, 0) / (e.weekly_capacity_hours * GREATEST(1, ($2::date - $1::date + 1) / 7.0))
                  ELSE 0
                END AS compliance_pct
           FROM employees e
           LEFT JOIN areas a ON a.id = e.area_id
           LEFT JOIN LATERAL (
             SELECT SUM(hours) AS total_hours
               FROM time_entries
              WHERE employee_id = e.id
                AND work_date >= $1::date AND work_date <= $2::date
                AND deleted_at IS NULL
           ) te ON true
          WHERE e.deleted_at IS NULL
            AND e.status IN ('active', 'on_leave')
          ORDER BY compliance_pct ASC, e.last_name`,
        [from, to],
      );
      return { data: rows, from, to };
    },

    /* ---- Plan vs Real ---- */
    async planVsReal(filters, user) {
      const isAdmin = ['admin', 'superadmin'].includes(user.role);
      const isLead = user.role === 'lead';

      const weekStart = toMonday(filters.week_start);
      const weekEnd = addDays(weekStart, 6);

      const empFilters = ["e.deleted_at IS NULL", "e.status IN ('active','on_leave','bench')"];
      const params: unknown[] = [weekStart, weekEnd];

      if (filters.employee_id) {
        params.push(filters.employee_id);
        empFilters.push(`e.id = $${params.length}`);
      }
      if (isLead) {
        params.push(user.id);
        empFilters.push(`e.manager_user_id = $${params.length}`);
      } else if (!isAdmin) {
        params.push(user.id);
        empFilters.push(`e.user_id = $${params.length}`);
      } else if (filters.manager_id) {
        params.push(filters.manager_id);
        empFilters.push(`e.manager_user_id = $${params.length}`);
      }

      const { rows: empRows } = await db.query(
        `SELECT e.id AS employee_id,
                (e.first_name || ' ' || e.last_name) AS employee_name,
                e.weekly_capacity_hours, e.level, ar.name AS area_name
           FROM employees e
           LEFT JOIN areas ar ON ar.id = e.area_id
          WHERE ${empFilters.join(' AND ')}
          ORDER BY e.first_name, e.last_name`,
        params,
      );

      if (!empRows.length) {
        return { week_start_date: weekStart, week_end_date: weekEnd, rows: [] };
      }

      const empIds = empRows.map((r: Record<string, unknown>) => r.employee_id);

      const { rows: asgRows } = await db.query(
        `SELECT a.id, a.employee_id, a.contract_id, a.role_title, a.weekly_hours,
                a.start_date, a.end_date, a.status,
                c.name AS contract_name
           FROM assignments a
           LEFT JOIN contracts c ON c.id = a.contract_id
          WHERE a.employee_id = ANY($1::uuid[])
            AND a.deleted_at IS NULL
            AND a.status IN ('planned','active')
            AND a.start_date <= $3::date
            AND (a.end_date IS NULL OR a.end_date >= $2::date)`,
        [empIds, weekStart, weekEnd],
      );

      const { rows: allocRows } = await db.query(
        `SELECT wta.employee_id, wta.assignment_id, wta.pct, wta.notes,
                c.name AS contract_name, a.role_title
           FROM weekly_time_allocations wta
           LEFT JOIN assignments a ON a.id = wta.assignment_id
           LEFT JOIN contracts   c ON c.id = a.contract_id
          WHERE wta.employee_id = ANY($1::uuid[])
            AND wta.week_start_date = $2::date`,
        [empIds, weekStart],
      );

      const result: PlanVsRealRow[] = empRows.map((emp: Record<string, unknown>) => {
        const cap = Number(emp.weekly_capacity_hours || 0) || 0;
        const empAsgs = asgRows.filter((a: Record<string, unknown>) => a.employee_id === emp.employee_id);
        const empAllocs = allocRows.filter((a: Record<string, unknown>) => a.employee_id === emp.employee_id);
        const hasActual = empAllocs.length > 0;

        const seen = new Set<string>();
        const lines: PlanVsRealLine[] = [];

        for (const a of empAsgs) {
          seen.add(a.id as string);
          const plannedPct = cap > 0 ? Math.round((Number(a.weekly_hours) / cap) * 1000) / 10 : 0;
          const allocRow = empAllocs.find((x: Record<string, unknown>) => x.assignment_id === a.id);
          const actualPct = allocRow ? Number(allocRow.pct) : null;
          let status: PlanVsRealLine['status'];
          if (actualPct == null) status = hasActual ? 'missing' : 'no_data';
          else if (Math.abs(actualPct - plannedPct) <= TOLERANCE_PP) status = 'on_plan';
          else if (actualPct > plannedPct) status = 'over';
          else status = 'under';
          lines.push({
            assignment_id: a.id as string,
            contract_id: a.contract_id as string | null,
            contract_name: a.contract_name as string | null,
            role_title: a.role_title as string | null,
            planned_hours: Number(a.weekly_hours),
            planned_pct: plannedPct,
            actual_pct: actualPct,
            diff_pct: actualPct == null ? null : Math.round((actualPct - plannedPct) * 10) / 10,
            status,
          });
        }

        for (const al of empAllocs) {
          if (al.assignment_id && seen.has(al.assignment_id as string)) continue;
          lines.push({
            assignment_id: al.assignment_id as string | null,
            contract_id: null,
            contract_name: (al.contract_name as string) || '(asignación no vigente)',
            role_title: al.role_title as string | null,
            planned_hours: 0,
            planned_pct: 0,
            actual_pct: Number(al.pct),
            diff_pct: Number(al.pct),
            status: 'unplanned',
          });
        }

        const totalPlanned = Math.round(lines.reduce((s, l) => s + (l.planned_pct || 0), 0) * 10) / 10;
        const totalActual = hasActual
          ? Math.round(lines.reduce((s, l) => s + (l.actual_pct || 0), 0) * 10) / 10
          : null;
        const benchPct = totalActual == null ? null : Math.max(0, Math.round((100 - totalActual) * 10) / 10);

        return {
          employee_id: emp.employee_id as string,
          employee_name: emp.employee_name as string,
          area_name: emp.area_name as string | null,
          level: emp.level as string | null,
          capacity_hours: cap,
          has_actual_data: hasActual,
          weekly_total_planned_pct: totalPlanned,
          weekly_total_actual_pct: totalActual,
          bench_pct: benchPct,
          lines,
        };
      });

      return { week_start_date: weekStart, week_end_date: weekEnd, rows: result };
    },

    /* ---- My Dashboard ---- */
    async myDashboard(userId) {
      const { rows: empRows } = await db.query(
        `SELECT id, first_name, last_name, weekly_capacity_hours
           FROM employees WHERE user_id=$1 AND deleted_at IS NULL`,
        [userId],
      );
      const employee = empRows[0] || null;

      if (!employee) {
        return {
          employee: null,
          active_assignments: [],
          week_hours: { logged: 0, expected: 0, capacity: 0 },
        };
      }

      const now = new Date();
      const day = now.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      const ws = new Date(now);
      ws.setUTCDate(ws.getUTCDate() + diff);
      ws.setUTCHours(0, 0, 0, 0);
      const weekStart = ws.toISOString().slice(0, 10);
      const weekEnd = addDays(weekStart, 6);

      const [asgRes, teRes] = await Promise.all([
        db.query(
          `SELECT a.*, c.name AS contract_name
             FROM assignments a
             LEFT JOIN contracts c ON c.id = a.contract_id
            WHERE a.employee_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL
            ORDER BY a.start_date`,
          [employee.id],
        ),
        db.query(
          `SELECT COALESCE(SUM(hours), 0) AS logged
             FROM time_entries
            WHERE employee_id = $1
              AND work_date >= $2::date AND work_date <= $3::date
              AND deleted_at IS NULL`,
          [employee.id, weekStart, weekEnd],
        ),
      ]);

      return {
        employee: {
          id: employee.id,
          first_name: employee.first_name,
          last_name: employee.last_name,
          weekly_capacity_hours: employee.weekly_capacity_hours,
        },
        active_assignments: asgRes.rows,
        week_hours: {
          logged: Number(teRes.rows[0].logged),
          expected: Number(employee.weekly_capacity_hours || 0),
          capacity: Number(employee.weekly_capacity_hours || 0),
          week_start: weekStart,
          week_end: weekEnd,
        },
      };
    },

    /* ---- Overview (executive dashboard) ---- */
    async overview() {
      const [assignmentsRes, requestsRes, employeesRes, contractsRes, opportunitiesRes, quotationsRes] =
        await Promise.all([
          db.query(
            `SELECT
               COUNT(*) FILTER (WHERE status = 'active')  ::int AS active_count,
               COUNT(*) FILTER (WHERE status = 'planned') ::int AS planned_count,
               COALESCE(SUM(weekly_hours) FILTER (WHERE status = 'active'), 0)::numeric AS weekly_hours
             FROM assignments WHERE deleted_at IS NULL`,
          ),
          db.query(
            `SELECT
               COUNT(*) FILTER (WHERE status IN ('open','partially_filled'))::int AS open_count,
               COALESCE(SUM(
                 GREATEST(
                   r.weekly_hours - COALESCE((
                     SELECT SUM(a.weekly_hours)
                       FROM assignments a
                      WHERE a.resource_request_id = r.id
                        AND a.deleted_at IS NULL
                        AND a.status IN ('planned','active')
                   ), 0), 0)
               ) FILTER (WHERE r.status IN ('open','partially_filled')), 0)::numeric AS open_hours_weekly
             FROM resource_requests r WHERE r.deleted_at IS NULL`,
          ),
          db.query(
            `SELECT
               COUNT(*) FILTER (WHERE status IN ('active','on_leave','bench'))::int AS total,
               COUNT(*) FILTER (WHERE status = 'bench')::int AS bench,
               COUNT(*) FILTER (WHERE status = 'active' AND utilization > 0)::int AS utilized
             FROM (
               SELECT e.id, e.status,
                      CASE WHEN e.weekly_capacity_hours > 0
                           THEN COALESCE(SUM(a.weekly_hours)
                                  FILTER (WHERE a.status = 'active' AND a.deleted_at IS NULL), 0)
                                / e.weekly_capacity_hours
                           ELSE 0
                      END AS utilization
                 FROM employees e
                 LEFT JOIN assignments a ON a.employee_id = e.id
                WHERE e.deleted_at IS NULL
                GROUP BY e.id
             ) x`,
          ),
          db.query(
            `SELECT status, COUNT(*)::int AS n
               FROM contracts WHERE deleted_at IS NULL GROUP BY status`,
          ),
          db.query(
            `SELECT status, COUNT(*)::int AS n
               FROM opportunities WHERE deleted_at IS NULL GROUP BY status`,
          ),
          db.query(
            `SELECT status, COUNT(*)::int AS n FROM quotations GROUP BY status`,
          ),
        ]);

      const asgRow = assignmentsRes.rows[0] || {};
      const reqRow = requestsRes.rows[0] || {};
      const empRow = employeesRes.rows[0] || {};

      const contractsByStatus: Record<string, number> = {};
      let contractActive = 0, contractPlanned = 0;
      for (const row of contractsRes.rows) {
        contractsByStatus[row.status] = row.n;
        if (row.status === 'active') contractActive = row.n;
        if (row.status === 'planned') contractPlanned = row.n;
      }

      const oppsByStatus: Record<string, number> = {};
      let pipelineCount = 0;
      for (const row of opportunitiesRes.rows) {
        oppsByStatus[row.status] = row.n;
        if (['open', 'qualified', 'proposal', 'negotiation'].includes(row.status)) {
          pipelineCount += row.n;
        }
      }

      const quotsByStatus: Record<string, number> = {};
      let quotTotal = 0;
      for (const row of quotationsRes.rows) {
        quotsByStatus[row.status] = row.n;
        quotTotal += row.n;
      }

      return {
        generated_at: new Date().toISOString(),
        assignments: {
          active_count: asgRow.active_count || 0,
          planned_count: asgRow.planned_count || 0,
          weekly_hours: Number(asgRow.weekly_hours || 0),
        },
        requests: {
          open_count: reqRow.open_count || 0,
          open_hours_weekly: Number(reqRow.open_hours_weekly || 0),
        },
        employees: {
          total: empRow.total || 0,
          bench: empRow.bench || 0,
          utilized: empRow.utilized || 0,
        },
        contracts: { active_count: contractActive, planned_count: contractPlanned, by_status: contractsByStatus },
        opportunities: { pipeline_count: pipelineCount, by_status: oppsByStatus },
        quotations: { total: quotTotal, by_status: quotsByStatus },
      };
    },
  };
}
