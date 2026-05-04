/**
 * routes/help.js — Manual de usuario vivo
 *
 * GET  /api/help              → lista de artículos publicados (agrupados por categoría)
 * GET  /api/help/:slug        → artículo individual (published; admins ven todos)
 * POST /api/help              → crear artículo (admin)
 * PUT  /api/help/:slug        → editar artículo (admin)
 * DELETE /api/help/:slug      → soft-delete real (admin) — elimina fila
 *
 * Enforcement:
 *   El script scripts/check_docs_coverage.js escanea el código fuente en busca
 *   de comentarios `// @docs-required: <slug>` y verifica que el artículo exista
 *   y haya sido actualizado en los últimos 30 días. Si no → exit 1 en CI.
 */

const express = require('express');
const pool = require('../database/pool');
const { auth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/http');

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = ['general', 'crm', 'delivery', 'time', 'reportes', 'finanzas', 'plataforma'];

function validateArticle(body) {
  const errors = [];
  if (!body.slug || !/^[a-z0-9-]+$/.test(body.slug)) {
    errors.push('slug requerido (solo minúsculas, números y guiones)');
  }
  if (!body.title || body.title.trim().length < 3) {
    errors.push('title requerido (mínimo 3 caracteres)');
  }
  if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
    errors.push(`category debe ser uno de: ${VALID_CATEGORIES.join(', ')}`);
  }
  return errors;
}

// ─── GET /api/help — lista pública agrupada por categoría ───────────────────
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = ['superadmin', 'admin'].includes(req.user?.role);
    const publishedFilter = isAdmin ? '' : 'WHERE is_published = true';

    const { rows } = await pool.query(`
      SELECT
        ha.id, ha.slug, ha.category, ha.sort_order, ha.title, ha.body_md,
        ha.is_published, ha.created_at, ha.updated_at,
        ha.updated_by,
        u.first_name || ' ' || u.last_name AS updated_by_name
      FROM help_articles ha
      LEFT JOIN users u ON u.id = ha.updated_by
      ${publishedFilter}
      ORDER BY ha.category, ha.sort_order, ha.title
    `);

    // Agrupar por categoría para facilitar el render en el cliente
    const byCategory = {};
    for (const row of rows) {
      if (!byCategory[row.category]) byCategory[row.category] = [];
      byCategory[row.category].push(row);
    }

    res.json({ data: rows, byCategory });
  } catch (err) {
    serverError(res, 'GET /api/help', err);
  }
});

// ─── GET /api/help/:slug ─────────────────────────────────────────────────────
router.get('/:slug', auth, async (req, res) => {
  try {
    const isAdmin = ['superadmin', 'admin'].includes(req.user?.role);
    const { rows } = await pool.query(
      `SELECT
         ha.*,
         u.first_name || ' ' || u.last_name AS updated_by_name
       FROM help_articles ha
       LEFT JOIN users u ON u.id = ha.updated_by
       WHERE ha.slug = $1
         ${isAdmin ? '' : 'AND ha.is_published = true'}`,
      [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Artículo no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    serverError(res, 'GET /api/help/:slug', err);
  }
});

// ─── POST /api/help — crear artículo (admin) ─────────────────────────────────
router.post('/', auth, requireRole('superadmin', 'admin'), async (req, res) => {
  const errors = validateArticle(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const { slug, category, sort_order = 0, title, body_md = '', is_published = false } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO help_articles
         (slug, category, sort_order, title, body_md, is_published, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [slug, category, Number(sort_order), title, body_md, Boolean(is_published), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Ya existe un artículo con slug "${slug}"` });
    }
    serverError(res, 'POST /api/help', err);
  }
});

// ─── PUT /api/help/:slug — editar artículo (admin) ───────────────────────────
router.put('/:slug', auth, requireRole('superadmin', 'admin'), async (req, res) => {
  const { category, sort_order, title, body_md, is_published, new_slug } = req.body;
  const updates = [];
  const params = [];

  if (new_slug !== undefined) {
    if (!/^[a-z0-9-]+$/.test(new_slug)) {
      return res.status(400).json({ error: 'new_slug inválido (solo minúsculas, números y guiones)' });
    }
    updates.push(`slug = $${params.push(new_slug)}`);
  }
  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category debe ser uno de: ${VALID_CATEGORIES.join(', ')}` });
    }
    updates.push(`category = $${params.push(category)}`);
  }
  if (sort_order !== undefined) updates.push(`sort_order = $${params.push(Number(sort_order))}`);
  if (title !== undefined) {
    if (title.trim().length < 3) return res.status(400).json({ error: 'title mínimo 3 caracteres' });
    updates.push(`title = $${params.push(title)}`);
  }
  if (body_md !== undefined) updates.push(`body_md = $${params.push(body_md)}`);
  if (is_published !== undefined) updates.push(`is_published = $${params.push(Boolean(is_published))}`);

  if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });

  updates.push(`updated_by = $${params.push(req.user.id)}`);
  params.push(req.params.slug);

  try {
    const { rows } = await pool.query(
      `UPDATE help_articles
          SET ${updates.join(', ')}
        WHERE slug = $${params.length}
        RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Artículo no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un artículo con ese slug' });
    }
    serverError(res, 'PUT /api/help/:slug', err);
  }
});

// ─── DELETE /api/help/:slug — eliminar artículo (admin) ──────────────────────
router.delete('/:slug', auth, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM help_articles WHERE slug = $1',
      [req.params.slug]
    );
    if (!rowCount) return res.status(404).json({ error: 'Artículo no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'DELETE /api/help/:slug', err);
  }
});

module.exports = router;
