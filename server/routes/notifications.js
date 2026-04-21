/**
 * In-app notifications — user-scoped.
 *
 * Every response is restricted to notifications owned by req.user.id.
 * No admin escape hatch for viewing other users' notifications (privacy
 * by default).
 *
 * Endpoints:
 *   GET    /                 — last 50 notifications, newest first
 *   GET    /unread-count     — { count: number }
 *   POST   /:id/read         — mark one as read (idempotent)
 *   POST   /read-all         — mark all my unread as read
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');

router.use(auth);

const LIST_LIMIT = 50;

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, body, link, entity_type, entity_id, read_at, created_at
         FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [req.user.id, LIST_LIMIT]
    );
    res.json({ data: rows });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/notifications failed:', err);
    res.status(500).json({ error: 'No se pudieron cargar las notificaciones.' });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM notifications
        WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/notifications/unread-count failed:', err);
    res.status(500).json({ error: 'No se pudo consultar el contador.' });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE notifications
          SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_id = $2
        RETURNING id, read_at`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Notificación no encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /api/notifications/:id/read failed:', err);
    res.status(500).json({ error: 'No se pudo marcar como leída.' });
  }
});

router.post('/read-all', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE notifications
          SET read_at = NOW()
        WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ updated: rowCount });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /api/notifications/read-all failed:', err);
    res.status(500).json({ error: 'No se pudo marcar todo como leído.' });
  }
});

module.exports = router;
