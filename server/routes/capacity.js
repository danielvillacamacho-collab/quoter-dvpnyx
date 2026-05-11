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
  businessDaysInOverlap,
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
    // An employee is "inactive" if terminated OR their end_date has passed.
    // Inactive employees bypass all filters (area, level, search) — they
    // only appear when they have at least one assignment visible in the
    // current viewport. Active employees are filtered normally.
    //
    // The query uses a UNION to keep filter logic simple:
    //   Part A: active employees matching filters
    //   Part B: inactive employees with viewport assignments (no filters)
    const empParams = [viewportStart, viewportEnd]; // $1, $2

    // -- Active employee filters --
    const activeWhere = [
      `e.deleted_at IS NULL`,
      `e.status <> 'terminated'`,
      `(e.end_date IS NULL OR e.end_date >= CURRENT_DATE)`,
    ];
    if (p.areaId) { empParams.push(p.areaId); activeWhere.push(`e.area_id = $${empParams.length}`); }
    if (p.levelMin) {
      const mins = LEVEL_VALUES.slice(p.levelMin - 1);
      empParams.push(mins);
      activeWhere.push(`e.level = ANY($${empParams.length}::text[])`);
    }
    if (p.levelMax) {
      const maxs = LEVEL_VALUES.slice(0, p.levelMax);
      empParams.push(maxs);
      activeWhere.push(`e.level = ANY($${empParams.length}::text[])`);
    }
    if (p.search) {
      empParams.push(`%${p.search.toLowerCase()}%`);
      activeWhere.push(`(LOWER(e.first_name) LIKE $${empParams.length} OR LOWER(e.last_name) LIKE $${empParams.length} OR LOWER(e.first_name || ' ' || e.last_name) LIKE $${empParams.length})`);
    }

    // Inactivos: por defecto sólo aparecen si tienen asignaciones que se
    // solapan con el viewport (preserva el comportamiento del fix 36a8b37).
    // Excepción: cuando hay un search activo, también aparecen los inactivos
    // cuyo nombre matchea el search, aunque no tengan asignaciones visibles.
    // Esto resuelve el caso "busco a alguien que renunció y no aparece" —
    // el operador necesita confirmación explícita de que la persona existe
    // pero sin actividad en el rango. Filtros de área/level NO se aplican
    // a inactivos (preserva el comportamiento original).
    const inactiveCriteria = [`EXISTS (
       SELECT 1 FROM assignments _asg
        WHERE _asg.employee_id = e.id
          AND _asg.deleted_at IS NULL
          AND _asg.status <> 'cancelled'
          AND _asg.start_date <= $2::date
          AND (_asg.end_date IS NULL OR _asg.end_date >= $1::date)
     )`];
    if (p.search) {
      // Reusa el mismo parámetro de search del bloque activo (último push).
      const searchParamIdx = empParams.length; // ya fue pusheado para activos
      inactiveCriteria.push(`(LOWER(e.first_name) LIKE $${searchParamIdx} OR LOWER(e.last_name) LIKE $${searchParamIdx} OR LOWER(e.first_name || ' ' || e.last_name) LIKE $${searchParamIdx})`);
    }

    const { rows: employeeRows } = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.area_id, e.status,
              e.end_date, e.weekly_capacity_hours, a.name AS area_name,
              (e.status = 'terminated' OR (e.end_date IS NOT NULL AND e.end_date < CURRENT_DATE)) AS inactive
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         WHERE ${activeWhere.join(' AND ')}
       UNION
       SELECT e.id, e.first_name, e.last_name, e.level, e.area_id, e.status,
              e.end_date, e.weekly_capacity_hours, a.name AS area_name,
              true AS inactive
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         WHERE e.deleted_at IS NULL
           AND (e.status = 'terminated' OR (e.end_date IS NOT NULL AND e.end_date < CURRENT_DATE))
           AND (${inactiveCriteria.join(' OR ')})
       ORDER BY first_name, last_name
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

    /* ── 3b. Actual hours from time_entries ─────────────────── */
    const assignmentIds = assignmentRows.map((a) => a.id);
    const actualByAsgWeek = new Map(); // key: `${assignment_id}::${weekIdx}` → hours
    if (assignmentIds.length > 0) {
      const { rows: teRows } = await pool.query(
        `SELECT te.assignment_id,
                te.work_date,
                SUM(te.hours) AS actual_hours
           FROM time_entries te
          WHERE te.deleted_at IS NULL
            AND te.assignment_id = ANY($1::uuid[])
            AND te.work_date >= $2::date
            AND te.work_date <= $3::date
          GROUP BY te.assignment_id, te.work_date`,
        [assignmentIds, viewportStart, viewportEnd],
      );
      for (const row of teRows) {
        const wd = row.work_date instanceof Date ? row.work_date : new Date(row.work_date + 'T00:00:00Z');
        for (let wi = 0; wi < weekWindows.length; wi++) {
          const ws = new Date(weekWindows[wi].start_date + 'T00:00:00Z');
          const we = new Date(weekWindows[wi].end_date + 'T00:00:00Z');
          if (wd >= ws && wd <= we) {
            const key = `${row.assignment_id}::${wi}`;
            actualByAsgWeek.set(key, (actualByAsgWeek.get(key) || 0) + Number(row.actual_hours));
            break;
          }
        }
      }
    }

    /* ── 4. Assemble response ────────────────────────────────── */
    // Assignments grouped by employee, enriched with week_range + color.
    const asgByEmp = new Map();
    const contractsMap = new Map();
    for (const a of assignmentRows) {
      const range = weekRangeForAssignment(a.start_date, a.end_date, weekWindows);
      const color = colorFor(a.contract_id);
      // Build actual_hours_by_week array matching weekWindows length.
      const actual_hours_by_week = weekWindows.map((_, wi) => {
        const key = `${a.id}::${wi}`;
        return actualByAsgWeek.get(key) || 0;
      });
      // Prorate weekly_hours by business days for each week window.
      const BDAYS_PER_WEEK = 5;
      const rawHrs = Number(a.weekly_hours);
      const aStartStr = a.start_date instanceof Date ? formatDateUTC(a.start_date) : a.start_date;
      const aEndStr = a.end_date instanceof Date ? formatDateUTC(a.end_date) : (a.end_date || null);
      const hours_by_week = weekWindows.map((ww) => {
        const days = businessDaysInOverlap(aStartStr, aEndStr, ww.start_date, ww.end_date);
        return Math.round((rawHrs * days / BDAYS_PER_WEEK) * 10) / 10;
      });
      const enriched = {
        id: a.id,
        contract_id: a.contract_id,
        contract_name: a.contract_name,
        client_name: a.client_name,
        resource_request_id: a.resource_request_id,
        role_title: a.role_title,
        weekly_hours: rawHrs,
        start_date: aStartStr,
        end_date: aEndStr,
        status: a.status,
        color,
        week_range: range, // [first, last] or null
        request_level: a.request_level || null,
        request_area_id: a.request_area_id || null,
        actual_hours_by_week,
        hours_by_week,
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
      // Enrich weekly with actual_hours (sum across all assignments for this employee).
      const actual_weekly = weekly.map((w, wi) => {
        let actual_hours = 0;
        for (const a of as) {
          actual_hours += (a.actual_hours_by_week && a.actual_hours_by_week[wi]) || 0;
        }
        return { ...w, actual_hours };
      });
      return {
        id: e.id,
        first_name: e.first_name,
        last_name: e.last_name,
        full_name: `${e.first_name} ${e.last_name}`.trim(),
        level: e.level,
        area_id: e.area_id,
        area_name: e.area_name,
        status: e.status,
        end_date: e.end_date instanceof Date ? formatDateUTC(e.end_date) : (e.end_date || null),
        inactive: !!e.inactive,
        weekly_capacity_hours: Number(e.weekly_capacity_hours),
        assignments: as,
        weekly: actual_weekly,
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

    // Inactive employees (terminated or past end_date) appear for historical
    // context but must not inflate the header metrics or trigger new alerts.
    const activeEmployees = employees.filter((e) => !e.inactive);
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

/**
 * GET /api/capacity/planner/export
 * Excel export of the planner view — same data as GET /planner but rendered
 * as an .xlsx file with planned vs actual hours per week per employee.
 */
router.get('/planner/export', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const p = parseParams(req.query);
    const weekWindows = buildWeekWindows(p.start, p.weeks);
    const viewportStart = weekWindows[0].start_date;
    const viewportEnd   = weekWindows[weekWindows.length - 1].end_date;

    /* ── 1. Employees ──────────────────────────────────────────── */
    const empParams = [viewportStart, viewportEnd];
    const activeWhere = [
      `e.deleted_at IS NULL`,
      `e.status <> 'terminated'`,
      `(e.end_date IS NULL OR e.end_date >= CURRENT_DATE)`,
    ];
    if (p.areaId) { empParams.push(p.areaId); activeWhere.push(`e.area_id = $${empParams.length}`); }
    if (p.levelMin) {
      const mins = LEVEL_VALUES.slice(p.levelMin - 1);
      empParams.push(mins);
      activeWhere.push(`e.level = ANY($${empParams.length}::text[])`);
    }
    if (p.levelMax) {
      const maxs = LEVEL_VALUES.slice(0, p.levelMax);
      empParams.push(maxs);
      activeWhere.push(`e.level = ANY($${empParams.length}::text[])`);
    }
    if (p.search) {
      empParams.push(`%${p.search.toLowerCase()}%`);
      activeWhere.push(`(LOWER(e.first_name) LIKE $${empParams.length} OR LOWER(e.last_name) LIKE $${empParams.length} OR LOWER(e.first_name || ' ' || e.last_name) LIKE $${empParams.length})`);
    }
    const inactiveCriteria = [`EXISTS (
       SELECT 1 FROM assignments _asg
        WHERE _asg.employee_id = e.id
          AND _asg.deleted_at IS NULL
          AND _asg.status <> 'cancelled'
          AND _asg.start_date <= $2::date
          AND (_asg.end_date IS NULL OR _asg.end_date >= $1::date)
     )`];
    if (p.search) {
      const searchParamIdx = empParams.length;
      inactiveCriteria.push(`(LOWER(e.first_name) LIKE $${searchParamIdx} OR LOWER(e.last_name) LIKE $${searchParamIdx} OR LOWER(e.first_name || ' ' || e.last_name) LIKE $${searchParamIdx})`);
    }
    const { rows: employeeRows } = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.area_id, e.status,
              e.end_date, e.weekly_capacity_hours, a.name AS area_name,
              (e.status = 'terminated' OR (e.end_date IS NOT NULL AND e.end_date < CURRENT_DATE)) AS inactive
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         WHERE ${activeWhere.join(' AND ')}
       UNION
       SELECT e.id, e.first_name, e.last_name, e.level, e.area_id, e.status,
              e.end_date, e.weekly_capacity_hours, a.name AS area_name,
              true AS inactive
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         WHERE e.deleted_at IS NULL
           AND (e.status = 'terminated' OR (e.end_date IS NOT NULL AND e.end_date < CURRENT_DATE))
           AND (${inactiveCriteria.join(' OR ')})
       ORDER BY first_name, last_name
       LIMIT 200`,
      empParams,
    );
    const employeeIds = employeeRows.map((e) => e.id);

    /* ── 2. Assignments ────────────────────────────────────────── */
    const asgParams = [viewportStart, viewportEnd];
    let asgWhere = `asg.deleted_at IS NULL
                    AND asg.status <> 'cancelled'
                    AND asg.start_date <= $2::date
                    AND (asg.end_date IS NULL OR asg.end_date >= $1::date)`;
    if (employeeIds.length) {
      asgParams.push(employeeIds);
      asgWhere += ` AND asg.employee_id = ANY($${asgParams.length}::uuid[])`;
    }
    if (p.contractId) {
      asgParams.push(p.contractId);
      asgWhere += ` AND asg.contract_id = $${asgParams.length}`;
    }
    const assignmentRows = employeeIds.length
      ? (await pool.query(
          `SELECT asg.id, asg.employee_id, asg.contract_id,
                  asg.weekly_hours, asg.start_date, asg.end_date, asg.status
             FROM assignments asg
             WHERE ${asgWhere}`,
          asgParams,
        )).rows
      : [];

    /* ── 3. Actual hours ───────────────────────────────────────── */
    const assignmentIds = assignmentRows.map((a) => a.id);
    const actualByAsgWeek = new Map();
    if (assignmentIds.length > 0) {
      const { rows: teRows } = await pool.query(
        `SELECT te.assignment_id, te.work_date, SUM(te.hours) AS actual_hours
           FROM time_entries te
          WHERE te.deleted_at IS NULL
            AND te.assignment_id = ANY($1::uuid[])
            AND te.work_date >= $2::date
            AND te.work_date <= $3::date
          GROUP BY te.assignment_id, te.work_date`,
        [assignmentIds, viewportStart, viewportEnd],
      );
      for (const row of teRows) {
        const wd = row.work_date instanceof Date ? row.work_date : new Date(row.work_date + 'T00:00:00Z');
        for (let wi = 0; wi < weekWindows.length; wi++) {
          const ws = new Date(weekWindows[wi].start_date + 'T00:00:00Z');
          const we = new Date(weekWindows[wi].end_date + 'T00:00:00Z');
          if (wd >= ws && wd <= we) {
            const key = `${row.assignment_id}::${wi}`;
            actualByAsgWeek.set(key, (actualByAsgWeek.get(key) || 0) + Number(row.actual_hours));
            break;
          }
        }
      }
    }

    /* ── 4. Build per-employee weekly data ─────────────────────── */
    // Group assignments by employee
    const asgByEmp = new Map();
    for (const a of assignmentRows) {
      const range = weekRangeForAssignment(a.start_date, a.end_date, weekWindows);
      if (!range) continue;
      if (!asgByEmp.has(a.employee_id)) asgByEmp.set(a.employee_id, []);
      asgByEmp.get(a.employee_id).push({ ...a, weekly_hours: Number(a.weekly_hours), week_range: range });
    }

    const rows = employeeRows.map((e) => {
      const as = asgByEmp.get(e.id) || [];
      const cap = Number(e.weekly_capacity_hours) || 0;
      const weeklyData = weekWindows.map((_, wi) => {
        let planned = 0;
        for (const a of as) {
          if (a.status === 'cancelled') continue;
          if (wi >= a.week_range[0] && wi <= a.week_range[1]) {
            planned += a.weekly_hours;
          }
        }
        let actual = 0;
        for (const a of as) {
          const key = `${a.id}::${wi}`;
          actual += actualByAsgWeek.get(key) || 0;
        }
        return { planned, actual, delta: actual - planned };
      });
      return {
        name: `${e.first_name} ${e.last_name}`.trim(),
        area: e.area_name || '',
        level: e.level || '',
        capacity: cap,
        weeklyData,
      };
    });

    /* ── 5. Generate Excel ─────────────────────────────────────── */
    const DVP_PURPLE = 'FF56234D';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DVPNYX Quoter';
    wb.created = new Date();

    const sheet = wb.addWorksheet('Planner');
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DVP_PURPLE } };
    const headerFont = { color: { argb: 'FFFFFFFF' }, bold: true };

    // Build header row
    const headerCells = ['Empleado', 'Área', 'Level', 'Capacidad (h/sem)'];
    for (const w of weekWindows) {
      headerCells.push(`${w.start_date} Plan`);
      headerCells.push(`${w.start_date} Real`);
      headerCells.push(`${w.start_date} Δ`);
    }
    const hRow = sheet.addRow(headerCells);
    hRow.eachCell((c) => { c.fill = headerFill; c.font = headerFont; c.alignment = { vertical: 'middle', horizontal: 'center' }; });

    // Column widths
    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 18;
    sheet.getColumn(3).width = 8;
    sheet.getColumn(4).width = 16;
    for (let i = 0; i < weekWindows.length * 3; i++) {
      sheet.getColumn(5 + i).width = 13;
    }

    // Conditional fill colors for deviations
    const positiveFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFF5E6' } };
    const negativeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBDCDC' } };
    const neutralFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F5F7' } };

    // Totals accumulators
    const totals = weekWindows.map(() => ({ planned: 0, actual: 0 }));

    // Data rows
    for (const r of rows) {
      const cells = [r.name, r.area, r.level, r.capacity];
      r.weeklyData.forEach((wd, wi) => {
        cells.push(wd.planned);
        cells.push(wd.actual);
        cells.push(wd.delta);
        totals[wi].planned += wd.planned;
        totals[wi].actual  += wd.actual;
      });
      const row = sheet.addRow(cells);
      row.getCell(1).font = { bold: true };
      // Apply conditional coloring to delta cells
      r.weeklyData.forEach((wd, wi) => {
        const deltaCol = 5 + wi * 3 + 2; // 1-based: col 4 + wi*3 + 3
        const cell = row.getCell(deltaCol);
        if (wd.delta > 0) {
          cell.fill = positiveFill;
          cell.font = { color: { argb: 'FF166534' }, bold: true };
        } else if (wd.delta < 0) {
          cell.fill = negativeFill;
          cell.font = { color: { argb: 'FF991B1B' }, bold: true };
        } else {
          cell.fill = neutralFill;
        }
      });
    }

    // Totals row
    const totalCells = ['TOTAL', '', '', ''];
    totals.forEach((t) => {
      const delta = t.actual - t.planned;
      totalCells.push(t.planned);
      totalCells.push(t.actual);
      totalCells.push(delta);
    });
    const totRow = sheet.addRow(totalCells);
    totRow.font = { bold: true };
    totRow.getCell(1).font = { bold: true, size: 12 };
    totals.forEach((t, wi) => {
      const delta = t.actual - t.planned;
      const deltaCol = 5 + wi * 3 + 2;
      const cell = totRow.getCell(deltaCol);
      if (delta > 0) {
        cell.fill = positiveFill;
        cell.font = { color: { argb: 'FF166534' }, bold: true };
      } else if (delta < 0) {
        cell.fill = negativeFill;
        cell.font = { color: { argb: 'FF991B1B' }, bold: true };
      } else {
        cell.fill = neutralFill;
        cell.font = { bold: true };
      }
    });

    const buffer = await wb.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="planner_${date}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    const status = err.status || 500;
    // eslint-disable-next-line no-console
    console.error('GET /api/capacity/planner/export failed:', err);
    res.status(status).json({ error: err.message || 'Error interno' });
  }
});

module.exports = router;
