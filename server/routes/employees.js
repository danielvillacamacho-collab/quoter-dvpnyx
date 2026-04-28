/**
 * Employees CRUD — Sprint 3 Module EE-1.
 * Spec: docs/specs/v2/04_modules/03_employees_and_skills.md
 *       docs/specs/v2/09_user_stories_backlog.md EE-1
 *
 * Scope ownership:
 *   - Any authenticated user may READ (selectors elsewhere depend on this).
 *   - Only admin+ can create / update / soft-delete.
 *   - Soft delete is rejected (409) when the employee has active
 *     assignments — preserves historical allocation data.
 *
 * The user_id link is nullable by design (spec: "distinción Empleado vs
 * Usuario"). An employee may exist with no system-login user. Creating
 * the user later is a separate action (EE-4), not part of this module.
 *
 * All mutations emit structured events via server/utils/events.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { parsePagination } = require('../utils/sanitize');
const { serverError, safeRollback } = require('../utils/http');

router.use(auth);

const VALID_LEVELS = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];
const VALID_STATUSES = ['active','on_leave','bench','terminated'];
const VALID_EMPLOYMENT_TYPES = ['fulltime','parttime','contractor'];

const EDITABLE_FIELDS = [
  'first_name', 'last_name', 'personal_email', 'corporate_email',
  'country', 'city', 'area_id', 'level', 'seniority_label',
  'employment_type', 'weekly_capacity_hours', 'languages',
  'start_date', 'end_date', 'status', 'squad_id', 'manager_user_id',
  'notes', 'tags', 'user_id',
];

function validateLevel(level) {
  if (level === undefined || level === null) return true;
  return VALID_LEVELS.includes(String(level));
}
function validateStatus(status) {
  if (status === undefined || status === null) return true;
  return VALID_STATUSES.includes(String(status));
}
function validateEmploymentType(et) {
  if (et === undefined || et === null) return true;
  return VALID_EMPLOYMENT_TYPES.includes(String(et));
}

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const wheres = ['e.deleted_at IS NULL'];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`(LOWER(e.first_name) LIKE LOWER(${add(like)}) OR LOWER(e.last_name) LIKE LOWER(${add(like)}) OR LOWER(e.corporate_email) LIKE LOWER(${add(like)}))`);
    }
    if (req.query.area_id)     wheres.push(`e.area_id = ${add(req.query.area_id)}`);
    if (req.query.level)       wheres.push(`e.level = ${add(req.query.level)}`);
    if (req.query.status)      wheres.push(`e.status = ${add(req.query.status)}`);
    if (req.query.squad_id)    wheres.push(`e.squad_id = ${add(req.query.squad_id)}`);
    if (req.query.country)     wheres.push(`e.country = ${add(req.query.country)}`);

    const where = `WHERE ${wheres.join(' AND ')}`;
    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM employees e ${where}`, filterParams),
      pool.query(
        `SELECT e.*,
           a.name AS area_name,
           (SELECT COUNT(*)::int FROM employee_skills WHERE employee_id=e.id) AS skills_count
           FROM employees e
           LEFT JOIN areas a ON a.id = e.area_id
           ${where}
           ORDER BY e.last_name, e.first_name
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...filterParams, limit, offset]
      ),
    ]);
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total: countRes.rows[0].total, pages: Math.ceil(countRes.rows[0].total / limit) || 1 },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /employees failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
         a.name AS area_name,
         u.email AS user_email, u.name AS user_name,
         (SELECT COUNT(*)::int FROM employee_skills WHERE employee_id=e.id) AS skills_count,
         (SELECT COUNT(*)::int FROM assignments WHERE employee_id=e.id AND status='active') AS active_assignments_count
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.id=$1 AND e.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /employees/:id', err); }
});

/* -------- CREATE (admin+) -------- */
router.post('/', adminOnly, async (req, res) => {
  const body = req.body || {};
  const { first_name, last_name, country, area_id, level, start_date } = body;

  if (!first_name || !String(first_name).trim()) return res.status(400).json({ error: 'first_name es requerido' });
  if (!last_name || !String(last_name).trim()) return res.status(400).json({ error: 'last_name es requerido' });
  if (!country || !String(country).trim()) return res.status(400).json({ error: 'country es requerido' });
  if (!area_id) return res.status(400).json({ error: 'area_id es requerido' });
  if (!level) return res.status(400).json({ error: 'level es requerido' });
  if (!validateLevel(level)) return res.status(400).json({ error: 'level inválido (L1..L11)' });
  if (!start_date) return res.status(400).json({ error: 'start_date es requerido' });
  if (!validateStatus(body.status)) return res.status(400).json({ error: 'status inválido' });
  if (!validateEmploymentType(body.employment_type)) return res.status(400).json({ error: 'employment_type inválido' });

  try {
    // Referential check — area must exist and be active
    const { rows: areaRows } = await pool.query(
      `SELECT id, active FROM areas WHERE id=$1`, [area_id]
    );
    if (!areaRows.length) return res.status(400).json({ error: 'area_id no existe' });
    if (!areaRows[0].active) return res.status(400).json({ error: 'El área está inactiva' });

    // Corporate email must be unique when provided
    if (body.corporate_email) {
      const dup = await pool.query(
        `SELECT id FROM employees WHERE LOWER(corporate_email)=LOWER($1) AND deleted_at IS NULL`,
        [String(body.corporate_email).trim()]
      );
      if (dup.rows.length) return res.status(409).json({ error: 'Ya existe un empleado con ese corporate_email' });
    }
    // Optional: user_id must be unique (DB-enforced, but friendly check)
    if (body.user_id) {
      const dup = await pool.query(
        `SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL`,
        [body.user_id]
      );
      if (dup.rows.length) return res.status(409).json({ error: 'Ese usuario ya está asociado a otro empleado' });
    }

    const { rows } = await pool.query(
      `INSERT INTO employees
         (user_id, first_name, last_name, personal_email, corporate_email,
          country, city, area_id, level, seniority_label, employment_type,
          weekly_capacity_hours, languages, start_date, end_date, status,
          squad_id, manager_user_id, notes, tags, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16,'active'),$17,$18,$19,$20,$21)
        RETURNING *`,
      [
        body.user_id || null,
        String(first_name).trim(),
        String(last_name).trim(),
        body.personal_email || null,
        body.corporate_email ? String(body.corporate_email).trim() : null,
        String(country).trim(),
        body.city || null,
        area_id,
        level,
        body.seniority_label || null,
        body.employment_type || 'fulltime',
        body.weekly_capacity_hours != null ? Number(body.weekly_capacity_hours) : 40,
        JSON.stringify(body.languages || []),
        start_date,
        body.end_date || null,
        body.status || null,
        body.squad_id || null,
        body.manager_user_id || null,
        body.notes || null,
        body.tags || null,
        req.user.id,
      ]
    );
    const emp = rows[0];
    await emitEvent(pool, {
      event_type: 'employee.created', entity_type: 'employee', entity_id: emp.id,
      actor_user_id: req.user.id,
      payload: { first_name: emp.first_name, last_name: emp.last_name, area_id: emp.area_id, level: emp.level, status: emp.status },
      req,
    });
    res.status(201).json(emp);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /employees failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* -------- UPDATE (admin+) -------- */
router.put('/:id', adminOnly, async (req, res) => {
  const conn = await pool.connect();
  try {
    const { rows: [before] } = await conn.query(
      `SELECT * FROM employees WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!before) { conn.release(); return res.status(404).json({ error: 'Empleado no encontrado' }); }

    const body = req.body || {};
    if (body.first_name !== undefined && !String(body.first_name).trim()) {
      conn.release();
      return res.status(400).json({ error: 'first_name no puede estar vacío' });
    }
    if (body.last_name !== undefined && !String(body.last_name).trim()) {
      conn.release();
      return res.status(400).json({ error: 'last_name no puede estar vacío' });
    }
    if (!validateLevel(body.level))           { conn.release(); return res.status(400).json({ error: 'level inválido' }); }
    if (!validateStatus(body.status))         { conn.release(); return res.status(400).json({ error: 'status inválido' }); }
    if (!validateEmploymentType(body.employment_type)) { conn.release(); return res.status(400).json({ error: 'employment_type inválido' }); }

    // Duplicate corporate_email check when renaming
    if (body.corporate_email && String(body.corporate_email).trim().toLowerCase() !== String(before.corporate_email || '').toLowerCase()) {
      const dup = await conn.query(
        `SELECT id FROM employees WHERE LOWER(corporate_email)=LOWER($1) AND deleted_at IS NULL AND id<>$2`,
        [String(body.corporate_email).trim(), req.params.id]
      );
      if (dup.rows.length) { conn.release(); return res.status(409).json({ error: 'Ya existe un empleado con ese corporate_email' }); }
    }

    await conn.query('BEGIN');

    const { rows } = await conn.query(
      `UPDATE employees SET
          user_id               = COALESCE($1, user_id),
          first_name            = COALESCE($2, first_name),
          last_name             = COALESCE($3, last_name),
          personal_email        = COALESCE($4, personal_email),
          corporate_email       = COALESCE($5, corporate_email),
          country               = COALESCE($6, country),
          city                  = COALESCE($7, city),
          area_id               = COALESCE($8, area_id),
          level                 = COALESCE($9, level),
          seniority_label       = COALESCE($10, seniority_label),
          employment_type       = COALESCE($11, employment_type),
          weekly_capacity_hours = COALESCE($12, weekly_capacity_hours),
          languages             = COALESCE($13::jsonb, languages),
          start_date            = COALESCE($14, start_date),
          end_date              = COALESCE($15, end_date),
          status                = COALESCE($16, status),
          squad_id              = COALESCE($17, squad_id),
          manager_user_id       = COALESCE($18, manager_user_id),
          notes                 = COALESCE($19, notes),
          tags                  = COALESCE($20, tags),
          updated_at            = NOW()
        WHERE id=$21 AND deleted_at IS NULL
        RETURNING *`,
      [
        body.user_id ?? null,
        body.first_name ? String(body.first_name).trim() : null,
        body.last_name ? String(body.last_name).trim() : null,
        body.personal_email ?? null,
        body.corporate_email ? String(body.corporate_email).trim() : null,
        body.country ? String(body.country).trim() : null,
        body.city ?? null,
        body.area_id ?? null,
        body.level ?? null,
        body.seniority_label ?? null,
        body.employment_type ?? null,
        body.weekly_capacity_hours != null ? Number(body.weekly_capacity_hours) : null,
        body.languages ? JSON.stringify(body.languages) : null,
        body.start_date ?? null,
        body.end_date ?? null,
        body.status ?? null,
        body.squad_id ?? null,
        body.manager_user_id ?? null,
        body.notes ?? null,
        body.tags ?? null,
        req.params.id,
      ]
    );
    const after = rows[0];

    // EE-2: status transitions with side effects.
    //   terminated → cancel planned/active assignments (preserves history
    //                via soft semantics; active time_entries stay intact)
    //   on_leave   → flag for manager notification (ES-3 wires the
    //                notification; here we just emit the event)
    //   active from on_leave → emit "leave_ended" event
    let cancelledAssignments = [];
    const statusChanged = before.status !== after.status;
    if (statusChanged && after.status === 'terminated') {
      const { rows: cancelled } = await conn.query(
        `UPDATE assignments SET status='cancelled', updated_at=NOW()
          WHERE employee_id=$1 AND status IN ('planned','active')
          RETURNING id`,
        [after.id]
      );
      cancelledAssignments = cancelled.map((r) => r.id);
    }

    await emitEvent(conn, {
      event_type: 'employee.updated', entity_type: 'employee', entity_id: after.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, after, EDITABLE_FIELDS),
      req,
    });
    if (statusChanged) {
      await emitEvent(conn, {
        event_type: 'employee.status_changed', entity_type: 'employee', entity_id: after.id,
        actor_user_id: req.user.id,
        payload: {
          from: before.status, to: after.status,
          cancelled_assignments: cancelledAssignments.length,
        },
        req,
      });
      if (after.status === 'terminated') {
        await emitEvent(conn, {
          event_type: 'employee.terminated', entity_type: 'employee', entity_id: after.id,
          actor_user_id: req.user.id,
          payload: { cancelled_assignments: cancelledAssignments },
          req,
        });
      } else if (after.status === 'on_leave') {
        await emitEvent(conn, {
          event_type: 'employee.leave_started', entity_type: 'employee', entity_id: after.id,
          actor_user_id: req.user.id,
          payload: { manager_user_id: after.manager_user_id, from: before.status },
          req,
        });
      } else if (before.status === 'on_leave' && after.status === 'active') {
        await emitEvent(conn, {
          event_type: 'employee.leave_ended', entity_type: 'employee', entity_id: after.id,
          actor_user_id: req.user.id,
          payload: {},
          req,
        });
      }
    }

    await conn.query('COMMIT');
    res.json({ ...after, cancelled_assignments: cancelledAssignments.length });
  } catch (err) {
    await safeRollback(conn, 'transaction');
    // eslint-disable-next-line no-console
    console.error('PUT /employees/:id failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

/* -------- SOFT DELETE (admin+) --------
 * 409 when the employee still has active assignments. Deletion implies
 * we'd lose the assignment history context; the UI should walk admin
 * through terminating them first.
 */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rows: deps } = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM assignments WHERE employee_id=$1 AND status='active') AS active_assignments`,
      [req.params.id]
    );
    if (deps[0].active_assignments > 0) {
      return res.status(409).json({
        error: `Este empleado tiene ${deps[0].active_assignments} asignación(es) activa(s). Termínalas antes de eliminar.`,
        active_assignments: deps[0].active_assignments,
      });
    }
    const { rows } = await pool.query(
      `UPDATE employees SET deleted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    await emitEvent(pool, {
      event_type: 'employee.deleted', entity_type: 'employee', entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { first_name: rows[0].first_name, last_name: rows[0].last_name },
      req,
    });
    res.json({ message: 'Empleado eliminado' });
  } catch (err) { serverError(res, 'DELETE /employees/:id', err); }
});

/* ========================================================================
 * EE-3 — Employee skills (proficiency, years, notes)
 *
 * Nested under employee because skills only make sense in that context.
 * Mutations are admin+; any authenticated user can READ a ficha.
 * The selector endpoint in /api/skills already filters inactive skills
 * when active=true is sent; the frontend is expected to do that when
 * building the "add skill" selector.
 * ====================================================================== */

const VALID_PROFICIENCY = ['beginner','intermediate','advanced','expert'];

/* List skills for an employee, joined to the skill catalog row. */
router.get('/:id/skills', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT es.id, es.employee_id, es.skill_id, es.proficiency,
              es.years_experience, es.notes, es.created_at,
              s.name AS skill_name, s.category AS skill_category, s.active AS skill_active
         FROM employee_skills es
         JOIN skills s ON s.id = es.skill_id
        WHERE es.employee_id = $1
        ORDER BY s.category NULLS LAST, s.name`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /employees/:id/skills failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* Assign a skill to an employee. 409 on duplicate (UNIQUE index). */
router.post('/:id/skills', adminOnly, async (req, res) => {
  const { skill_id, proficiency, years_experience, notes } = req.body || {};
  if (!skill_id) return res.status(400).json({ error: 'skill_id es requerido' });
  if (proficiency && !VALID_PROFICIENCY.includes(proficiency)) {
    return res.status(400).json({ error: 'proficiency inválido' });
  }

  try {
    // Referential + active check on skill
    const { rows: sRows } = await pool.query(`SELECT id, name, active FROM skills WHERE id=$1`, [skill_id]);
    if (!sRows.length) return res.status(400).json({ error: 'skill no existe' });
    if (!sRows[0].active) return res.status(400).json({ error: 'El skill está inactivo y no puede asignarse' });

    // Ensure employee exists (scoped to not-deleted)
    const { rows: eRows } = await pool.query(
      `SELECT id FROM employees WHERE id=$1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!eRows.length) return res.status(404).json({ error: 'Empleado no encontrado' });

    const { rows } = await pool.query(
      `INSERT INTO employee_skills (employee_id, skill_id, proficiency, years_experience, notes)
        VALUES ($1,$2,COALESCE($3,'intermediate'),$4,$5) RETURNING *`,
      [
        req.params.id,
        skill_id,
        proficiency || null,
        years_experience != null ? Number(years_experience) : null,
        notes || null,
      ]
    );
    const es = rows[0];
    await emitEvent(pool, {
      event_type: 'employee_skill.assigned',
      entity_type: 'employee',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: { skill_id, skill_name: sRows[0].name, proficiency: es.proficiency },
      req,
    });
    res.status(201).json(es);
  } catch (err) {
    // UNIQUE violation on (employee_id, skill_id)
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Este empleado ya tiene ese skill asignado' });
    }
    // eslint-disable-next-line no-console
    console.error('POST /employees/:id/skills failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* Update proficiency / years / notes on an existing assignment. */
router.put('/:id/skills/:skillId', adminOnly, async (req, res) => {
  const body = req.body || {};
  if (body.proficiency && !VALID_PROFICIENCY.includes(body.proficiency)) {
    return res.status(400).json({ error: 'proficiency inválido' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE employee_skills SET
          proficiency       = COALESCE($1, proficiency),
          years_experience  = COALESCE($2, years_experience),
          notes             = COALESCE($3, notes)
        WHERE employee_id=$4 AND skill_id=$5
        RETURNING *`,
      [
        body.proficiency ?? null,
        body.years_experience != null ? Number(body.years_experience) : null,
        body.notes ?? null,
        req.params.id,
        req.params.skillId,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Asignación no encontrada' });
    await emitEvent(pool, {
      event_type: 'employee_skill.updated',
      entity_type: 'employee',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: { skill_id: Number(req.params.skillId), proficiency: rows[0].proficiency },
      req,
    });
    res.json(rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PUT /employees/:id/skills/:skillId failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* Remove a skill from an employee. */
router.delete('/:id/skills/:skillId', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM employee_skills WHERE employee_id=$1 AND skill_id=$2 RETURNING *`,
      [req.params.id, req.params.skillId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Asignación no encontrada' });
    await emitEvent(pool, {
      event_type: 'employee_skill.removed',
      entity_type: 'employee',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: { skill_id: Number(req.params.skillId) },
      req,
    });
    res.json({ message: 'Skill removido' });
  } catch (err) { serverError(res, 'DELETE /employees/:id/skills/:skillId', err); }
});

module.exports = router;
