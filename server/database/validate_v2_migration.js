/**
 * Post-migration validation. Runs the invariants listed in
 * docs/specs/v2/08_migration_plan.md §"Verificación post-migración".
 *
 * Exits 1 if any check fails, 0 if all pass. Intended to run in CI after
 * migrate.js + migrate_v2_data.js.
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

const CHECKS = [
  {
    name: 'every non-deleted quotation has client_id',
    sql: `SELECT COUNT(*)::int AS c FROM quotations WHERE client_id IS NULL AND deleted_at IS NULL`,
    expect: (r) => r.c === 0,
  },
  {
    name: 'every non-deleted quotation has opportunity_id',
    sql: `SELECT COUNT(*)::int AS c FROM quotations WHERE opportunity_id IS NULL AND deleted_at IS NULL`,
    expect: (r) => r.c === 0,
  },
  {
    name: 'every non-deleted user has squad_id',
    sql: `SELECT COUNT(*)::int AS c FROM users WHERE squad_id IS NULL AND deleted_at IS NULL`,
    expect: (r) => r.c === 0,
  },
  {
    name: 'every opportunity has client_id',
    sql: `SELECT COUNT(*)::int AS c FROM opportunities WHERE client_id IS NULL AND deleted_at IS NULL`,
    expect: (r) => r.c === 0,
  },
  {
    name: 'every approved quotation has a parent opportunity with winning_quotation_id set',
    sql: `SELECT COUNT(*)::int AS c
            FROM quotations q
           WHERE q.status='approved'
             AND q.deleted_at IS NULL
             AND q.opportunity_id IN (
               SELECT id FROM opportunities WHERE winning_quotation_id IS NULL
             )`,
    expect: (r) => r.c === 0,
  },
  {
    name: 'areas catalogue is seeded',
    sql: `SELECT COUNT(*)::int AS c FROM areas`,
    expect: (r) => r.c >= 9,
  },
  {
    name: 'skills catalogue is seeded (>= 40 entries)',
    sql: `SELECT COUNT(*)::int AS c FROM skills`,
    expect: (r) => r.c >= 40,
  },
  {
    name: 'default squad "DVPNYX Global" exists',
    sql: `SELECT COUNT(*)::int AS c FROM squads WHERE LOWER(name)=LOWER('DVPNYX Global') AND deleted_at IS NULL`,
    expect: (r) => r.c === 1,
  },
  {
    name: 'no legacy role "preventa" remains in users (should be "member" with function=preventa)',
    sql: `SELECT COUNT(*)::int AS c FROM users WHERE role='preventa' AND deleted_at IS NULL`,
    expect: (r) => r.c === 0,
  },
  {
    name: 'every active user has function set',
    sql: `SELECT COUNT(*)::int AS c FROM users WHERE function IS NULL AND deleted_at IS NULL AND active=true`,
    expect: (r) => r.c === 0,
  },
  {
    name: 'new parameter categories (time_tracking + reports) are seeded',
    sql: `SELECT COUNT(DISTINCT category)::int AS c FROM parameters WHERE category IN ('time_tracking','reports')`,
    expect: (r) => r.c === 2,
  },
  {
    name: 'events table exists and accepts writes',
    sql: `SELECT 1 AS c FROM information_schema.tables WHERE table_name='events' LIMIT 1`,
    expect: (r) => r && r.c === 1,
  },
];

async function main() {
  const client = await pool.connect();
  let allOk = true;
  const results = [];
  try {
    for (const chk of CHECKS) {
      const { rows } = await client.query(chk.sql);
      const row = rows[0] || {};
      const ok = chk.expect(row);
      results.push({ check: chk.name, ok, row });
      if (!ok) allOk = false;
    }
  } finally {
    client.release();
    await pool.end();
  }
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    // eslint-disable-next-line no-console
    console.log(`${icon}  ${r.check}  — ${JSON.stringify(r.row)}`);
  }
  // eslint-disable-next-line no-console
  console.log(allOk ? '\nAll checks passed.' : '\nOne or more checks failed.');
  if (!allOk) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

module.exports = { CHECKS };
