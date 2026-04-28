# Guía de integración de agentes IA — DVPNYX Quoter

Cómo conectar agentes IA (Claude, GPT, Gemini, modelos open source) al sistema de manera observable, reproducible y con feedback loop. La capa de soporte vive en producción desde la rama `chore/ai-readiness-foundations`.

---

## Índice

1. [Estado de la capa AI-readiness](#1-estado-de-la-capa-ai-readiness)
2. [Tu primera integración en 30 minutos](#2-tu-primera-integración-en-30-minutos)
3. [Patrón estándar: `ai_logger.run()`](#3-patrón-estándar-ai_loggerrun)
4. [Cerrando el feedback loop](#4-cerrando-el-feedback-loop)
5. [Versionado de prompts](#5-versionado-de-prompts)
6. [Embeddings con pgvector](#6-embeddings-con-pgvector)
7. [Casos de uso priorizados](#7-casos-de-uso-priorizados)
8. [Observabilidad y costos](#8-observabilidad-y-costos)
9. [Seguridad y PII](#9-seguridad-y-pii)
10. [Antipatrones a evitar](#10-antipatrones-a-evitar)

---

## 1. Estado de la capa AI-readiness

Lo que YA existe (mayo 2026):

| Componente | Estado |
|---|---|
| `ai_interactions` table | ✅ creada, indexes en place |
| `ai_prompt_templates` table | ✅ creada (vacía) |
| `delivery_facts` table + función refresh | ✅ creada (sin job nocturno aún) |
| `pgvector` extension | ⚠️ best-effort (instala si la imagen lo permite) |
| Columnas `*_embedding vector(1536)` | ✅ presentes si pgvector activo |
| HNSW indexes para búsqueda semántica | ✅ creados con `vector_cosine_ops` |
| `utils/ai_logger.js` | ✅ con tests |
| `routes/ai_interactions.js` (browse + decision) | ✅ admin-only listado + POST decision |
| Job nocturno populando embeddings | ❌ pendiente |
| Job nocturno refresh delivery_facts | ❌ pendiente |
| Backfill de embeddings | ❌ pendiente |
| Wiring de UI para mostrar sugerencias IA | ❌ pendiente |

**Lo que falta para tu primer agente productivo:** generar embeddings (job + endpoint POST `/api/admin/embeddings/refresh`) y conectar un primer caso de uso (típicamente: candidate matching).

---

## 2. Tu primera integración en 30 minutos

Ejemplo: ranking de candidatos para un `resource_request` usando Claude.

### Paso 1: registrar el prompt template

```sql
INSERT INTO ai_prompt_templates (name, version, description, body, output_schema, active, created_by)
VALUES (
  'candidate_ranking',
  1,
  'Ranking de candidatos para un resource request, considerando skills, área y disponibilidad',
  $$
You are a staffing assistant for DVPNYX. Given a resource request and a pool of candidate employees,
rank them from best to worst fit. Consider:
- Skills match (required and nice-to-have)
- Area alignment
- Level proximity
- Availability (current capacity vs request hours)

Return JSON in this exact shape:
{
  "ranked": [
    { "employee_id": "uuid", "score": 0..100, "reason": "short rationale" },
    ...
  ]
}

Resource Request:
{request_json}

Candidates:
{candidates_json}
  $$,
  '{
    "type": "object",
    "required": ["ranked"],
    "properties": {
      "ranked": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["employee_id", "score", "reason"],
          "properties": {
            "employee_id": { "type": "string" },
            "score": { "type": "number", "minimum": 0, "maximum": 100 },
            "reason": { "type": "string" }
          }
        }
      }
    }
  }'::jsonb,
  true,
  '<your-admin-uuid>'
);
```

### Paso 2: crear el endpoint que llama al modelo

```js
// server/routes/ai_candidates.js (NUEVO)
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { isValidUUID } = require('../utils/sanitize');
const { serverError } = require('../utils/http');
const ai = require('../utils/ai_logger');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.use(auth);

router.post('/rank/:requestId', adminOnly, async (req, res) => {
  try {
    const requestId = req.params.requestId;
    if (!isValidUUID(requestId)) return res.status(400).json({ error: 'requestId no es UUID' });

    // 1. Cargar request + pool de candidatos
    const { rows: rrRows } = await pool.query(
      `SELECT rr.*, a.name AS area_name FROM resource_requests rr
         LEFT JOIN areas a ON a.id = rr.area_id
        WHERE rr.id = $1 AND rr.deleted_at IS NULL`,
      [requestId]
    );
    if (!rrRows.length) return res.status(404).json({ error: 'Request no existe' });
    const request = rrRows[0];

    const { rows: candidates } = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.country,
              e.weekly_capacity_hours, a.name AS area_name,
              ARRAY_AGG(s.name) FILTER (WHERE s.name IS NOT NULL) AS skills
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         LEFT JOIN employee_skills es ON es.employee_id = e.id
         LEFT JOIN skills s ON s.id = es.skill_id
        WHERE e.deleted_at IS NULL AND e.status IN ('active','bench')
        GROUP BY e.id, a.name
        LIMIT 25`
    );

    // 2. Cargar template versionado
    const { rows: tpls } = await pool.query(
      `SELECT body, version FROM ai_prompt_templates
        WHERE name = 'candidate_ranking' AND active = true
        ORDER BY version DESC LIMIT 1`
    );
    if (!tpls.length) return res.status(503).json({ error: 'No hay prompt activo' });
    const tpl = tpls[0];

    const promptBody = tpl.body
      .replace('{request_json}', JSON.stringify(request))
      .replace('{candidates_json}', JSON.stringify(candidates));

    // 3. Llamar al modelo VIA ai_logger.run() para que quede el log
    const result = await ai.run({
      pool,
      agent:    { name: 'claude-sonnet-4.5', version: '20251015' },
      template: { name: 'candidate_ranking', version: tpl.version },
      userId:   req.user.id,
      entity:   { type: 'resource_request', id: requestId },
      input:    { request_id: requestId, candidate_count: candidates.length, prompt: promptBody },
      call: async () => {
        const t0 = Date.now();
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 2000,
          messages: [{ role: 'user', content: promptBody }],
        });
        const text = response.content[0]?.text || '{}';
        return {
          output: JSON.parse(text),
          inputTokens:  response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          costUsd:      response.usage.input_tokens  * 0.003 / 1000
                      + response.usage.output_tokens * 0.015 / 1000,
        };
      },
    });

    // result.__interactionId queda para que la UI registre la decisión
    res.json({
      ranked: result.output.ranked,
      interaction_id: result.__interactionId,
    });
  } catch (err) { serverError(res, 'POST /ai-candidates/rank', err); }
});

module.exports = router;
```

### Paso 3: registrar la ruta

```js
// server/index.js
app.use('/api/ai-candidates', require('./routes/ai_candidates'));
```

### Paso 4: en la UI, registrar la decisión humana

```js
// client/src/modules/CandidatesModal.js (modificación)
const { ranked, interaction_id } = await apiPost(`/api/ai-candidates/rank/${requestId}`);

// Cuando el usuario asigna a uno:
await apiPost(`/api/assignments`, { /* ... */ });
await apiPost(`/api/ai-interactions/${interaction_id}/decision`, {
  decision: 'accepted',
  feedback: `User picked employee_id=${pickedId}`,
});

// Si el usuario ignoró la sugerencia y picó manual:
await apiPost(`/api/ai-interactions/${interaction_id}/decision`, {
  decision: 'rejected',
  feedback: 'Manual pick — reason: …',
});
```

### Paso 5: ver el log

```
GET /api/ai-interactions?prompt_template=candidate_ranking
GET /api/ai-interactions?human_decision=pending
GET /api/ai-interactions/:id
```

Eso es todo. Tienes feedback loop, costos, latencia, reproducibilidad.

---

## 3. Patrón estándar: `ai_logger.run()`

Cualquier llamada a un agente IA en este sistema **debe** pasar por `ai_logger.run()`. No hay excepciones.

```js
const ai = require('../utils/ai_logger');

const result = await ai.run({
  pool,                                    // pg pool
  agent: {
    name:    'claude-sonnet-4.5',          // nombre canónico del modelo
    version: '20251015',                    // versión específica (date string del modelo)
  },
  template: {
    name:    'candidate_ranking',           // referencia a ai_prompt_templates
    version: 3,                             // versión exacta usada
  },
  userId:  req.user.id,                    // null si fue un job sin usuario
  entity:  { type: 'resource_request', id: rrId },  // sobre qué opera
  input:   { /* prompt + contexto, sin PII directa */ },
  call: async (input) => {
    // Tu llamada real al modelo. Devuelve:
    return {
      output:        { /* respuesta */ },
      confidence:    0.85,                  // opcional, 0..1 si el modelo lo expone
      inputTokens:   1200,                  // opcional pero recomendado
      outputTokens:  250,                   // opcional pero recomendado
      costUsd:       0.0123,                // opcional pero recomendado
    };
  },
});

// result tiene shape de `output` + un campo extra:
// result.__interactionId  ← UUID de la fila en ai_interactions
```

**Garantías:**
- Siempre se inserta una fila en `ai_interactions` (incluso si la llamada falla — para forensics).
- Si el log a DB falla, **no rompe el flujo**: se loguea por consola y se continúa. El agente se ejecuta igual.
- Si la llamada al modelo lanza, `run()` re-lanza pero ya quedó el registro con `error` poblado.
- `latency_ms` se mide automáticamente.

---

## 4. Cerrando el feedback loop

El log es inútil sin la decisión humana. Tres formas:

### 4.1 UI: registrar después de cada acción

```js
// Cuando el usuario acepta la sugerencia
await apiPost(`/api/ai-interactions/${interactionId}/decision`, {
  decision: 'accepted',
  feedback: 'Optional context',
});

// Cuando el usuario rechaza / pica manual
await apiPost(`/api/ai-interactions/${interactionId}/decision`, {
  decision: 'rejected',
  feedback: 'Picked employee X instead because ...',
});

// Cuando modifica la sugerencia (ej. ajustó las horas propuestas)
await apiPost(`/api/ai-interactions/${interactionId}/decision`, {
  decision: 'modified',
  feedback: 'Reduced hours from 40 to 30',
});

// Cuando ignora completamente
await apiPost(`/api/ai-interactions/${interactionId}/decision`, {
  decision: 'ignored',
});
```

### 4.2 Programáticamente desde server

```js
const ai = require('../utils/ai_logger');
await ai.recordDecision(pool, interactionId, 'accepted', 'auto-approved by rule X');
```

### 4.3 Estadísticas para tablero

```sql
-- Tasa de aceptación por template
SELECT prompt_template, prompt_template_version,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE human_decision = 'accepted') AS accepted,
       COUNT(*) FILTER (WHERE human_decision = 'rejected') AS rejected,
       COUNT(*) FILTER (WHERE human_decision IS NULL)      AS pending,
       AVG(latency_ms)                                       AS avg_latency_ms,
       SUM(cost_usd)                                          AS total_cost_usd
  FROM ai_interactions
 WHERE created_at > NOW() - INTERVAL '30 days'
 GROUP BY prompt_template, prompt_template_version
 ORDER BY total DESC;
```

Cuando una versión de prompt tenga ≥30% de `rejected`, evaluar reescribir y crear `version+1`.

---

## 5. Versionado de prompts

**Reglas:**
- Cada cambio sustantivo a un prompt = nuevo `(name, version+1)`.
- Marcar la versión vieja `active=false` cuando la nueva la reemplace.
- El `output_schema` se valida contra la respuesta del modelo (ver `utils/json_schema.js`).
- Si quieres A/B test, dejar dos versiones `active=true` y enrutar 50/50 en el endpoint.

```sql
-- Ver versiones activas por nombre
SELECT name, version, description, created_at
  FROM ai_prompt_templates
 WHERE active = true
 ORDER BY name, version DESC;
```

Ejemplo de evolución:

```
candidate_ranking v1: prompt simple, sólo skills
candidate_ranking v2: + áreas + level
candidate_ranking v3: + disponibilidad + idiomas (versión actual)
```

---

## 6. Embeddings con pgvector

**Generar embeddings en bulk** (job nocturno o on-demand):

```js
// server/jobs/refresh_embeddings.js (PROPUESTO — no existe aún)
const pool = require('../database/pool');
const Anthropic = require('@anthropic-ai/sdk');

async function embedText(text) {
  // Anthropic todavía no expone embeddings públicamente. Usar OpenAI por ahora:
  const openai = new (require('openai'))({ apiKey: process.env.OPENAI_API_KEY });
  const r = await openai.embeddings.create({
    model: 'text-embedding-3-small',  // 1536 dims = compatible con nuestro vector(1536)
    input: text.slice(0, 8000),
  });
  return r.data[0].embedding;
}

async function refreshEmployeeEmbeddings() {
  const { rows } = await pool.query(`
    SELECT e.id,
           e.first_name || ' ' || e.last_name || ' · ' || e.level || ' · ' || a.name AS profile,
           STRING_AGG(s.name || ' (' || es.proficiency || ')', ', ') AS skills
      FROM employees e
      LEFT JOIN areas a ON a.id = e.area_id
      LEFT JOIN employee_skills es ON es.employee_id = e.id
      LEFT JOIN skills s ON s.id = es.skill_id
     WHERE e.deleted_at IS NULL
       AND (e.skill_profile_embedding IS NULL OR e.updated_at > (
         SELECT COALESCE(MAX(refreshed_at), '1970-01-01') FROM delivery_facts WHERE employee_id = e.id
       ))
     GROUP BY e.id, a.name
  `);

  for (const row of rows) {
    const text = `${row.profile}. Skills: ${row.skills || '(ninguna)'}.`;
    const vec  = await embedText(text);
    await pool.query(
      `UPDATE employees SET skill_profile_embedding = $1 WHERE id = $2`,
      [`[${vec.join(',')}]`, row.id]
    );
  }
}
```

**Búsqueda semántica:**

```sql
-- Top 10 empleados más similares a una descripción de request
SELECT e.id, e.first_name, e.last_name, e.level,
       1 - (e.skill_profile_embedding <=> $1) AS similarity
  FROM employees e
 WHERE e.deleted_at IS NULL
   AND e.skill_profile_embedding IS NOT NULL
 ORDER BY e.skill_profile_embedding <=> $1
 LIMIT 10;
```

`<=>` es cosine distance (0 = idénticos, 2 = opuestos). El index HNSW hace esto O(log n).

**Combinado con filtros relacionales:**

```sql
-- Senior backend devs en CO con embedding similar al request
SELECT e.id, e.first_name, e.last_name,
       1 - (e.skill_profile_embedding <=> $1) AS similarity
  FROM employees e
  JOIN areas a ON a.id = e.area_id
 WHERE e.deleted_at IS NULL
   AND e.country = 'Colombia'
   AND e.level IN ('L4','L5','L6')
   AND a.key = 'development'
 ORDER BY e.skill_profile_embedding <=> $1
 LIMIT 10;
```

---

## 7. Casos de uso priorizados

Por orden de impacto/esfuerzo:

### 7.1 🥇 Candidate matching semántico

Reemplaza el `candidate_matcher.js` boolean por scoring semántico. Mantiene los filtros duros (área, nivel, capacidad) pero usa embeddings para "cercanía" en lugar de exact match en skills.

### 7.2 🥈 Auto-resumen de cotizaciones

Generar `quotations.summary_embedding` + un campo `narrative` en cada quotation que el preventa pueda usar para emails/propuestas. Habilita RAG sobre cotizaciones pasadas para nuevas similares.

### 7.3 🥉 Suggester de duración por línea

Dado `(specialty, role_title, level)` de una nueva línea de cotización, sugerir `duration_months` y `hours_per_week` basado en cotizaciones históricas similares (vector search sobre `quotation_lines.specialty_embedding` — futuro).

### 7.4 Forecasting de utilización

Con `delivery_facts` poblada, entrenar un modelo simple (lineal o XGBoost) que predice `utilization_30d` basado en el pipeline + assignments planeados. No requiere LLM.

### 7.5 Análisis de overrides de assignments

Cuando admin crea un assignment con `override_reason`, mandar a un LLM para clasificar la razón en categorías. Entrenar para detectar patterns problemáticos.

### 7.6 Asistente Q&A sobre el sistema

RAG sobre los embeddings de contracts/quotations/opportunities. "¿Cuál fue la duración promedio de proyectos fixed_scope con Bancolombia?" responde con números reales del DB + contexto.

---

## 8. Observabilidad y costos

### Métricas a trackear

```sql
-- Costo último mes por modelo
SELECT agent_name,
       COUNT(*) AS calls,
       SUM(cost_usd) AS total_usd,
       AVG(latency_ms)::int AS avg_ms,
       SUM(input_tokens)  AS in_tok,
       SUM(output_tokens) AS out_tok
  FROM ai_interactions
 WHERE created_at > NOW() - INTERVAL '30 days'
 GROUP BY agent_name;

-- Acceptance rate por template
SELECT prompt_template,
       COUNT(*) FILTER (WHERE human_decision = 'accepted') * 100.0 / NULLIF(COUNT(*), 0) AS accept_pct,
       COUNT(*) AS total
  FROM ai_interactions
 WHERE created_at > NOW() - INTERVAL '30 days'
   AND human_decision IS NOT NULL
 GROUP BY prompt_template
 ORDER BY accept_pct;
```

### Dashboard mínimo recomendado

Cuando lleguen los primeros 1000 interactions:

1. Calls por día / costos por día / tokens por día
2. P50 y P99 de latencia por modelo
3. % accepted vs rejected vs pending por template
4. Top 5 errores más comunes (campo `error`)
5. Distribución de `confidence` cuando el modelo la emite

---

## 9. Seguridad y PII

**Reglas duras:**

1. **NUNCA logear PII directa en `input_payload`**: emails personales, teléfonos, direcciones, números de identificación. Si el contexto los requiere, sustituir por placeholders (`<email>`, `<id>`) antes de mandar.

2. **El prompt va al modelo, queda en logs.** Asume que cualquier dato que envíes al modelo se queda registrado en sus servers (Anthropic/OpenAI). Verifica el contrato de privacidad.

3. **No mandes `password_hash`, tokens, ni secrets.** Es obvio pero ha pasado.

4. **Output puede contener alucinaciones de PII.** Validar con `output_schema` antes de exponer al usuario.

5. **Costos como denial-of-service.** Rate-limit los endpoints que llaman al modelo (ya tenemos `express-rate-limit` configurado para login; aplicar a `/api/ai-*` también).

### Helper de redacción

```js
function redact(obj) {
  // Implementar: caminar el objeto y reemplazar strings que matcheen
  // patrones de email/teléfono/UUID por <redacted>.
  // Reemplaza en una rama futura.
}

await ai.run({ ..., input: redact(rawInput), ... });
```

---

## 10. Antipatrones a evitar

❌ **No hagas:**

- Llamar al modelo SIN pasar por `ai_logger.run()` ("sólo para esta vez").
- Reusar un prompt template sin versionar cuando lo modificas. Cada cambio = `version+1`.
- Mostrar al usuario directamente la salida del modelo sin validar contra `output_schema`.
- Asumir que la respuesta es JSON válido. Siempre `try/catch` el `JSON.parse`.
- Ejecutar acciones automáticamente en base a la sugerencia del modelo. Siempre interponer human-in-the-loop salvo casos triviales (autocompletar campos opcionales).
- Embeber datos sensibles directos en `input_payload` para "que el modelo entienda mejor".
- Dejar `human_decision` en `pending` para siempre. Si la UI ya cerró el flujo, registrar `ignored` automáticamente al cerrar.
- Crear nuevos esquemas de logging paralelos. La verdad vive en `ai_interactions`.

---

## Referencias

- [`server/utils/ai_logger.js`](../server/utils/ai_logger.js) — código de la capa
- [`server/routes/ai_interactions.js`](../server/routes/ai_interactions.js) — endpoints de browse + decision
- [`server/database/migrate.js`](../server/database/migrate.js) — schema de `ai_*` y `delivery_facts`
- [`docs/specs/v2/03_data_model.md §12`](specs/v2/03_data_model.md#12-capa-ai-readiness) — modelo de datos AI
- Anthropic API: https://docs.anthropic.com
- OpenAI Embeddings: https://platform.openai.com/docs/guides/embeddings
- pgvector: https://github.com/pgvector/pgvector

---

*Esta guía se actualiza cuando se conecta el primer agente productivo (cambia `4. Cerrando el feedback loop` con métricas reales) y cuando se publique el job nocturno de embeddings.*
