const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { emitEvent } = require('../utils/events');
const { parsePagination } = require('../utils/sanitize');
const { parseSort } = require('../utils/sort');
const { serverError } = require('../utils/http');

const SORTABLE = {
  project_name:    'q.project_name',
  client_name:     'q.client_name',
  type:            'q.type',
  status:          'q.status',
  created_at:      'q.created_at',
  updated_at:      'q.updated_at',
  sent_at:         'q.sent_at',
  created_by_name: 'u.name',
};
const { recalcStaffAugLines, detectLineDrift } = require('../utils/calc');
const quotationExport = require('../utils/quotation_export');

/**
 * Load the full parameter set grouped by category, in the same shape the
 * client-side calc expects. Used by the PUT handler to recompute outputs
 * server-side (EX-2 — server is source of truth for calculated fields).
 */
async function loadCanonicalParams(conn) {
  const { rows } = await conn.query('SELECT category, key, value FROM parameters');
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push({ key: r.key, value: r.value });
  }
  return grouped;
}

router.use(auth);

router.get('/', async (req, res) => {
  try {
    // Pagination is OPT-IN to preserve backwards compat with the V1
    // Dashboard which expects a flat array from /api/quotations. When a
    // caller passes ?page, ?limit or ?paginate=true we return the
    // paginated envelope; otherwise we return an array (capped at 500
    // for safety — still protects against runaway growth).
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 200 });
    const paginated = req.query.page !== undefined
      || req.query.limit !== undefined
      || req.query.paginate === 'true';

    const wheres = [];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

    // Preventa (role==='member' + function='preventa' tras normalización del
    // middleware) sólo ve sus propios drafts. El check antiguo basado en
    // `req.user.role === 'preventa'` queda como fallback histórico para
    // tokens legacy todavía no rotados.
    if (req.user.role === 'preventa' || req.user.function === 'preventa') {
      wheres.push(`q.created_by = ${add(req.user.id)}`);
    }
    if (req.query.client_id)      wheres.push(`q.client_id = ${add(req.query.client_id)}`);
    if (req.query.opportunity_id) wheres.push(`q.opportunity_id = ${add(req.query.opportunity_id)}`);
    if (req.query.status)         wheres.push(`q.status = ${add(req.query.status)}`);

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const sort = parseSort(req.query, SORTABLE, {
      defaultField: 'updated_at', defaultDir: 'desc', tieBreaker: 'q.id ASC',
    });
    const baseSql = `
      SELECT q.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM quotation_lines WHERE quotation_id=q.id) as line_count
      FROM quotations q JOIN users u ON q.created_by=u.id
      ${where}
      ORDER BY ${sort.orderBy}`;

    if (!paginated) {
      // Legacy shape: flat array, no pagination metadata. Cap a 500 aunque
      // el caller no pida paginación.
      const { rows } = await pool.query(`${baseSql} LIMIT 500`, filterParams);
      return res.json(rows);
    }

    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM quotations q ${where}`, filterParams),
      pool.query(`${baseSql} LIMIT $${limitIdx} OFFSET $${offsetIdx}`, [...filterParams, limit, offset]),
    ]);
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total: countRes.rows[0].total, pages: Math.ceil(countRes.rows[0].total / limit) || 1 },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /quotations failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows: [quot] } = await pool.query('SELECT * FROM quotations WHERE id=$1', [req.params.id]);
    if (!quot) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (req.user.role === 'preventa' && quot.created_by !== req.user.id)
      return res.status(403).json({ error: 'No tiene acceso a esta cotización' });
    const { rows: lines } = await pool.query('SELECT * FROM quotation_lines WHERE quotation_id=$1 ORDER BY sort_order', [req.params.id]);
    const { rows: phases } = await pool.query('SELECT * FROM quotation_phases WHERE quotation_id=$1 ORDER BY sort_order', [req.params.id]);
    const { rows: epics } = await pool.query('SELECT * FROM quotation_epics WHERE quotation_id=$1 ORDER BY sort_order', [req.params.id]);
    const { rows: milestones } = await pool.query('SELECT * FROM quotation_milestones WHERE quotation_id=$1 ORDER BY sort_order', [req.params.id]);
    res.json({ ...quot, lines, phases, epics, milestones });
  } catch (err) { serverError(res, 'GET /quotations/:id', err); }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      type, project_name, client_id, opportunity_id,
      client_name, commercial_name, preventa_name,
      discount_pct, notes, lines, phases, epics, milestones, metadata,
    } = req.body;

    // V2 (EX-1): cotizaciones EXIGEN cliente + oportunidad.
    if (!client_id) return res.status(400).json({ error: 'client_id es requerido' });
    if (!opportunity_id) return res.status(400).json({ error: 'opportunity_id es requerido' });

    // Validar que ambas entidades existan, no estén soft-deleted, y que la
    // oportunidad pertenezca al cliente indicado.
    const { rows: cRows } = await client.query(
      `SELECT id, name FROM clients WHERE id=$1 AND deleted_at IS NULL`,
      [client_id]
    );
    if (!cRows.length) return res.status(400).json({ error: 'Cliente no existe o está eliminado' });

    const { rows: oRows } = await client.query(
      `SELECT id, name, client_id FROM opportunities WHERE id=$1 AND deleted_at IS NULL`,
      [opportunity_id]
    );
    if (!oRows.length) return res.status(400).json({ error: 'Oportunidad no existe o está eliminada' });
    if (oRows[0].client_id !== client_id) {
      return res.status(409).json({
        error: 'La oportunidad no pertenece al cliente indicado',
        opportunity_client_id: oRows[0].client_id,
      });
    }

    await client.query('BEGIN');
    const { rows: [quot] } = await client.query(
      `INSERT INTO quotations (type, project_name, client_id, opportunity_id, client_name, commercial_name, preventa_name, discount_pct, notes, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [type, project_name, client_id, opportunity_id, client_name || cRows[0].name, commercial_name, preventa_name, discount_pct || 0, notes, JSON.stringify(metadata || {}), req.user.id]
    );
    if (lines?.length) {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await client.query(
          `INSERT INTO quotation_lines (quotation_id, sort_order, specialty, role_title, level, country, bilingual, tools, stack, modality, quantity, duration_months, hours_per_week, phase, cost_hour, rate_hour, rate_month, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [quot.id, i, l.specialty, l.role_title, l.level, l.country, l.bilingual, l.tools, l.stack, l.modality, l.quantity, l.duration_months, l.hours_per_week, l.phase, l.cost_hour, l.rate_hour, l.rate_month, l.total]
        );
      }
    }
    if (phases?.length) {
      for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        await client.query('INSERT INTO quotation_phases (quotation_id, sort_order, name, weeks, description) VALUES ($1,$2,$3,$4,$5)',
          [quot.id, i, p.name, p.weeks, p.description]);
      }
    }
    if (milestones?.length) {
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        await client.query('INSERT INTO quotation_milestones (quotation_id, sort_order, name, phase, percentage, amount, expected_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [quot.id, i, m.name, m.phase, m.percentage, m.amount, m.expected_date]);
      }
    }
    if (epics?.length) {
      for (let i = 0; i < epics.length; i++) {
        const e = epics[i];
        await client.query(
          'INSERT INTO quotation_epics (quotation_id, sort_order, name, priority, hours_by_profile, total_hours) VALUES ($1,$2,$3,$4,$5,$6)',
          [quot.id, i, e.name, e.priority || 'Media', JSON.stringify(e.hours_by_profile || {}), e.total_hours || 0]
        );
      }
    }
    await client.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, 'create_quotation', 'quotation', $2, $3)`,
      [req.user.id, quot.id, JSON.stringify({ type, project_name, client_name })]);
    // V2 structured event (non-fatal if it fails)
    await emitEvent(client, {
      event_type: 'quotation.created',
      entity_type: 'quotation',
      entity_id: quot.id,
      actor_user_id: req.user.id,
      payload: { type, project_name, client_id, opportunity_id, status: quot.status },
      req,
    });
    await client.query('COMMIT');
    res.status(201).json(quot);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ error: 'Error interno' });
  } finally { client.release(); }
});

router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { project_name, client_name, commercial_name, preventa_name, status, discount_pct, notes, lines, phases, epics, milestones, metadata } = req.body;

    // EX-3: snapshot parameters when the quotation first leaves `draft` for
    // `sent` or `approved`. Load the current row first so we can decide
    // whether to capture BEFORE the UPDATE.
    const { rows: [before] } = await client.query(
      `SELECT id, type, status, parameters_snapshot FROM quotations WHERE id=$1`,
      [req.params.id]
    );
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No encontrada' }); }

    const effectiveStatus = status != null ? status : before.status;
    const isFirstLeavingDraft = before.status === 'draft'
      && (effectiveStatus === 'sent' || effectiveStatus === 'approved')
      && !before.parameters_snapshot;

    // EX-2 + EX-3: pick the calc params for this PUT.
    //   - If a snapshot already exists → use it (frozen post-sent totals).
    //   - If we're capturing one right now → load live params and use those.
    //   - Else → use live params (quotation is still in draft).
    let paramsForCalc = null;
    let capturedSnapshot = null;
    if (before.parameters_snapshot) {
      paramsForCalc = before.parameters_snapshot;
    } else if (isFirstLeavingDraft || (lines && before.type === 'staff_aug')) {
      paramsForCalc = await loadCanonicalParams(client);
      if (isFirstLeavingDraft) capturedSnapshot = paramsForCalc;
    }

    const { rows: [quot] } = await client.query(
      `UPDATE quotations SET project_name=COALESCE($1,project_name), client_name=COALESCE($2,client_name),
       commercial_name=COALESCE($3,commercial_name), preventa_name=COALESCE($4,preventa_name),
       status=COALESCE($5,status), discount_pct=COALESCE($6,discount_pct), notes=COALESCE($7,notes),
       metadata=COALESCE($8,metadata),
       parameters_snapshot=COALESCE($9,parameters_snapshot),
       sent_at=CASE WHEN $10::boolean AND sent_at IS NULL THEN NOW() ELSE sent_at END,
       updated_at=NOW() WHERE id=$11 RETURNING *`,
      [
        project_name, client_name, commercial_name, preventa_name,
        status, discount_pct, notes,
        metadata ? JSON.stringify(metadata) : null,
        capturedSnapshot ? JSON.stringify(capturedSnapshot) : null,
        effectiveStatus === 'sent',
        req.params.id,
      ]
    );
    if (!quot) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No encontrada' }); }

    if (capturedSnapshot) {
      await emitEvent(client, {
        event_type: 'quotation.snapshot_captured',
        entity_type: 'quotation',
        entity_id: quot.id,
        actor_user_id: req.user.id,
        payload: { trigger_status: effectiveStatus, previous_status: before.status },
        req,
      });
    }

    // EX-2: for staff_aug lines, the server is the source of truth for
    // calculated outputs (cost_hour / rate_hour / rate_month / total).
    // The client's submitted outputs are used ONLY to detect drift and
    // emit an event — the persisted values come from recalcStaffAugLines.
    let driftReport = null;
    let canonicalLines = lines;
    if (lines && quot.type === 'staff_aug' && paramsForCalc) {
      canonicalLines = recalcStaffAugLines(lines, paramsForCalc);
      driftReport = detectLineDrift(lines, canonicalLines, 0.01);
      if (driftReport.drifted) {
        await emitEvent(client, {
          event_type: 'quotation.calc_drift',
          entity_type: 'quotation',
          entity_id: quot.id,
          actor_user_id: req.user.id,
          payload: { diffs: driftReport.diffs.slice(0, 20), total_drifted_fields: driftReport.diffs.length, used_snapshot: !!before.parameters_snapshot },
          req,
        });
      }
    }

    if (canonicalLines) {
      await client.query('DELETE FROM quotation_lines WHERE quotation_id=$1', [req.params.id]);
      for (let i = 0; i < canonicalLines.length; i++) {
        const l = canonicalLines[i];
        await client.query(
          `INSERT INTO quotation_lines (quotation_id, sort_order, specialty, role_title, level, country, bilingual, tools, stack, modality, quantity, duration_months, hours_per_week, phase, cost_hour, rate_hour, rate_month, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [quot.id, i, l.specialty, l.role_title, l.level, l.country, l.bilingual, l.tools, l.stack, l.modality, l.quantity, l.duration_months, l.hours_per_week, l.phase, l.cost_hour, l.rate_hour, l.rate_month, l.total]
        );
      }
    }
    // Collected phase IDs indexed by sort_order. Populated when `phases`
    // is included in the PUT body so EX-4 can translate the legacy
    // allocation matrix (which keys by phase index) into the relational
    // quotation_allocations table (which keys by phase UUID).
    const phaseIdByIdx = [];
    if (phases) {
      await client.query('DELETE FROM quotation_phases WHERE quotation_id=$1', [req.params.id]);
      for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        const { rows: [inserted] } = await client.query(
          'INSERT INTO quotation_phases (quotation_id, sort_order, name, weeks, description) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [quot.id, i, p.name, p.weeks, p.description]
        );
        phaseIdByIdx[i] = inserted.id;
      }
    }

    // EX-4: dual-write metadata.allocation to the quotation_allocations
    // table so future reporting queries can aggregate without scanning
    // JSONB. GET still returns the legacy JSONB shape (backwards
    // compatible); a subsequent change can flip GET over once all
    // consumers are on the relational source.
    //
    // If phases weren't re-uploaded in this PUT but the allocation was,
    // we fall back to fetching the existing phase IDs from the DB so the
    // mapping still works.
    const allocationFromMeta = metadata?.allocation;
    if (allocationFromMeta && typeof allocationFromMeta === 'object') {
      let idxMap = phaseIdByIdx;
      if (idxMap.length === 0) {
        const { rows: existingPhases } = await client.query(
          'SELECT id, sort_order FROM quotation_phases WHERE quotation_id=$1 ORDER BY sort_order',
          [quot.id]
        );
        idxMap = existingPhases.map((r) => r.id);
      }
      // CASCADE on phase DELETE already cleared old allocation rows when
      // phases were re-inserted above. When phases weren't re-uploaded
      // we need to clear explicitly so this write is authoritative.
      if (phaseIdByIdx.length === 0) {
        await client.query('DELETE FROM quotation_allocations WHERE quotation_id=$1', [req.params.id]);
      }
      for (const [lineIdxStr, phaseMap] of Object.entries(allocationFromMeta)) {
        const lineIdx = Number(lineIdxStr);
        if (!Number.isFinite(lineIdx) || !phaseMap || typeof phaseMap !== 'object') continue;
        for (const [phaseIdxStr, hoursRaw] of Object.entries(phaseMap)) {
          const phaseIdx = Number(phaseIdxStr);
          const hours = Number(hoursRaw);
          if (!Number.isFinite(phaseIdx) || !Number.isFinite(hours) || hours <= 0) continue;
          const phaseId = idxMap[phaseIdx];
          if (!phaseId) continue; // orphan — skip
          await client.query(
            `INSERT INTO quotation_allocations (quotation_id, line_sort_order, phase_id, weekly_hours)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (quotation_id, line_sort_order, phase_id) DO UPDATE SET weekly_hours = EXCLUDED.weekly_hours`,
            [quot.id, lineIdx, phaseId, hours]
          );
        }
      }
    }

    if (milestones) {
      await client.query('DELETE FROM quotation_milestones WHERE quotation_id=$1', [req.params.id]);
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        await client.query('INSERT INTO quotation_milestones (quotation_id, sort_order, name, phase, percentage, amount, expected_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [quot.id, i, m.name, m.phase, m.percentage, m.amount, m.expected_date]);
      }
    }
    if (epics) {
      await client.query('DELETE FROM quotation_epics WHERE quotation_id=$1', [req.params.id]);
      for (let i = 0; i < epics.length; i++) {
        const e = epics[i];
        await client.query(
          'INSERT INTO quotation_epics (quotation_id, sort_order, name, priority, hours_by_profile, total_hours) VALUES ($1,$2,$3,$4,$5,$6)',
          [quot.id, i, e.name, e.priority || 'Media', JSON.stringify(e.hours_by_profile || {}), e.total_hours || 0]
        );
      }
    }
    await emitEvent(client, {
      event_type: 'quotation.updated',
      entity_type: 'quotation',
      entity_id: quot.id,
      actor_user_id: req.user.id,
      payload: { status: quot.status, project_name: quot.project_name },
      req,
    });
    await client.query('COMMIT');
    // EX-2: the response carries the canonical values the server persisted
    // so the client can reconcile without a round-trip GET. `drift` is
    // populated only for staff_aug where recalc happened.
    res.json({
      ...quot,
      lines: canonicalLines !== undefined ? canonicalLines : undefined,
      drift: driftReport,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ error: 'Error interno' });
  } finally { client.release(); }
});

router.post('/:id/duplicate', async (req, res) => {
  try {
    const { rows: [orig] } = await pool.query('SELECT * FROM quotations WHERE id=$1', [req.params.id]);
    if (!orig) return res.status(404).json({ error: 'No encontrada' });
    const { rows: [newq] } = await pool.query(
      `INSERT INTO quotations (type, parent_id, version, project_name, client_name, commercial_name, preventa_name, discount_pct, notes, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [orig.type, orig.id, orig.version + 1, orig.project_name + ' (copia)', orig.client_name, orig.commercial_name, orig.preventa_name, orig.discount_pct, orig.notes, orig.metadata, req.user.id]
    );
    await pool.query(`INSERT INTO quotation_lines (quotation_id, sort_order, specialty, role_title, level, country, bilingual, tools, stack, modality, quantity, duration_months, hours_per_week, phase, cost_hour, rate_hour, rate_month, total) SELECT $1, sort_order, specialty, role_title, level, country, bilingual, tools, stack, modality, quantity, duration_months, hours_per_week, phase, cost_hour, rate_hour, rate_month, total FROM quotation_lines WHERE quotation_id=$2`, [newq.id, req.params.id]);
    await pool.query(`INSERT INTO quotation_phases (quotation_id, sort_order, name, weeks, description) SELECT $1, sort_order, name, weeks, description FROM quotation_phases WHERE quotation_id=$2`, [newq.id, req.params.id]);
    await pool.query(`INSERT INTO quotation_milestones (quotation_id, sort_order, name, phase, percentage, amount, expected_date) SELECT $1, sort_order, name, phase, percentage, amount, expected_date FROM quotation_milestones WHERE quotation_id=$2`, [newq.id, req.params.id]);
    await pool.query(`INSERT INTO quotation_epics (quotation_id, sort_order, name, priority, hours_by_profile, total_hours) SELECT $1, sort_order, name, priority, hours_by_profile, total_hours FROM quotation_epics WHERE quotation_id=$2`, [newq.id, req.params.id]);
    res.status(201).json(newq);
  } catch (err) { serverError(res, 'POST /quotations/:id/duplicate', err); }
});

/**
 * Export a quotation as xlsx / pdf. Soporta ambos tipos:
 *   - fixed_scope  → spec_editor_proyectos.docx Spec 2 (Abril 2026)
 *   - staff_aug    → spec_capacity_editor.docx  Spec 4 (Abril 2026)
 *
 *   POST /api/quotations/:id/export?format=xlsx|pdf
 *
 * Reglas comunes:
 *  - Pueden exportar: el creador, roles admin/superadmin, o usuarios cuya
 *    `function` sea comercial / preventa / admin (son justamente quienes
 *    envían la propuesta al cliente). Cualquier otro perfil (viewer,
 *    fte_tecnico, capacity, delivery, etc.) sólo puede exportar las suyas.
 *  - Ambos formatos requieren ≥1 recurso / perfil.
 *  - El XLSX incluye desglose interno (costo/hora, buffer, margen) para
 *    fixed_scope (ops / finanzas). Para staff_aug solo muestra la
 *    composición del equipo y tarifa cliente-facing — NUNCA cost empresa.
 *  - El PDF es siempre propuesta comercial cliente-facing (sin costos
 *    internos). Para staff_aug omite stack/modalidad/herramientas.
 *
 * Validaciones específicas:
 *  - fixed_scope: además requiere ≥1 fase con semanas > 0.
 *  - staff_aug: además requiere que las líneas tengan tarifa mensual > 0
 *    (es decir, que calc haya podido resolver nivel/país/stack).
 */
router.post('/:id/export', async (req, res) => {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    if (format !== 'xlsx' && format !== 'pdf') {
      return res.status(400).json({ error: 'format inválido — use xlsx o pdf' });
    }

    const { rows: [quot] } = await pool.query('SELECT * FROM quotations WHERE id=$1', [req.params.id]);
    if (!quot) return res.status(404).json({ error: 'Cotización no encontrada' });

    // Permisos: creador, role admin/superadmin, o function comercial/preventa/admin.
    // El JWT puede no traer `function` si fue emitido antes de incluirlo en el
    // payload de login — en ese caso lo resolvemos en BD para no obligar a
    // todos los usuarios activos a re-loguearse tras el deploy del hotfix.
    const isOwner = quot.created_by === req.user.id;
    const isAdminRole = req.user.role === 'admin' || req.user.role === 'superadmin';
    let canExport = isOwner || isAdminRole;
    if (!canExport) {
      let userFunction = req.user.function || null;
      if (!userFunction) {
        const { rows: ur } = await pool.query('SELECT function FROM users WHERE id=$1', [req.user.id]);
        userFunction = ur[0]?.function || null;
      }
      canExport = userFunction === 'comercial' || userFunction === 'preventa' || userFunction === 'admin';
    }
    if (!canExport) {
      return res.status(403).json({ error: 'Sin permiso para exportar esta cotización' });
    }

    if (quot.type !== 'fixed_scope' && quot.type !== 'staff_aug') {
      return res.status(400).json({ error: 'Tipo de cotización no soportado para exportar' });
    }

    const [linesR, phasesR, epicsR, milestonesR] = await Promise.all([
      pool.query('SELECT * FROM quotation_lines WHERE quotation_id=$1 ORDER BY sort_order', [req.params.id]),
      pool.query('SELECT * FROM quotation_phases WHERE quotation_id=$1 ORDER BY sort_order', [req.params.id]),
      pool.query('SELECT * FROM quotation_epics WHERE quotation_id=$1 ORDER BY sort_order', [req.params.id]),
      pool.query('SELECT * FROM quotation_milestones WHERE quotation_id=$1 ORDER BY sort_order', [req.params.id]),
    ]);

    let payload = {
      ...quot,
      lines: linesR.rows,
      phases: phasesR.rows,
      epics: epicsR.rows,
      milestones: milestonesR.rows,
    };

    // SPEC-FIX-01 (Opción A): si el cliente manda `override_state` en el
    // body, lo usamos sobre la versión persistida — esto permite exportar
    // la versión EN PANTALLA aunque haya cambios sin guardar (cuando el
    // autosave está deshabilitado o pendiente de flush). Sólo confiamos
    // en campos del editor; no permitimos override de id, type, ownership.
    if (req.body && req.body.override_state && typeof req.body.override_state === 'object') {
      const ov = req.body.override_state;
      payload = {
        ...payload,
        // Datos editables del header
        project_name: ov.project_name ?? payload.project_name,
        client_name: ov.client_name ?? payload.client_name,
        commercial_name: ov.commercial_name ?? payload.commercial_name,
        preventa_name: ov.preventa_name ?? payload.preventa_name,
        notes: ov.notes ?? payload.notes,
        discount_pct: ov.discount_pct ?? payload.discount_pct,
        metadata: { ...(payload.metadata || {}), ...(ov.metadata || {}) },
        // Colecciones — el cliente las recalcula con calc.js antes de mandarlas.
        lines: Array.isArray(ov.lines) ? ov.lines : payload.lines,
        phases: Array.isArray(ov.phases) ? ov.phases : payload.phases,
        epics: Array.isArray(ov.epics) ? ov.epics : payload.epics,
        milestones: Array.isArray(ov.milestones) ? ov.milestones : payload.milestones,
      };
    }

    if (quot.type === 'fixed_scope') {
      if (!payload.lines.length) return res.status(400).json({ error: 'La cotización necesita al menos 1 perfil' });
      if (!payload.phases.some((p) => Number(p.weeks || 0) > 0)) {
        return res.status(400).json({ error: 'La cotización necesita al menos 1 fase con semanas > 0' });
      }
    } else {
      // staff_aug: solo exige ≥1 recurso con tarifa > 0
      if (!payload.lines.length) {
        return res.status(400).json({ error: 'La cotización necesita al menos 1 recurso' });
      }
      if (!payload.lines.some((l) => Number(l.rate_month || 0) > 0)) {
        return res.status(400).json({ error: 'La cotización necesita al menos 1 recurso con tarifa > 0' });
      }
    }

    // Snapshot has priority over live params (freeze post-sent totals).
    const params = quot.parameters_snapshot || (await loadCanonicalParams(pool));

    let buffer; let contentType;
    try {
      if (format === 'xlsx') {
        buffer = await quotationExport.generateXlsx(payload, params);
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        buffer = await quotationExport.generatePdf(payload, params);
        contentType = 'application/pdf';
      }
    } catch (err) {
      if (/Cannot find module/.test(err.message)) {
        return res.status(503).json({
          error: `Dependencia para formato ${format} no instalada en el servidor`,
        });
      }
      throw err;
    }

    const filename = quotationExport.buildFilename(payload, format);

    // Log export for audit (non-fatal)
    try {
      await pool.query(
        `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'export_quotation', 'quotation', $2, $3)`,
        [req.user.id, quot.id, JSON.stringify({ format, filename })]
      );
    } catch (e) { /* best-effort */ }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  } catch (err) {
    console.error('export error:', err);
    res.status(500).json({ error: 'Error al generar el archivo' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM quotations WHERE id=$1', [req.params.id]);
    await emitEvent(pool, {
      event_type: 'quotation.deleted',
      entity_type: 'quotation',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: {},
      req,
    });
    res.json({ message: 'Eliminada' });
  } catch (err) { serverError(res, 'DELETE /quotations/:id', err); }
});

module.exports = router;
