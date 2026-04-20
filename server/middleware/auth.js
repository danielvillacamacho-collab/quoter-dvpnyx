const jwt = require('jsonwebtoken');

/**
 * Auth middleware — verifies JWT and populates req.user.
 *
 * V2 additions (non-breaking):
 *   - req.user gains `function` and `squad_id` when present in the JWT.
 *   - Legacy role 'preventa' is accepted as equivalent to 'member' with
 *     function='preventa' during the migration grace period.
 */
const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Grace handling: treat legacy 'preventa' as ('member', function='preventa').
    if (decoded.role === 'preventa' && !decoded.function) {
      decoded.function = 'preventa';
      decoded.role = 'member';
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

module.exports = { auth, adminOnly, superadminOnly, requireRole };
