/**
 * Areas catalog — Sprint 3 Module EA-1.
 * Spec: docs/specs/v2/04_modules/03_employees_and_skills.md
 *       docs/specs/v2/09_user_stories_backlog.md EA-1
 *
 * Scope ownership:
 *   - Any authenticated user may READ (selectors elsewhere depend on this).
 *   - Only admin+ can create / update / activate / deactivate.
 *   - No hard DELETE. Deactivation is blocked if the area still has
 *     active employees (preserves referential history).
 *
 * All mutations emit structured events via server/utils/events.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { serverError } = require('../utils/http');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');

router.use(auth);

const EDITABLE_FIELDS = ['key', 'name', 'description', 'sort_order'];

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const wheres = [];
    const params = [];
    if (req.query.active !== undefined) {
      params.push(req.query.active === 'true' || req.query.active === '1');
      wheres.push(`active = $${params.length}`);
    }
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT a.*,
         (SELECT COUNT(*)::int FROM employees e WHERE e.area_id=a.id AND e.status='active' AND e.deleted_at IS NULL) AS active_employees_count
         FROM areas a
         ${where}
         ORDER BY a.sort_order, a.name`,
      params
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /areas', err); }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*,
         (SELECT COUNT(*)::int FROM employees e WHERE e.area_id=a.id AND e.status='active' AND e.deleted_at IS NULL) AS active_employees_count
         FROM areas a WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Área no encontrada' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /areas/:id', err); }
});

/* -------- CREATE (admin+) -------- */
router.post('/', adminOnly, async (req, res) => {
  const { key, name, description, sort_order } = req.body || {};
  if (!key || !String(key).trim()) return res.status(400).json({ error: 'key es requerido' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name es requerido' });

  try {
    // duplicate check on key (case-insensitive) — the UNIQUE constraint on
    // `key` already enforces this at the DB level but we want a friendly
    // 409 with the existing row's id, same pattern as Clients.
    const dup = await pool.query(
      `SELECT id, key, name FROM areas WHERE LOWER(key)=LOWER($1)`,
      [String(key).trim()]
    );
    if (dup.rows.length) {
      return res.status(409).json({
        error: 'Ya existe un área con esa key',
        hint: dup.rows[0].name,
        existing_id: dup.rows[0].id,
      });
    }
    const { rows } = await pool.query(
      `INSERT INTO areas (key, name, description, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [String(key).trim(), String(name).trim(), description || null, Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0]
    );
    const area = rows[0];
    await emitEvent(pool, {
      event_type: 'area.created', entity_type: 'area', entity_id: String(area.id),
      actor_user_id: req.user.id, payload: { key: area.key, name: area.name }, req,
    });
    res.status(201).json(area);
  } catch (err) { serverError(res, 'POST /areas', err); }
});

/* -------- UPDATE (admin+) -------- */
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: [before] } = await pool.query(`SELECT * FROM areas WHERE id=$1`, [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Área no encontrada' });

    const body = req.body || {};
    if (body.key !== undefined && !String(body.key).trim()) {
      return res.status(400).json({ error: 'key no puede estar vacío' });
    }
    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ error: 'name no puede estar vacío' });
    }
    // duplicate-key check when renaming the key
    if (body.key && String(body.key).trim().toLowerCase() !== before.key.toLowerCase()) {
      const dup = await pool.query(
        `SELECT id FROM areas WHERE LOWER(key)=LOWER($1) AND id<>$2`,
        [String(body.key).trim(), req.params.id]
      );
      if (dup.rows.length) return res.status(409).json({ error: 'Ya existe un área con esa key' });
    }

    const { rows } = await pool.query(
      `UPDATE areas SET
          key         = COALESCE($1, key),
          name        = COALESCE($2, name),
          description = COALESCE($3, description),
          sort_order  = COALESCE($4, sort_order)
        WHERE id=$5 RETURNING *`,
      [
        body.key ? String(body.key).trim() : null,
        body.name ? String(body.name).trim() : null,
        body.description ?? null,
        body.sort_order != null ? Number(body.sort_order) : null,
        req.params.id,
      ]
    );
    const after = rows[0];
    await emitEvent(pool, {
      event_type: 'area.updated', entity_type: 'area', entity_id: String(after.id),
      actor_user_id: req.user.id, payload: buildUpdatePayload(before, after, EDITABLE_FIELDS), req,
    });
    res.json(after);
  } catch (err) { serverError(res, 'PUT /areas/:id', err); }
});

/* -------- DEACTIVATE (admin+) --------
 * 409 if there are still active employees assigned to this area. The UI
 * guides the admin to reassign them before retiring the area.
 */
router.post('/:id/deactivate', adminOnly, async (req, res) => {
  try {
    const { rows: employees } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM employees
         WHERE area_id=$1 AND status='active' AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (employees[0].count > 0) {
      return res.status(409).json({
        error: `Este área tiene ${employees[0].count} empleado(s) activo(s). Reasígnalos antes de desactivarla.`,
        active_employees_count: employees[0].count,
      });
    }
    const { rows } = await pool.query(
      `UPDATE areas SET active=false WHERE id=$1 AND active=true RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Área no encontrada o ya inactiva' });
    await emitEvent(pool, {
      event_type: 'area.deactivated', entity_type: 'area', entity_id: String(rows[0].id),
      actor_user_id: req.user.id, payload: { key: rows[0].key, name: rows[0].name }, req,
    });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'POST /areas/:id/deactivate', err); }
});

/* -------- ACTIVATE (admin+) -------- */
router.post('/:id/activate', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE areas SET active=true WHERE id=$1 AND active=false RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Área no encontrada o ya activa' });
    await emitEvent(pool, {
      event_type: 'area.activated', entity_type: 'area', entity_id: String(rows[0].id),
      actor_user_id: req.user.id, payload: { key: rows[0].key, name: rows[0].name }, req,
    });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'POST /areas/:id/activate', err); }
});

module.exports = router;
