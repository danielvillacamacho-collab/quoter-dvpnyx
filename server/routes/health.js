const router = require('express').Router();
const pool = require('../database/pool');

/**
 * Public health endpoint — no auth.
 *   200 { ok: true, version, git_sha, db: 'up'|'down' }
 *
 * Used by:
 *   - CI health probe during deploy (see .github/workflows/deploy.yml)
 *   - External uptime monitors (UptimeRobot, Better Stack)
 *   - CloudFront origin health-check when AWS stack lights up
 */
router.get('/', async (_req, res) => {
  const version = process.env.APP_VERSION || '2.0.0-dev';
  const git_sha = (process.env.GIT_SHA || process.env.REACT_APP_GIT_SHA || 'unknown').slice(0, 12);
  let db = 'down';
  try {
    await pool.query('SELECT 1');
    db = 'up';
  } catch (err) {
    // El endpoint sigue devolviendo 503 con db='down' — pero loggeamos el
    // error para que las CloudWatch alarms / uptime monitors tengan
    // contexto del fallo (antes se enmascaraba silenciosamente).
    // eslint-disable-next-line no-console
    console.warn('Health check DB probe failed:', err && err.message ? err.message : err);
  }
  const ok = db === 'up';
  res.status(ok ? 200 : 503).json({ ok, version, git_sha, db });
});

module.exports = router;
