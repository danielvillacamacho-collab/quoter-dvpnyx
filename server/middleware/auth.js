const jwt = require('jsonwebtoken');
const pool = require('../database/pool');

/**
 * Auth middleware — verifies JWT and populates req.user.
 *
 * V2 additions (non-breaking):
 *   - req.user gains `function` and `squad_id` when present in the JWT.
 *   - Legacy role 'preventa' is accepted as equivalent to 'member' with
 *     function='preventa' during the migration grace period.
 *
 * FIX-AUTH-01: After verifying the JWT signature, we do a lightweight DB
 * check (SELECT active, deleted_at) to ensure the user hasn't been
 * deactivated or deleted since the token was issued. This closes the
 * window where a valid token could still work after account removal.
 * For a ~30-person team the extra indexed query per request is negligible.
 */
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Grace handling: treat legacy 'preventa' as ('member', function='preventa').
    if (decoded.role === 'preventa' && !decoded.function) {
      decoded.function = 'preventa';
      decoded.role = 'member';
    }
    // DB check: reject tokens for deactivated or deleted users.
    const { rows } = await pool.query(
      'SELECT active, deleted_at FROM users WHERE id=$1',
      [decoded.id],
    );
    if (!rows.length || !rows[0].active || rows[0].deleted_at) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

const adminOnly = (req, res, next) => {
  if (!['admin', 'superadmin'].includes(req.user.role))
    return res.status(403).json({ error: 'Acceso solo para administradores' });
  next();
};

const superadminOnly = (req, res, next) => {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Acceso solo para superadmin' });
  next();
};

/**
 * Require one of a list of roles. Example:
 *   router.post('/foo', auth, requireRole('admin','lead'), handler)
 */
const requireRole = (...allowed) => (req, res, next) => {
  if (!allowed.includes(req.user.role))
    return res.status(403).json({ error: 'Rol insuficiente para esta acción' });
  next();
};

// SPEC-CRM-00 v1.1 PR4 — RBAC 7 roles.
// 'preventa' se mantiene válido en BD (compat) pero el middleware lo normaliza
// a member+function='preventa' en el auth handler de arriba.
const ROLES = ['superadmin', 'admin', 'director', 'lead', 'member', 'staff', 'viewer', 'external'];
const SEE_ALL_ROLES = new Set(['superadmin', 'admin', 'director']);
const WRITE_ROLES = new Set(['superadmin', 'admin', 'director', 'lead', 'member']);

module.exports = { auth, adminOnly, superadminOnly, requireRole, ROLES, SEE_ALL_ROLES, WRITE_ROLES };
