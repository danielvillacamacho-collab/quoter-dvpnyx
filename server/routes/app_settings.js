/**
 * App settings — superadmin-only key/value store for system configuration.
 *
 * Currently used for AWS SNS credentials. Future settings can be added
 * by simply writing new keys — the schema is generic.
 *
 * Endpoints:
 *   GET  /api/admin/settings          — returns all settings as { key: value }
 *   PUT  /api/admin/settings          — upserts multiple keys (body: { key: value, ... })
 *   GET  /api/admin/settings/:key     — single key value
 *   PUT  /api/admin/settings/:key     — upsert single key (body: { value })
 *
 * Secret values (aws_secret_access_key) are redacted in GET responses
 * unless the caller passes ?reveal=1. Only superadmin can reveal.
 */
const router = require('express').Router();
const pool   = require('../database/pool');
const { auth, superadminOnly } = require('../middleware/auth');
const { serverError }          = require('../utils/http');
const { emitEvent }            = require('../utils/events');

router.use(auth, superadminOnly);

const SECRET_KEYS = new Set(['aws_secret_access_key', 'cron_secret']);

function redactSecrets(obj, reveal) {
  if (reveal) return obj;
  const out = { ...obj };
  for (const k of SECRET_KEYS) {
    if (k in out && out[k]) out[k] = '••••••••';
  }
  return out;
}

// GET /api/admin/settings  — all settings as flat object
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM app_settings ORDER BY key');
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    const reveal = req.query.reveal === '1';
    res.json({ data: redactSecrets(obj, reveal) });
  } catch (err) {
    serverError(res, 'GET /admin/settings', err);
  }
});

// GET /api/admin/settings/:key
router.get('/:key', async (req, res) => {
  try {
    const key = String(req.params.key).trim();
    const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    if (!rows.length) return res.status(404).json({ error: 'Clave no encontrada' });
    const reveal = req.query.reveal === '1';
    const value  = reveal || !SECRET_KEYS.has(key) ? rows[0].value : '••••••••';
    res.json({ key, value });
  } catch (err) {
    serverError(res, 'GET /admin/settings/:key', err);
  }
});

// PUT /api/admin/settings  — bulk upsert { key: value, ... }
router.put('/', async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Body debe ser un objeto { clave: valor }' });
  }
  const entries = Object.entries(updates);
  if (entries.length === 0) return res.status(400).json({ error: 'Sin claves para actualizar' });

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    for (const [key, value] of entries) {
      await conn.query(
        `INSERT INTO app_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               updated_at = NOW(),
               updated_by = EXCLUDED.updated_by`,
        [String(key).trim(), value === null ? null : String(value), req.user.id]
      );
    }
    await conn.query('COMMIT');
    await emitEvent(pool, 'app_settings.updated', 'app_settings', null, req.user.id,
      { keys: entries.map(([k]) => k) });
    res.json({ ok: true, updated: entries.length });
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    serverError(res, 'PUT /admin/settings', err);
  } finally {
    conn.release();
  }
});

// PUT /api/admin/settings/:key  — upsert single key
router.put('/:key', async (req, res) => {
  const key   = String(req.params.key).trim();
  const value = req.body?.value !== undefined ? req.body.value : null;
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by`,
      [key, value === null ? null : String(value), req.user.id]
    );
    await emitEvent(pool, 'app_settings.updated', 'app_settings', null, req.user.id, { key });
    res.json({ ok: true, key });
  } catch (err) {
    serverError(res, 'PUT /admin/settings/:key', err);
  }
});

module.exports = router;
