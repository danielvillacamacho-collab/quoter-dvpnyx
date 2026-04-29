/**
 * In-app notifications helper. Writes to the `notifications` table.
 *
 * Usage from inside a route:
 *
 *   const { notify } = require('../utils/notifications');
 *   await notify(client, {
 *     user_id,
 *     type: 'assignment.created',
 *     title: 'Te asignaron a un proyecto',
 *     body: `${contract.name} — ${weekly_hours}h/sem`,
 *     link: `/assignments`,
 *     entity_type: 'assignment',
 *     entity_id: asg.id,
 *   });
 *
 * Mirrors `utils/events.emitEvent`:
 *   - never throws (a notification miss must not take down the mutation).
 *   - accepts either a pg.Pool or a tx client, so it can be atomic with
 *     the business write when desired.
 *   - silently drops writes when `user_id` is null/undefined — callers
 *     often look up the user_id from optional relations (e.g. an employee
 *     with no linked user), and the branch should live here, not at each
 *     call site.
 */

/**
 * Detect a pg.Pool (has .connect) vs a pg.PoolClient (a checked-out
 * connection that may be inside a txn). When called with a txn client
 * we wrap the INSERT in a SAVEPOINT — see INC-002: if the INSERT fails
 * (e.g. FK violation because employees.user_id points to a deleted
 * user), Postgres marks the surrounding txn ABORTED. The caller's
 * subsequent COMMIT then fails, even though notify()'s try/catch
 * swallowed the JS error — silently killing the user-facing mutation.
 * The SAVEPOINT isolates the failure to just the notification.
 */
function isPool(c) {
  return c && typeof c.connect === 'function';
}

async function notify(pgClientOrPool, {
  user_id,
  type,
  title,
  body = null,
  link = null,
  entity_type = null,
  entity_id = null,
}) {
  if (!user_id || !type || !title) return null;
  const usingTxnClient = !isPool(pgClientOrPool);
  const sp = usingTxnClient ? `notify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
  try {
    if (sp) await pgClientOrPool.query(`SAVEPOINT ${sp}`);
    const { rows } = await pgClientOrPool.query(
      `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, user_id, type, title, body, link, entity_type, entity_id, read_at, created_at`,
      [user_id, type, title, body, link, entity_type, entity_id]
    );
    if (sp) await pgClientOrPool.query(`RELEASE SAVEPOINT ${sp}`);
    return rows[0];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('notify() failed:', err.message);
    if (sp) {
      try { await pgClientOrPool.query(`ROLLBACK TO SAVEPOINT ${sp}`); }
      catch (_) { /* surrounding txn already gone — nothing to recover */ }
    }
    return null;
  }
}

/**
 * Convenience: fan-out to a set of user_ids, deduping + skipping nulls.
 * Returns an array of inserted rows (may be shorter than input).
 */
async function notifyMany(pgClientOrPool, userIds, payload) {
  const unique = Array.from(new Set((userIds || []).filter(Boolean)));
  const out = [];
  for (const uid of unique) {
    // eslint-disable-next-line no-await-in-loop
    const row = await notify(pgClientOrPool, { ...payload, user_id: uid });
    if (row) out.push(row);
  }
  return out;
}

module.exports = { notify, notifyMany };
