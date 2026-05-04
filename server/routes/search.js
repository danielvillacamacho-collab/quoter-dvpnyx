/**
 * Global search — powers the Command Palette (⌘K) in the client shell.
 *
 * Shape:
 *   GET /api/search?q=<text>&limit=<per_type>
 *
 * Response:
 *   { query, total, results: [{ type, id, title, subtitle, url }] }
 *
 * Implementation notes:
 *   - Six parallel queries (clients, opportunities, contracts, employees,
 *     quotations, resource_requests). Each is ILIKE-based and soft-delete
 *     aware.
 *   - `limit` caps rows per type (default 5, max 10). The client renders
 *     results grouped by type, so trimming per-type keeps each section
 *     readable.
 *   - Min query length is 2 chars: shorter queries would turn the ILIKE
 *     into a table scan with too many hits.
 *   - URLs are generated server-side so the client just follows them.
 *     That keeps the palette dumb: render + navigate.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { serverError } = require('../utils/http');

router.use(auth);

const MIN_Q = 2;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function pickLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// --- Per-type search helpers --------------------------------------------

async function searchClients(like, limit) {
  const { rows } = await pool.query(
    `SELECT id, name, country, tier
       FROM clients
      WHERE deleted_at IS NULL
        AND (name ILIKE $1 OR COALESCE(legal_name,'') ILIKE $1)
      ORDER BY name
      LIMIT $2`,
    [like, limit]
  );
  return rows.map((r) => ({
    type: 'client',
    id: r.id,
    title: r.name,
    subtitle: [r.country, r.tier].filter(Boolean).join(' · ') || 'Cliente',
    url: `/clients/${r.id}`,
  }));
}

async function searchOpportunities(like, limit) {
  const { rows } = await pool.query(
    `SELECT o.id, o.name, o.status, c.name AS client_name
       FROM opportunities o
       JOIN clients c ON c.id = o.client_id
      WHERE o.deleted_at IS NULL
        AND o.name ILIKE $1
      ORDER BY o.updated_at DESC
      LIMIT $2`,
    [like, limit]
  );
  return rows.map((r) => ({
    type: 'opportunity',
    id: r.id,
    title: r.name,
    subtitle: `${r.client_name} · ${r.status}`,
    url: `/opportunities/${r.id}`,
  }));
}

async function searchContracts(like, limit) {
  const { rows } = await pool.query(
    `SELECT k.id, k.name, k.status, k.type, c.name AS client_name
       FROM contracts k
       JOIN clients c ON c.id = k.client_id
      WHERE k.deleted_at IS NULL
        AND k.name ILIKE $1
      ORDER BY k.updated_at DESC
      LIMIT $2`,
    [like, limit]
  );
  return rows.map((r) => ({
    type: 'contract',
    id: r.id,
    title: r.name,
    subtitle: `${r.client_name} · ${r.type} · ${r.status}`,
    url: `/contracts/${r.id}`,
  }));
}

async function searchEmployees(like, limit) {
  const { rows } = await pool.query(
    `SELECT e.id, e.first_name, e.last_name, e.level, e.country, e.status,
            a.name AS area_name
       FROM employees e
       LEFT JOIN areas a ON a.id = e.area_id
      WHERE e.deleted_at IS NULL
        AND (
          (e.first_name || ' ' || e.last_name) ILIKE $1
          OR COALESCE(e.corporate_email,'') ILIKE $1
        )
      ORDER BY e.last_name, e.first_name
      LIMIT $2`,
    [like, limit]
  );
  return rows.map((r) => ({
    type: 'employee',
    id: r.id,
    title: `${r.first_name} ${r.last_name}`,
    subtitle: [r.area_name, r.level, r.country, r.status].filter(Boolean).join(' · '),
    url: `/employees/${r.id}`,
  }));
}

async function searchQuotations(like, limit) {
  const { rows } = await pool.query(
    `SELECT id, project_name, client_name, type, status
       FROM quotations
      WHERE project_name ILIKE $1 OR client_name ILIKE $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [like, limit]
  );
  return rows.map((r) => ({
    type: 'quotation',
    id: r.id,
    title: r.project_name,
    subtitle: `${r.client_name} · ${r.type === 'staff_aug' ? 'Staff Aug' : 'Proyecto'} · ${r.status}`,
    url: `/quotation/${r.id}`,
  }));
}

async function searchRequests(like, limit) {
  const { rows } = await pool.query(
    `SELECT r.id, r.role_title, r.level, r.status, k.name AS contract_name, c.name AS client_name
       FROM resource_requests r
       JOIN contracts k ON k.id = r.contract_id
       JOIN clients   c ON c.id = k.client_id
      WHERE r.deleted_at IS NULL
        AND r.role_title ILIKE $1
      ORDER BY r.updated_at DESC
      LIMIT $2`,
    [like, limit]
  );
  return rows.map((r) => ({
    type: 'resource_request',
    id: r.id,
    title: r.role_title,
    subtitle: `${r.client_name} · ${r.contract_name} · ${r.level} · ${r.status}`,
    url: `/resource-requests/${r.id}`,
  }));
}

// --- Orchestrator -------------------------------------------------------

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < MIN_Q) {
    return res.json({ query: q, total: 0, results: [] });
  }
  const limit = pickLimit(req.query.limit);
  // Escape ILIKE wildcards so a user typing `100%` doesn't match everything.
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

  try {
    const [clients, opps, contracts, employees, quotations, requests] = await Promise.all([
      searchClients(like, limit),
      searchOpportunities(like, limit),
      searchContracts(like, limit),
      searchEmployees(like, limit),
      searchQuotations(like, limit),
      searchRequests(like, limit),
    ]);
    const results = [...clients, ...opps, ...contracts, ...employees, ...quotations, ...requests];
    res.json({ query: q, total: results.length, results });
  } catch (err) {
    serverError(res, 'GET /search', err);
  }
});

module.exports = router;
