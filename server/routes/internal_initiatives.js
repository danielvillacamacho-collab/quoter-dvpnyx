/**
 * Internal Initiatives — SPEC-II-00.
 *
 * Iniciativas internas paralelas a `contracts`. Tienen presupuesto USD
 * y agrupan asignaciones internas (no facturables). Solo admin crea o
 * borra; admin u operations_owner editan; cualquiera lee (los KPIs van
 * a dashboards de toda la empresa).
 *
 * Estados (state machine):
 *   active    ↔ paused
 *   active/paused → completed (terminal)
 *   active/paused → cancelled (terminal)
 * Transiciones a terminal setean actual_end_date si es NULL.
 *
 * El código humano `initiative_code` se genera dentro de un advisory
 * lock para evitar colisiones en creación concurrente. Ver
 * `utils/initiative_code.js`.
 *
 * Soft delete: bloqueado si la iniciativa tiene asignaciones activas
 * (status IN ('planned','active')) — el admin debe terminarlas primero.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { parsePagination, isValidUUID, isValidISODate } = require('../utils/sanitize');
const { serverError, safeRollback } = require('../utils/http');
const {
  buildInitiativeCode,
  nextSequence,
  acquireSequenceLock,
} = require('../utils/initiative_code');

router.use(auth);

const VALID_STATUSES = ['active', 'completed', 'cancelled', 'paused'];
const TRANSITIONS = {
  active:    new Set(['paused', 'completed', 'cancelled']),
  paused:    new Set(['active', 'completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

const EDITABLE_FIELDS = [
  'name', 'description', 'business_area_id',
  'budget_usd', 'hours_estimated',
  'start_date', 'target_end_date',
  'operations_owner_id',
];

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const wheres = ['ii.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.business_area)     wheres.push(`ii.business_area_id = ${add(req.query.business_area)}`);
    if (req.query.status)            wheres.push(`ii.status = ${add(req.query.status)}`);
    if (req.query.operations_owner_id) wheres.push(`ii.operations_owner_id = ${add(req.query.operations_owner_id)}`);
    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      wheres.push(`(LOWER(ii.name) LIKE LOWER(${add(like)}) OR LOWER(ii.initiative_code) LIKE LOWER(${add(like)}))`);
    }

    const where = `WHERE ${wheres.join(' AND ')}`;
    const limitIdx  = params.length + 1;
    const offsetIdx = params.length + 2;

    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM internal_initiatives ii ${where}`, params),
      pool.query(
        // consumed_usd y hours_consumed son proxies basados en horas
        // planeadas (weekly_hours × semanas transcurridas × tarifa snapshot).
        // Se reemplazará por suma real de time_entries cuando se implemente
        // tracking de horas a iniciativas internas (futuro spec).
        `SELECT ii.*,
                ba.label_es AS business_area_label,
                u.name AS operations_owner_name,
                COALESCE((
                  SELECT COUNT(*)::int
                    FROM internal_initiative_assignments
                   WHERE internal_initiative_id = ii.id
                     AND deleted_at IS NULL
                     AND status IN ('planned','active')
                ), 0) AS assignments_count,
                GREATEST(0, COALESCE((
                  SELECT SUM(weekly_hours * GREATEST(0,
                    (LEAST(CURRENT_DATE, COALESCE(end_date, CURRENT_DATE))
                     - GREATEST(start_date, ii.start_date))::numeric / 7
                  ))
                    FROM internal_initiative_assignments
                   WHERE internal_initiative_id = ii.id
                     AND deleted_at IS NULL
                     AND status IN ('planned','active','ended')
                ), 0))::numeric AS hours_consumed,
                GREATEST(0, COALESCE((
                  SELECT SUM(weekly_hours * COALESCE(hourly_rate_usd, 0) * GREATEST(0,
                    (LEAST(CURRENT_DATE, COALESCE(end_date, CURRENT_DATE))
                     - GREATEST(start_date, ii.start_date))::numeric / 7
                  ))
                    FROM internal_initiative_assignments
                   WHERE internal_initiative_id = ii.id
                     AND deleted_at IS NULL
                     AND status IN ('planned','active','ended')
                ), 0))::numeric AS consumed_usd
           FROM internal_initiatives ii
           LEFT JOIN business_areas ba ON ba.id = ii.business_area_id
           LEFT JOIN users u           ON u.id  = ii.operations_owner_id
           ${where}
           ORDER BY ii.created_at DESC
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
  } catch (err) { serverError(res, 'GET /internal-initiatives', err); }
});

/* -------- GET ONE -------- */
router.get('/:id', async (req, res) => {
  try {
    if (!isValidUUID(req.params.id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const { rows } = await pool.query(
      `SELECT ii.*,
              ba.label_es AS business_area_label,
              u.name AS operations_owner_name
         FROM internal_initiatives ii
         LEFT JOIN business_areas ba ON ba.id = ii.business_area_id
         LEFT JOIN users u           ON u.id  = ii.operations_owner_id
        WHERE ii.id = $1 AND ii.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Iniciativa no encontrada' });

    const ii = rows[0];

    // Asignaciones (con datos del empleado).
    const { rows: assignments } = await pool.query(
      `SELECT iia.*,
              e.first_name, e.last_name, e.country, e.country_id, e.level
         FROM internal_initiative_assignments iia
         LEFT JOIN employees e ON e.id = iia.employee_id
        WHERE iia.internal_initiative_id = $1 AND iia.deleted_at IS NULL
        ORDER BY iia.start_date DESC`,
      [req.params.id]
    );

    // Métricas de consumo proyectado: weekly_hours × rate × semanas transcurridas.
    const { rows: metricsRows } = await pool.query(
      `SELECT
         COALESCE(SUM(weekly_hours * GREATEST(0,
           (LEAST(CURRENT_DATE, COALESCE(end_date, CURRENT_DATE))
            - GREATEST(start_date, $2::date))::numeric / 7
         )), 0) AS hours_consumed,
         COALESCE(SUM(weekly_hours * COALESCE(hourly_rate_usd, 0) * GREATEST(0,
           (LEAST(CURRENT_DATE, COALESCE(end_date, CURRENT_DATE))
            - GREATEST(start_date, $2::date))::numeric / 7
         )), 0) AS consumed_usd
       FROM internal_initiative_assignments
      WHERE internal_initiative_id = $1 AND deleted_at IS NULL
        AND status IN ('planned','active','ended')`,
      [req.params.id, ii.start_date]
    );
    const hours_consumed = Math.max(0, Math.round(Number(metricsRows[0].hours_consumed) * 100) / 100);
    const consumed_usd  = Math.max(0, Math.round(Number(metricsRows[0].consumed_usd) * 100) / 100);

    res.json({
      ...ii,
      assignments,
      metrics: {
        consumed_usd,
        hours_consumed,
        budget_remaining_usd: Math.round((Number(ii.budget_usd) - consumed_usd) * 100) / 100,
        budget_consumed_pct: Number(ii.budget_usd) > 0
          ? Math.round((consumed_usd / Number(ii.budget_usd)) * 10000) / 10000
          : 0,
      },
    });
  } catch (err) { serverError(res, 'GET /internal-initiatives/:id', err); }
});

/* -------- CREATE (admin) -------- */
router.post('/', adminOnly, async (req, res) => {
  const body = req.body || {};
  const {
    name, description, business_area_id, budget_usd,
    hours_estimated, start_date, target_end_date, operations_owner_id,
  } = body;

  // Validaciones
  if (!name || String(name).trim().length < 5) {
    return res.status(400).json({ error: 'name requerido (≥5 caracteres)' });
  }
  if (String(name).length > 255) {
    return res.status(400).json({ error: 'name demasiado largo (max 255)' });
  }
  if (!business_area_id) return res.status(400).json({ error: 'business_area_id requerido' });
  const budget = Number(budget_usd);
  if (!Number.isFinite(budget) || budget < 0) {
    return res.status(400).json({ error: 'budget_usd debe ser ≥ 0' });
  }
  if (!isValidISODate(start_date)) {
    return res.status(400).json({ error: 'start_date inválido (YYYY-MM-DD)' });
  }
  if (target_end_date != null && !isValidISODate(target_end_date)) {
    return res.status(400).json({ error: 'target_end_date inválido (YYYY-MM-DD)' });
  }
  if (target_end_date && target_end_date < start_date) {
    return res.status(400).json({ error: 'target_end_date debe ser ≥ start_date' });
  }
  if (!operations_owner_id || !isValidUUID(operations_owner_id)) {
    return res.status(400).json({ error: 'operations_owner_id requerido (UUID)' });
  }
  const hoursEst = hours_estimated == null ? 0 : Number(hours_estimated);
  if (!Number.isFinite(hoursEst) || hoursEst < 0) {
    return res.status(400).json({ error: 'hours_estimated debe ser ≥ 0' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    // Validar FKs
    const { rows: areaRows } = await conn.query(
      `SELECT id FROM business_areas WHERE id = $1 AND is_active = true`, [business_area_id]
    );
    if (!areaRows.length) {
      await safeRollback(conn, 'POST /internal-initiatives'); conn.release();
      return res.status(400).json({ error: 'business_area_id no existe' });
    }
    const { rows: ownerRows } = await conn.query(
      `SELECT id FROM users WHERE id = $1`, [operations_owner_id]
    );
    if (!ownerRows.length) {
      await safeRollback(conn, 'POST /internal-initiatives'); conn.release();
      return res.status(400).json({ error: 'operations_owner_id no existe' });
    }

    // Generar código humano bajo advisory lock.
    const year = parseInt(start_date.slice(0, 4), 10);
    await acquireSequenceLock(conn, business_area_id, year);
    const seq = await nextSequence(conn, business_area_id, year);
    const initiative_code = buildInitiativeCode(business_area_id, year, seq);

    const { rows } = await conn.query(
      `INSERT INTO internal_initiatives
         (initiative_code, name, description, business_area_id, status,
          budget_usd, hours_estimated, start_date, target_end_date,
          operations_owner_id, source_system, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'active',
               $5, $6, $7, $8,
               $9, 'ui', $10, $10)
       RETURNING *`,
      [
        initiative_code, String(name).trim(), description || null, business_area_id,
        budget, hoursEst, start_date, target_end_date || null,
        operations_owner_id, req.user.id,
      ]
    );

    await emitEvent(conn, {
      event_type: 'internal_initiative.created',
      entity_type: 'internal_initiative',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { initiative_code, name: rows[0].name, business_area_id, budget_usd: budget },
      req,
    });

    await conn.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await safeRollback(conn, 'POST /internal-initiatives');
    serverError(res, 'POST /internal-initiatives', err);
  } finally {
    conn.release();
  }
});

/* -------- UPDATE (admin or operations_owner) -------- */
router.put('/:id', async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    const { rows: existRows } = await conn.query(
      `SELECT * FROM internal_initiatives WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!existRows.length) {
      await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
      return res.status(404).json({ error: 'Iniciativa no encontrada' });
    }
    const before = existRows[0];

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const isOwner = before.operations_owner_id === req.user.id;
    if (!isAdmin && !isOwner) {
      await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
      return res.status(403).json({ error: 'Solo admin u operations_owner pueden editar' });
    }
    if (['completed', 'cancelled'].includes(before.status)) {
      await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
      return res.status(409).json({ error: 'Iniciativa terminal, no editable' });
    }

    // Construir SET dinámicamente.
    const sets = [];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };
    const body = req.body || {};

    for (const f of EDITABLE_FIELDS) {
      if (!(f in body)) continue;
      // Validaciones puntuales
      if (f === 'name') {
        const v = String(body.name || '').trim();
        if (v.length < 5 || v.length > 255) {
          await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
          return res.status(400).json({ error: 'name debe tener 5..255 caracteres' });
        }
        sets.push(`name = ${add(v)}`);
      } else if (f === 'budget_usd') {
        const v = Number(body.budget_usd);
        if (!Number.isFinite(v) || v < 0) {
          await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
          return res.status(400).json({ error: 'budget_usd debe ser ≥ 0' });
        }
        sets.push(`budget_usd = ${add(v)}`);
      } else if (f === 'hours_estimated') {
        const v = Number(body.hours_estimated);
        if (!Number.isFinite(v) || v < 0) {
          await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
          return res.status(400).json({ error: 'hours_estimated debe ser ≥ 0' });
        }
        sets.push(`hours_estimated = ${add(v)}`);
      } else if (f === 'start_date' || f === 'target_end_date') {
        if (body[f] != null && !isValidISODate(body[f])) {
          await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
          return res.status(400).json({ error: `${f} inválido (YYYY-MM-DD)` });
        }
        sets.push(`${f} = ${add(body[f])}`);
      } else if (f === 'operations_owner_id') {
        if (!isAdmin) {
          await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
          return res.status(403).json({ error: 'Cambiar owner requiere admin' });
        }
        if (!isValidUUID(body[f])) {
          await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
          return res.status(400).json({ error: 'operations_owner_id inválido' });
        }
        sets.push(`operations_owner_id = ${add(body[f])}`);
      } else if (f === 'business_area_id') {
        sets.push(`business_area_id = ${add(body[f])}`);
      } else {
        sets.push(`${f} = ${add(body[f])}`);
      }
    }

    if (sets.length === 0) {
      await safeRollback(conn, 'PUT /internal-initiatives/:id'); conn.release();
      return res.status(400).json({ error: 'Sin campos para actualizar' });
    }
    sets.push(`updated_by = ${add(req.user.id)}`);
    sets.push(`updated_at = NOW()`);

    const idIdx = params.length + 1;
    params.push(req.params.id);
    const { rows: updated } = await conn.query(
      `UPDATE internal_initiatives SET ${sets.join(', ')} WHERE id = $${idIdx} RETURNING *`,
      params
    );

    await emitEvent(conn, {
      event_type: 'internal_initiative.updated',
      entity_type: 'internal_initiative',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: buildUpdatePayload(before, updated[0], EDITABLE_FIELDS),
      req,
    });

    await conn.query('COMMIT');
    res.json(updated[0]);
  } catch (err) {
    await safeRollback(conn, 'PUT /internal-initiatives/:id');
    serverError(res, 'PUT /internal-initiatives/:id', err);
  } finally {
    conn.release();
  }
});

/* -------- TRANSITIONS (admin only) -------- */
router.post('/:id/transitions', adminOnly, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  const { to_status, reason } = req.body || {};
  if (!VALID_STATUSES.includes(to_status)) {
    return res.status(400).json({ error: `to_status inválido (válidos: ${VALID_STATUSES.join(',')})` });
  }
  if (to_status === 'cancelled' && (!reason || String(reason).trim().length < 5)) {
    return res.status(400).json({ error: 'reason requerido (≥5 chars) para cancelar' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `SELECT * FROM internal_initiatives WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) {
      await safeRollback(conn, 'POST /internal-initiatives/:id/transitions'); conn.release();
      return res.status(404).json({ error: 'Iniciativa no encontrada' });
    }
    const before = rows[0];
    if (before.status === to_status) {
      await safeRollback(conn, 'POST /internal-initiatives/:id/transitions'); conn.release();
      return res.status(409).json({ error: `Ya está en estado ${to_status}` });
    }
    if (!TRANSITIONS[before.status].has(to_status)) {
      await safeRollback(conn, 'POST /internal-initiatives/:id/transitions'); conn.release();
      return res.status(409).json({ error: `Transición ${before.status} → ${to_status} no permitida` });
    }

    const setActualEnd = (to_status === 'completed' || to_status === 'cancelled') && before.actual_end_date == null;
    const { rows: updated } = await conn.query(
      `UPDATE internal_initiatives
          SET status = $1,
              actual_end_date = COALESCE(actual_end_date, ${setActualEnd ? 'CURRENT_DATE' : 'actual_end_date'}),
              updated_by = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [to_status, req.user.id, req.params.id]
    );

    // Si pasa a completed o cancelled, terminar asignaciones planeadas/activas.
    if (to_status === 'completed' || to_status === 'cancelled') {
      await conn.query(
        `UPDATE internal_initiative_assignments
            SET status = 'cancelled', updated_at = NOW(), updated_by = $1
          WHERE internal_initiative_id = $2
            AND deleted_at IS NULL
            AND status IN ('planned', 'active')`,
        [req.user.id, req.params.id]
      );
    }

    await emitEvent(conn, {
      event_type: 'internal_initiative.status_changed',
      entity_type: 'internal_initiative',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: { from: before.status, to: to_status, reason: reason || null },
      req,
    });

    await conn.query('COMMIT');
    res.json(updated[0]);
  } catch (err) {
    await safeRollback(conn, 'POST /internal-initiatives/:id/transitions');
    serverError(res, 'POST /internal-initiatives/:id/transitions', err);
  } finally {
    conn.release();
  }
});

/* -------- DELETE (soft) — admin only -------- */
router.delete('/:id', adminOnly, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  const reason = (req.body && req.body.reason) || req.query.reason || null;

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `SELECT id, status FROM internal_initiatives
        WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!rows.length) {
      await safeRollback(conn, 'DELETE /internal-initiatives/:id'); conn.release();
      return res.status(404).json({ error: 'Iniciativa no encontrada' });
    }

    const { rows: activeAssign } = await conn.query(
      `SELECT COUNT(*)::int AS n FROM internal_initiative_assignments
        WHERE internal_initiative_id = $1
          AND deleted_at IS NULL
          AND status IN ('planned', 'active')`,
      [req.params.id]
    );
    if (activeAssign[0].n > 0) {
      await safeRollback(conn, 'DELETE /internal-initiatives/:id'); conn.release();
      return res.status(409).json({
        error: 'La iniciativa tiene asignaciones activas. Termínelas antes de eliminar.',
      });
    }

    await conn.query(
      `UPDATE internal_initiatives
          SET deleted_at = NOW(), deletion_reason = $1, updated_by = $2, updated_at = NOW()
        WHERE id = $3`,
      [reason, req.user.id, req.params.id]
    );

    await emitEvent(conn, {
      event_type: 'internal_initiative.deleted',
      entity_type: 'internal_initiative',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: { reason },
      req,
    });

    await conn.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await safeRollback(conn, 'DELETE /internal-initiatives/:id');
    serverError(res, 'DELETE /internal-initiatives/:id', err);
  } finally {
    conn.release();
  }
});

/* -------- ASSIGNMENTS subresource -------- */

/* List assignments of an initiative */
router.get('/:id/assignments', async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query(
      `SELECT iia.*,
              e.first_name, e.last_name, e.country, e.country_id, e.level,
              creator.name AS created_by_name
         FROM internal_initiative_assignments iia
         LEFT JOIN employees e      ON e.id = iia.employee_id
         LEFT JOIN users creator    ON creator.id = iia.created_by
        WHERE iia.internal_initiative_id = $1 AND iia.deleted_at IS NULL
        ORDER BY iia.start_date DESC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /internal-initiatives/:id/assignments', err); }
});

/* Create assignment (admin or operations_owner of the initiative) */
router.post('/:id/assignments', async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  const { employee_id, start_date, end_date, weekly_hours, role_description, notes } = req.body || {};

  if (!isValidUUID(employee_id)) return res.status(400).json({ error: 'employee_id inválido' });
  if (!isValidISODate(start_date)) return res.status(400).json({ error: 'start_date inválido' });
  if (end_date != null && !isValidISODate(end_date)) {
    return res.status(400).json({ error: 'end_date inválido' });
  }
  if (end_date && end_date < start_date) {
    return res.status(400).json({ error: 'end_date debe ser ≥ start_date' });
  }
  const wh = Number(weekly_hours);
  if (!Number.isFinite(wh) || wh <= 0 || wh > 80) {
    return res.status(400).json({ error: 'weekly_hours debe ser >0 y ≤80' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    const { rows: iiRows } = await conn.query(
      `SELECT id, status, operations_owner_id FROM internal_initiatives
        WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!iiRows.length) {
      await safeRollback(conn, 'POST /internal-initiatives/:id/assignments'); conn.release();
      return res.status(404).json({ error: 'Iniciativa no encontrada' });
    }
    const ii = iiRows[0];
    if (ii.status === 'completed' || ii.status === 'cancelled') {
      await safeRollback(conn, 'POST /internal-initiatives/:id/assignments'); conn.release();
      return res.status(409).json({ error: `Iniciativa en estado ${ii.status}, no admite asignaciones` });
    }

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin && ii.operations_owner_id !== req.user.id) {
      await safeRollback(conn, 'POST /internal-initiatives/:id/assignments'); conn.release();
      return res.status(403).json({ error: 'Solo admin u operations_owner pueden asignar' });
    }

    // Validar empleado activo + lookup de tarifa horaria desde último employee_cost.
    const { rows: empRows } = await conn.query(
      `SELECT e.id, e.weekly_capacity_hours, e.status AS emp_status,
              ec.cost_usd, ec.period
         FROM employees e
         LEFT JOIN LATERAL (
           SELECT cost_usd, period
             FROM employee_costs
            WHERE employee_id = e.id AND cost_usd IS NOT NULL
            ORDER BY period DESC
            LIMIT 1
         ) ec ON true
        WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [employee_id]
    );
    if (!empRows.length) {
      await safeRollback(conn, 'POST /internal-initiatives/:id/assignments'); conn.release();
      return res.status(400).json({ error: 'employee no existe' });
    }
    const emp = empRows[0];
    if (emp.emp_status === 'terminated') {
      await safeRollback(conn, 'POST /internal-initiatives/:id/assignments'); conn.release();
      return res.status(409).json({ error: 'Empleado terminado no asignable' });
    }

    // Snapshot de tarifa: cost_usd / (weekly × 52/12). Si no hay employee_cost,
    // guardamos NULL — el idle engine lo trata como missing_rate y dashboards
    // marcarán la iniciativa con warning.
    let hourlyRate = null;
    if (emp.cost_usd != null && Number(emp.weekly_capacity_hours) > 0) {
      const monthlyHours = (Number(emp.weekly_capacity_hours) * 52) / 12;
      hourlyRate = Math.round((Number(emp.cost_usd) / monthlyHours) * 10000) / 10000;
    }

    const { rows: created } = await conn.query(
      `INSERT INTO internal_initiative_assignments
         (internal_initiative_id, employee_id, start_date, end_date,
          weekly_hours, hourly_rate_usd, status, role_description, notes,
          created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'planned', $7, $8, $9)
       RETURNING *`,
      [req.params.id, employee_id, start_date, end_date || null, wh, hourlyRate,
       role_description || null, notes || null, req.user.id]
    );

    await emitEvent(conn, {
      event_type: 'internal_initiative_assignment.created',
      entity_type: 'internal_initiative_assignment',
      entity_id: created[0].id,
      actor_user_id: req.user.id,
      payload: {
        internal_initiative_id: req.params.id,
        employee_id, weekly_hours: wh, hourly_rate_usd: hourlyRate,
        missing_rate: hourlyRate === null,
      },
      req,
    });

    await conn.query('COMMIT');
    res.status(201).json({ ...created[0], missing_rate: hourlyRate === null });
  } catch (err) {
    await safeRollback(conn, 'POST /internal-initiatives/:id/assignments');
    serverError(res, 'POST /internal-initiatives/:id/assignments', err);
  } finally {
    conn.release();
  }
});

module.exports = router;
