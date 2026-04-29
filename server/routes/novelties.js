/**
 * Employee Novelties — SPEC-II-00.
 *
 * Vacaciones, incapacidades, capacitaciones y otras ausencias de
 * empleados. En MVP NO hay workflow de aprobación: quien crea aprueba.
 * Roles permitidos para crear: admin, lead (solo su equipo via
 * employees.manager_user_id) y `capacity` function.
 *
 * Lectura:
 *   - Empleado (member): solo sus propias novedades.
 *   - Lead: las suyas + las de quienes le reportan.
 *   - Admin/superadmin/función=capacity: todas.
 *
 * Overlap: trigger DB (`prevent_novelty_overlap`) bloquea solapamiento
 * de novedades aprobadas para el mismo empleado. Convertimos el error
 * pgcode 23505/raise en 422 con mensaje claro.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { emitEvent } = require('../utils/events');
const { parsePagination, isValidUUID, isValidISODate } = require('../utils/sanitize');
const { serverError, safeRollback } = require('../utils/http');

router.use(auth);

const VALID_TYPES = ['vacation', 'sick_leave', 'parental_leave', 'unpaid_leave',
  'bereavement', 'legal_leave', 'corporate_training', 'unavailable_other'];

function isAdmin(user) {
  return ['admin', 'superadmin'].includes(user.role);
}

/** El usuario tiene visibilidad global (admin o función capacity). */
function hasGlobalView(user) {
  return isAdmin(user) || user.function === 'capacity';
}

/** Puede crear/editar novedades. */
function canMutate(user) {
  return hasGlobalView(user) || user.role === 'lead';
}

/**
 * Verifica que `req.user` tenga visibilidad sobre `targetEmployeeId`.
 * Devuelve null si OK; un objeto { status, error } si falla.
 *
 * - Admin / capacity: visibilidad global.
 * - Lead: empleados con employees.manager_user_id = req.user.id, o el
 *   suyo propio (employees.user_id = req.user.id).
 * - Member: solo el suyo (employees.user_id = req.user.id).
 */
async function checkEmployeeScope(req, targetEmployeeId) {
  if (hasGlobalView(req.user)) return null;

  const { rows } = await pool.query(
    `SELECT id, user_id, manager_user_id FROM employees
      WHERE id = $1 AND deleted_at IS NULL`,
    [targetEmployeeId]
  );
  if (!rows.length) return { status: 404, error: 'Empleado no encontrado' };
  const e = rows[0];

  // Su propio registro
  if (e.user_id && e.user_id === req.user.id) return null;

  // Lead viendo gente que le reporta
  if (req.user.role === 'lead' && e.manager_user_id === req.user.id) return null;

  return { status: 403, error: 'Sin permisos sobre este empleado' };
}

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const wheres = [];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.employee_id) {
      const scope = await checkEmployeeScope(req, req.query.employee_id);
      if (scope) return res.status(scope.status).json({ error: scope.error });
      wheres.push(`n.employee_id = ${add(req.query.employee_id)}`);
    } else if (!hasGlobalView(req.user)) {
      // Sin filtro explícito y sin visibilidad global → solo lo suyo.
      // Si es lead, también ve a su equipo.
      if (req.user.role === 'lead') {
        wheres.push(`(EXISTS (
           SELECT 1 FROM employees e2
            WHERE e2.id = n.employee_id
              AND (e2.user_id = ${add(req.user.id)} OR e2.manager_user_id = ${add(req.user.id)})
         ))`);
      } else {
        wheres.push(`(EXISTS (
           SELECT 1 FROM employees e2
            WHERE e2.id = n.employee_id AND e2.user_id = ${add(req.user.id)}
         ))`);
      }
    }

    if (req.query.novelty_type_id) wheres.push(`n.novelty_type_id = ${add(req.query.novelty_type_id)}`);
    if (req.query.status)          wheres.push(`n.status = ${add(req.query.status)}`);
    if (req.query.from_date)       wheres.push(`n.end_date   >= ${add(req.query.from_date)}::date`);
    if (req.query.to_date)         wheres.push(`n.start_date <= ${add(req.query.to_date)}::date`);

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const limitIdx  = params.length + 1;
    const offsetIdx = params.length + 2;

    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM employee_novelties n ${where}`, params),
      pool.query(
        `SELECT n.*,
                e.first_name, e.last_name, e.country, e.country_id,
                nt.label_es AS novelty_type_label,
                nt.is_paid_time, nt.requires_attachment_recommended,
                approver.name AS approved_by_name
           FROM employee_novelties n
           LEFT JOIN employees e        ON e.id = n.employee_id
           LEFT JOIN novelty_types nt   ON nt.id = n.novelty_type_id
           LEFT JOIN users approver     ON approver.id = n.approved_by
           ${where}
           ORDER BY n.start_date DESC
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, limit, offset]
      ),
    ]);

    res.json({
      data: rowsRes.rows,
      pagination: {
        page, limit,
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / limit) || 1,
      },
    });
  } catch (err) { serverError(res, 'GET /novelties', err); }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query(
      `SELECT n.*,
              e.first_name, e.last_name, e.user_id AS employee_user_id,
              e.manager_user_id,
              nt.label_es AS novelty_type_label
         FROM employee_novelties n
         LEFT JOIN employees e      ON e.id = n.employee_id
         LEFT JOIN novelty_types nt ON nt.id = n.novelty_type_id
        WHERE n.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Novedad no encontrada' });
    const n = rows[0];

    if (!hasGlobalView(req.user)) {
      if (n.employee_user_id !== req.user.id
          && !(req.user.role === 'lead' && n.manager_user_id === req.user.id)) {
        return res.status(403).json({ error: 'Sin permisos' });
      }
    }
    res.json(n);
  } catch (err) { serverError(res, 'GET /novelties/:id', err); }
});

/* -------- CREATE -------- */
router.post('/', async (req, res) => {
  if (!canMutate(req.user)) {
    return res.status(403).json({ error: 'Solo lead/admin/capacity pueden crear novedades' });
  }
  const {
    employee_id, novelty_type_id, start_date, end_date, reason,
    attachment_url, attachment_note,
  } = req.body || {};

  if (!isValidUUID(employee_id))   return res.status(400).json({ error: 'employee_id inválido' });
  if (!VALID_TYPES.includes(novelty_type_id)) {
    return res.status(400).json({ error: `novelty_type_id inválido (válidos: ${VALID_TYPES.join(',')})` });
  }
  if (!isValidISODate(start_date)) return res.status(400).json({ error: 'start_date inválido' });
  if (!isValidISODate(end_date))   return res.status(400).json({ error: 'end_date inválido' });
  if (end_date < start_date)       return res.status(400).json({ error: 'end_date debe ser ≥ start_date' });

  // Lead solo puede registrar para su equipo.
  if (!hasGlobalView(req.user)) {
    const scope = await checkEmployeeScope(req, employee_id);
    if (scope) return res.status(scope.status).json({ error: scope.error });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    const { rows: empRows } = await conn.query(
      `SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employee_id]
    );
    if (!empRows.length) {
      await safeRollback(conn, 'POST /novelties'); conn.release();
      return res.status(400).json({ error: 'employee no existe' });
    }

    let inserted;
    try {
      const { rows } = await conn.query(
        `INSERT INTO employee_novelties
           (employee_id, novelty_type_id, start_date, end_date, status,
            reason, attachment_url, attachment_note,
            approved_at, approved_by, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'approved',
                 $5, $6, $7,
                 NOW(), $8, $8, $8)
         RETURNING *`,
        [
          employee_id, novelty_type_id, start_date, end_date,
          reason || null, attachment_url || null, attachment_note || null,
          req.user.id,
        ]
      );
      inserted = rows[0];
    } catch (insErr) {
      // Trigger overlap → mensaje claro 422
      if (insErr.message && /novelty_overlap/i.test(insErr.message)) {
        await safeRollback(conn, 'POST /novelties'); conn.release();
        return res.status(422).json({
          error: 'overlap_detected',
          message: 'El empleado ya tiene una novedad aprobada que se solapa con este rango.',
        });
      }
      throw insErr;
    }

    await emitEvent(conn, {
      event_type: 'novelty.created',
      entity_type: 'novelty',
      entity_id: inserted.id,
      actor_user_id: req.user.id,
      payload: {
        employee_id, novelty_type_id, start_date, end_date,
      },
      req,
    });

    await conn.query('COMMIT');
    res.status(201).json(inserted);
  } catch (err) {
    await safeRollback(conn, 'POST /novelties');
    serverError(res, 'POST /novelties', err);
  } finally {
    conn.release();
  }
});

/* -------- CANCEL -------- */
router.post('/:id/cancel', async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  const reason = (req.body && req.body.cancellation_reason) || null;
  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'cancellation_reason requerido (≥5 chars)' });
  }
  if (!canMutate(req.user)) {
    return res.status(403).json({ error: 'Sin permisos para cancelar' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `SELECT n.*, e.user_id AS employee_user_id, e.manager_user_id
         FROM employee_novelties n
         LEFT JOIN employees e ON e.id = n.employee_id
        WHERE n.id = $1`, [req.params.id]
    );
    if (!rows.length) {
      await safeRollback(conn, 'POST /novelties/:id/cancel'); conn.release();
      return res.status(404).json({ error: 'Novedad no encontrada' });
    }
    const n = rows[0];
    if (n.status === 'cancelled') {
      await safeRollback(conn, 'POST /novelties/:id/cancel'); conn.release();
      return res.status(409).json({ error: 'Ya está cancelada' });
    }
    if (!hasGlobalView(req.user)) {
      const isOwn = n.employee_user_id === req.user.id;
      const isLeadOfEmp = req.user.role === 'lead' && n.manager_user_id === req.user.id;
      if (!isOwn && !isLeadOfEmp && n.created_by !== req.user.id) {
        await safeRollback(conn, 'POST /novelties/:id/cancel'); conn.release();
        return res.status(403).json({ error: 'Sin permisos para cancelar esta novedad' });
      }
    }

    const { rows: updated } = await conn.query(
      `UPDATE employee_novelties
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_by = $1,
              cancellation_reason = $2,
              updated_by = $1, updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [req.user.id, reason, req.params.id]
    );

    await emitEvent(conn, {
      event_type: 'novelty.cancelled',
      entity_type: 'novelty',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: { cancellation_reason: reason },
      req,
    });

    await conn.query('COMMIT');
    res.json(updated[0]);
  } catch (err) {
    await safeRollback(conn, 'POST /novelties/:id/cancel');
    serverError(res, 'POST /novelties/:id/cancel', err);
  } finally {
    conn.release();
  }
});

/* -------- USER CALENDAR --------
 * Vista combinada: festivos del país del empleado + novedades + asignaciones,
 * limitado a un rango. Útil para construir el modal "Registrar novedad" en el
 * frontend con warnings de overlap.
 */
router.get('/calendar/:employee_id', async (req, res) => {
  const { employee_id } = req.params;
  if (!isValidUUID(employee_id)) return res.status(400).json({ error: 'employee_id inválido' });
  const { from, to } = req.query;
  if (!isValidISODate(from) || !isValidISODate(to)) {
    return res.status(400).json({ error: 'from y to (YYYY-MM-DD) son requeridos' });
  }
  if (to < from) return res.status(400).json({ error: 'to debe ser ≥ from' });

  const scope = await checkEmployeeScope(req, employee_id);
  if (scope) return res.status(scope.status).json({ error: scope.error });

  try {
    const { rows: empRows } = await pool.query(
      `SELECT id, country_id, weekly_capacity_hours, first_name, last_name
         FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employee_id]
    );
    if (!empRows.length) return res.status(404).json({ error: 'Empleado no encontrado' });
    const emp = empRows[0];

    const [holidays, novelties, contractAssignments, internalAssignments] = await Promise.all([
      emp.country_id
        ? pool.query(
            `SELECT holiday_date, label, holiday_type
               FROM country_holidays
              WHERE country_id = $1 AND holiday_date BETWEEN $2 AND $3
              ORDER BY holiday_date`,
            [emp.country_id, from, to]
          ).then((r) => r.rows)
        : Promise.resolve([]),
      pool.query(
        `SELECT n.*, nt.label_es AS novelty_type_label, nt.counts_in_capacity
           FROM employee_novelties n
           LEFT JOIN novelty_types nt ON nt.id = n.novelty_type_id
          WHERE n.employee_id = $1
            AND n.status = 'approved'
            AND n.end_date >= $2 AND n.start_date <= $3
          ORDER BY n.start_date`,
        [employee_id, from, to]
      ).then((r) => r.rows),
      pool.query(
        `SELECT a.id, a.start_date, a.end_date, a.weekly_hours, a.status,
                a.role_title, c.name AS contract_name
           FROM assignments a
           LEFT JOIN contracts c ON c.id = a.contract_id
          WHERE a.employee_id = $1
            AND a.deleted_at IS NULL
            AND a.status IN ('planned','active')
            AND COALESCE(a.end_date, '9999-12-31'::date) >= $2
            AND a.start_date <= $3
          ORDER BY a.start_date`,
        [employee_id, from, to]
      ).then((r) => r.rows),
      pool.query(
        `SELECT iia.id, iia.start_date, iia.end_date, iia.weekly_hours, iia.status,
                iia.role_description, ii.name AS initiative_name, ii.initiative_code
           FROM internal_initiative_assignments iia
           LEFT JOIN internal_initiatives ii ON ii.id = iia.internal_initiative_id
          WHERE iia.employee_id = $1
            AND iia.deleted_at IS NULL
            AND iia.status IN ('planned','active')
            AND COALESCE(iia.end_date, '9999-12-31'::date) >= $2
            AND iia.start_date <= $3
          ORDER BY iia.start_date`,
        [employee_id, from, to]
      ).then((r) => r.rows),
    ]);

    res.json({
      employee: { id: emp.id, country_id: emp.country_id, first_name: emp.first_name, last_name: emp.last_name },
      from, to,
      holidays, novelties,
      contract_assignments: contractAssignments,
      internal_assignments: internalAssignments,
    });
  } catch (err) { serverError(res, 'GET /novelties/calendar/:employee_id', err); }
});

/* -------- TYPES catalog -------- */
router.get('/_meta/types', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label_es, label_en, is_paid_time, requires_attachment_recommended, counts_in_capacity, sort_order
         FROM novelty_types
        WHERE is_active = true
        ORDER BY sort_order`
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /novelties/_meta/types', err); }
});

module.exports = router;
