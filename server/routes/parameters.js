/**
 * Parameters — pricing / modality / margins catalog.
 *
 * V2 addition (EP-2): every PUT now emits a structured `parameter.updated`
 * event with before/after/changed_fields so parameter history shows up
 * alongside every other entity's audit trail. The legacy audit_log row
 * is kept for backwards compatibility until V1 readers are gone.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent, buildUpdatePayload } = require('../utils/events');
const { serverError } = require('../utils/http');

const TRACKED_FIELDS = ['value', 'label', 'note'];

router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM parameters ORDER BY category, sort_order');
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(row);
    }
    res.json(grouped);
  } catch (err) { serverError(res, 'GET /parameters', err); }
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { value, label, note } = req.body;

    // EP-2: read BEFORE so the event carries before/after diff.
    const { rows: beforeRows } = await pool.query(`SELECT * FROM parameters WHERE id=$1`, [req.params.id]);
    if (!beforeRows.length) return res.status(404).json({ error: 'Parámetro no encontrado' });
    const before = beforeRows[0];

    const { rows } = await pool.query(
      'UPDATE parameters SET value=COALESCE($1,value), label=COALESCE($2,label), note=COALESCE($3,note), updated_at=NOW(), updated_by=$4 WHERE id=$5 RETURNING *',
      [value, label, note, req.user.id, req.params.id]
    );
    const after = rows[0];

    // Legacy audit_log (unchanged — V1 readers rely on it).
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, 'update_parameter', 'parameter', $2, $3)`,
      [req.user.id, after.id, JSON.stringify({ category: after.category, key: after.key, value })]
    );

    // V2 structured event. Non-fatal if emitEvent can't insert.
    await emitEvent(pool, {
      event_type: 'parameter.updated',
      entity_type: 'parameter',
      entity_id: String(after.id),
      actor_user_id: req.user.id,
      payload: {
        ...buildUpdatePayload(before, after, TRACKED_FIELDS),
        category: after.category,
        key: after.key,
      },
      req,
    });

    res.json(after);
  } catch (err) { serverError(res, 'PUT /parameters/:id', err); }
});

module.exports = router;
