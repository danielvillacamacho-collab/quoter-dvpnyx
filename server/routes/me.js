const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { serverError } = require('../utils/http');

router.use(auth);

const VALID_PROFICIENCY = ['beginner', 'intermediate', 'advanced', 'expert'];

async function getEmployeeId(userId) {
  const { rows } = await pool.query(
    'SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL',
    [userId],
  );
  return rows.length ? rows[0].id : null;
}

/* ── Profile ──────────────────────────────────────────────────────── */

router.get('/profile', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });
    const { rows } = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.personal_email, e.corporate_email,
              e.country, e.city, e.level, e.seniority_label, e.employment_type,
              e.weekly_capacity_hours, e.languages, e.start_date, e.status,
              e.bio, e.linkedin_url, e.github_url, e.portfolio_url,
              a.name AS area_name
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
        WHERE e.id = $1`,
      [empId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /me/profile', err); }
});

router.put('/profile', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });

    const { bio, linkedin_url, github_url, portfolio_url, languages, city } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE employees SET
          bio           = COALESCE($1, bio),
          linkedin_url  = COALESCE($2, linkedin_url),
          github_url    = COALESCE($3, github_url),
          portfolio_url = COALESCE($4, portfolio_url),
          languages     = COALESCE($5, languages),
          city          = COALESCE($6, city),
          updated_at    = NOW()
        WHERE id = $7
        RETURNING id, bio, linkedin_url, github_url, portfolio_url, languages, city`,
      [
        bio ?? null,
        linkedin_url ?? null,
        github_url ?? null,
        portfolio_url ?? null,
        languages ? JSON.stringify(languages) : null,
        city ?? null,
        empId,
      ],
    );
    res.json(rows[0]);
  } catch (err) { serverError(res, 'PUT /me/profile', err); }
});

/* ── Skills ───────────────────────────────────────────────────────── */

router.get('/skills', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });
    const { rows } = await pool.query(
      `SELECT es.id, es.skill_id, es.proficiency, es.years_experience, es.notes, es.created_at,
              s.name AS skill_name, s.category AS skill_category
         FROM employee_skills es
         JOIN skills s ON s.id = es.skill_id
        WHERE es.employee_id = $1
        ORDER BY s.category NULLS LAST, s.name`,
      [empId],
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /me/skills', err); }
});

router.post('/skills', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });

    const { skill_id, proficiency, years_experience, notes } = req.body || {};
    if (!skill_id) return res.status(400).json({ error: 'skill_id es requerido' });
    if (proficiency && !VALID_PROFICIENCY.includes(proficiency)) {
      return res.status(400).json({ error: 'proficiency inválido' });
    }

    const { rows: sRows } = await pool.query('SELECT id, active FROM skills WHERE id=$1', [skill_id]);
    if (!sRows.length) return res.status(400).json({ error: 'Skill no existe' });
    if (!sRows[0].active) return res.status(400).json({ error: 'El skill está inactivo' });

    const { rows } = await pool.query(
      `INSERT INTO employee_skills (employee_id, skill_id, proficiency, years_experience, notes)
        VALUES ($1,$2,COALESCE($3,'intermediate'),$4,$5) RETURNING *`,
      [empId, skill_id, proficiency || null,
       years_experience != null ? Number(years_experience) : null,
       notes || null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Ya tienes ese skill asignado' });
    }
    serverError(res, 'POST /me/skills', err);
  }
});

router.put('/skills/:skillId', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });

    const { proficiency, years_experience, notes } = req.body || {};
    if (proficiency && !VALID_PROFICIENCY.includes(proficiency)) {
      return res.status(400).json({ error: 'proficiency inválido' });
    }
    const { rows } = await pool.query(
      `UPDATE employee_skills SET
          proficiency      = COALESCE($1, proficiency),
          years_experience = COALESCE($2, years_experience),
          notes            = COALESCE($3, notes)
        WHERE employee_id=$4 AND skill_id=$5
        RETURNING *`,
      [proficiency ?? null,
       years_experience != null ? Number(years_experience) : null,
       notes ?? null,
       empId, req.params.skillId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Skill no encontrado en tu perfil' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'PUT /me/skills/:skillId', err); }
});

router.delete('/skills/:skillId', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });
    const { rows } = await pool.query(
      'DELETE FROM employee_skills WHERE employee_id=$1 AND skill_id=$2 RETURNING *',
      [empId, req.params.skillId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Skill no encontrado en tu perfil' });
    res.json({ message: 'Skill removido' });
  } catch (err) { serverError(res, 'DELETE /me/skills/:skillId', err); }
});

/* ── Education ────────────────────────────────────────────────────── */

router.get('/education', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });
    const { rows } = await pool.query(
      `SELECT * FROM employee_education WHERE employee_id=$1 ORDER BY end_year DESC NULLS FIRST, start_year DESC`,
      [empId],
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /me/education', err); }
});

router.post('/education', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });

    const { institution, degree, field_of_study, start_year, end_year, description } = req.body || {};
    if (!institution || !degree) return res.status(400).json({ error: 'institution y degree son requeridos' });

    const { rows } = await pool.query(
      `INSERT INTO employee_education (employee_id, institution, degree, field_of_study, start_year, end_year, description)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [empId, institution.trim(), degree.trim(), field_of_study?.trim() || null,
       start_year ? Number(start_year) : null, end_year ? Number(end_year) : null,
       description?.trim() || null],
    );
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, 'POST /me/education', err); }
});

router.put('/education/:id', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });

    const { institution, degree, field_of_study, start_year, end_year, description } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE employee_education SET
          institution    = COALESCE($1, institution),
          degree         = COALESCE($2, degree),
          field_of_study = COALESCE($3, field_of_study),
          start_year     = COALESCE($4, start_year),
          end_year       = COALESCE($5, end_year),
          description    = COALESCE($6, description),
          updated_at     = NOW()
        WHERE id=$7 AND employee_id=$8
        RETURNING *`,
      [institution?.trim() ?? null, degree?.trim() ?? null, field_of_study?.trim() ?? null,
       start_year != null ? Number(start_year) : null,
       end_year != null ? Number(end_year) : null,
       description?.trim() ?? null,
       req.params.id, empId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'PUT /me/education/:id', err); }
});

router.delete('/education/:id', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });
    const { rows } = await pool.query(
      'DELETE FROM employee_education WHERE id=$1 AND employee_id=$2 RETURNING *',
      [req.params.id, empId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ message: 'Educación eliminada' });
  } catch (err) { serverError(res, 'DELETE /me/education/:id', err); }
});

/* ── Assignments (read-only) ──────────────────────────────────────── */

const ME_ASSIGNMENT_VALID_STATUSES = ['planned', 'active', 'ended', 'cancelled'];

router.get('/assignments', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });

    const params = [empId];
    const addParam = (v) => { params.push(v); return `$${params.length}`; };

    // Status filter: support comma-separated values (e.g. status=active,ended).
    // Default excludes only cancelled so all non-terminal assignments are visible.
    const rawStatus = req.query.status ? String(req.query.status) : '';
    const statusList = rawStatus
      ? rawStatus.split(',').map((s) => s.trim()).filter((s) => ME_ASSIGNMENT_VALID_STATUSES.includes(s))
      : [];
    let statusFilter;
    if (statusList.length === 1) {
      statusFilter = `AND a.status = ${addParam(statusList[0])}`;
    } else if (statusList.length > 1) {
      statusFilter = `AND a.status IN (${statusList.map((s) => addParam(s)).join(', ')})`;
    } else {
      statusFilter = `AND a.status NOT IN ('cancelled')`;
    }

    // Date-range intersection (SPEC-007 / SPEC-012): optional, uses same logic as
    // buildAssignmentFilters. Open-ended assignments (end_date IS NULL) match any date_from.
    let dateFilter = '';
    if (req.query.date_from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from)) {
      dateFilter += ` AND (a.end_date IS NULL OR a.end_date >= ${addParam(req.query.date_from)}::date)`;
    }
    if (req.query.date_to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to)) {
      dateFilter += ` AND a.start_date <= ${addParam(req.query.date_to)}::date`;
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.employee_id, a.contract_id, a.resource_request_id,
              a.role_title, a.weekly_hours, a.start_date, a.end_date, a.status,
              c.name AS contract_name,
              cl.name AS client_name,
              rr.role_title AS request_role_title
         FROM assignments a
         JOIN contracts c ON c.id = a.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN resource_requests rr ON rr.id = a.resource_request_id
        WHERE a.employee_id = $1
          AND a.deleted_at IS NULL
          ${statusFilter}
          ${dateFilter}
        ORDER BY a.start_date DESC`,
      params,
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /me/assignments', err); }
});

/* ── Completeness ─────────────────────────────────────────────────── */

router.get('/completeness', async (req, res) => {
  try {
    const empId = await getEmployeeId(req.user.id);
    if (!empId) return res.status(404).json({ error: 'No tienes un perfil de empleado vinculado' });

    const { rows: [emp] } = await pool.query(
      `SELECT bio, linkedin_url, github_url, portfolio_url, languages, city FROM employees WHERE id=$1`,
      [empId],
    );
    const { rows: skills } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM employee_skills WHERE employee_id=$1', [empId],
    );
    const { rows: edu } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM employee_education WHERE employee_id=$1', [empId],
    );

    const checks = [
      { key: 'bio', done: !!emp.bio },
      { key: 'city', done: !!emp.city },
      { key: 'linkedin', done: !!emp.linkedin_url },
      { key: 'skills', done: skills[0].cnt >= 3 },
      { key: 'education', done: edu[0].cnt >= 1 },
      { key: 'languages', done: Array.isArray(emp.languages) && emp.languages.length > 0 },
    ];
    const done = checks.filter((c) => c.done).length;
    res.json({ pct: Math.round((done / checks.length) * 100), checks });
  } catch (err) { serverError(res, 'GET /me/completeness', err); }
});

module.exports = router;
