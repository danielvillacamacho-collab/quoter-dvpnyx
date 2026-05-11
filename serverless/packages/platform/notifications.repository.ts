import type { Pool } from 'pg';
import type { Notification } from './types';
import { NotFound } from '@shared/errors';

const LIST_LIMIT = 50;

export interface NotificationsRepository {
  list(userId: string, unreadOnly?: boolean): Promise<{ data: Notification[] }>;
  unreadCount(userId: string): Promise<{ count: number }>;
  markRead(id: string, userId: string): Promise<Notification>;
  markAllRead(userId: string): Promise<{ updated: number }>;
}

export function createNotificationsRepository(db: Pool): NotificationsRepository {
  return {
    async list(userId, unreadOnly) {
      const unreadFilter = unreadOnly ? 'AND read_at IS NULL' : '';
      const { rows } = await db.query(
        `SELECT id, type, title, body, link, entity_type, entity_id, read_at, created_at
           FROM notifications
          WHERE user_id = $1 ${unreadFilter}
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, LIST_LIMIT],
      );
      return { data: rows };
    },

    async unreadCount(userId) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS count
           FROM notifications
          WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return { count: rows[0]?.count ?? 0 };
    },

    async markRead(id, userId) {
      const { rows } = await db.query(
        `UPDATE notifications
            SET read_at = COALESCE(read_at, NOW())
          WHERE id = $1 AND user_id = $2
          RETURNING id, read_at`,
        [id, userId],
      );
      if (!rows.length) throw new NotFound('Notificación', id);
      return rows[0];
    },

    async markAllRead(userId) {
      const { rowCount } = await db.query(
        `UPDATE notifications
            SET read_at = NOW()
          WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return { updated: rowCount ?? 0 };
    },
  };
}
