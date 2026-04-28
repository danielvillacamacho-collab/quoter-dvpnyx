/**
 * AI interaction logger — wrapper para registrar TODA llamada a un agente
 * en `ai_interactions`. Sin esto, cualquier integración futura con
 * Claude/GPT/etc es una caja negra: no puedes reproducir errores, mejorar
 * prompts, detectar drift, ni dar feedback al modelo.
 *
 * Uso típico (en una ruta o servicio):
 *
 *   const ai = require('./utils/ai_logger');
 *   const result = await ai.run({
 *     pool,
 *     agent: { name: 'claude-sonnet-4.5', version: '20251015' },
 *     template: { name: 'candidate_ranking', version: 3 },
 *     userId: req.user.id,
 *     entity: { type: 'resource_request', id: rrId },
 *     input:  { request: rr, candidates: pool },
 *     call:   async (input) => callAnthropicAPI(input),  // tu llamada real
 *   });
 *
 * `result` es la respuesta de `call()`. La fila ya quedó en
 * `ai_interactions` con id en `result.__interactionId` para que la UI
 * pueda registrar `human_decision` después.
 *
 * Política: NUNCA logueamos PII directa en input_payload. El caller
 * pasa `redact()` si tiene datos sensibles antes del shape final.
 */

/**
 * Ejecuta una llamada a un agente IA capturando todo el contexto.
 *
 * @param {object} args
 * @param {object} args.pool        - pg pool
 * @param {object} args.agent       - { name, version }
 * @param {object} args.template    - { name, version }
 * @param {string=} args.userId     - usuario que disparó la acción (puede ser null si fue un job)
 * @param {object=} args.entity     - { type, id } sobre qué entidad opera
 * @param {object} args.input       - payload que se manda al modelo
 * @param {function} args.call      - async () → { output, confidence?, costUsd?, inputTokens?, outputTokens? }
 * @returns Resultado de `call()` con un campo extra `__interactionId`.
 */
async function run({ pool, agent, template, userId, entity, input, call }) {
  if (!pool) throw new Error('ai.run: pool requerido');
  if (!agent || !agent.name || !agent.version) throw new Error('ai.run: agent.name + agent.version requeridos');
  if (!template || !template.name || !template.version) throw new Error('ai.run: template.name + template.version requeridos');
  if (typeof call !== 'function') throw new Error('ai.run: call function requerida');

  const start = Date.now();
  let result;
  let error = null;
  try {
    result = await call(input);
  } catch (err) {
    error = err;
  }
  const latencyMs = Date.now() - start;

  // Insertar siempre, también si hubo error — para forensics.
  let interactionId = null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO ai_interactions (
         agent_name, agent_version, prompt_template, prompt_template_version,
         user_id, entity_type, entity_id,
         input_payload, output_payload, confidence,
         cost_usd, input_tokens, output_tokens, latency_ms, error
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::jsonb, $9::jsonb, $10,
         $11, $12, $13, $14, $15
       ) RETURNING id`,
      [
        agent.name, agent.version,
        template.name, template.version,
        userId || null,
        entity?.type || null,
        entity?.id || null,
        JSON.stringify(input || {}),
        JSON.stringify(result?.output ?? null),
        Number.isFinite(result?.confidence) ? result.confidence : null,
        Number.isFinite(result?.costUsd) ? result.costUsd : null,
        Number.isFinite(result?.inputTokens) ? Math.trunc(result.inputTokens) : null,
        Number.isFinite(result?.outputTokens) ? Math.trunc(result.outputTokens) : null,
        latencyMs,
        error ? String(error.message || error) : null,
      ]
    );
    interactionId = rows[0]?.id || null;
  } catch (logErr) {
    // No queremos que el log roto rompa la llamada al agente. Loguear y seguir.
    // eslint-disable-next-line no-console
    console.error('ai.run: failed to write ai_interactions row:', logErr.message);
  }

  if (error) throw error;
  return { ...result, __interactionId: interactionId };
}

/**
 * Marca la decisión humana sobre una interacción previa.
 * Llamar desde la ruta donde el usuario acepta/rechaza/modifica la sugerencia.
 *
 * @param {object} pool
 * @param {string} interactionId  - el __interactionId devuelto por run()
 * @param {string} decision       - 'accepted' | 'rejected' | 'modified' | 'ignored'
 * @param {string=} feedback      - texto libre opcional
 */
async function recordDecision(pool, interactionId, decision, feedback) {
  const VALID = ['accepted', 'rejected', 'modified', 'ignored'];
  if (!VALID.includes(decision)) throw new Error(`decision inválido: ${decision}`);
  if (!interactionId) return null;
  const { rows } = await pool.query(
    `UPDATE ai_interactions
        SET human_decision = $2,
            human_feedback = $3,
            decided_at     = NOW()
      WHERE id = $1
      RETURNING id, human_decision`,
    [interactionId, decision, feedback || null]
  );
  return rows[0] || null;
}

module.exports = { run, recordDecision };
