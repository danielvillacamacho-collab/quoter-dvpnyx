/**
 * /api/users  —  User management (admin+ only)
 *
 * V2 role model:
 *   superadmin  — full access; cannot be created or deleted via API
 *   admin       — manage users, parameters, bulk import
 *   lead        — delivery / project leads
 *   member      — standard contributor
 *   viewer      — read-only
 *
 * Each user also has an optional `function` that drives fine-grained
 * sidebar visibility (comercial, preventa, capacity_manager, …).
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { serverError } = require('../utils/http');

router.use(auth, adminOnly);

const ASSIGNABLE_ROLES = ['admin', 'lead', 'member', 'viewer'];
const VALID_FUNCTIONS = [
  'comercial', 'preventa', 'capacity_manager', 'delivery_manager',
  'project_manager', 'fte_tecnico', 'people', 'finance', 'pmo', 'admin',
];

/* ── GET / ──────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, function, active, must_change_password, created_at
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    serverError(res, 'users', err);
  }
});

/* ── POST / ─────────────────────────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { email, name, role, function: fn, password } = req.body;

    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, nombre y rol son requeridos' });
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `Rol inválido. Opciones: ${ASSIGNABLE_ROLES.join(', ')}` });
    }
    if (role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Solo el superadmin puede crear administradores' });
    }
    if (fn && !VALID_FUNCTIONS.includes(fn)) {
      return res.status(400).json({ error: `Función inválida. Opciones: ${VALID_FUNCTIONS.join(', ')}` });
    }

    const hash = await bcrypt.hash(password || '000000', 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, function)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, function, active, must_change_password, created_at`,
      [email.toLowerCase(), hash, name, role, fn || null],
    );

    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
       VALUES ($1, 'create_user', 'user', $2, $3)`,
      [req.user.id, rows[0].id, JSON.stringify({ email, role, function: fn })],
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ya registrado' });
    serverError(res, 'users', err);
  }
});

/* ── PUT /:id ───────────────────────────────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const { name, role, function: fn, active } = req.body;

    const { rows: [target] } = await pool.query(
      'SELECT id, role FROM users WHERE id=$1 AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (role !== undefined) {
      if (!ASSIGNABLE_ROLES.includes(role)) {
        return res.status(400).json({ error: `Rol inválido. Opciones: ${ASSIGNABLE_ROLES.join(', ')}` });
      }
      if (req.user.role !== 'superadmin') {
        return res.status(403).json({ error: 'Solo el superadmin puede cambiar roles' });
      }
      if (target.role === 'superadmin') {
        return res.status(403).json({ error: 'No se puede cambiar el rol del superadmin' });
      }
      if (target.id === req.user.id) {
        return res.status(403).json({ error: 'No puedes cambiar tu propio rol' });
      }
    }

    if (fn !== undefined && fn !== null && !VALID_FUNCTIONS.includes(fn)) {
      return res.status(400).json({ error: `Función inválida. Opciones: ${VALID_FUNCTIONS.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET name     = COALESCE($1, name),
           role     = COALESCE($2, role),
           function = CASE WHEN $3::varchar IS NOT NULL THEN $3::varchar ELSE function END,
           active   = COALESCE($4, active),
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, email, name, role, function, active`,
      [name ?? null, role ?? null, fn ?? null, active ?? null, req.params.id],
    );

    if (role !== undefined) {
      await pool.query(
        `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'change_role', 'user', $2, $3)`,
        [req.user.id, req.params.id, JSON.stringify({ new_role: role, old_role: target.role })],
      );
    }

    res.json(rows[0]);
  } catch (err) {
    serverError(res, 'users', err);
  }
});

/* ── DELETE /:id ────────────────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Solo el superadmin puede eliminar usuarios' });
    }
    if (req.params.id === req.user.id) {
      return res.status(403).json({ error: 'No puedes eliminarte a ti mismo' });
    }

    const { rows: [target] } = await pool.query(
      'SELECT id, email, role FROM users WHERE id=$1 AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.role === 'superadmin') {
      return res.status(403).json({ error: 'No se puede eliminar al superadmin' });
    }

    // Prevent orphaning: refuse if user owns quotations
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM quotations WHERE created_by=$1',
      [req.params.id],
    );
    if (count > 0) {
      return res.status(409).json({
        error: `Este usuario tiene ${count} cotización(es). Desactívalo en lugar de eliminarlo para preservar el historial.`,
      });
    }

    // Soft-delete preserves audit trail
    await pool.query(
      'UPDATE users SET deleted_at = NOW(), active = false WHERE id = $1',
      [req.params.id],
    );
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
       VALUES ($1, 'delete_user', 'user', $2, $3)`,
      [req.user.id, req.params.id, JSON.stringify({ email: target.email })],
    );
    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    serverError(res, 'users', err);
  }
});

/* ── POST /:id/reset-password ───────────────────────────────────── */
router.post('/:id/reset-password', async (req, res) => {
  try {
    const hash = await bcrypt.hash('000000', 12);
    await pool.query(
      'UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2',
      [hash, req.params.id],
    );
    res.json({ message: 'Contraseña reseteada a 000000' });
  } catch (err) {
    serverError(res, 'users', err);
  }
});

module.exports = router;
