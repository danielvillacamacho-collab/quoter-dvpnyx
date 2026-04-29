/**
 * Event emitter helper. Writes to the `events` table.
 *
 * Usage inside a route:
 *   const { emitEvent } = require('../utils/events');
 *   await emitEvent(clientOrPool, {
 *     event_type: 'quotation.created',
 *     entity_type: 'quotation',
 *     entity_id: quot.id,
 *     actor_user_id: req.user.id,
 *     payload: { type, project_name, client_id },
 *     req,                       // optional — auto-fills ip + user-agent
 *   });
 *
 * `client` can be a pg.Pool or a pg.PoolClient. When you're inside a
 * transaction, pass the transaction client so the event is atomic with
 * the mutation.
 *
 * This never throws for unexpected errors — audit failures should not
 * take down the user-facing mutation. Failures are console.error'd.
 */

/**
 * Detect a pg.Pool vs a pg.PoolClient. When inside a txn (client) we
 * wrap the audit INSERT in a SAVEPOINT — see INC-002: a swallowed
 * error inside an open txn still marks it ABORTED in Postgres, killing
 * the caller's subsequent COMMIT. The savepoint contains the failure.
 */
function isPool(c) {
  return c && typeof c.connect === 'function';
}

async function emitEvent(pgClientOrPool, {
  event_type,
  entity_type,
  entity_id,
  actor_user_id = null,
  payload = {},
  ip_address = null,
  user_agent = null,
  req = null,
}) {
  if (!event_type || !entity_type || !entity_id) {
    // eslint-disable-next-line no-console
    console.warn('emitEvent: missing required fields', { event_type, entity_type, entity_id });
    return null;
  }
  const ip = ip_address ?? req?.ip ?? null;
  const ua = user_agent ?? req?.get?.('user-agent') ?? null;
  const usingTxnClient = !isPool(pgClientOrPool);
  const sp = usingTxnClient ? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
  try {
    if (sp) await pgClientOrPool.query(`SAVEPOINT ${sp}`);
    const { rows } = await pgClientOrPool.query(
      `INSERT INTO events (event_type, entity_type, entity_id, actor_user_id, payload, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id, created_at`,
      [event_type, entity_type, entity_id, actor_user_id, JSON.stringify(payload || {}), ip, ua]
    );
    if (sp) await pgClientOrPool.query(`RELEASE SAVEPOINT ${sp}`);
    return rows[0];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('emitEvent failed (non-fatal):', err.message, { event_type, entity_type, entity_id });
    if (sp) {
      try { await pgClientOrPool.query(`ROLLBACK TO SAVEPOINT ${sp}`); }
      catch (_) { /* surrounding txn already gone */ }
    }
    return null;
  }
}

/**
 * Build a standardized "update" payload comparing before/after and
 * listing the fields that actually changed. Skips unchanged values.
 */
function buildUpdatePayload(before, after, trackedFields) {
  const changed_fields = [];
  const out = { before: {}, after: {}, changed_fields };
  for (const f of trackedFields) {
    // eslint-disable-next-line eqeqeq
    if (before?.[f] != after?.[f]) {
      out.before[f] = before?.[f] ?? null;
      out.after[f]  = after?.[f]  ?? null;
      changed_fields.push(f);
    }
  }
  return out;
}

module.exports = { emitEvent, buildUpdatePayload };
