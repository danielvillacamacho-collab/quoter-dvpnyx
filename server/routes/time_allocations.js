/**
 * Weekly time allocations (% por asignación, Time-MVP-00.1).
 *
 * Modelo distinto al de time_entries (que es horas diarias). Aquí cada
 * empleado registra el % de su semana asignado a cada uno de sus
 * proyectos activos. Bench = 100 - SUM(pct), no se persiste.
 *
 * Endpoints:
 *   GET /api/time-allocations?week_start=YYYY-MM-DD[&employee_id=X]
 *     Si el caller es admin/superadmin puede pasar employee_id distinto al
 *     suyo. Si es member, sólo se ve a sí mismo (employee derivado de
 *     users.id → employees.user_id). Devuelve:
 *       {
 *         week_start_date,
 *         employee: { id, name, ... },
 *         active_assignments: [{ id, contract_id, contract_name, role_title,
 *                                start_date, end_date, weekly_hours }],
 *         allocations: [{ id, assignment_id, pct, notes, updated_at }],
 *         summary: { total_pct, bench_pct }
 *       }
 *
 *   PUT /api/time-allocations/bulk
 *     body: { week_start_date, employee_id?, allocations: [{ assignment_id, pct, notes? }] }
 *     Atómico: borra rows previos para esa semana/empleado y reinserta.
 *     Valida SUM(pct) ≤ 100 (warning soft si < 100, error duro si > 100).
 *     Retorna el GET equivalente.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');

router.use(auth);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize to Monday of the week containing `dateIso`. */
function mondayOf(dateIso) {
  const d = new Date(dateIso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function resolveEmployee(req, requestedEmployeeId) {
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  if (requestedEmployeeId) {
    if (!isAdmin) {
      // Verificar que el empleado solicitado coincide con el caller.
      const { rows } = await pool.query(
        `SELECT id FROM employees WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`,
        [requestedEmployeeId, req.user.id],
      );
      if (!rows.length) return { error: 'forbidden' };
    } else {
      const { rows } = await pool.query(
        `SELECT id, name FROM employees WHERE id=$1 AND deleted_at IS NULL`,
        [requestedEmployeeId],
      );
      if (!rows.length) return { error: 'not_found' };
      return { employee: rows[0] };
    }
    const { rows } = await pool.query(
      `SELECT id, name FROM employees WHERE id=$1 AND deleted_at IS NULL`,
      [requestedEmployeeId],
    );
    return { employee: rows[0] };
  }
  // Default: derive from req.user.
  const { rows } = await pool.query(
    `SELECT id, name FROM employees WHERE user_id=$1 AND deleted_at IS NULL`,
    [req.user.id],
  );
  if (!rows.length) return { error: 'no_employee_for_user' };
  return { employee: rows[0] };
}

router.get('/', async (req, res) => {
  try {
    const weekStart = String(req.query.week_start || '').trim();
    if (!ISO_DATE_RE.test(weekStart)) {
      return res.status(400).json({ error: 'week_start inválido (YYYY-MM-DD)' });
    }
    const monday = mondayOf(weekStart);
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

    const { employee, error } = await resolveEmployee(req, req.query.employee_id);
    if (error === 'forbidden') return res.status(403).json({ error: 'No puedes ver allocations de otro empleado' });
    if (error === 'not_found') return res.status(404).json({ error: 'Empleado no encontrado' });
    if (error === 'no_employee_for_user') {
      // Admin/superadmin sin employees row (caso CEO etc.): devolvemos 200
      // con la lista de empleados disponibles para que la UI muestre un
      // picker. Para non-admin, sí es un error real.
      if (isAdmin) {
        const { rows: candidates } = await pool.query(
          `SELECT e.id, e.name, e.user_id, u.email
             FROM employees e
             LEFT JOIN users u ON u.id = e.user_id
            WHERE e.deleted_at IS NULL
            ORDER BY e.name ASC
            LIMIT 500`
        );
        return res.json({
          requires_employee_pick: true,
          available_employees: candidates,
          week_start_date: monday,
          message: 'Tu usuario no tiene un empleado vinculado. Selecciona uno para ver su tiempo.',
        });
      }
      return res.status(404).json({
        error: 'Tu usuario no está vinculado a un empleado. Contacta a admin.',
        code: 'no_employee_for_user',
      });
    }

    const sunday = (() => {
      const d = new Date(monday + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 6);
      return d.toISOString().slice(0, 10);
    })();

    // Asignaciones activas durante esa semana (overlap entre [start_date, end_date]
    // y [monday, sunday]). Sin filtrar por status — el frontend decide.
    const { rows: activeAssignments } = await pool.query(
      `SELECT a.id, a.employee_id, a.contract_id, a.role_title, a.weekly_hours,
              a.start_date, a.end_date, a.status,
              c.name AS contract_name, c.type AS contract_type, c.original_currency
         FROM assignments a
         LEFT JOIN contracts c ON c.id = a.contract_id
        WHERE a.employee_id=$1
          AND a.deleted_at IS NULL
          AND a.start_date <= $3
          AND (a.end_date IS NULL OR a.end_date >= $2)
          AND a.status IN ('planned','active')
        ORDER BY c.name ASC`,
      [employee.id, monday, sunday],
    );

    const { rows: allocations } = await pool.query(
      `SELECT id, assignment_id, pct, notes, updated_at, updated_by
         FROM weekly_time_allocations
        WHERE employee_id=$1 AND week_start_date=$2
        ORDER BY updated_at DESC`,
      [employee.id, monday],
    );

    const totalPct = allocations.reduce((sum, a) => sum + Number(a.pct || 0), 0);
    const benchPct = Math.max(0, 100 - totalPct);

    res.json({
      week_start_date: monday,
      week_end_date: sunday,
      employee,
      active_assignments: activeAssignments,
      allocations: allocations.map((a) => ({ ...a, pct: Number(a.pct) })),
      summary: { total_pct: totalPct, bench_pct: benchPct },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /time-allocations failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/bulk', async (req, res) => {
  const body = req.body || {};
  const weekStart = String(body.week_start_date || '').trim();
  if (!ISO_DATE_RE.test(weekStart)) {
    return res.status(400).json({ error: 'week_start_date inválido (YYYY-MM-DD)' });
  }
  const monday = mondayOf(weekStart);

  const allocations = Array.isArray(body.allocations) ? body.allocations : null;
  if (!allocations) return res.status(400).json({ error: 'allocations[] es requerido' });

  // Validación: cada item con assignment_id + pct válido (0..100).
  for (const a of allocations) {
    if (!a.assignment_id || typeof a.assignment_id !== 'string') {
      return res.status(400).json({ error: 'Cada allocation debe traer assignment_id (UUID)' });
    }
    const pct = Number(a.pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: `pct fuera de rango (0..100) para assignment ${a.assignment_id}` });
    }
  }

  const sumPct = allocations.reduce((acc, a) => acc + Number(a.pct || 0), 0);
  if (sumPct > 100.0001) {
    return res.status(400).json({
      error: `La suma de % es ${sumPct.toFixed(2)}%. No puede exceder 100%.`,
      code: 'pct_sum_exceeds_100',
      sum_pct: sumPct,
    });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    const { employee, error } = await resolveEmployee(req, body.employee_id);
    if (error === 'forbidden') { await conn.query('ROLLBACK'); return res.status(403).json({ error: 'No puedes editar allocations de otro empleado' }); }
    if (error === 'not_found') { await conn.query('ROLLBACK'); return res.status(404).json({ error: 'Empleado no encontrado' }); }
    if (error === 'no_employee_for_user') { await conn.query('ROLLBACK'); return res.status(404).json({ error: 'Tu usuario no está vinculado a un empleado.' }); }

    // Verificar que cada assignment pertenece al empleado y existe.
    if (allocations.length > 0) {
      const assignmentIds = allocations.map((a) => a.assignment_id);
      const { rows: validAsg } = await conn.query(
        `SELECT id FROM assignments WHERE id = ANY($1::uuid[]) AND employee_id=$2 AND deleted_at IS NULL`,
        [assignmentIds, employee.id],
      );
      if (validAsg.length !== assignmentIds.length) {
        await conn.query('ROLLBACK');
        return res.status(400).json({ error: 'Hay assignment_id inválidos o que no pertenecen a este empleado' });
      }
    }

    // Estrategia: borrar todas las rows previas para esa (employee, week) y
    // reinsertar. Atómico, simple, no requiere diff. Filas con pct=0 se omiten
    // (no tiene sentido persistirlas).
    await conn.query(
      `DELETE FROM weekly_time_allocations WHERE employee_id=$1 AND week_start_date=$2`,
      [employee.id, monday],
    );

    const inserted = [];
    for (const a of allocations) {
      const pct = Number(a.pct);
      if (pct === 0) continue;
      const { rows } = await conn.query(
        `INSERT INTO weekly_time_allocations
           (employee_id, week_start_date, assignment_id, pct, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4::numeric, $5, $6, $6)
         RETURNING id, assignment_id, pct, notes, updated_at, updated_by`,
        [employee.id, monday, a.assignment_id, pct, a.notes || null, req.user.id],
      );
      inserted.push({ ...rows[0], pct: Number(rows[0].pct) });
    }

    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'weekly_time_allocations_bulk_save', 'weekly_time_allocations', $2,
                 jsonb_build_object('employee_id', $3::uuid, 'week_start_date', $4::date,
                                    'entries_count', $5::int, 'sum_pct', $6::numeric))`,
      [req.user.id, employee.id, employee.id, monday, inserted.length, sumPct],
    );

    await conn.query('COMMIT');
    const benchPct = Math.max(0, 100 - sumPct);
    res.json({
      week_start_date: monday,
      employee,
      allocations: inserted,
      summary: { total_pct: sumPct, bench_pct: benchPct },
      warnings: sumPct < 99.9999 ? [{ code: 'bench', message: `${benchPct.toFixed(0)}% de la semana queda en bench.` }] : [],
    });
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('PUT /time-allocations/bulk failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

module.exports = router;
module.exports._internal = { mondayOf };
