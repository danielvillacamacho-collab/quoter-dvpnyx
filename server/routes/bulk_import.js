/**
 * POST /api/bulk-import/:entity/preview
 * POST /api/bulk-import/:entity/commit
 * GET  /api/bulk-import/templates/:entity  — downloadable CSV template
 *
 * Admin+ only. Rows are accepted as JSON (array), so the frontend does
 * the CSV parsing client-side (zero server deps + a much smaller payload).
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { runBulkImport, ENTITIES } = require('../utils/bulk_import');

router.use(auth, adminOnly);

// Canonical template headers + 1-2 example rows per entity.
const TEMPLATES = {
  areas: {
    headers: ['key', 'name', 'description', 'sort_order', 'active'],
    examples: [
      ['devops_sre', 'DevOps / SRE', 'Especialidad combinada de plataforma y confiabilidad', '9', 'true'],
      ['data_engineering', 'Data Engineering', 'Diseño y mantenimiento de pipelines de datos', '10', 'true'],
    ],
  },
  skills: {
    headers: ['name', 'category', 'description', 'active'],
    examples: [
      ['React', 'framework', 'Frontend UI library', 'true'],
      ['dbt', 'data', 'SQL transformations', 'true'],
    ],
  },
  clients: {
    headers: ['name', 'legal_name', 'country', 'industry', 'tier', 'preferred_currency', 'notes', 'active'],
    examples: [
      ['Acme Corp', 'Acme S.A.', 'Colombia', 'Retail', 'mid_market', 'USD', 'Cliente referencia', 'true'],
    ],
  },
  employees: {
    headers: [
      'first_name', 'last_name', 'corporate_email', 'personal_email',
      'country', 'city', 'area_key', 'level', 'seniority_label',
      'employment_type', 'weekly_capacity_hours',
      'start_date', 'end_date', 'status', 'squad_name', 'notes',
    ],
    examples: [
      ['Ana', 'Lopez', 'ana.lopez@dvpnyx.com', '', 'Colombia', 'Bogotá',
        'development', 'L5', 'Semi Senior', 'fulltime', '40',
        '2026-01-15', '', 'active', 'DVPNYX Global', ''],
    ],
  },
  'employee-skills': {
    headers: ['corporate_email', 'skill_name', 'proficiency', 'years_experience', 'notes'],
    examples: [
      ['ana.lopez@dvpnyx.com', 'React', 'advanced', '4', ''],
      ['ana.lopez@dvpnyx.com', 'TypeScript', 'intermediate', '2', ''],
    ],
  },
};

function csvEscape(s) {
  const v = String(s ?? '');
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

function templateToCsv(entity) {
  const t = TEMPLATES[entity];
  if (!t) return null;
  const lines = [t.headers.join(',')];
  for (const row of t.examples) lines.push(row.map(csvEscape).join(','));
  return lines.join('\n') + '\n';
}

router.get('/entities', (_req, res) => {
  res.json({ entities: ENTITIES, templates: Object.keys(TEMPLATES) });
});

router.get('/templates/:entity', (req, res) => {
  const entity = req.params.entity;
  // Validar entity contra whitelist ANTES de tocar response headers — evita
  // que `entity` vaya al Content-Disposition sin saneo (riesgo de filename
  // injection / path traversal en cliente).
  if (!ENTITIES.includes(entity)) {
    return res.status(404).json({ error: 'Plantilla no encontrada' });
  }
  const csv = templateToCsv(entity);
  if (!csv) return res.status(404).json({ error: 'Plantilla no encontrada' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="template_${entity}.csv"`);
  res.send(csv);
});

/**
 * Both endpoints accept { rows: [...] }. Dry-run vs commit is chosen
 * by the route segment so the UI + log reader can tell them apart
 * without inspecting the body.
 */
async function handle(req, res, { dryRun }) {
  const entity = req.params.entity;
  if (!ENTITIES.includes(entity)) {
    return res.status(400).json({ error: `Entidad no soportada: "${entity}"` });
  }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'Body debe ser { rows: [ {col:val,...} ] }' });
  if (rows.length > 5000) return res.status(413).json({ error: 'Máximo 5000 filas por import' });

  try {
    const result = await runBulkImport({
      entity, rows, pool, userId: req.user.id, dryRun,
    });
    res.status(200).json(result);
  } catch (err) {
    const status = err.status || 500;
    // eslint-disable-next-line no-console
    console.error(`bulk-import ${entity} failed:`, err);
    res.status(status).json({ error: err.message || 'Error interno' });
  }
}

router.post('/:entity/preview', (req, res) => handle(req, res, { dryRun: true }));
router.post('/:entity/commit',  (req, res) => handle(req, res, { dryRun: false }));

module.exports = router;
