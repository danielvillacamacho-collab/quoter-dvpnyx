/**
 * US-BK-1 — GET /api/capacity/planner
 *
 * Single endpoint powering the Capacity Planner UI (Runn-style weekly
 * timeline). We keep the query footprint small and predictable:
 *
 *   1. Employees (filtered + paged) — one SELECT
 *   2. Assignments overlapping the viewport for those employees — one SELECT
 *   3. Contracts referenced by those assignments (+ open requests) — one SELECT
 *   4. Open / partially-filled resource_requests overlapping the viewport — one SELECT
 *
 * The rest (week windows, per-employee utilization, contract colors,
 * meta aggregates) is derived in `server/utils/capacity_planner.js`
 * which is pure and unit-tested.
 *
 * Response is deliberately flat and stable so the frontend (and later
 * an AI/agent layer) can just render it; no per-employee N+1.
 */

'use strict';

const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const {
  buildWeekWindows,
  weekRangeForAssignment,
  computeWeeklyForEmployee,
  colorFor,
  aggregateMeta,
  computeAlerts,
  mondayOf,
  parseDateUTC,
  formatDateUTC,
} = require('../utils/capacity_planner');

router.use(auth);

const LEVEL_VALUES = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];
const levelIndex = (lvl) => {
  const i = LEVEL_VALUES.indexOf(String(lvl).toUpperCase());
  return i === -1 ? null : i + 1;
};

/**
 * Parse and sanitize query params. Defaults:
 *   start   → Monday of the current UTC week
 *   weeks   → 12 (clamped to [1, 26])
 */
function parseParams(q) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultStart = formatDateUTC(mondayOf(today));

  let start = defaultStart;
  if (q.start) {
    const p = parseDateUTC(q.start);
    if (!p) throw Object.assign(new Error('start inválido (formato YYYY-MM-DD)'), { status: 400 });
    start = formatDateUTC(mondayOf(p));
  }
  let weeks = Number(q.weeks);
  if (!Number.isFinite(weeks)) weeks = 12;
  weeks = Math.max(1, Math.min(26, Math.trunc(weeks)));

  const contractId = q.contract_id ? String(q.contract_id) : null;
  const areaId     = q.area_id ? Number(q.area_id) : null;
  const levelMin   = q.level_min ? levelIndex(q.level_min) : null;
  const levelMax   = q.level_max ? levelIndex(q.level_max) : null;
  const search     = q.search ? String(q.search).trim() : '';

  if (q.area_id && (!Number.isFinite(areaId) || areaId <= 0)) {
    throw Object.assign(new Error('area_id inválido'), { status: 400 });
  }

  return { start, weeks, contractId, areaId, levelMin, levelMax, search };
}

/**
 * GET /api/capacity/planner
 * See file header for response shape.
 */
router.get('/planner', async (req, res) => {
  try {
    const p = parseParams(req.query);
    const weekWindows = buildWeekWindows(p.start, p.weeks);
    const viewportStart = weekWindows[0].start_date;
    const viewportEnd   = weekWindows[weekWindows.length - 1].end_date;

    /* ── 1. Employees (filtered) ─────────────────────────────── */
    // Terminated employees are included ONLY if they have at least one
    // assignment visible in the current viewport. This lets the planner
    // see historical work of people who left the company without
    // polluting the list with ex-employees who have no open assignments.
    const empParams = [viewportStart, viewportEnd]; // $1, $2 reserved for terminated subquery
    const empWhere = [
      `e.deleted_at IS NULL`,
      `(e.status <> 'terminated' OR EXISTS (
          SELECT 1 FROM assignments _asg
           WHERE _asg.employee_id = e.id
             AND _asg.deleted_at IS NULL
             AND _asg.status <> 'cancelled'
             AND _asg.start_date <= $2::date
             AND (_asg.end_date IS NULL OR _asg.end_date >= $1::date)
        )
      )`,
    ];
    if (p.areaId) { empParams.push(p.areaId); empWhere.push(`e.area_id = $${empParams.length}`); }
    if (p.levelMin) {
      // Postgres orders L1..L11 lexicographically wrong ('L10' < 'L2'), so
      // we compare against the literal set.
      const mins = LEVEL_VALUES.slice(p.levelMin - 1);
      empParams.push(mins);
      empWhere.push(`e.level = ANY($${empParams.length}::text[])`);
    }
    if (p.levelMax) {
      const maxs = LEVEL_VALUES.slice(0, p.levelMax);
      empParams.push(maxs);
      empWhere.push(`e.level = ANY($${empParams.length}::text[])`);
    }
    if (p.search) {
      empParams.push(`%${p.search.toLowerCase()}%`);
      empWhere.push(`(LOWER(e.first_name) LIKE $${empParams.length} OR LOWER(e.last_name) LIKE $${empParams.length} OR LOWER(e.first_name || ' ' || e.last_name) LIKE $${empParams.length})`);
    }
    const { rows: employeeRows } = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.area_id, e.status,
              e.weekly_capacity_hours, a.name AS area_name
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         WHERE ${empWhere.join(' AND ')}
         ORDER BY e.first_name, e.last_name
         LIMIT 200`,
      empParams,
    );
    const employeeIds = employeeRows.map((e) => e.id);

    /* ── 2. Assignments overlapping the viewport ─────────────── */
    // Overlap: assignment range [start_date, end_date or +∞] intersects viewport.
    const asgParams = [viewportStart, viewportEnd];
    let asgWhere = `asg.deleted_at IS NULL
                    AND asg.status <> 'cancelled'
                    AND asg.start_date <= $2::date
                    AND (asg.end_date IS NULL OR asg.end_date >= $1::date)`;
    if (employeeIds.length) {
      asgParams.push(employeeIds);
      asgWhere += ` AND asg.employee_id = ANY($${asgParams.length}::uuid[])`;
    } else {
      // No employees → no assignments (skip the query entirely).
    }
    if (p.contractId) {
      asgParams.push(p.contractId);
      asgWhere += ` AND asg.contract_id = $${asgParams.length}`;
    }
    const assignmentRows = employeeIds.length
      ? (await pool.query(
          `SELECT asg.id, asg.employee_id, asg.contract_id, asg.resource_request_id,
                  asg.role_title, asg.weekly_hours, asg.start_date, asg.end_date, asg.status,
                  c.name AS contract_name, c.status AS contract_status,
                  cl.name AS client_name,
                  rr.level AS request_level, rr.area_id AS request_area_id
             FROM assignments asg
             JOIN contracts c ON c.id = asg.contract_id
             LEFT JOIN clients cl ON cl.id = c.client_id
             LEFT JOIN resource_requests rr ON rr.id = asg.resource_request_id
             WHERE ${asgWhere}`,
          asgParams,
        )).rows
      : [];

    /* ── 3. Open / partially-filled resource_requests ────────── */
    const rrParams = [viewportStart, viewportEnd];
    let rrWhere = `rr.deleted_at IS NULL
                   AND rr.status IN ('open','partially_filled')
                   AND rr.start_date <= $2::date
                   AND (rr.end_date IS NULL OR rr.end_date >= $1::date)`;
    if (p.contractId) {
      rrParams.push(p.contractId);
      rrWhere += ` AND rr.contract_id = $${rrParams.length}`;
    }
    if (p.areaId) {
      rrParams.push(p.areaId);
      rrWhere += ` AND rr.area_id = $${rrParams.length}`;
    }
    const { rows: requestRows } = await pool.query(
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
         WHERE ${rrWhere}
         ORDER BY rr.start_date, rr.level
         LIMIT 200`,
      rrParams,
    );

    /* ── 4. Assemble response ────────────────────────────────── */
    // Assignments grouped by employee, enriched with week_range + color.
    const asgByEmp = new Map();
    const contractsMap = new Map();
    for (const a of assignmentRows) {
      const range = weekRangeForAssignment(a.start_date, a.end_date, weekWindows);
      const color = colorFor(a.contract_id);
      const enriched = {
        id: a.id,
        contract_id: a.contract_id,
        contract_name: a.contract_name,
        client_name: a.client_name,
        resource_request_id: a.resource_request_id,
        role_title: a.role_title,
        weekly_hours: Number(a.weekly_hours),
        start_date: a.start_date instanceof Date ? formatDateUTC(a.start_date) : a.start_date,
        end_date: a.end_date instanceof Date ? formatDateUTC(a.end_date) : (a.end_date || null),
        status: a.status,
        color,
        week_range: range, // [first, last] or null
        request_level: a.request_level || null,
        request_area_id: a.request_area_id || null,
      };
      if (!asgByEmp.has(a.employee_id)) asgByEmp.set(a.employee_id, []);
      asgByEmp.get(a.employee_id).push(enriched);
      if (!contractsMap.has(a.contract_id)) {
        contractsMap.set(a.contract_id, { id: a.contract_id, name: a.contract_name, client_name: a.client_name, color });
      }
    }

    const employees = employeeRows.map((e) => {
      const as = asgByEmp.get(e.id) || [];
      const weekly = computeWeeklyForEmployee(
        { weekly_capacity_hours: Number(e.weekly_capacity_hours) },
        as,
        weekWindows,
      );
      return {
        id: e.id,
        first_name: e.first_name,
        last_name: e.last_name,
        full_name: `${e.first_name} ${e.last_name}`.trim(),
        level: e.level,
        area_id: e.area_id,
        area_name: e.area_name,
        status: e.status,
        weekly_capacity_hours: Number(e.weekly_capacity_hours),
        assignments: as,
        weekly,
      };
    });

    const openRequests = requestRows.map((rr) => {
      const color = colorFor(rr.contract_id);
      const range = weekRangeForAssignment(rr.start_date, rr.end_date, weekWindows);
      const filled = Number(rr.filled_count) || 0;
      if (!contractsMap.has(rr.contract_id)) {
        contractsMap.set(rr.contract_id, { id: rr.contract_id, name: rr.contract_name, client_name: rr.client_name, color });
      }
      return {
        id: rr.id,
        contract_id: rr.contract_id,
        contract_name: rr.contract_name,
        client_name: rr.client_name,
        role_title: rr.role_title,
        level: rr.level,
        area_id: rr.area_id,
        area_name: rr.area_name,
        weekly_hours: Number(rr.weekly_hours),
        quantity: Number(rr.quantity) || 1,
        filled_count: filled,
        missing: Math.max(0, (Number(rr.quantity) || 1) - filled),
        start_date: rr.start_date instanceof Date ? formatDateUTC(rr.start_date) : rr.start_date,
        end_date: rr.end_date instanceof Date ? formatDateUTC(rr.end_date) : (rr.end_date || null),
        status: rr.status,
        color,
        week_range: range,
      };
    });

    // Terminated employees appear in the planner for historical context but
    // must not inflate/deflate the header metrics or trigger new alerts.
    const activeEmployees = employees.filter((e) => e.status !== 'terminated');
    const meta = aggregateMeta(activeEmployees, openRequests);
    const alerts = computeAlerts(activeEmployees, openRequests, weekWindows);

    res.json({
      window: {
        start_date: viewportStart,
        end_date: viewportEnd,
        weeks: p.weeks,
      },
      weeks: weekWindows,
      employees,
      open_requests: openRequests,
      contracts: Array.from(contractsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      meta,
      alerts,
      filters_applied: {
        contract_id: p.contractId,
        area_id: p.areaId,
        level_min: p.levelMin ? `L${p.levelMin}` : null,
        level_max: p.levelMax ? `L${p.levelMax}` : null,
        search: p.search || null,
      },
    });
  } catch (err) {
    const status = err.status || 500;
    // eslint-disable-next-line no-console
    console.error('GET /api/capacity/planner failed:', err);
    res.status(status).json({ error: err.message || 'Error interno' });
  }
});

module.exports = router;
