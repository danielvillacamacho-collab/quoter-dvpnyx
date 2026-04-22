/**
 * Executive Dashboard v2 — `/api/dashboard/overview`.
 *
 * One authenticated endpoint that returns KPIs aggregated across the
 * core domains so the home page can render a real cockpit instead of a
 * quotations-only list. Each domain is a single query; queries run in
 * parallel via Promise.all to keep the endpoint fast even under load.
 *
 * Keeping the shape intentionally flat + documented so the frontend can
 * add new cards without another round-trip.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');

router.use(auth);

// ---- Per-domain queries -----------------------------------------------
// Each returns a single row (or a small set) and is defensive against
// NULLs so downstream rendering never blows up.

async function assignmentsKpis() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'active')  ::int AS active_count,
       COUNT(*) FILTER (WHERE status = 'planned') ::int AS planned_count,
       COALESCE(SUM(weekly_hours) FILTER (WHERE status = 'active'), 0)::numeric AS weekly_hours
     FROM assignments
     WHERE deleted_at IS NULL`
  );
  const r = rows[0] || {};
  return {
    active_count:  r.active_count  || 0,
    planned_count: r.planned_count || 0,
    weekly_hours:  Number(r.weekly_hours || 0),
  };
}

async function requestsKpis() {
  const { rows } = await pool.query(
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
           ), 0),
           0
         )
       ) FILTER (WHERE r.status IN ('open','partially_filled')), 0)::numeric AS open_hours_weekly
     FROM resource_requests r
     WHERE r.deleted_at IS NULL`
  );
  const r = rows[0] || {};
  return {
    open_count:        r.open_count || 0,
    open_hours_weekly: Number(r.open_hours_weekly || 0),
  };
}

async function employeesKpis() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('active','on_leave','bench'))::int AS total,
       COUNT(*) FILTER (WHERE status = 'bench')::int                        AS bench,
       COUNT(*) FILTER (WHERE status = 'active' AND utilization > 0)::int   AS utilized
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
     ) x`
  );
  const r = rows[0] || {};
  return {
    total:    r.total    || 0,
    bench:    r.bench    || 0,
    utilized: r.utilized || 0,
  };
}

async function contractsKpis() {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n
       FROM contracts
      WHERE deleted_at IS NULL
      GROUP BY status`
  );
  const by_status = {};
  let active_count = 0, planned_count = 0;
  for (const row of rows) {
    by_status[row.status] = row.n;
    if (row.status === 'active')  active_count  = row.n;
    if (row.status === 'planned') planned_count = row.n;
  }
  return { active_count, planned_count, by_status };
}

async function opportunitiesKpis() {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n
       FROM opportunities
      WHERE deleted_at IS NULL
      GROUP BY status`
  );
  const by_status = {};
  let pipeline_count = 0;
  for (const row of rows) {
    by_status[row.status] = row.n;
    if (['open','qualified','proposal','negotiation'].includes(row.status)) pipeline_count += row.n;
  }
  return { pipeline_count, by_status };
}

async function quotationsKpis() {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n
       FROM quotations
      GROUP BY status`
  );
  const by_status = {};
  let total = 0;
  for (const row of rows) {
    by_status[row.status] = row.n;
    total += row.n;
  }
  return { total, by_status };
}

// ---- Orchestrator ------------------------------------------------------

router.get('/overview', async (_req, res) => {
  try {
    const [assignments, requests, employees, contracts, opportunities, quotations] =
      await Promise.all([
        assignmentsKpis(),
        requestsKpis(),
        employeesKpis(),
        contractsKpis(),
        opportunitiesKpis(),
        quotationsKpis(),
      ]);
    res.json({
      generated_at: new Date().toISOString(),
      assignments,
      requests,
      employees,
      contracts,
      opportunities,
      quotations,
    });
  } catch (err) {
    console.error('GET /api/dashboard/overview failed:', err);
    res.status(500).json({ error: 'No se pudo cargar el dashboard ejecutivo.' });
  }
});

module.exports = router;
