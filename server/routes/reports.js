/**
 * Reports — Sprint 6 Modules EI-1 through EI-7.
 * Spec: docs/specs/v2/04_modules/06_reports.md
 *       docs/specs/v2/09_user_stories_backlog.md EI-*
 *
 * Every endpoint is read-only and returns aggregated data in a shape
 * the corresponding frontend page can render as a table. The data can
 * be exported as CSV by the client — the server keeps the format JSON
 * for flexibility.
 *
 * Reads are gated by the standard auth middleware — every authenticated
 * user can run any report; access to specific rows is already scoped by
 * the underlying tables' visibility (soft-deleted + status filters).
 *
 * Conventions:
 *   - Utilization = active_weekly_hours / weekly_capacity_hours
 *   - Time-tracking compliance expressed in % of expected hours.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { serverError } = require('../utils/http');

router.use(auth);

/** EI-2 — Utilization per employee. */
router.get('/utilization', async (req, res) => {
  try {
    const areaFilter = req.query.area_id ? `AND e.area_id = $1` : '';
    const params = req.query.area_id ? [Number(req.query.area_id)] : [];
    // PERF-002: filtros de active + deleted_at en el JOIN ON, no en
    // un FILTER del SUM. Antes: el JOIN traía TODA la historia de
    // assignments (cancelled, ended, soft-deleted) y luego filtraba.
    // Con miles de filas históricas eso es O(employees × all_assignments).
    // Ahora: O(employees × active_assignments). El SUM ya no necesita FILTER.
    const { rows } = await pool.query(
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
      params
    );
    res.json({ data: rows });
  } catch (err) {
    serverError(res, 'GET /reports/utilization', err);
  }
});

/** EI-3 — Bench: employees with utilization below threshold (default 30%). */
router.get('/bench', async (req, res) => {
  try {
    const threshold = Number(req.query.threshold || 0.30);
    // PERF-002: mismo patrón que /utilization — filtros en JOIN ON.
    const { rows } = await pool.query(
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
      [threshold]
    );
    res.json({ data: rows, threshold });
  } catch (err) {
    serverError(res, 'GET /reports/bench', err);
  }
});

/** EI-4 — Pending resource requests, ordered by priority + age. */
router.get('/pending-requests', async (req, res) => {
  try {
    const { rows } = await pool.query(
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
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /reports/pending-requests', err); }
});

/** EI-5 — Hiring needs: aggregate pending requests by (area, level, country). */
router.get('/hiring-needs', async (req, res) => {
  try {
    const { rows } = await pool.query(
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
        ORDER BY open_slots DESC, a.name, rr.level`
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /reports/hiring-needs', err); }
});

/** EI-6 — Coverage per contract. */
router.get('/coverage', async (req, res) => {
  try {
    const { rows } = await pool.query(
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
        ORDER BY coverage_pct ASC, c.name`
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /reports/coverage', err); }
});

/** EI-7 — Time tracking compliance per employee over a date range. */
router.get('/time-compliance', async (req, res) => {
  try {
    const from = req.query.from || new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.level,
              a.name AS area_name,
              e.weekly_capacity_hours,
              COALESCE(te.total_hours, 0)::numeric AS total_logged_hours,
              -- Expected = capacity × number_of_weeks_in_range (approx by days/7)
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
      [from, to]
    );
    res.json({ data: rows, from, to });
  } catch (err) { serverError(res, 'GET /reports/time-compliance', err); }
});

/**
 * EI-8 — Plan vs Real (Time-MVP-00.2).
 *
 * Compara, semana por semana, el plan (assignments.weekly_hours convertido
 * a % sobre la capacidad del empleado) contra el % real registrado en
 * `weekly_time_allocations`. Salida pensada para que un líder vea, fila
 * por fila por (empleado × asignación), si la persona está trabajando en
 * lo que se planeó o se está desviando.
 *
 * Query:
 *   week_start  YYYY-MM-DD (opcional, default lunes de la semana actual)
 *   employee_id UUID (opcional, filtra a una sola persona — útil en /time/team)
 *   manager_id  UUID (opcional, filtra a empleados cuyo manager_user_id=X.
 *                     Cuando el caller es role='lead' se fuerza a su id.)
 *
 * Respuesta:
 *   { week_start_date, week_end_date,
 *     rows: [{ employee_id, employee_name, area_name, level,
 *              capacity_hours, weekly_total_planned_pct, weekly_total_actual_pct,
 *              has_actual_data,                 // true si registró algo esa semana
 *              lines: [{ assignment_id, contract_id, contract_name, role_title,
 *                        planned_hours, planned_pct, actual_pct, diff_pct,
 *                        status }],            // status: 'on_plan'|'over'|'under'|'unplanned'|'missing'
 *              bench_pct }] }
 *
 * Notas:
 *   - Si el empleado tiene allocations sin assignment correspondiente
 *     (ej. registró 50% en algo que ya no está en assignments), aparece
 *     como línea con status='unplanned'.
 *   - Si tiene assignment pero NO registró tiempo, status='missing'.
 *   - Tolerancia: |diff| <= 10pp → 'on_plan'.
 */
router.get('/plan-vs-real', async (req, res) => {
  try {
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const isLead  = req.user.role === 'lead';

    const weekStart = (() => {
      const w = String(req.query.week_start || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
        const d = new Date(w + 'T00:00:00Z');
        const day = d.getUTCDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setUTCDate(d.getUTCDate() + diff);
        return d.toISOString().slice(0, 10);
      }
      const d = new Date();
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diff);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    })();
    const weekEnd = (() => {
      const d = new Date(weekStart + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 6);
      return d.toISOString().slice(0, 10);
    })();

    // Whom can the caller see?
    const empFilters = [`e.deleted_at IS NULL`, `e.status IN ('active','on_leave','bench')`];
    const params = [weekStart, weekEnd];
    if (req.query.employee_id) {
      params.push(req.query.employee_id);
      empFilters.push(`e.id = $${params.length}`);
    }
    // Lead: scoped to direct reports. Non-admin/non-lead: scoped to themselves.
    if (isLead) {
      params.push(req.user.id);
      empFilters.push(`e.manager_user_id = $${params.length}`);
    } else if (!isAdmin) {
      params.push(req.user.id);
      empFilters.push(`e.user_id = $${params.length}`);
    } else if (req.query.manager_id) {
      params.push(req.query.manager_id);
      empFilters.push(`e.manager_user_id = $${params.length}`);
    }

    // 1) Empleados visibles + sus assignments activos en la semana.
    const { rows: empRows } = await pool.query(
      `SELECT e.id AS employee_id,
              (e.first_name || ' ' || e.last_name) AS employee_name,
              e.weekly_capacity_hours, e.level, ar.name AS area_name
         FROM employees e
         LEFT JOIN areas ar ON ar.id = e.area_id
        WHERE ${empFilters.join(' AND ')}
        ORDER BY e.first_name, e.last_name`,
      params
    );
    if (!empRows.length) {
      return res.json({ week_start_date: weekStart, week_end_date: weekEnd, rows: [] });
    }
    const empIds = empRows.map((r) => r.employee_id);

    const { rows: asgRows } = await pool.query(
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
      [empIds, weekStart, weekEnd]
    );

    const { rows: allocRows } = await pool.query(
      `SELECT wta.employee_id, wta.assignment_id, wta.pct, wta.notes,
              c.name AS contract_name, a.role_title
         FROM weekly_time_allocations wta
         LEFT JOIN assignments a ON a.id = wta.assignment_id
         LEFT JOIN contracts   c ON c.id = a.contract_id
        WHERE wta.employee_id = ANY($1::uuid[])
          AND wta.week_start_date = $2::date`,
      [empIds, weekStart]
    );

    const TOLERANCE_PP = 10; // ±10 puntos porcentuales = "on_plan"

    const result = empRows.map((emp) => {
      const cap = Number(emp.weekly_capacity_hours || 0) || 0;
      const empAsgs = asgRows.filter((a) => a.employee_id === emp.employee_id);
      const empAllocs = allocRows.filter((a) => a.employee_id === emp.employee_id);
      const hasActual = empAllocs.length > 0;

      // Build a unified set of (assignment_id) keys.
      const seen = new Set();
      const lines = [];
      empAsgs.forEach((a) => {
        seen.add(a.id);
        const plannedPct = cap > 0 ? Math.round((Number(a.weekly_hours) / cap) * 1000) / 10 : 0;
        const allocRow = empAllocs.find((x) => x.assignment_id === a.id);
        const actualPct = allocRow ? Number(allocRow.pct) : null;
        let status;
        if (actualPct == null) status = hasActual ? 'missing' : 'no_data';
        else if (Math.abs(actualPct - plannedPct) <= TOLERANCE_PP) status = 'on_plan';
        else if (actualPct > plannedPct) status = 'over';
        else status = 'under';
        lines.push({
          assignment_id: a.id,
          contract_id: a.contract_id,
          contract_name: a.contract_name,
          role_title: a.role_title,
          planned_hours: Number(a.weekly_hours),
          planned_pct: plannedPct,
          actual_pct: actualPct,
          diff_pct: actualPct == null ? null : Math.round((actualPct - plannedPct) * 10) / 10,
          status,
        });
      });
      // Allocations sin assignment vigente → 'unplanned'.
      empAllocs.forEach((al) => {
        if (al.assignment_id && seen.has(al.assignment_id)) return;
        lines.push({
          assignment_id: al.assignment_id,
          contract_id: null,
          contract_name: al.contract_name || '(asignación no vigente)',
          role_title: al.role_title || null,
          planned_hours: 0,
          planned_pct: 0,
          actual_pct: Number(al.pct),
          diff_pct: Number(al.pct),
          status: 'unplanned',
        });
      });

      const totalPlanned = Math.round(lines.reduce((s, l) => s + (l.planned_pct || 0), 0) * 10) / 10;
      const totalActual = hasActual
        ? Math.round(lines.reduce((s, l) => s + (l.actual_pct || 0), 0) * 10) / 10
        : null;
      const benchPct = totalActual == null ? null : Math.max(0, Math.round((100 - totalActual) * 10) / 10);

      return {
        employee_id: emp.employee_id,
        employee_name: emp.employee_name,
        area_name: emp.area_name,
        level: emp.level,
        capacity_hours: cap,
        has_actual_data: hasActual,
        weekly_total_planned_pct: totalPlanned,
        weekly_total_actual_pct: totalActual,
        bench_pct: benchPct,
        lines,
      };
    });

    res.json({ week_start_date: weekStart, week_end_date: weekEnd, rows: result });
  } catch (err) {
    serverError(res, 'GET /reports/plan-vs-real', err);
  }
});

/** ED-1 — Personal dashboard: a small rollup for "me". */
router.get('/my-dashboard', async (req, res) => {
  try {
    // Identify my employee row (if any).
    const { rows: empRows } = await pool.query(
      `SELECT id, first_name, last_name, weekly_capacity_hours FROM employees WHERE user_id=$1 AND deleted_at IS NULL`,
      [req.user.id]
    );
    const employee = empRows[0] || null;

    if (!employee) {
      // Users without an employee row (e.g. admin-only accounts) get a
      // minimal rollup.
      return res.json({
        employee: null,
        active_assignments: [],
        week_hours: { logged: 0, expected: 0, capacity: null },
      });
    }

    const weekStart = (() => {
      const d = new Date();
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    })();
    const weekEnd = (() => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + 6);
      return d.toISOString().slice(0, 10);
    })();

    const [asgRes, teRes] = await Promise.all([
      pool.query(
        `SELECT a.*, c.name AS contract_name
           FROM assignments a
           LEFT JOIN contracts c ON c.id = a.contract_id
          WHERE a.employee_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL
          ORDER BY a.start_date`,
        [employee.id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(hours), 0) AS logged
           FROM time_entries
          WHERE employee_id = $1
            AND work_date >= $2::date AND work_date <= $3::date
            AND deleted_at IS NULL`,
        [employee.id, weekStart, weekEnd]
      ),
    ]);

    res.json({
      employee: {
        id: employee.id, first_name: employee.first_name, last_name: employee.last_name,
        weekly_capacity_hours: employee.weekly_capacity_hours,
      },
      active_assignments: asgRes.rows,
      week_hours: {
        logged: Number(teRes.rows[0].logged),
        expected: Number(employee.weekly_capacity_hours || 0),
        capacity: Number(employee.weekly_capacity_hours || 0),
        week_start: weekStart, week_end: weekEnd,
      },
    });
  } catch (err) {
    serverError(res, 'GET /reports/my-dashboard', err);
  }
});

module.exports = router;
