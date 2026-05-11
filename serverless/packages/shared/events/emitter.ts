import type { Pool, PoolClient } from 'pg';
import type { EventPayload } from '../types';

function isPool(c: Pool | PoolClient): c is Pool {
  return typeof (c as Pool).connect === 'function';
}

export interface EventEmitter {
  emit(
    pgClientOrPool: Pool | PoolClient,
    payload: EventPayload,
  ): Promise<{ id: string; created_at: string } | null>;
}

export function createEventEmitter(): EventEmitter {
  return {
    async emit(pgClientOrPool, payload) {
      const { event_type, entity_type, entity_id, actor_user_id, payload: data, ip_address, user_agent } = payload;

      if (!event_type || !entity_type || !entity_id) {
        console.warn('emitEvent: missing required fields', { event_type, entity_type, entity_id });
        return null;
      }

      const usingTxnClient = !isPool(pgClientOrPool);
      const sp = usingTxnClient
        ? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : null;

      try {
        if (sp) await (pgClientOrPool as PoolClient).query(`SAVEPOINT ${sp}`);
        const { rows } = await pgClientOrPool.query(
          `INSERT INTO events (event_type, entity_type, entity_id, actor_user_id, payload, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           RETURNING id, created_at`,
          [event_type, entity_type, entity_id, actor_user_id, JSON.stringify(data || {}), ip_address || null, user_agent || null],
        );
        if (sp) await (pgClientOrPool as PoolClient).query(`RELEASE SAVEPOINT ${sp}`);
        return rows[0];
      } catch (err) {
        console.error('emitEvent failed (non-fatal):', (err as Error).message, { event_type, entity_type, entity_id });
        if (sp) {
          try { await (pgClientOrPool as PoolClient).query(`ROLLBACK TO SAVEPOINT ${sp}`); }
          catch { /* surrounding txn already gone */ }
        }
        return null;
      }
    },
  };
}

export function buildUpdatePayload(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  trackedFields: string[],
): Record<string, unknown> {
  const changed_fields: string[] = [];
  const out: Record<string, unknown> = { before: {}, after: {}, changed_fields };
  for (const f of trackedFields) {
    if (before?.[f] != after?.[f]) {
      (out.before as Record<string, unknown>)[f] = before?.[f] ?? null;
      (out.after as Record<string, unknown>)[f] = after?.[f] ?? null;
      changed_fields.push(f);
    }
  }
  return out;
}
