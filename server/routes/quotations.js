const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { emitEvent } = require('../utils/events');
const { recalcStaffAugLines, detectLineDrift } = require('../utils/calc');

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
    const where = req.user.role === 'preventa' ? 'WHERE q.created_by=$1' : '';
    const params = req.user.role === 'preventa' ? [req.user.id] : [];
    const { rows } = await pool.query(`
      SELECT q.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM quotation_lines WHERE quotation_id=q.id) as line_count
      FROM quotations q JOIN users u ON q.created_by=u.id ${where}
      ORDER BY q.updated_at DESC
    `, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
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
    if (phases) {
      await client.query('DELETE FROM quotation_phases WHERE quotation_id=$1', [req.params.id]);
      for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        await client.query('INSERT INTO quotation_phases (quotation_id, sort_order, name, weeks, description) VALUES ($1,$2,$3,$4,$5)',
          [quot.id, i, p.name, p.weeks, p.description]);
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
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
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
