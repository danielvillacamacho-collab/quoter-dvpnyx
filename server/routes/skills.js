/**
 * Skills catalog — Sprint 3 Module EA-2.
 * Spec: docs/specs/v2/04_modules/03_employees_and_skills.md
 *       docs/specs/v2/09_user_stories_backlog.md EA-2
 *
 * Scope ownership (mirrors areas.js):
 *   - Any authenticated user may READ (selectors elsewhere need this).
 *   - Only admin+ can create / update / activate / deactivate.
 *   - No hard DELETE. Deactivation is blocked if any employees currently
 *     have the skill assigned (preserves historical assignment context).
 *
 * Categorías predefinidas are kept as strings on the row (category
 * VARCHAR). The spec does not require a separate category table.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { serverError } = require('../utils/http');

router.use(auth);

const EDITABLE_FIELDS = ['name', 'category', 'description'];

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const wheres = [];
    const params = [];
    if (req.query.active !== undefined) {
      params.push(req.query.active === 'true' || req.query.active === '1');
      wheres.push(`s.active = $${params.length}`);
    }
    if (req.query.category) {
      params.push(req.query.category);
      wheres.push(`s.category = $${params.length}`);
    }
    if (req.query.search) {
      params.push('%' + req.query.search + '%');
      wheres.push(`LOWER(s.name) LIKE LOWER($${params.length})`);
    }
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT s.*,
         (SELECT COUNT(*)::int FROM employee_skills es JOIN employees e ON e.id=es.employee_id
            WHERE es.skill_id=s.id AND e.deleted_at IS NULL) AS employees_count
         FROM skills s
         ${where}
         ORDER BY s.category NULLS LAST, s.name`,
      params
    );
    res.json({ data: rows });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /skills failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
         (SELECT COUNT(*)::int FROM employee_skills es JOIN employees e ON e.id=es.employee_id
            WHERE es.skill_id=s.id AND e.deleted_at IS NULL) AS employees_count
         FROM skills s WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Skill no encontrado' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /skills/:id', err); }
});

/* -------- CREATE (admin+) -------- */
router.post('/', adminOnly, async (req, res) => {
  const { name, category, description } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name es requerido' });

  try {
    const dup = await pool.query(
      `SELECT id, name FROM skills WHERE LOWER(name)=LOWER($1)`,
      [String(name).trim()]
    );
    if (dup.rows.length) {
      return res.status(409).json({
        error: 'Ya existe un skill con ese nombre',
        hint: dup.rows[0].name,
        existing_id: dup.rows[0].id,
      });
    }
    const { rows } = await pool.query(
      `INSERT INTO skills (name, category, description) VALUES ($1,$2,$3) RETURNING *`,
      [String(name).trim(), category || null, description || null]
    );
    const skill = rows[0];
    await emitEvent(pool, {
      event_type: 'skill.created', entity_type: 'skill', entity_id: String(skill.id),
      actor_user_id: req.user.id, payload: { name: skill.name, category: skill.category }, req,
    });
    res.status(201).json(skill);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /skills failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- UPDATE (admin+) -------- */
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: [before] } = await pool.query(`SELECT * FROM skills WHERE id=$1`, [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Skill no encontrado' });

    const body = req.body || {};
    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ error: 'name no puede estar vacío' });
    }
    if (body.name && String(body.name).trim().toLowerCase() !== before.name.toLowerCase()) {
      const dup = await pool.query(
        `SELECT id FROM skills WHERE LOWER(name)=LOWER($1) AND id<>$2`,
        [String(body.name).trim(), req.params.id]
      );
      if (dup.rows.length) return res.status(409).json({ error: 'Ya existe un skill con ese nombre' });
    }
    const { rows } = await pool.query(
      `UPDATE skills SET
          name        = COALESCE($1, name),
          category    = COALESCE($2, category),
          description = COALESCE($3, description)
        WHERE id=$4 RETURNING *`,
      [
        body.name ? String(body.name).trim() : null,
        body.category ?? null,
        body.description ?? null,
        req.params.id,
      ]
    );
    const after = rows[0];
    await emitEvent(pool, {
      event_type: 'skill.updated', entity_type: 'skill', entity_id: String(after.id),
      actor_user_id: req.user.id, payload: buildUpdatePayload(before, after, EDITABLE_FIELDS), req,
    });
    res.json(after);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /skills/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- DEACTIVATE (admin+) --------
 * 409 if any employee still has this skill assigned. The UI asks admin
 * to reassign/remove the skill from those employees first.
 */
router.post('/:id/deactivate', adminOnly, async (req, res) => {
  try {
    const { rows: used } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM employee_skills es
         JOIN employees e ON e.id=es.employee_id
         WHERE es.skill_id=$1 AND e.deleted_at IS NULL`,
      [req.params.id]
    );
    if (used[0].count > 0) {
      return res.status(409).json({
        error: `Este skill está asignado a ${used[0].count} empleado(s). Remuévelo primero.`,
        employees_count: used[0].count,
      });
    }
    const { rows } = await pool.query(
      `UPDATE skills SET active=false WHERE id=$1 AND active=true RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Skill no encontrado o ya inactivo' });
    await emitEvent(pool, {
      event_type: 'skill.deactivated', entity_type: 'skill', entity_id: String(rows[0].id),
      actor_user_id: req.user.id, payload: { name: rows[0].name }, req,
    });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'POST /skills/:id/deactivate', err); }
});

/* -------- ACTIVATE (admin+) -------- */
router.post('/:id/activate', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE skills SET active=true WHERE id=$1 AND active=false RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Skill no encontrado o ya activo' });
    await emitEvent(pool, {
      event_type: 'skill.activated', entity_type: 'skill', entity_id: String(rows[0].id),
      actor_user_id: req.user.id, payload: { name: rows[0].name }, req,
    });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'POST /skills/:id/activate', err); }
});

module.exports = router;
