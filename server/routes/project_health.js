/**
 * Project Health — EVM (PMI) for fixed-scope projects (SPEC-PRJ-HEALTH-01).
 *
 * Endpoints:
 *   POST /api/projects/:contract_id/baseline       — freeze baseline at kick-off
 *   GET  /api/projects/:contract_id/baseline        — get active baseline + WBS
 *   POST /api/projects/:contract_id/baseline/rebase — re-baseline (admin/director)
 *   GET  /api/projects/:contract_id/wbs             — WBS packages for active baseline
 *   POST /api/projects/:contract_id/status-reports  — submit weekly status
 *   GET  /api/projects/:contract_id/status-reports  — list status reports
 *   GET  /api/projects/:contract_id/health          — computed KPIs + health
 *   GET  /api/projects/portfolio-health              — portfolio view
 *   POST /api/projects/:contract_id/closeout         — close project
 */

const router = require('express').Router();
const pool = require('../database/pool');
const { auth, requireRole, SEE_ALL_ROLES } = require('../middleware/auth');
const { safeRollback, serverError } = require('../utils/http');
const { emitEvent } = require('../utils/events');
const evm = require('../utils/evm');

router.use(auth);

// ──────────── helpers ────────────

async function loadContract(conn, contractId) {
  const { rows } = await conn.query(
    `SELECT c.id, c.name, c.type, c.contract_subtype, c.status, c.start_date, c.end_date,
            c.total_value_usd, c.winning_quotation_id, c.account_owner_id,
            c.client_id
       FROM contracts c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [contractId],
  );
  return rows[0] || null;
}

function requireFixedScope(contract, res) {
  if (!contract) { res.status(404).json({ error: 'Contrato no encontrado' }); return false; }
  if (contract.contract_subtype !== 'fixed_scope') {
    res.status(422).json({ error: 'Solo contratos fixed_scope soportan Project Health (EVM)', code: 'not_a_fixed_scope_project' });
    return false;
  }
  return true;
}

/** Load hourly cost for employees from employee_costs (latest period). */
async function buildCostMap(conn, employeeIds, cutoffDate) {
  if (!employeeIds.length) return new Map();
  // Get most recent cost for each employee up to cutoff
  const { rows } = await conn.query(
    `SELECT DISTINCT ON (ec.employee_id)
            ec.employee_id, ec.cost_usd, e.weekly_capacity_hours
       FROM employee_costs ec
       JOIN employees e ON e.id = ec.employee_id
      WHERE ec.employee_id = ANY($1::uuid[])
        AND ec.period <= $2
      ORDER BY ec.employee_id, ec.period DESC`,
    [employeeIds, cutoffDate.replace(/-/g, '').slice(0, 6)],
  );
  const map = new Map();
  for (const r of rows) {
    const monthlyHours = Number(r.weekly_capacity_hours || 40) * 4.333;
    const hourlyCost = monthlyHours > 0 ? Number(r.cost_usd) / monthlyHours : 0;
    map.set(r.employee_id, hourlyCost);
  }
  return map;
}

/**
 * Derive the "costo protegido" (BAC Cost) from a quotation.
 *
 * For fixed-scope (project) quotations the cost comes from the V2 allocation
 * matrix: SUM(weekly_hours × phase.weeks × line.cost_hour), then apply buffer
 * + warranty from the parameters snapshot (or current parameters).
 *
 * For staff-aug quotations the cost is the V1 formula:
 *   SUM(cost_hour × hours_per_week × 4.333 × duration_months × quantity).
 *
 * Returns { totalCost, costProtected } where costProtected includes contingency.
 */
async function computeQuotationCost(conn, quotationId) {
  // Load quotation type + parameters
  const { rows: [quot] } = await conn.query(
    'SELECT type, parameters_snapshot FROM quotations WHERE id = $1',
    [quotationId],
  );
  if (!quot) return { totalCost: 0, costProtected: 0 };

  // --- Fixed-scope: V2 allocation matrix ---
  if (quot.type === 'project' || quot.type === 'fixed_scope') {
    const { rows: allocCost } = await conn.query(
      `SELECT COALESCE(SUM(
         qa.weekly_hours * COALESCE(qp.weeks, 0) * COALESCE(ql.cost_hour, 0)
       ), 0)::numeric AS total_cost
       FROM quotation_allocations qa
       JOIN quotation_phases qp ON qp.id = qa.phase_id
       JOIN quotation_lines ql ON ql.quotation_id = qa.quotation_id
                               AND ql.sort_order = qa.line_sort_order
       WHERE qa.quotation_id = $1`,
      [quotationId],
    );
    let totalCost = Number(allocCost[0].total_cost || 0);

    // Fallback to V1 if no allocations exist
    if (totalCost <= 0) {
      const { rows: v1 } = await conn.query(
        `SELECT COALESCE(SUM(
           COALESCE(cost_hour, 0) * COALESCE(hours_per_week, 0) * 4.333
           * COALESCE(duration_months, 1) * COALESCE(quantity, 1)
         ), 0)::numeric AS total_cost
         FROM quotation_lines WHERE quotation_id = $1`,
        [quotationId],
      );
      totalCost = Number(v1[0].total_cost || 0);
    }

    // Apply buffer + warranty from parameters → costProtected
    let params = quot.parameters_snapshot;
    if (!params) {
      const { rows: pRows } = await conn.query('SELECT category, key, value FROM parameters');
      params = {};
      for (const r of pRows) {
        if (!params[r.category]) params[r.category] = [];
        params[r.category].push({ key: r.key, value: r.value });
      }
    }
    const calc = require('../utils/calc');
    const fin = calc.calcProjectFinancials(totalCost, params);
    return { totalCost, costProtected: fin.costProtected };
  }

  // --- Staff-aug: V1 formula ---
  const { rows } = await conn.query(
    `SELECT COALESCE(SUM(
       COALESCE(cost_hour, 0) * COALESCE(hours_per_week, 0) * 4.333
       * COALESCE(duration_months, 1) * COALESCE(quantity, 1)
     ), 0)::numeric AS total_cost
     FROM quotation_lines WHERE quotation_id = $1`,
    [quotationId],
  );
  const totalCost = Number(rows[0].total_cost || 0);
  return { totalCost, costProtected: totalCost };
}

/**
 * Sync EVM progress → revenue_periods.
 * Writes cumulative real_pct for the given month and recalculates real_usd
 * for that month + all subsequent months with real_pct (delta model).
 */
async function syncRevenueFromProgress(conn, contractId, yyyymm, realPct, totalValueUsd, userId) {
  // Upsert the row for this month
  await conn.query(
    `INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, real_pct, created_by, updated_by)
     VALUES ($1, $2, 0, $3, $4, $4)
     ON CONFLICT (contract_id, yyyymm) DO UPDATE SET
       real_pct   = EXCLUDED.real_pct,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [contractId, yyyymm, realPct, userId],
  );
  // Recalculate real_usd for all months with real_pct (delta model)
  const { rows: allMonths } = await conn.query(
    `SELECT yyyymm, real_pct FROM revenue_periods
      WHERE contract_id = $1 AND real_pct IS NOT NULL
      ORDER BY yyyymm ASC`,
    [contractId],
  );
  let prevPct = 0;
  for (const m of allMonths) {
    const pct = Number(m.real_pct);
    const realUsd = (pct - prevPct) * totalValueUsd;
    await conn.query(
      `UPDATE revenue_periods
          SET real_usd = $3::numeric, updated_at = NOW()
        WHERE contract_id = $1 AND yyyymm = $2`,
      [contractId, m.yyyymm, realUsd],
    );
    prevPct = pct;
  }
}

// ──────────── GET /baseline-preview ────────────
// Returns pre-computed BAC values so the frontend can show them before creation.

router.get('/:contract_id/baseline-preview', requireRole('superadmin', 'admin', 'lead'), async (req, res) => {
  try {
    const contract = await loadContract(pool, req.params.contract_id);
    if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });

    const bacRevenue = Number(contract.total_value_usd || 0);
    let bacCostAuto = 0;
    let costProtected = 0;
    if (contract.winning_quotation_id) {
      const quotCost = await computeQuotationCost(pool, contract.winning_quotation_id);
      bacCostAuto = quotCost.costProtected;
      costProtected = quotCost.costProtected;
    }

    res.json({
      bac_revenue: bacRevenue,
      bac_cost_auto: bacCostAuto,
      cost_protected: costProtected,
      original_currency: contract.original_currency || 'USD',
      has_winning_quotation: !!contract.winning_quotation_id,
      needs_manual_cost: bacCostAuto <= 0,
    });
  } catch (err) { serverError(res, 'GET /projects/:contract_id/baseline-preview', err); }
});

// ──────────── POST /baseline ────────────

router.post('/:contract_id/baseline', requireRole('superadmin', 'admin', 'lead'), async (req, res) => {
  const { contract_id } = req.params;
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const contract = await loadContract(conn, contract_id);
    if (!requireFixedScope(contract, res)) { await conn.query('ROLLBACK'); return; }

    // Check no active baseline exists
    const { rows: existing } = await conn.query(
      'SELECT id FROM project_baselines WHERE contract_id=$1 AND is_active=true', [contract_id]);
    if (existing.length) {
      await conn.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe un baseline activo. Usa re-baseline para crear una nueva version.', code: 'baseline_already_exists' });
    }

    // Need winning_quotation_id to derive WBS
    if (!contract.winning_quotation_id) {
      await conn.query('ROLLBACK');
      return res.status(422).json({ error: 'El contrato no tiene cotizacion ganadora. Asocia una antes de crear el baseline.', code: 'missing_winning_quotation' });
    }

    // Load phases from quotation
    const { rows: phases } = await conn.query(
      'SELECT id, name, sort_order, weeks FROM quotation_phases WHERE quotation_id=$1 ORDER BY sort_order',
      [contract.winning_quotation_id],
    );
    if (!phases.length) {
      await conn.query('ROLLBACK');
      return res.status(422).json({ error: 'La cotizacion no tiene fases definidas. Agrega al menos una fase antes de crear el baseline.', code: 'missing_wbs_inputs' });
    }

    // Load epics and milestones
    const { rows: epics } = await conn.query(
      'SELECT id, name, sort_order, total_hours FROM quotation_epics WHERE quotation_id=$1 ORDER BY sort_order',
      [contract.winning_quotation_id],
    );
    const { rows: milestones } = await conn.query(
      'SELECT id, name, sort_order, expected_date FROM quotation_milestones WHERE quotation_id=$1 AND deleted_at IS NULL ORDER BY sort_order',
      [contract.winning_quotation_id],
    );

    // Load allocations to compute planned_hours per phase
    const { rows: allocations } = await conn.query(
      'SELECT phase_id, SUM(weekly_hours) as total_weekly FROM quotation_allocations WHERE quotation_id=$1 GROUP BY phase_id',
      [contract.winning_quotation_id],
    );
    const allocByPhase = new Map(allocations.map(a => [a.phase_id, Number(a.total_weekly)]));

    // Derive BAC Revenue = contract value (manual); BAC Cost = costo protegido from quotation.
    const bacRevenue = Number(contract.total_value_usd || 0);
    let bacCost = 0;
    if (req.body.bac_cost_usd) {
      bacCost = Number(req.body.bac_cost_usd);
    } else {
      const quotCost = await computeQuotationCost(conn, contract.winning_quotation_id);
      bacCost = quotCost.costProtected;
    }
    if (bacCost <= 0 || bacRevenue <= 0) {
      await conn.query('ROLLBACK');
      return res.status(400).json({
        error: bacRevenue <= 0
          ? 'El contrato no tiene valor (total_value_usd). Edítalo primero desde el detalle del contrato.'
          : 'No se pudo derivar BAC cost de la cotización (cost_hour × horas). Verifica las líneas de la cotización o envía bac_cost_usd manualmente.',
      });
    }

    const plannedStart = contract.start_date ? new Date(contract.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const plannedEnd = contract.end_date ? new Date(contract.end_date).toISOString().slice(0, 10) : null;
    if (!plannedEnd) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: 'El contrato necesita fecha de fin para crear el baseline' });
    }

    const measurementMethod = req.body.measurement_method || 'weighted_milestones';

    // Create baseline
    const { rows: [baseline] } = await conn.query(
      `INSERT INTO project_baselines
         (contract_id, version, frozen_by, bac_cost_usd, bac_revenue_usd,
          planned_start, planned_end, measurement_method, snapshot, reason)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [contract_id, req.user.id, bacCost, bacRevenue,
       plannedStart, plannedEnd, measurementMethod,
       JSON.stringify({ phases: phases.map(p => ({ id: p.id, name: p.name, weeks: p.weeks })) }),
       req.body.reason || 'Baseline inicial al kick-off'],
    );

    // Derive weight distribution: proportional to weeks (or equal if no weeks data)
    const totalWeeks = phases.reduce((s, p) => s + (Number(p.weeks) || 1), 0);

    // Create WBS packages from phases
    let cumulativeStart = new Date(plannedStart);
    const wbsPackages = [];
    for (const phase of phases) {
      const phaseWeeks = Number(phase.weeks) || 1;
      const weight = evm.round4(phaseWeeks / totalWeeks);
      const phaseEnd = new Date(cumulativeStart);
      phaseEnd.setDate(phaseEnd.getDate() + phaseWeeks * 7 - 1);
      const phaseEndClamped = phaseEnd > new Date(plannedEnd) ? new Date(plannedEnd) : phaseEnd;

      const weeklyHours = allocByPhase.get(phase.id) || 0;
      const plannedHours = weeklyHours * phaseWeeks;
      const plannedCostPhase = evm.round2(weight * bacCost);

      const { rows: [wbs] } = await conn.query(
        `INSERT INTO wbs_packages
           (baseline_id, kind, source_id, name, sort_order, planned_hours, planned_cost_usd,
            weight_pct, planned_start, planned_end)
         VALUES ($1, 'phase', $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [baseline.id, phase.id, phase.name, phase.sort_order,
         plannedHours, plannedCostPhase, weight,
         cumulativeStart.toISOString().slice(0, 10),
         phaseEndClamped.toISOString().slice(0, 10)],
      );
      wbsPackages.push(wbs);

      // Advance start for next phase
      cumulativeStart = new Date(phaseEndClamped);
      cumulativeStart.setDate(cumulativeStart.getDate() + 1);
    }

    // Create WBS packages for epics (children of first matching phase)
    for (const epic of epics) {
      const parentPhase = wbsPackages[0]; // default to first phase
      await conn.query(
        `INSERT INTO wbs_packages
           (baseline_id, parent_id, kind, source_id, name, sort_order, planned_hours,
            planned_cost_usd, weight_pct, planned_start, planned_end)
         VALUES ($1, $2, 'epic', $3, $4, $5, $6, 0, 0, $7, $8)`,
        [baseline.id, parentPhase?.id, epic.id, epic.name, epic.sort_order,
         Number(epic.total_hours || 0),
         parentPhase?.planned_start || plannedStart,
         parentPhase?.planned_end || plannedEnd],
      );
    }

    // Create WBS packages for milestones (weight_pct = 0 per spec)
    for (const ms of milestones) {
      const msDate = ms.expected_date ? new Date(ms.expected_date).toISOString().slice(0, 10) : plannedEnd;
      await conn.query(
        `INSERT INTO wbs_packages
           (baseline_id, kind, source_id, name, sort_order, planned_hours,
            planned_cost_usd, weight_pct, planned_start, planned_end)
         VALUES ($1, 'milestone', $2, $3, $4, 0, 0, 0, $5, $5)`,
        [baseline.id, ms.id, ms.name, ms.sort_order, msDate],
      );
    }

    await emitEvent(conn, {
      event_type: 'project.baseline_created',
      entity_type: 'project_baseline',
      entity_id: baseline.id,
      actor_user_id: req.user.id,
      payload: { contract_id, version: 1, bac_cost_usd: bacCost, bac_revenue_usd: bacRevenue },
      req,
    });

    await conn.query('COMMIT');
    res.status(201).json({ baseline, wbs: wbsPackages });
  } catch (err) {
    await safeRollback(conn);
    serverError(res, 'POST /projects/:contract_id/baseline', err);
  } finally { conn.release(); }
});

// ──────────── GET /baseline ────────────

router.get('/:contract_id/baseline', async (req, res) => {
  try {
    const { rows: [baseline] } = await pool.query(
      `SELECT pb.*, u.name AS frozen_by_name
         FROM project_baselines pb
         LEFT JOIN users u ON u.id = pb.frozen_by
        WHERE pb.contract_id = $1 AND pb.is_active = true`,
      [req.params.contract_id],
    );
    if (!baseline) return res.status(404).json({ error: 'No hay baseline activo para este contrato' });

    const { rows: wbs } = await pool.query(
      'SELECT * FROM wbs_packages WHERE baseline_id=$1 ORDER BY sort_order', [baseline.id]);

    res.json({ baseline, wbs });
  } catch (err) { serverError(res, 'GET /projects/:contract_id/baseline', err); }
});

// ──────────── POST /baseline/rebase ────────────

router.post('/:contract_id/baseline/rebase', requireRole('superadmin', 'admin', 'director'), async (req, res) => {
  const { contract_id } = req.params;
  const { reason } = req.body || {};
  if (!reason || String(reason).trim().length < 30) {
    return res.status(400).json({ error: 'reason debe tener al menos 30 caracteres para justificar el re-baseline' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const contract = await loadContract(conn, contract_id);
    if (!requireFixedScope(contract, res)) { await conn.query('ROLLBACK'); return; }

    if (contract.status === 'completed') {
      await conn.query('ROLLBACK');
      return res.status(409).json({ error: 'No se puede re-basear un proyecto cerrado', code: 'project_closed' });
    }

    const { rows: [current] } = await conn.query(
      'SELECT * FROM project_baselines WHERE contract_id=$1 AND is_active=true FOR UPDATE',
      [contract_id],
    );
    if (!current) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'No hay baseline activo para re-basear' });
    }

    // Deactivate current
    await conn.query(
      'UPDATE project_baselines SET is_active=false WHERE id=$1', [current.id]);

    const newVersion = current.version + 1;
    const bacCost = Number(req.body.bac_cost_usd || current.bac_cost_usd);
    const bacRevenue = Number(req.body.bac_revenue_usd || current.bac_revenue_usd);
    const newPlannedEnd = req.body.planned_end || current.planned_end;

    // Create new baseline version
    const { rows: [newBaseline] } = await conn.query(
      `INSERT INTO project_baselines
         (contract_id, version, frozen_by, bac_cost_usd, bac_revenue_usd,
          planned_start, planned_end, measurement_method, snapshot, reason, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING *`,
      [contract_id, newVersion, req.user.id, bacCost, bacRevenue,
       current.planned_start, newPlannedEnd,
       req.body.measurement_method || current.measurement_method,
       current.snapshot, reason.trim()],
    );

    // Copy WBS packages to new baseline
    const { rows: oldWbs } = await conn.query(
      'SELECT * FROM wbs_packages WHERE baseline_id=$1 AND parent_id IS NULL ORDER BY sort_order',
      [current.id],
    );
    for (const pkg of oldWbs) {
      await conn.query(
        `INSERT INTO wbs_packages
           (baseline_id, kind, source_id, name, sort_order, planned_hours,
            planned_cost_usd, weight_pct, planned_start, planned_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [newBaseline.id, pkg.kind, pkg.source_id, pkg.name, pkg.sort_order,
         pkg.planned_hours, pkg.planned_cost_usd, pkg.weight_pct,
         pkg.planned_start, pkg.planned_end],
      );
    }

    await emitEvent(conn, {
      event_type: 'project.rebaselined',
      entity_type: 'project_baseline',
      entity_id: newBaseline.id,
      actor_user_id: req.user.id,
      payload: { contract_id, old_version: current.version, new_version: newVersion, reason: reason.trim() },
      req,
    });

    await conn.query('COMMIT');
    res.status(201).json({ baseline: newBaseline });
  } catch (err) {
    await safeRollback(conn);
    serverError(res, 'POST /projects/:contract_id/baseline/rebase', err);
  } finally { conn.release(); }
});

// ──────────── GET /wbs ────────────

router.get('/:contract_id/wbs', async (req, res) => {
  try {
    const { rows: [baseline] } = await pool.query(
      'SELECT id FROM project_baselines WHERE contract_id=$1 AND is_active=true',
      [req.params.contract_id],
    );
    if (!baseline) return res.status(404).json({ error: 'No hay baseline activo' });

    const { rows } = await pool.query(
      'SELECT * FROM wbs_packages WHERE baseline_id=$1 ORDER BY sort_order', [baseline.id]);
    res.json(rows);
  } catch (err) { serverError(res, 'GET /projects/:contract_id/wbs', err); }
});

// ──────────── POST /status-reports ────────────

router.post('/:contract_id/status-reports', requireRole('superadmin', 'admin', 'lead'), async (req, res) => {
  const { contract_id } = req.params;
  const { cutoff_date, wbs_progress: progressInput, narrative, risks, overall_health } = req.body || {};

  if (!cutoff_date) return res.status(400).json({ error: 'cutoff_date es requerido' });
  const cutoff = String(cutoff_date).slice(0, 10);

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const contract = await loadContract(conn, contract_id);
    if (!requireFixedScope(contract, res)) { await conn.query('ROLLBACK'); return; }

    if (contract.status === 'completed') {
      await conn.query('ROLLBACK');
      return res.status(409).json({ error: 'No se pueden reportar status en un proyecto cerrado', code: 'project_closed' });
    }

    const { rows: [baseline] } = await conn.query(
      'SELECT * FROM project_baselines WHERE contract_id=$1 AND is_active=true',
      [contract_id],
    );
    if (!baseline) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'No hay baseline activo. Crea uno antes de reportar status.' });
    }

    // Validate cutoff
    if (cutoff < baseline.planned_start || cutoff > new Date().toISOString().slice(0, 10)) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: 'cutoff_date fuera de rango', code: 'cutoff_out_of_range' });
    }

    // Check duplicate
    const { rows: dup } = await conn.query(
      'SELECT id FROM project_status_reports WHERE baseline_id=$1 AND cutoff_date=$2',
      [baseline.id, cutoff],
    );
    if (dup.length) {
      await conn.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe un status report para esta fecha', code: 'status_report_exists' });
    }

    // Load WBS packages (phases only for weight-based EV)
    const { rows: wbsPackages } = await conn.query(
      `SELECT * FROM wbs_packages WHERE baseline_id=$1 AND kind='phase' ORDER BY sort_order`,
      [baseline.id],
    );

    // Build progress map from input
    const progressMap = new Map();
    if (Array.isArray(progressInput)) {
      for (const p of progressInput) {
        progressMap.set(p.wbs_package_id, p);
      }
    }

    // Merge WBS with progress for EV computation
    const wbsWithProgress = wbsPackages.map(pkg => ({
      weight_pct: Number(pkg.weight_pct),
      planned_start: pkg.planned_start,
      planned_end: pkg.planned_end,
      percent_complete: progressMap.has(pkg.id) ? Number(progressMap.get(pkg.id).percent_complete || 0) : 0,
    }));

    const bacCost = Number(baseline.bac_cost_usd);
    const pStart = new Date(baseline.planned_start).toISOString().slice(0, 10);
    const pEnd = new Date(baseline.planned_end).toISOString().slice(0, 10);

    // Compute PV and EV
    const pv = evm.computePV(wbsWithProgress, bacCost, cutoff, pStart, pEnd);
    const ev = evm.computeEV(wbsWithProgress, bacCost);

    // Compute AC from time_entries
    const { rows: timeRows } = await conn.query(
      `SELECT te.employee_id, SUM(te.hours) AS hours
         FROM time_entries te
         JOIN assignments a ON a.id = te.assignment_id
        WHERE a.contract_id = $1
          AND te.work_date <= $2
          AND te.deleted_at IS NULL
        GROUP BY te.employee_id`,
      [contract_id, cutoff],
    );
    const empIds = timeRows.map(r => r.employee_id);
    const costMap = await buildCostMap(conn, empIds, cutoff);
    const acResult = evm.computeAC(
      timeRows.map(r => ({ employee_id: r.employee_id, hours: Number(r.hours) })),
      costMap,
    );

    // Build PV curve for Earned Schedule
    const pvCurve = evm.buildPvCurve(wbsWithProgress, bacCost, pStart, pEnd);
    const atDays = evm.diffDays(pStart, cutoff);

    // Compute all KPIs
    const kpis = evm.computeKpis({
      pv, ev, ac: acResult.ac, bac: bacCost,
      plannedStart: pStart, plannedEnd: pEnd, cutoffDate: cutoff,
      pvCurve,
    });

    // Earned Schedule
    const esResult = evm.computeEarnedSchedule(pvCurve, ev, atDays);

    const computedKpis = {
      pv: evm.round2(pv),
      ev: evm.round2(ev),
      ac: evm.round2(acResult.ac),
      ...kpis,
      ...esResult,
      ac_warnings: acResult.warnings,
      ac_coverage_pct: acResult.coverage_pct,
    };

    // Compute health
    const health = evm.computeHealth(computedKpis, bacCost);
    const finalHealth = overall_health || health.overall;

    // Insert status report
    const { rows: [report] } = await conn.query(
      `INSERT INTO project_status_reports
         (baseline_id, cutoff_date, reported_by, overall_health, narrative, risks, computed_kpis)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [baseline.id, cutoff, req.user.id, finalHealth,
       narrative || null, risks ? JSON.stringify(risks) : null,
       JSON.stringify(computedKpis)],
    );

    // Insert wbs_progress records
    for (const pkg of wbsPackages) {
      const prog = progressMap.get(pkg.id);
      await conn.query(
        `INSERT INTO wbs_progress (status_report_id, wbs_package_id, percent_complete, evidence_url, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [report.id, pkg.id,
         prog ? Number(prog.percent_complete || 0) : 0,
         prog?.evidence_url || null,
         prog?.notes || null],
      );
    }

    // Emit health event if degraded
    if (finalHealth === 'red') {
      await emitEvent(conn, {
        event_type: 'project.health_degraded',
        entity_type: 'project_status_report',
        entity_id: report.id,
        actor_user_id: req.user.id,
        payload: { contract_id, health: finalHealth, cpi: computedKpis.cpi, spi: computedKpis.spi, drivers: health.drivers },
        req,
      });
    }

    // ── Bridge: EVM progress → Revenue recognition ──
    // El avance global (EV / BAC) = real_pct acumulado a fin del mes del cutoff.
    // Se escribe directamente en revenue_periods para que Revenue refleje el
    // progreso real del proyecto sin intervención manual.
    const globalProgress = bacCost > 0 ? evm.round4(ev / bacCost) : 0;
    const revenueMonth = cutoff.replace(/-/g, '').slice(0, 6); // '2026-05-08' → '202605'
    const totalValue = Number(contract.total_value_usd || 0);
    if (totalValue > 0 && globalProgress >= 0) {
      await syncRevenueFromProgress(conn, contract_id, revenueMonth, globalProgress, totalValue, req.user.id);
    }

    await conn.query('COMMIT');
    res.status(201).json({ report, computed_kpis: computedKpis, health, revenue_synced: { yyyymm: revenueMonth, real_pct: globalProgress } });
  } catch (err) {
    await safeRollback(conn);
    serverError(res, 'POST /projects/:contract_id/status-reports', err);
  } finally { conn.release(); }
});

// ──────────── GET /status-reports ────────────

router.get('/:contract_id/status-reports', async (req, res) => {
  try {
    const { rows: [baseline] } = await pool.query(
      'SELECT id FROM project_baselines WHERE contract_id=$1 AND is_active=true',
      [req.params.contract_id],
    );
    if (!baseline) return res.status(404).json({ error: 'No hay baseline activo' });

    const { rows } = await pool.query(
      `SELECT psr.*, u.name AS reported_by_name
         FROM project_status_reports psr
         LEFT JOIN users u ON u.id = psr.reported_by
        WHERE psr.baseline_id = $1
        ORDER BY psr.cutoff_date DESC`,
      [baseline.id],
    );
    res.json(rows);
  } catch (err) { serverError(res, 'GET /projects/:contract_id/status-reports', err); }
});

// ──────────── GET /health ────────────

router.get('/:contract_id/health', async (req, res) => {
  try {
    const contract = await loadContract(pool, req.params.contract_id);
    if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });
    if (contract.contract_subtype !== 'fixed_scope') {
      return res.status(422).json({ error: 'Solo contratos fixed_scope', code: 'not_a_fixed_scope_project' });
    }

    const { rows: [baseline] } = await pool.query(
      'SELECT * FROM project_baselines WHERE contract_id=$1 AND is_active=true',
      [req.params.contract_id],
    );
    if (!baseline) return res.status(404).json({ error: 'No hay baseline activo' });

    // Get latest status report
    const { rows: [latest] } = await pool.query(
      `SELECT * FROM project_status_reports
        WHERE baseline_id=$1 ORDER BY cutoff_date DESC LIMIT 1`,
      [baseline.id],
    );

    // Get WBS with latest progress
    const { rows: wbs } = await pool.query(
      `SELECT wp.*, COALESCE(pr.percent_complete, 0) AS current_progress
         FROM wbs_packages wp
         LEFT JOIN LATERAL (
           SELECT wpr.percent_complete FROM wbs_progress wpr
           JOIN project_status_reports psr ON psr.id = wpr.status_report_id
           WHERE wpr.wbs_package_id = wp.id AND psr.baseline_id = $1
           ORDER BY psr.cutoff_date DESC LIMIT 1
         ) pr ON true
        WHERE wp.baseline_id = $1
        ORDER BY wp.sort_order`,
      [baseline.id],
    );

    // Trend: last 12 status reports
    const { rows: trend } = await pool.query(
      `SELECT cutoff_date,
              (computed_kpis->>'cpi')::numeric AS cpi,
              (computed_kpis->>'spi')::numeric AS spi,
              overall_health
         FROM project_status_reports
        WHERE baseline_id=$1
        ORDER BY cutoff_date DESC LIMIT 12`,
      [baseline.id],
    );

    const kpis = latest?.computed_kpis || {};
    const health = latest ? { overall: latest.overall_health, drivers: kpis.health_drivers || [] }
      : { overall: 'green', drivers: [] };

    res.json({
      contract_id: contract.id,
      contract_name: contract.name,
      baseline: {
        id: baseline.id,
        version: baseline.version,
        frozen_at: baseline.frozen_at,
        bac_cost_usd: Number(baseline.bac_cost_usd),
        bac_revenue_usd: Number(baseline.bac_revenue_usd),
        planned_start: baseline.planned_start,
        planned_end: baseline.planned_end,
        measurement_method: baseline.measurement_method,
      },
      as_of: latest?.cutoff_date || new Date().toISOString().slice(0, 10),
      kpis,
      health,
      trend: trend.reverse(),
      wbs: wbs.map(w => ({
        id: w.id,
        kind: w.kind,
        name: w.name,
        weight_pct: Number(w.weight_pct),
        percent_complete: Number(w.current_progress),
        planned_start: w.planned_start,
        planned_end: w.planned_end,
      })),
    });
  } catch (err) { serverError(res, 'GET /projects/:contract_id/health', err); }
});

// ──────────── GET /portfolio-health ────────────

router.get('/portfolio-health', async (req, res) => {
  try {
    // All authenticated users can see the portfolio (same visibility as /contracts).
    const whereClause = "c.contract_subtype = 'fixed_scope' AND c.deleted_at IS NULL AND c.status != 'completed'";
    const params = [];

    const { rows } = await pool.query(
      `SELECT c.id AS contract_id, c.name AS contract_name, c.status,
              cl.name AS client_name,
              pb.id AS baseline_id, pb.version, pb.bac_cost_usd, pb.bac_revenue_usd,
              pb.planned_start, pb.planned_end,
              psr.cutoff_date AS last_report_date,
              psr.overall_health,
              psr.computed_kpis
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN project_baselines pb ON pb.contract_id = c.id AND pb.is_active = true
         LEFT JOIN LATERAL (
           SELECT * FROM project_status_reports
            WHERE baseline_id = pb.id
            ORDER BY cutoff_date DESC LIMIT 1
         ) psr ON true
        WHERE ${whereClause}
        ORDER BY psr.overall_health DESC NULLS LAST, c.name`,
      params,
    );

    res.json({
      projects: rows.map(r => ({
        contract_id: r.contract_id,
        contract_name: r.contract_name,
        client_name: r.client_name,
        status: r.status,
        has_baseline: !!r.baseline_id,
        baseline_version: r.version,
        bac_cost_usd: r.bac_cost_usd ? Number(r.bac_cost_usd) : null,
        bac_revenue_usd: r.bac_revenue_usd ? Number(r.bac_revenue_usd) : null,
        planned_start: r.planned_start,
        planned_end: r.planned_end,
        last_report_date: r.last_report_date,
        overall_health: r.overall_health || null,
        kpis: r.computed_kpis || null,
      })),
      count: rows.length,
    });
  } catch (err) { serverError(res, 'GET /projects/portfolio-health', err); }
});

// ──────────── POST /closeout ────────────

router.post('/:contract_id/closeout', requireRole('superadmin', 'admin', 'director'), async (req, res) => {
  const { contract_id } = req.params;
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const contract = await loadContract(conn, contract_id);
    if (!requireFixedScope(contract, res)) { await conn.query('ROLLBACK'); return; }

    if (contract.status === 'completed') {
      await conn.query('ROLLBACK');
      return res.status(409).json({ error: 'El proyecto ya esta cerrado', code: 'project_closed' });
    }

    // Update contract status
    await conn.query(
      "UPDATE contracts SET status='completed', updated_at=NOW() WHERE id=$1",
      [contract_id],
    );

    await emitEvent(conn, {
      event_type: 'project.closed',
      entity_type: 'contract',
      entity_id: contract_id,
      actor_user_id: req.user.id,
      payload: { contract_id, narrative: req.body.narrative || null },
      req,
    });

    await conn.query('COMMIT');
    res.json({ status: 'completed', contract_id });
  } catch (err) {
    await safeRollback(conn);
    serverError(res, 'POST /projects/:contract_id/closeout', err);
  } finally { conn.release(); }
});

// ──────────── GET /cost-forecast ────────────
// Costo real planeado = AC ejecutado (pasado) + asignaciones futuras (planeado).
// Útil para saber si el proyecto se va a salir del presupuesto con el staffing actual.

router.get('/:contract_id/cost-forecast', async (req, res) => {
  try {
    const contract = await loadContract(pool, req.params.contract_id);
    if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });

    const today = new Date().toISOString().slice(0, 10);

    // 1. AC ejecutado: horas registradas × costo horario (pasado)
    const { rows: timeRows } = await pool.query(
      `SELECT te.employee_id, SUM(te.hours) AS hours
         FROM time_entries te
         JOIN assignments a ON a.id = te.assignment_id
        WHERE a.contract_id = $1
          AND te.work_date <= $2
          AND te.deleted_at IS NULL
        GROUP BY te.employee_id`,
      [contract.id, today],
    );
    const empIdsAc = timeRows.map(r => r.employee_id);
    const costMapAc = await buildCostMap(pool, empIdsAc, today);
    const acResult = evm.computeAC(
      timeRows.map(r => ({ employee_id: r.employee_id, hours: Number(r.hours) })),
      costMapAc,
    );

    // 2. Costo futuro planeado: asignaciones activas/planned × costo horario × semanas restantes
    const { rows: assignments } = await pool.query(
      `SELECT a.employee_id, a.weekly_hours, a.start_date, a.end_date
         FROM assignments a
        WHERE a.contract_id = $1
          AND a.status IN ('active', 'planned')
          AND a.deleted_at IS NULL
          AND (a.end_date IS NULL OR a.end_date > $2)`,
      [contract.id, today],
    );

    const futureEmpIds = [...new Set(assignments.map(a => a.employee_id))];
    const costMapFuture = await buildCostMap(pool, futureEmpIds, today);

    let plannedFutureCost = 0;
    const futureDetails = [];
    for (const a of assignments) {
      const startFrom = a.start_date && a.start_date > today ? a.start_date : today;
      const endAt = a.end_date || (contract.end_date ? new Date(contract.end_date).toISOString().slice(0, 10) : null);
      if (!endAt) continue;
      const diffMs = new Date(endAt) - new Date(startFrom);
      const weeks = Math.max(0, diffMs / (7 * 24 * 3600 * 1000));
      const hourlyRate = costMapFuture.get(a.employee_id) || 0;
      const cost = Number(a.weekly_hours) * weeks * hourlyRate;
      plannedFutureCost += cost;
      futureDetails.push({
        employee_id: a.employee_id,
        weekly_hours: Number(a.weekly_hours),
        weeks_remaining: evm.round2(weeks),
        hourly_cost: evm.round2(hourlyRate),
        projected_cost: evm.round2(cost),
        has_cost_data: hourlyRate > 0,
      });
    }

    const eac_staffing = evm.round2(acResult.ac + plannedFutureCost);

    // 3. BAC from baseline (if exists) for comparison
    const { rows: [baseline] } = await pool.query(
      'SELECT bac_cost_usd, bac_revenue_usd FROM project_baselines WHERE contract_id=$1 AND is_active=true',
      [contract.id],
    );
    const bacCost = baseline ? Number(baseline.bac_cost_usd) : null;
    const bacRevenue = baseline ? Number(baseline.bac_revenue_usd) : null;
    const variance = bacCost != null ? evm.round2(bacCost - eac_staffing) : null;

    res.json({
      contract_id: contract.id,
      as_of: today,
      ac_executed: acResult.ac,
      ac_warnings: acResult.warnings,
      planned_future_cost: evm.round2(plannedFutureCost),
      eac_staffing,
      bac_cost: bacCost,
      bac_revenue: bacRevenue,
      variance_at_completion: variance,
      margin_projected: bacRevenue && eac_staffing ? evm.round2(bacRevenue - eac_staffing) : null,
      assignments_detail: futureDetails,
    });
  } catch (err) { serverError(res, 'GET /projects/:contract_id/cost-forecast', err); }
});

// ──────────── POST /backfill-revenue ────────────
// Admin-only: reprocess all existing status reports to sync progress → revenue.
// Useful for historical data before the bridge was implemented.

router.post('/:contract_id/backfill-revenue', requireRole('superadmin', 'admin'), async (req, res) => {
  const { contract_id } = req.params;
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const contract = await loadContract(conn, contract_id);
    if (!contract) { await conn.query('ROLLBACK'); return res.status(404).json({ error: 'Contrato no encontrado' }); }

    const totalValue = Number(contract.total_value_usd || 0);
    if (totalValue <= 0) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: 'El contrato necesita total_value_usd > 0 para sincronizar revenue' });
    }

    // Load all baselines (active and historical) to find status reports
    const { rows: baselines } = await conn.query(
      'SELECT id, bac_cost_usd FROM project_baselines WHERE contract_id=$1 ORDER BY version',
      [contract_id],
    );
    if (!baselines.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'No hay baselines para este contrato' });
    }

    // For each status report, compute the global progress at that point
    // and assign it to the month of the cutoff_date
    const synced = [];
    for (const bl of baselines) {
      const bacCost = Number(bl.bac_cost_usd);
      if (bacCost <= 0) continue;

      const { rows: reports } = await conn.query(
        `SELECT psr.id, psr.cutoff_date, psr.computed_kpis
           FROM project_status_reports psr
          WHERE psr.baseline_id = $1
          ORDER BY psr.cutoff_date ASC`,
        [bl.id],
      );

      for (const rpt of reports) {
        const kpis = rpt.computed_kpis || {};
        // EV from computed_kpis is already stored
        const evValue = Number(kpis.ev || 0);
        const globalPct = evm.round4(evValue / bacCost);
        const yyyymm = String(rpt.cutoff_date).replace(/-/g, '').slice(0, 6);

        await syncRevenueFromProgress(conn, contract_id, yyyymm, globalPct, totalValue, req.user.id);
        synced.push({ cutoff_date: rpt.cutoff_date, yyyymm, real_pct: globalPct });
      }
    }

    await conn.query('COMMIT');
    res.json({ synced_count: synced.length, details: synced });
  } catch (err) {
    await safeRollback(conn);
    serverError(res, 'POST /projects/:contract_id/backfill-revenue', err);
  } finally { conn.release(); }
});

// ──────────── POST /backfill-bac-cost ────────────
// Admin-only: recalculate bac_cost_usd on active baseline from quotation lines.

router.post('/:contract_id/backfill-bac-cost', requireRole('superadmin', 'admin'), async (req, res) => {
  const { contract_id } = req.params;
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const contract = await loadContract(conn, contract_id);
    if (!contract) { await conn.query('ROLLBACK'); return res.status(404).json({ error: 'Contrato no encontrado' }); }
    if (!contract.winning_quotation_id) {
      await conn.query('ROLLBACK');
      return res.status(422).json({ error: 'Sin cotización ganadora' });
    }

    const quotCost = await computeQuotationCost(conn, contract.winning_quotation_id);
    if (quotCost.costProtected <= 0) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: 'Costo protegido derivado de la cotización es 0. Verifica cost_hour en las líneas y la matriz de allocations.' });
    }

    const { rows: [baseline] } = await conn.query(
      'SELECT id, bac_cost_usd FROM project_baselines WHERE contract_id=$1 AND is_active=true FOR UPDATE',
      [contract_id],
    );
    if (!baseline) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'No hay baseline activo' });
    }

    const oldBac = Number(baseline.bac_cost_usd);
    await conn.query(
      'UPDATE project_baselines SET bac_cost_usd=$1 WHERE id=$2',
      [quotCost.costProtected, baseline.id],
    );

    // Recalculate planned_cost_usd on WBS packages (proportional to weight)
    const { rows: wbs } = await conn.query(
      "SELECT id, weight_pct FROM wbs_packages WHERE baseline_id=$1 AND kind='phase'",
      [baseline.id],
    );
    for (const pkg of wbs) {
      const newCost = evm.round2(Number(pkg.weight_pct) * quotCost.costProtected);
      await conn.query('UPDATE wbs_packages SET planned_cost_usd=$1 WHERE id=$2', [newCost, pkg.id]);
    }

    await conn.query('COMMIT');
    res.json({
      baseline_id: baseline.id,
      old_bac_cost: oldBac,
      new_bac_cost: quotCost.costProtected,
      total_cost_raw: quotCost.totalCost,
      wbs_updated: wbs.length,
    });
  } catch (err) {
    await safeRollback(conn);
    serverError(res, 'POST /projects/:contract_id/backfill-bac-cost', err);
  } finally { conn.release(); }
});

module.exports = router;
