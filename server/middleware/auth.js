const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Token inválido o expirado' }); }
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

module.exports = { auth, adminOnly, superadminOnly };
