const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1 AND active=true', [email.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Credenciales inválidas' });
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, function: user.function || null },
      process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    await pool.query(`INSERT INTO audit_log (user_id, action, details, ip_address) VALUES ($1, 'login', '{}', $2)`,
      [user.id, req.ip]);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, function: user.function || null, must_change_password: user.must_change_password } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/change-password', auth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (current_password) {
      const valid = await bcrypt.compare(current_password, rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash=$1, must_change_password=false, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.get('/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, name, role, function, must_change_password, preferences FROM users WHERE id=$1',
      [req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    // Ensure preferences is always an object on the wire — psql returns {} but
    // if the column were ever NULL (shouldn't, DEFAULT guards it) the client
    // would crash reading user.preferences.scheme.
    const row = rows[0];
    row.preferences = row.preferences || {};
    res.json(row);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

/**
 * PUT /api/auth/me/preferences
 *
 * Phase 10 UI refresh — self-service UI preferences. Any authenticated user
 * can update their own preferences; no admin check. Body is merged with the
 * existing JSONB (so the client can PATCH just `{ scheme: 'dark' }` without
 * wiping accentHue / density). Unknown keys are dropped to keep the schema
 * explicit.
 */
const ALLOWED_PREF_KEYS = ['scheme', 'accentHue', 'density'];
function sanitizePrefs(body) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const k of ALLOWED_PREF_KEYS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === 'scheme' && ['light', 'dark'].includes(v)) out.scheme = v;
    else if (k === 'accentHue' && Number.isFinite(v) && v >= 0 && v <= 360) out.accentHue = Math.round(v);
    else if (k === 'density' && Number.isFinite(v) && v >= 0.85 && v <= 1.2) out.density = Number(v);
  }
  return out;
}

router.put('/me/preferences', auth, async (req, res) => {
  try {
    const patch = sanitizePrefs(req.body);
    // `||` short-circuits the empty-object case: jsonb_strip_nulls keeps
    // `{ scheme: null }` from accidentally blanking existing keys.
    const { rows } = await pool.query(
      `UPDATE users
         SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
       WHERE id = $2
       RETURNING preferences`,
      [JSON.stringify(patch), req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ preferences: rows[0].preferences || {} });
  } catch (err) {
    console.error('PUT /me/preferences failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
