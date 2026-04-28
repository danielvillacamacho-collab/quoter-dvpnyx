/**
 * AI interactions browse + decision endpoints.
 *
 * Endpoints:
 *   GET  /api/ai-interactions
 *        Admin-only listado paginado del log. Soporta filtros por
 *        agent_name, prompt_template, entity_type/id, user_id,
 *        human_decision (incluyendo 'pending' = NULL), y rango de fecha.
 *
 *   GET  /api/ai-interactions/:id
 *        Detalle completo. Admin-only.
 *
 *   POST /api/ai-interactions/:id/decision
 *        El usuario que disparó la sugerencia (o un admin) registra
 *        su decisión: accepted | rejected | modified | ignored.
 *        Body opcional: { feedback: string }.
 *
 * Estos endpoints son la base del feedback loop. Sin la decisión humana
 * registrada, la IA no aprende de sus aciertos/errores.
 */
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { parsePagination, isValidUUID } = require('../utils/sanitize');
const { serverError } = require('../utils/http');
const { recordDecision } = require('../utils/ai_logger');

router.use(auth);

/* -------- LIST (admin) -------- */
router.get('/', adminOnly, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    const wheres = [];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

    if (req.query.agent_name)      wheres.push(`agent_name = ${add(req.query.agent_name)}`);
    if (req.query.prompt_template) wheres.push(`prompt_template = ${add(req.query.prompt_template)}`);
    if (req.query.user_id) {
      if (!isValidUUID(req.query.user_id)) return res.status(400).json({ error: 'user_id no es un UUID válido' });
      wheres.push(`user_id = ${add(req.query.user_id)}`);
    }
    if (req.query.entity_type) wheres.push(`entity_type = ${add(req.query.entity_type)}`);
    if (req.query.entity_id) {
      if (!isValidUUID(req.query.entity_id)) return res.status(400).json({ error: 'entity_id no es un UUID válido' });
      wheres.push(`entity_id = ${add(req.query.entity_id)}`);
    }
    if (req.query.human_decision === 'pending') {
      wheres.push(`human_decision IS NULL`);
    } else if (req.query.human_decision) {
      wheres.push(`human_decision = ${add(req.query.human_decision)}`);
    }
    if (req.query.from) wheres.push(`created_at >= ${add(req.query.from)}::timestamptz`);
    if (req.query.to)   wheres.push(`created_at <= ${add(req.query.to)}::timestamptz`);

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;

    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM ai_interactions ${where}`, filterParams),
      pool.query(
        `SELECT id, agent_name, agent_version, prompt_template, prompt_template_version,
                user_id, entity_type, entity_id, confidence, human_decision,
                cost_usd, input_tokens, output_tokens, latency_ms, error,
                created_at, decided_at
           FROM ai_interactions
           ${where}
           ORDER BY created_at DESC
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...filterParams, limit, offset]
      ),
    ]);

    res.json({
      data: rowsRes.rows,
      pagination: {
        page, limit,
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / limit) || 1,
      },
    });
  } catch (err) { serverError(res, 'GET /ai-interactions', err); }
});

/* -------- GET ONE (admin) — incluye payloads completos -------- */
router.get('/:id', adminOnly, async (req, res) => {
  try {
    if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id no es un UUID válido' });
    const { rows } = await pool.query(
      `SELECT * FROM ai_interactions WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Interacción no encontrada' });
    res.json(rows[0]);
  } catch (err) { serverError(res, 'GET /ai-interactions/:id', err); }
});

/* -------- DECISION --------
 * Cualquier usuario autenticado puede registrar su decisión SI fue el
 * mismo que disparó la interacción; admin puede registrarla siempre.
 */
router.post('/:id/decision', async (req, res) => {
  try {
    if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'id no es un UUID válido' });
    const decision = String((req.body || {}).decision || '').trim();
    const feedback = (req.body || {}).feedback || null;
    const VALID = ['accepted', 'rejected', 'modified', 'ignored'];
    if (!VALID.includes(decision)) {
      return res.status(400).json({ error: `decision inválida (${VALID.join('|')})` });
    }

    // Authorization: dueño de la interacción O admin.
    const { rows } = await pool.query(
      `SELECT user_id, human_decision FROM ai_interactions WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Interacción no encontrada' });
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin && rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'No puedes modificar la decisión de otra interacción' });
    }
    if (rows[0].human_decision) {
      return res.status(409).json({
        error: `Esta interacción ya tiene decisión registrada (${rows[0].human_decision}).`,
        code: 'already_decided',
      });
    }

    const updated = await recordDecision(pool, req.params.id, decision, feedback);
    res.json(updated);
  } catch (err) { serverError(res, 'POST /ai-interactions/:id/decision', err); }
});

module.exports = router;
