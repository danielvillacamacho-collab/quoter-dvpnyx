/**
 * Country Holidays — SPEC-II-00.
 *
 * Catálogo de festivos por país. Lectura libre (cualquier autenticado);
 * mutación admin-only. La carga inicial se hace via seed embebido en
 * migrate.js (CO/MX/GT/EC/PA/PE/US, 2026 + 2027). Esta API permite
 * correcciones manuales y carga futura.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent } = require('../utils/events');
const { isValidUUID, isValidISODate } = require('../utils/sanitize');
const { serverError } = require('../utils/http');

router.use(auth);

const VALID_TYPES = ['national', 'regional', 'optional', 'company'];

/* -------- LIST (filtros) -------- */
router.get('/', async (req, res) => {
  try {
    const wheres = [];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };

    if (req.query.country) wheres.push(`h.country_id = ${add(String(req.query.country).toUpperCase())}`);
    if (req.query.year) {
      const y = parseInt(req.query.year, 10);
      if (Number.isFinite(y)) wheres.push(`h.year = ${add(y)}`);
    }
    if (req.query.from) wheres.push(`h.holiday_date >= ${add(req.query.from)}::date`);
    if (req.query.to)   wheres.push(`h.holiday_date <= ${add(req.query.to)}::date`);

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT h.id, h.country_id, h.holiday_date, h.label, h.holiday_type,
              h.year, h.notes, h.created_at,
              c.label_es AS country_label
         FROM country_holidays h
         LEFT JOIN countries c ON c.id = h.country_id
         ${where}
         ORDER BY h.holiday_date ASC`,
      params
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /holidays', err); }
});

/* -------- COUNTRIES catalog -------- */
router.get('/_meta/countries', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label_es, label_en, standard_workday_hours, standard_workdays_per_week
         FROM countries WHERE is_active = true ORDER BY label_es`
    );
    res.json({ data: rows });
  } catch (err) { serverError(res, 'GET /holidays/_meta/countries', err); }
});

/* -------- CREATE (admin) -------- */
router.post('/', adminOnly, async (req, res) => {
  const body = req.body || {};
  const country_id = String(body.country_id || '').toUpperCase();
  const { holiday_date, label, holiday_type } = body;

  if (!country_id || country_id.length !== 2) {
    return res.status(400).json({ error: 'country_id inválido (ISO-2)' });
  }
  if (!isValidISODate(holiday_date)) {
    return res.status(400).json({ error: 'holiday_date inválido (YYYY-MM-DD)' });
  }
  if (!label || String(label).trim().length < 3) {
    return res.status(400).json({ error: 'label requerido (≥3 chars)' });
  }
  const type = holiday_type || 'national';
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `holiday_type inválido (válidos: ${VALID_TYPES.join(',')})` });
  }
  const year = parseInt(holiday_date.slice(0, 4), 10);

  try {
    const { rows } = await pool.query(
      `INSERT INTO country_holidays (country_id, holiday_date, label, holiday_type, year, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [country_id, holiday_date, String(label).trim(), type, year, body.notes || null, req.user.id]
    );
    await emitEvent(pool, {
      event_type: 'holiday.created',
      entity_type: 'country_holiday',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { country_id, holiday_date, label, holiday_type: type },
      req,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un festivo en esa fecha para ese país' });
    }
    if (err && err.code === '23503') {
      return res.status(400).json({ error: 'country_id no existe en catálogo' });
    }
    serverError(res, 'POST /holidays', err);
  }
});

/* -------- UPDATE (admin) -------- */
router.put('/:id', adminOnly, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  const body = req.body || {};
  const sets = [];
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if ('label' in body) {
    if (!body.label || String(body.label).trim().length < 3) {
      return res.status(400).json({ error: 'label inválido' });
    }
    sets.push(`label = ${add(String(body.label).trim())}`);
  }
  if ('holiday_type' in body) {
    if (!VALID_TYPES.includes(body.holiday_type)) {
      return res.status(400).json({ error: 'holiday_type inválido' });
    }
    sets.push(`holiday_type = ${add(body.holiday_type)}`);
  }
  if ('holiday_date' in body) {
    if (!isValidISODate(body.holiday_date)) {
      return res.status(400).json({ error: 'holiday_date inválido' });
    }
    sets.push(`holiday_date = ${add(body.holiday_date)}`);
    sets.push(`year = ${add(parseInt(body.holiday_date.slice(0, 4), 10))}`);
  }
  if ('notes' in body) sets.push(`notes = ${add(body.notes)}`);

  if (sets.length === 0) return res.status(400).json({ error: 'Sin campos para actualizar' });
  sets.push(`updated_at = NOW()`);

  const idIdx = params.length + 1;
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE country_holidays SET ${sets.join(', ')} WHERE id = $${idIdx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    await emitEvent(pool, {
      event_type: 'holiday.updated',
      entity_type: 'country_holiday',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: body,
      req,
    });
    res.json(rows[0]);
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Conflicto: otro festivo ya existe con esa fecha+país' });
    }
    serverError(res, 'PUT /holidays/:id', err);
  }
});

/* -------- DELETE (admin) -------- */
router.delete('/:id', adminOnly, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM country_holidays WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'No encontrado' });
    await emitEvent(pool, {
      event_type: 'holiday.deleted',
      entity_type: 'country_holiday',
      entity_id: req.params.id,
      actor_user_id: req.user.id,
      payload: {},
      req,
    });
    res.json({ ok: true });
  } catch (err) { serverError(res, 'DELETE /holidays/:id', err); }
});

module.exports = router;
