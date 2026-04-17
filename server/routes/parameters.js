const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM parameters ORDER BY category, sort_order');
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(row);
    }
    res.json(grouped);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { value, label, note } = req.body;
    const { rows } = await pool.query(
      'UPDATE parameters SET value=COALESCE($1,value), label=COALESCE($2,label), note=COALESCE($3,note), updated_at=NOW(), updated_by=$4 WHERE id=$5 RETURNING *',
      [value, label, note, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Parámetro no encontrado' });
    await pool.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, 'update_parameter', 'parameter', $2, $3)`,
      [req.user.id, rows[0].id, JSON.stringify({ category: rows[0].category, key: rows[0].key, value })]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
