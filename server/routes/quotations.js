const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');

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
    await client.query('BEGIN');
    const { type, project_name, client_name, commercial_name, preventa_name, discount_pct, notes, lines, phases, epics, milestones, metadata } = req.body;
    const { rows: [quot] } = await client.query(
      `INSERT INTO quotations (type, project_name, client_name, commercial_name, preventa_name, discount_pct, notes, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [type, project_name, client_name, commercial_name, preventa_name, discount_pct || 0, notes, JSON.stringify(metadata || {}), req.user.id]
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
    await client.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, 'create_quotation', 'quotation', $2, $3)`,
      [req.user.id, quot.id, JSON.stringify({ type, project_name, client_name })]);
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
    const { project_name, client_name, commercial_name, preventa_name, status, discount_pct, notes, lines, phases, milestones, metadata } = req.body;
    const { rows: [quot] } = await client.query(
      `UPDATE quotations SET project_name=COALESCE($1,project_name), client_name=COALESCE($2,client_name),
       commercial_name=COALESCE($3,commercial_name), preventa_name=COALESCE($4,preventa_name),
       status=COALESCE($5,status), discount_pct=COALESCE($6,discount_pct), notes=COALESCE($7,notes),
       metadata=COALESCE($8,metadata), updated_at=NOW() WHERE id=$9 RETURNING *`,
      [project_name, client_name, commercial_name, preventa_name, status, discount_pct, notes, metadata ? JSON.stringify(metadata) : null, req.params.id]
    );
    if (!quot) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No encontrada' }); }
    if (lines) {
      await client.query('DELETE FROM quotation_lines WHERE quotation_id=$1', [req.params.id]);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
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
    await client.query('COMMIT');
    res.json(quot);
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
    res.status(201).json(newq);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM quotations WHERE id=$1', [req.params.id]);
    res.json({ message: 'Eliminada' });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
