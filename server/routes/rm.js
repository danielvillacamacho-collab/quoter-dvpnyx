/**
 * SPEC-RM-00 — Resource Management: bulk assignments, locks, actual-hours export.
 *
 * Adds the high-value operations missing from the single-assignment CRUD
 * in assignments.js: bulk create, bulk extend, bulk remove, assignment locks,
 * and the XLSX export of actual hours for the ERP handoff.
 *
 * Roles:
 *   Read endpoints: any authenticated user (scoped by role in query).
 *   Write endpoints (bulk assign, locks): admin+ (superadmin, admin, director, lead).
 *   Export: admin+.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { serverError, safeRollback } = require('../utils/http');

router.use(auth);

const CAPACITY_HOURS = 40;
const MAX_BULK_EMPLOYEES = 200;
const MAX_TARGET_WEEKS = 52;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// ── Helpers ─────────────────────────────────────────────────────────

function toMonday(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function weeksBetween(startDate, endDate) {
  const weeks = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    weeks.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return weeks;
}

async function getLockedWeeks(conn, employeeId, weekDates) {
  if (!weekDates.length) return new Set();
  const { rows } = await conn.query(
    `SELECT week_starting::text FROM assignment_locks
      WHERE employee_id = $1 AND week_starting = ANY($2::date[])
        AND unlocked_at IS NULL`,
    [employeeId, weekDates],
  );
  return new Set(rows.map((r) => r.week_starting));
}

// For each employee+week, sum overlapping assignments
async function sumHoursForWeek(conn, employeeId, weekMonday) {
  const weekEnd = new Date(weekMonday);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const endStr = weekEnd.toISOString().slice(0, 10);
  const { rows } = await conn.query(
    `SELECT COALESCE(SUM(weekly_hours), 0) AS total
       FROM assignments
      WHERE employee_id = $1
        AND deleted_at IS NULL
        AND status IN ('planned','active')
        AND start_date <= $3::date
        AND (end_date IS NULL OR end_date >= $2::date)`,
    [employeeId, weekMonday, endStr],
  );
  return Number(rows[0].total || 0);
}

// ── POST /api/rm/assignments/bulk ───────────────────────────────────
//
// Create multiple assignments at once. Supports dry_run for preview.
// Body: { assignments: [...], dry_run: bool }
// Each assignment: { employee_id, contract_id, resource_request_id?,
//   weekly_hours, start_date, end_date?, role_title?, notes? }

router.post('/assignments/bulk', adminOnly, async (req, res) => {
  const { assignments, dry_run } = req.body;
  if (!Array.isArray(assignments) || !assignments.length) {
    return res.status(400).json({ error: 'Se requiere un array de assignments' });
  }
  if (assignments.length > 200) {
    return res.status(400).json({ error: 'Máximo 200 assignments por operación' });
  }

  const results = { created: 0, skipped_locked: 0, warnings: [], assignment_ids: [], errors: [] };
  const conn = await pool.connect();

  try {
    if (!dry_run) await conn.query('BEGIN');

    for (const asgn of assignments) {
      const { employee_id, contract_id, resource_request_id, weekly_hours, start_date, end_date, role_title, notes } = asgn;

      if (!employee_id || !contract_id || !weekly_hours || !start_date) {
        results.errors.push({ employee_id, reason: 'campos_requeridos', detail: 'employee_id, contract_id, weekly_hours y start_date son requeridos' });
        continue;
      }

      const weekMonday = toMonday(start_date);
      if (!weekMonday) {
        results.errors.push({ employee_id, reason: 'fecha_invalida', detail: start_date });
        continue;
      }

      // Check lock
      const locked = await getLockedWeeks(conn, employee_id, [weekMonday]);
      if (locked.has(weekMonday)) {
        results.skipped_locked++;
        continue;
      }

      // Check capacity
      const existing = await sumHoursForWeek(conn, employee_id, weekMonday);
      const newTotal = existing + Number(weekly_hours);
      if (newTotal > CAPACITY_HOURS) {
        results.warnings.push({
          employee_id,
          week_starting: weekMonday,
          reason: 'over_capacity',
          current_total: existing,
          adding: Number(weekly_hours),
          new_total: newTotal,
          threshold: CAPACITY_HOURS,
        });
      }

      // Check idempotency: skip if same (employee, contract, overlapping dates) exists
      const effectiveEnd = end_date || null;
      const { rows: existing_asgn } = await conn.query(
        `SELECT id FROM assignments
          WHERE employee_id = $1 AND contract_id = $2
            AND deleted_at IS NULL AND status IN ('planned','active')
            AND start_date <= $4::date AND (end_date IS NULL OR end_date >= $3::date)
          LIMIT 1`,
        [employee_id, contract_id, start_date, effectiveEnd || '9999-12-31'],
      );
      if (existing_asgn.length) {
        results.created++;
        results.assignment_ids.push(existing_asgn[0].id);
        continue;
      }

      if (!dry_run) {
        const { rows } = await conn.query(
          `INSERT INTO assignments (employee_id, contract_id, resource_request_id,
             weekly_hours, start_date, end_date, role_title, notes, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
           RETURNING id`,
          [employee_id, contract_id, resource_request_id || null,
           Number(weekly_hours), start_date, effectiveEnd, role_title || null,
           notes || null, req.user.id],
        );
        results.assignment_ids.push(rows[0].id);
      }
      results.created++;
    }

    if (!dry_run) await conn.query('COMMIT');
    res.json(results);
  } catch (err) {
    if (!dry_run) await safeRollback(conn, 'POST /rm/assignments/bulk');
    serverError(res, 'POST /rm/assignments/bulk', err);
  } finally {
    conn.release();
  }
});

// ── POST /api/rm/assignments/bulk-extend ────────────────────────────
//
// Copy assignments from source_week to target_weeks for given employees.
// Body: { employee_ids, contract_id, source_week, target_weeks, weekly_hours?, overwrite_existing? }

router.post('/assignments/bulk-extend', adminOnly, async (req, res) => {
  const { employee_ids, contract_id, source_week, target_weeks, weekly_hours, overwrite_existing } = req.body;

  if (!Array.isArray(employee_ids) || !employee_ids.length) {
    return res.status(400).json({ error: 'employee_ids requerido' });
  }
  if (employee_ids.length > MAX_BULK_EMPLOYEES) {
    return res.status(400).json({ error: `Máximo ${MAX_BULK_EMPLOYEES} empleados por operación` });
  }
  if (!employee_ids.every(isUuid)) {
    return res.status(400).json({ error: 'employee_ids debe ser un array de UUIDs válidos' });
  }
  if (!isUuid(contract_id)) return res.status(400).json({ error: 'contract_id inválido' });
  if (!source_week) return res.status(400).json({ error: 'source_week requerido' });
  if (!Array.isArray(target_weeks) || !target_weeks.length) {
    return res.status(400).json({ error: 'target_weeks requerido' });
  }
  if (target_weeks.length > MAX_TARGET_WEEKS) {
    return res.status(400).json({ error: `Máximo ${MAX_TARGET_WEEKS} semanas por operación` });
  }

  const conn = await pool.connect();
  const results = { created: 0, skipped_locked: 0, skipped_existing: 0, warnings: [] };

  try {
    await conn.query('BEGIN');

    // Get source assignments
    const sourceMonday = toMonday(source_week);
    const sourceEnd = new Date(sourceMonday);
    sourceEnd.setUTCDate(sourceEnd.getUTCDate() + 6);

    const { rows: sourceRows } = await conn.query(
      `SELECT employee_id, weekly_hours, role_title, resource_request_id
         FROM assignments
        WHERE contract_id = $1
          AND employee_id = ANY($2::uuid[])
          AND deleted_at IS NULL AND status IN ('planned','active')
          AND start_date <= $4::date AND (end_date IS NULL OR end_date >= $3::date)`,
      [contract_id, employee_ids, sourceMonday, sourceEnd.toISOString().slice(0, 10)],
    );

    const sourceMap = {};
    sourceRows.forEach((r) => { sourceMap[r.employee_id] = r; });

    for (const empId of employee_ids) {
      const source = sourceMap[empId];
      if (!source && !weekly_hours) continue;
      const hours = weekly_hours || source?.weekly_hours || 40;

      for (const tw of target_weeks) {
        const monday = toMonday(tw);
        if (!monday) continue;

        const locked = await getLockedWeeks(conn, empId, [monday]);
        if (locked.has(monday)) { results.skipped_locked++; continue; }

        const weekEnd = new Date(monday);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

        // Check existing
        const { rows: dup } = await conn.query(
          `SELECT id FROM assignments
            WHERE employee_id=$1 AND contract_id=$2
              AND deleted_at IS NULL AND status IN ('planned','active')
              AND start_date <= $4::date AND (end_date IS NULL OR end_date >= $3::date)
            LIMIT 1`,
          [empId, contract_id, monday, weekEnd.toISOString().slice(0, 10)],
        );

        if (dup.length && !overwrite_existing) { results.skipped_existing++; continue; }
        if (dup.length && overwrite_existing) {
          await conn.query('UPDATE assignments SET weekly_hours=$1, updated_at=NOW() WHERE id=$2',
            [Number(hours), dup[0].id]);
          results.created++;
          continue;
        }

        await conn.query(
          `INSERT INTO assignments (employee_id, contract_id, resource_request_id,
             weekly_hours, start_date, end_date, role_title, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)`,
          [empId, contract_id, source?.resource_request_id || null,
           Number(hours), monday, weekEnd.toISOString().slice(0, 10),
           source?.role_title || null, req.user.id],
        );
        results.created++;
      }
    }

    await conn.query('COMMIT');
    res.json(results);
  } catch (err) {
    await safeRollback(conn, 'POST /rm/assignments/bulk-extend');
    serverError(res, 'POST /rm/assignments/bulk-extend', err);
  } finally {
    conn.release();
  }
});

// ── POST /api/rm/assignments/bulk-remove ────────────────────────────
//
// Soft-delete assignments for employees in a date range for a contract.
// Body: { employee_ids, contract_id, week_from, week_to }

router.post('/assignments/bulk-remove', adminOnly, async (req, res) => {
  const { employee_ids, contract_id, week_from, week_to } = req.body;
  if (!Array.isArray(employee_ids) || !employee_ids.length || !contract_id || !week_from || !week_to) {
    return res.status(400).json({ error: 'employee_ids, contract_id, week_from y week_to son requeridos' });
  }
  if (employee_ids.length > MAX_BULK_EMPLOYEES) {
    return res.status(400).json({ error: `Máximo ${MAX_BULK_EMPLOYEES} empleados por operación` });
  }
  if (!employee_ids.every(isUuid)) {
    return res.status(400).json({ error: 'employee_ids debe ser un array de UUIDs válidos' });
  }
  if (!isUuid(contract_id)) {
    return res.status(400).json({ error: 'contract_id inválido' });
  }

  try {
    // Source of truth for locks is assignment_locks. Use NOT EXISTS so an
    // assignment is skipped when ANY of the weeks it covers in the range
    // is locked, regardless of the (potentially stale) is_locked column.
    const { rows: lockRows } = await pool.query(
      `SELECT employee_id, week_starting::text FROM assignment_locks
        WHERE employee_id = ANY($1::uuid[])
          AND week_starting >= $2::date AND week_starting <= $3::date
          AND unlocked_at IS NULL`,
      [employee_ids, week_from, week_to],
    );

    const { rowCount } = await pool.query(
      `UPDATE assignments
         SET deleted_at = NOW(), status = 'cancelled', updated_at = NOW()
       WHERE employee_id = ANY($1::uuid[])
         AND contract_id = $2
         AND deleted_at IS NULL
         AND status IN ('planned','active')
         AND start_date >= $3::date AND start_date <= $4::date
         AND NOT EXISTS (
           SELECT 1 FROM assignment_locks al
            WHERE al.employee_id = assignments.employee_id
              AND al.unlocked_at IS NULL
              AND al.week_starting BETWEEN $3::date AND $4::date
              AND al.week_starting <= COALESCE(assignments.end_date, '9999-12-31'::date)
              AND (al.week_starting + 6) >= assignments.start_date
         )`,
      [employee_ids, contract_id, week_from, week_to],
    );

    res.json({ removed: rowCount, skipped_locked: lockRows.length });
  } catch (err) { serverError(res, 'POST /rm/assignments/bulk-remove', err); }
});

// ── GET /api/rm/locks ───────────────────────────────────────────────

router.get('/locks', async (req, res) => {
  const { employee_id, week_from, week_to } = req.query;
  const wheres = ['unlocked_at IS NULL'];
  const params = [];
  if (employee_id) { params.push(employee_id); wheres.push(`employee_id = $${params.length}`); }
  if (week_from) { params.push(week_from); wheres.push(`week_starting >= $${params.length}::date`); }
  if (week_to) { params.push(week_to); wheres.push(`week_starting <= $${params.length}::date`); }

  try {
    const { rows } = await pool.query(
      `SELECT al.id, al.employee_id, al.week_starting, al.locked_at, al.lock_reason,
              e.first_name || ' ' || e.last_name AS employee_name,
              u.name AS locked_by_name
         FROM assignment_locks al
         JOIN employees e ON e.id = al.employee_id
         LEFT JOIN users u ON u.id = al.locked_by
        WHERE ${wheres.join(' AND ')}
        ORDER BY al.week_starting DESC
        LIMIT 500`,
      params,
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /rm/locks', err); }
});

// ── POST /api/rm/locks ──────────────────────────────────────────────
// Manual lock. Superadmin only.

router.post('/locks', adminOnly, async (req, res) => {
  const { employee_id, week_starting, lock_reason } = req.body;
  if (!employee_id || !week_starting) {
    return res.status(400).json({ error: 'employee_id y week_starting son requeridos' });
  }
  const reason = lock_reason || 'manual_lock';

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `INSERT INTO assignment_locks (employee_id, week_starting, locked_by, lock_reason)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (employee_id, week_starting) DO UPDATE
         SET unlocked_at = NULL, locked_by = $3, lock_reason = $4, locked_at = NOW()
       RETURNING id`,
      [employee_id, week_starting, req.user.id, reason],
    );

    await conn.query(
      `UPDATE assignments SET is_locked = true, updated_at = NOW()
        WHERE employee_id = $1 AND deleted_at IS NULL
          AND start_date <= ($2::date + 6) AND (end_date IS NULL OR end_date >= $2::date)`,
      [employee_id, week_starting],
    );

    await conn.query('COMMIT');
    res.json({ id: rows[0].id, locked: true });
  } catch (err) {
    await safeRollback(conn, 'POST /rm/locks');
    serverError(res, 'POST /rm/locks', err);
  } finally {
    conn.release();
  }
});

// ── DELETE /api/rm/locks/:id ────────────────────────────────────────
// Unlock. Superadmin only.

router.delete('/locks/:id', adminOnly, async (req, res) => {
  const { reason } = req.body || {};

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      `UPDATE assignment_locks SET unlocked_at = NOW(), unlocked_by = $1
        WHERE id = $2 AND unlocked_at IS NULL
        RETURNING employee_id, week_starting`,
      [req.user.id, req.params.id],
    );
    if (!rows.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Lock no encontrado o ya desbloqueado' });
    }

    const { employee_id, week_starting } = rows[0];
    // Only clear is_locked if no OTHER active lock still covers an
    // overlapping week — otherwise we'd unlock assignments that remain
    // locked by a different week.
    await conn.query(
      `UPDATE assignments SET is_locked = false, updated_at = NOW()
        WHERE employee_id = $1 AND deleted_at IS NULL
          AND start_date <= ($2::date + 6) AND (end_date IS NULL OR end_date >= $2::date)
          AND NOT EXISTS (
            SELECT 1 FROM assignment_locks al
             WHERE al.employee_id = assignments.employee_id
               AND al.unlocked_at IS NULL
               AND al.week_starting <= COALESCE(assignments.end_date, '9999-12-31'::date)
               AND (al.week_starting + 6) >= assignments.start_date
          )`,
      [employee_id, week_starting],
    );

    await conn.query(
      `INSERT INTO audit_log (user_id, action, details, ip_address)
       VALUES ($1, 'assignment_unlock', $2, $3)`,
      [req.user.id, JSON.stringify({ lock_id: req.params.id, employee_id, week_starting, reason }), req.ip],
    );

    await conn.query('COMMIT');
    res.json({ unlocked: true });
  } catch (err) {
    await safeRollback(conn, 'DELETE /rm/locks/:id');
    serverError(res, 'DELETE /rm/locks/:id', err);
  } finally {
    conn.release();
  }
});

// ── GET /api/rm/actual-hours/export ─────────────────────────────────
//
// XLSX export with 2 sheets: granular entries + weekly summary.
// Query: week_from, week_to, area_id?, contract_id?

router.get('/actual-hours/export', adminOnly, async (req, res) => {
  const { week_from, week_to, area_id, contract_id } = req.query;
  if (!week_from || !week_to) {
    return res.status(400).json({ error: 'week_from y week_to son requeridos' });
  }

  // Max 90 days
  const diffDays = (new Date(week_to) - new Date(week_from)) / (1000 * 60 * 60 * 24);
  if (diffDays > 92) {
    return res.status(400).json({ error: 'Máximo 90 días por exportación. Exportar por trimestres.' });
  }

  try {
    const ExcelJS = require('exceljs');

    // Build filter
    const wheres = ['te.deleted_at IS NULL', 'te.work_date >= $1::date', 'te.work_date <= $2::date'];
    const params = [week_from, week_to];
    if (area_id) { params.push(area_id); wheres.push(`e.area_id = $${params.length}`); }
    if (contract_id) { params.push(contract_id); wheres.push(`a.contract_id = $${params.length}`); }

    // Sheet 1: granular entries
    const { rows: entries } = await pool.query(
      `SELECT
         e.id AS employee_id, e.first_name || ' ' || e.last_name AS employee_name,
         e.level AS employee_level, ar.name AS employee_area,
         te.work_date, date_trunc('week', te.work_date)::date AS week_starting,
         CASE WHEN a.contract_id IS NOT NULL THEN 'client_contract' ELSE 'other' END AS entry_type,
         a.contract_id, c.name AS contract_name, cl.name AS client_name,
         te.hours AS actual_hours, te.status AS entry_status,
         te.description, te.created_at AS submitted_at
       FROM time_entries te
       JOIN employees e ON e.id = te.employee_id
       LEFT JOIN areas ar ON ar.id = e.area_id
       JOIN assignments a ON a.id = te.assignment_id
       LEFT JOIN contracts c ON c.id = a.contract_id
       LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE ${wheres.join(' AND ')}
       ORDER BY e.last_name, e.first_name, te.work_date`,
      params,
    );

    // Sheet 2: weekly summary
    const { rows: summary } = await pool.query(
      `SELECT
         e.id AS employee_id, e.first_name || ' ' || e.last_name AS employee_name,
         e.level AS employee_level, ar.name AS employee_area,
         date_trunc('week', te.work_date)::date AS week_starting,
         a.contract_id, c.name AS contract_name, cl.name AS client_name,
         SUM(te.hours) AS total_actual_hours,
         COALESCE(a.weekly_hours, 0) AS planned_hours
       FROM time_entries te
       JOIN employees e ON e.id = te.employee_id
       LEFT JOIN areas ar ON ar.id = e.area_id
       JOIN assignments a ON a.id = te.assignment_id
       LEFT JOIN contracts c ON c.id = a.contract_id
       LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE ${wheres.join(' AND ')}
       GROUP BY e.id, e.first_name, e.last_name, e.level, ar.name,
                date_trunc('week', te.work_date)::date,
                a.contract_id, c.name, cl.name, a.weekly_hours
       ORDER BY e.last_name, e.first_name, week_starting`,
      params,
    );

    // Build workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DVPNYX Platform';
    wb.created = new Date();

    const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } } };
    const dateFormat = 'DD/MM/YYYY';
    const hoursFormat = '#,##0.00';

    // ── Sheet 1: Horas por Entrada ──
    const ws1 = wb.addWorksheet('Horas por Entrada');
    const cols1 = [
      { header: 'employee_id', key: 'employee_id', width: 36 },
      { header: 'employee_name', key: 'employee_name', width: 25 },
      { header: 'employee_level', key: 'employee_level', width: 12 },
      { header: 'employee_area', key: 'employee_area', width: 18 },
      { header: 'entry_date', key: 'work_date', width: 14 },
      { header: 'week_starting', key: 'week_starting', width: 14 },
      { header: 'entry_type', key: 'entry_type', width: 18 },
      { header: 'contract_id', key: 'contract_id', width: 36 },
      { header: 'contract_name', key: 'contract_name', width: 25 },
      { header: 'client_name', key: 'client_name', width: 20 },
      { header: 'actual_hours', key: 'actual_hours', width: 12 },
      { header: 'entry_status', key: 'entry_status', width: 12 },
      { header: 'description', key: 'description', width: 30 },
      { header: 'submitted_at', key: 'submitted_at', width: 20 },
    ];
    ws1.columns = cols1;
    ws1.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });
    entries.forEach((r, i) => {
      const row = ws1.addRow(r);
      if (i % 2 === 1) row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
    });
    ws1.getColumn('actual_hours').numFmt = hoursFormat;
    ws1.getColumn('work_date').numFmt = dateFormat;
    ws1.getColumn('week_starting').numFmt = dateFormat;

    // ── Sheet 2: Resumen Semanal ──
    const ws2 = wb.addWorksheet('Resumen Semanal');
    const cols2 = [
      { header: 'employee_id', key: 'employee_id', width: 36 },
      { header: 'employee_name', key: 'employee_name', width: 25 },
      { header: 'employee_level', key: 'employee_level', width: 12 },
      { header: 'employee_area', key: 'employee_area', width: 18 },
      { header: 'week_starting', key: 'week_starting', width: 14 },
      { header: 'contract_id', key: 'contract_id', width: 36 },
      { header: 'contract_name', key: 'contract_name', width: 25 },
      { header: 'client_name', key: 'client_name', width: 20 },
      { header: 'total_actual_hours', key: 'total_actual_hours', width: 16 },
      { header: 'planned_hours', key: 'planned_hours', width: 14 },
      { header: 'variance_hours', key: 'variance_hours', width: 14 },
      { header: 'variance_pct', key: 'variance_pct', width: 12 },
    ];
    ws2.columns = cols2;
    ws2.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });
    summary.forEach((r, i) => {
      const actual = Number(r.total_actual_hours || 0);
      const planned = Number(r.planned_hours || 0);
      const variance = actual - planned;
      const variancePct = planned > 0 ? ((variance / planned) * 100).toFixed(1) : 'N/A';
      const row = ws2.addRow({ ...r, total_actual_hours: actual, planned_hours: planned, variance_hours: variance, variance_pct: variancePct });
      if (i % 2 === 1) row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
    });
    ws2.getColumn('total_actual_hours').numFmt = hoursFormat;
    ws2.getColumn('planned_hours').numFmt = hoursFormat;
    ws2.getColumn('variance_hours').numFmt = hoursFormat;
    ws2.getColumn('week_starting').numFmt = dateFormat;

    // Footer
    const footerRow = ws2.addRow({});
    footerRow.getCell(1).value = `Generado por DVPNYX Platform el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Datos oficiales — no modificar.`;
    footerRow.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (user_id, action, details, ip_address)
       VALUES ($1, 'rm_export_actual_hours', $2, $3)`,
      [req.user.id, JSON.stringify({ week_from, week_to, area_id, contract_id, row_count: entries.length }), req.ip],
    );

    // Stream response
    const filename = `DVPNYX_HorasReales_${week_from}_${week_to}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { serverError(res, 'GET /rm/actual-hours/export', err); }
});

// ── GET /api/rm/deviations/weekly ───────────────────────────────────
//
// Weekly breakdown of plan vs actual per person or project.
// Query: week_from, week_to, group_by (person|project), area_id?, contract_id?, min_variance_pct?

router.get('/deviations/weekly', async (req, res) => {
  const { week_from, week_to, group_by = 'person', area_id, contract_id, min_variance_pct } = req.query;
  if (!week_from || !week_to) {
    return res.status(400).json({ error: 'week_from y week_to son requeridos' });
  }

  const isAdmin = ['superadmin', 'admin', 'director', 'lead'].includes(req.user.role);

  try {
    const wheres = ['a.deleted_at IS NULL', "a.status IN ('planned','active')"];
    const params = [week_from, week_to];

    if (!isAdmin) {
      // Employee only sees their own
      const { rows: empRows } = await pool.query(
        'SELECT id FROM employees WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1',
        [req.user.id],
      );
      if (!empRows.length) return res.json({ summary: {}, weeks: [], rows: [] });
      params.push(empRows[0].id);
      wheres.push(`a.employee_id = $${params.length}`);
    }

    if (area_id) { params.push(area_id); wheres.push(`e.area_id = $${params.length}`); }
    if (contract_id) { params.push(contract_id); wheres.push(`a.contract_id = $${params.length}`); }

    // Generate week list
    const weeks = weeksBetween(toMonday(week_from), toMonday(week_to));

    if (group_by === 'project') {
      const { rows } = await pool.query(
        `SELECT
           a.contract_id, c.name AS contract_name, cl.name AS client_name,
           date_trunc('week', d.day)::date AS week_starting,
           SUM(a.weekly_hours) AS planned_hours,
           COALESCE(SUM(te.actual), 0) AS actual_hours
         FROM assignments a
         JOIN contracts c ON c.id = a.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         JOIN employees e ON e.id = a.employee_id
         CROSS JOIN generate_series($1::date, $2::date, '7 days'::interval) AS d(day)
         LEFT JOIN (
           SELECT assignment_id, date_trunc('week', work_date)::date AS w, SUM(hours) AS actual
             FROM time_entries WHERE deleted_at IS NULL
            GROUP BY assignment_id, date_trunc('week', work_date)::date
         ) te ON te.assignment_id = a.id AND te.w = date_trunc('week', d.day)::date
         WHERE ${wheres.join(' AND ')}
           AND a.start_date <= (d.day + 6) AND (a.end_date IS NULL OR a.end_date >= d.day)
         GROUP BY a.contract_id, c.name, cl.name, date_trunc('week', d.day)::date
         ORDER BY c.name, week_starting`,
        params,
      );

      const grouped = {};
      rows.forEach((r) => {
        if (!grouped[r.contract_id]) {
          grouped[r.contract_id] = { contract_id: r.contract_id, contract_name: r.contract_name, client_name: r.client_name, weeks: {}, totals: { planned: 0, actual: 0 } };
        }
        const planned = Number(r.planned_hours);
        const actual = Number(r.actual_hours);
        const variance = actual - planned;
        grouped[r.contract_id].weeks[r.week_starting] = { planned_hours: planned, actual_hours: actual, variance_hours: variance, variance_pct: planned ? Number(((variance / planned) * 100).toFixed(1)) : null };
        grouped[r.contract_id].totals.planned += planned;
        grouped[r.contract_id].totals.actual += actual;
      });

      const resultRows = Object.values(grouped).map((g) => {
        const v = g.totals.actual - g.totals.planned;
        g.totals.variance = v;
        g.totals.variance_pct = g.totals.planned ? Number(((v / g.totals.planned) * 100).toFixed(1)) : null;
        return g;
      });

      if (min_variance_pct) {
        const minPct = Number(min_variance_pct);
        const filtered = resultRows.filter((r) => r.totals.variance_pct !== null && Math.abs(r.totals.variance_pct) >= minPct);
        return res.json({ weeks, rows: filtered });
      }

      return res.json({ weeks, rows: resultRows });
    }

    // group_by = person (default)
    const { rows } = await pool.query(
      `SELECT
         e.id AS employee_id, e.first_name || ' ' || e.last_name AS employee_name,
         e.level, ar.name AS area_name,
         date_trunc('week', d.day)::date AS week_starting,
         SUM(a.weekly_hours) AS planned_hours,
         COALESCE(te_sum.actual, 0) AS actual_hours
       FROM assignments a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN areas ar ON ar.id = e.area_id
       CROSS JOIN generate_series($1::date, $2::date, '7 days'::interval) AS d(day)
       LEFT JOIN (
         SELECT te.employee_id, date_trunc('week', te.work_date)::date AS w, SUM(te.hours) AS actual
           FROM time_entries te WHERE te.deleted_at IS NULL
          GROUP BY te.employee_id, date_trunc('week', te.work_date)::date
       ) te_sum ON te_sum.employee_id = e.id AND te_sum.w = date_trunc('week', d.day)::date
       WHERE ${wheres.join(' AND ')}
         AND a.start_date <= (d.day + 6) AND (a.end_date IS NULL OR a.end_date >= d.day)
       GROUP BY e.id, e.first_name, e.last_name, e.level, ar.name, date_trunc('week', d.day)::date
       ORDER BY e.last_name, e.first_name, week_starting`,
      params,
    );

    const grouped = {};
    rows.forEach((r) => {
      if (!grouped[r.employee_id]) {
        grouped[r.employee_id] = { employee_id: r.employee_id, employee_name: r.employee_name, level: r.level, area_name: r.area_name, weeks: {}, totals: { planned: 0, actual: 0 } };
      }
      const planned = Number(r.planned_hours);
      const actual = Number(r.actual_hours);
      const variance = actual - planned;
      grouped[r.employee_id].weeks[r.week_starting] = { planned_hours: planned, actual_hours: actual, variance_hours: variance, variance_pct: planned ? Number(((variance / planned) * 100).toFixed(1)) : null };
      grouped[r.employee_id].totals.planned += planned;
      grouped[r.employee_id].totals.actual += actual;
    });

    const resultRows = Object.values(grouped).map((g) => {
      const v = g.totals.actual - g.totals.planned;
      g.totals.variance = v;
      g.totals.variance_pct = g.totals.planned ? Number(((v / g.totals.planned) * 100).toFixed(1)) : null;
      return g;
    });

    const summary = {
      total_planned_hours: resultRows.reduce((s, r) => s + r.totals.planned, 0),
      total_actual_hours: resultRows.reduce((s, r) => s + r.totals.actual, 0),
      employees_over_plan: resultRows.filter((r) => (r.totals.variance_pct || 0) > 5).length,
      employees_under_plan: resultRows.filter((r) => (r.totals.variance_pct || 0) < -5).length,
      employees_on_plan: resultRows.filter((r) => Math.abs(r.totals.variance_pct || 0) <= 5).length,
    };
    summary.total_variance_hours = summary.total_actual_hours - summary.total_planned_hours;
    summary.total_variance_pct = summary.total_planned_hours ? Number(((summary.total_variance_hours / summary.total_planned_hours) * 100).toFixed(1)) : 0;

    if (min_variance_pct) {
      const minPct = Number(min_variance_pct);
      const filtered = resultRows.filter((r) => r.totals.variance_pct !== null && Math.abs(r.totals.variance_pct) >= minPct);
      return res.json({ summary, weeks, rows: filtered });
    }

    res.json({ summary, weeks, rows: resultRows });
  } catch (err) { serverError(res, 'GET /rm/deviations/weekly', err); }
});

// ── GET /api/rm/contracts/active ────────────────────────────────────
// Short list for bulk assign modal selector.

router.get('/contracts/active', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, cl.name AS client_name, c.start_date, c.end_date
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE c.status IN ('planned','active') AND c.deleted_at IS NULL
        ORDER BY cl.name, c.name`,
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /rm/contracts/active', err); }
});

module.exports = router;
