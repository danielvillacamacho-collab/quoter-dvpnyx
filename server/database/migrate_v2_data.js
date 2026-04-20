/**
 * One-time data migration V1 → V2.
 *
 * Idempotent: each step uses WHERE clauses / ON CONFLICT so it can be run
 * multiple times safely. However, it is ONLY required after running
 * migrate.js (which creates V2 DDL). In a fresh install migrate.js already
 * leaves the DB in a valid state; this script is a no-op when there's no
 * legacy data.
 *
 * Steps:
 *   1. Ensure default squad "DVPNYX Global" exists.
 *   2. Assign default squad to all users without one.
 *   3. Backfill users.function based on legacy role.
 *   4. Migrate users with role='preventa' → role='member' + function='preventa'.
 *   5. Create one client per distinct quotations.client_name (prefixed Legacy).
 *   6. Create one opportunity per quotation; link the winning quotation when status=approved.
 *   7. Back-link quotations.client_id, opportunity_id, squad_id.
 *   8. Migrate quotations.metadata.allocation → quotation_allocations table.
 *   9. Best-effort copy audit_log → events (preserves history).
 */
const { Pool } = require('pg');
require('dotenv').config();
const useSsl = ['true', '1', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

const LEGACY_CLIENT_PREFIX = 'Legacy — ';

async function ensureDefaultSquad(client) {
  const { rows } = await client.query(
    `INSERT INTO squads (name, description)
     VALUES ('DVPNYX Global', 'Squad por defecto creado en la migración V2')
     ON CONFLICT DO NOTHING
     RETURNING id`
  );
  if (rows.length) return rows[0].id;
  const existing = await client.query(
    `SELECT id FROM squads WHERE LOWER(name) = LOWER('DVPNYX Global') AND deleted_at IS NULL LIMIT 1`
  );
  return existing.rows[0].id;
}

async function assignDefaultSquad(client, squadId) {
  const res = await client.query(
    `UPDATE users SET squad_id = $1 WHERE squad_id IS NULL AND deleted_at IS NULL`,
    [squadId]
  );
  return res.rowCount;
}

async function backfillUserFunctions(client) {
  // superadmin + admin → function='admin'
  await client.query(
    `UPDATE users SET function='admin'
       WHERE function IS NULL AND role IN ('superadmin','admin')`
  );
  // preventa legacy role keeps function='preventa' (before swapping role below)
  await client.query(
    `UPDATE users SET function='preventa'
       WHERE function IS NULL AND role='preventa'`
  );
}

async function migratePreventaRole(client) {
  // role='preventa' is legacy — promote to 'member' so the V2 role model is uniform.
  // function='preventa' was already set in backfillUserFunctions.
  const res = await client.query(
    `UPDATE users SET role='member' WHERE role='preventa'`
  );
  return res.rowCount;
}

async function createLegacyClients(client, createdByUserId) {
  // One client per distinct client_name that isn't already linked to a client.
  const { rows: distinctNames } = await client.query(
    `SELECT DISTINCT client_name
       FROM quotations
      WHERE client_id IS NULL
        AND client_name IS NOT NULL
        AND client_name <> ''
      ORDER BY client_name`
  );
  const nameToId = new Map();
  for (const { client_name: name } of distinctNames) {
    const legacyName = LEGACY_CLIENT_PREFIX + name;
    // If it was created in a prior run (idempotency), reuse it.
    const existing = await client.query(
      `SELECT id FROM clients WHERE LOWER(name)=LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [legacyName]
    );
    if (existing.rows.length) {
      nameToId.set(name, existing.rows[0].id);
      continue;
    }
    const { rows } = await client.query(
      `INSERT INTO clients (name, notes, tags, created_by)
       VALUES ($1, $2, ARRAY['legacy','v1-migration'], $3)
       RETURNING id`,
      [legacyName, `Auto-creado desde quotations.client_name en la migración V2.`, createdByUserId]
    );
    nameToId.set(name, rows[0].id);
  }
  return nameToId;
}

async function createLegacyOpportunities(client, squadId, nameToClientId) {
  // For every quotation without opportunity_id, create a 1:1 opportunity.
  const { rows: quots } = await client.query(
    `SELECT id, client_name, project_name, status, created_by, created_at, updated_at
       FROM quotations
      WHERE opportunity_id IS NULL
      ORDER BY created_at`
  );
  const statusMap = {
    draft:     'open',
    sent:      'proposal',
    approved:  'won',
    rejected:  'lost',
    expired:   'cancelled',
  };
  const outcomeMap = {
    won:       'won',
    lost:      'lost',
    cancelled: 'cancelled',
  };
  let created = 0;
  for (const q of quots) {
    const clientId = nameToClientId.get(q.client_name);
    if (!clientId) continue;   // defensive — shouldn't happen
    const newStatus = statusMap[q.status] || 'open';
    const newOutcome = outcomeMap[newStatus] || null;
    const { rows: [opp] } = await client.query(
      `INSERT INTO opportunities
        (client_id, name, account_owner_id, squad_id, status, outcome,
         winning_quotation_id, closed_at, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $3, $9, $10)
       RETURNING id`,
      [
        clientId,
        `${LEGACY_CLIENT_PREFIX}${q.project_name}`,
        q.created_by,
        squadId,
        newStatus,
        newOutcome,
        newStatus === 'won' ? q.id : null,
        newStatus === 'won' || newStatus === 'lost' || newStatus === 'cancelled' ? q.updated_at : null,
        q.created_at,
        q.updated_at,
      ]
    );
    // Back-link on the quotation.
    await client.query(
      `UPDATE quotations SET client_id=$1, opportunity_id=$2, squad_id=$3 WHERE id=$4`,
      [clientId, opp.id, squadId, q.id]
    );
    created++;
  }
  return created;
}

async function migrateAllocations(client) {
  // Read metadata.allocation JSONB (shape: { [lineIdx]: { [phaseIdx]: hrWeek } })
  // and write to quotation_allocations. Note V1 used numeric phase indices,
  // not phase UUIDs. We resolve phase index → phase UUID via quotation_phases.sort_order.
  const { rows: quots } = await client.query(
    `SELECT id, metadata FROM quotations
      WHERE metadata ? 'allocation'
        AND metadata->'allocation' <> '{}'::jsonb`
  );
  let inserted = 0;
  for (const q of quots) {
    const alloc = q.metadata?.allocation || {};
    const { rows: phases } = await client.query(
      `SELECT id, sort_order FROM quotation_phases WHERE quotation_id=$1 ORDER BY sort_order`,
      [q.id]
    );
    const phaseByOrder = new Map(phases.map((p) => [p.sort_order, p.id]));
    for (const [lineIdxStr, phaseMap] of Object.entries(alloc)) {
      const lineIdx = Number(lineIdxStr);
      if (!phaseMap || typeof phaseMap !== 'object') continue;
      for (const [phaseIdxStr, hrWeek] of Object.entries(phaseMap)) {
        const hours = Number(hrWeek || 0);
        if (!hours) continue;
        const phaseIdx = Number(phaseIdxStr);
        const phaseId = phaseByOrder.get(phaseIdx);
        if (!phaseId) continue;   // orphaned allocation; skip
        const r = await client.query(
          `INSERT INTO quotation_allocations (quotation_id, line_sort_order, phase_id, weekly_hours)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (quotation_id, line_sort_order, phase_id) DO NOTHING`,
          [q.id, lineIdx, phaseId, hours]
        );
        inserted += r.rowCount;
      }
    }
  }
  return inserted;
}

async function copyAuditToEvents(client) {
  // Best-effort: copy existing audit_log into events. Idempotent via a sentinel
  // payload flag so re-runs don't duplicate.
  const res = await client.query(
    `INSERT INTO events (event_type, entity_type, entity_id, actor_user_id, payload, ip_address, created_at)
     SELECT
       COALESCE(a.action, 'legacy.unknown'),
       COALESCE(a.entity, 'legacy'),
       COALESCE(a.entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
       a.user_id,
       jsonb_build_object('migrated_from_audit_log', true, 'original', to_jsonb(a)),
       a.ip_address,
       a.created_at
     FROM audit_log a
     WHERE NOT EXISTS (
       SELECT 1 FROM events e
        WHERE e.created_at = a.created_at
          AND e.actor_user_id IS NOT DISTINCT FROM a.user_id
          AND e.event_type = COALESCE(a.action, 'legacy.unknown')
          AND e.payload->>'migrated_from_audit_log' = 'true'
     )`
  );
  return res.rowCount;
}

/**
 * EG-5 — backfill parameters_snapshot on legacy non-draft quotations.
 *
 * V1 saved quotations directly without a parameter snapshot. After the
 * V2 deploy, any admin who tweaks a parameter would shift totals on
 * every sent/approved quotation — changing commercial commitments that
 * were already made to the client.
 *
 * This step reads the current parameter set once and stamps every
 * legacy sent/approved quotation with it, effectively pinning their
 * totals to the parameter state at the moment of migration. Draft
 * quotations are intentionally skipped — they haven't been committed
 * yet and will get their own snapshot the first time they move to
 * sent/approved post-migration.
 *
 * Idempotent: only touches rows where parameters_snapshot IS NULL.
 */
async function backfillRetroactiveSnapshots(client) {
  const { rows: paramRows } = await client.query(
    `SELECT category, key, value FROM parameters`
  );
  const snapshot = {};
  for (const r of paramRows) {
    if (!snapshot[r.category]) snapshot[r.category] = [];
    snapshot[r.category].push({ key: r.key, value: r.value });
  }
  const result = await client.query(
    `UPDATE quotations
        SET parameters_snapshot = $1::jsonb,
            updated_at = NOW()
      WHERE parameters_snapshot IS NULL
        AND status IN ('sent', 'approved')
      RETURNING id`,
    [JSON.stringify(snapshot)]
  );
  return result.rowCount;
}

async function pickCreatedByFallback(client) {
  // The Legacy clients table requires created_by. Prefer the superadmin user;
  // fall back to ANY user; bomb out explicitly otherwise.
  const { rows } = await client.query(
    `SELECT id FROM users WHERE role='superadmin' ORDER BY created_at LIMIT 1`
  );
  if (rows.length) return rows[0].id;
  const { rows: any } = await client.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
  if (any.length) return any[0].id;
  throw new Error('No users in DB; cannot create legacy clients.');
}

async function main() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const report = {};
    const squadId = await ensureDefaultSquad(client);
    report.defaultSquadId = squadId;
    report.usersGivenSquad = await assignDefaultSquad(client, squadId);

    await backfillUserFunctions(client);
    report.preventaRolesMigrated = await migratePreventaRole(client);

    const createdByFallback = await pickCreatedByFallback(client);
    const clientNameToId = await createLegacyClients(client, createdByFallback);
    report.legacyClientsCreated = clientNameToId.size;

    report.legacyOpportunitiesCreated =
      await createLegacyOpportunities(client, squadId, clientNameToId);

    report.allocationsMigrated = await migrateAllocations(client);
    report.retroactiveSnapshotsBackfilled = await backfillRetroactiveSnapshots(client);
    report.auditLogEventsCopied = await copyAuditToEvents(client);

    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log('V2 data migration completed:\n' + JSON.stringify(report, null, 2));
    return report;
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('V2 data migration failed:', err);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = { main };
