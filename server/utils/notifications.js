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
  try {
    const { rows } = await pgClientOrPool.query(
      `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, user_id, type, title, body, link, entity_type, entity_id, read_at, created_at`,
      [user_id, type, title, body, link, entity_type, entity_id]
    );
    return rows[0];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('notify() failed:', err.message);
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
