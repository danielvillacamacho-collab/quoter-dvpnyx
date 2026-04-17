const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');

router.use(auth, adminOnly);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, email, name, role, active, must_change_password, created_at FROM users ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

router.post('/', async (req, res) => {
  try {
    const { email, name, role, password } = req.body;
    if (!email || !name || !role) return res.status(400).json({ error: 'Email, nombre y rol requeridos' });
    if (!['admin', 'preventa'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    if (role === 'admin' && req.user.role !== 'superadmin')
      return res.status(403).json({ error: 'Solo superadmin puede crear administradores' });
    const hash = await bcrypt.hash(password || '000000', 12);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [email.toLowerCase(), hash, name, role]
    );
    await pool.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, 'create_user', 'user', $2, $3)`,
      [req.user.id, rows[0].id, JSON.stringify({ email, role })]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ya registrado' });
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, role, active } = req.body;
    const { rows } = await pool.query(
      'UPDATE users SET name=COALESCE($1,name), role=COALESCE($2,role), active=COALESCE($3,active), updated_at=NOW() WHERE id=$4 RETURNING id, email, name, role, active',
      [name, role, active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    const hash = await bcrypt.hash('000000', 12);
    await pool.query('UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2', [hash, req.params.id]);
    res.json({ message: 'Contraseña reseteada a 000000' });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
