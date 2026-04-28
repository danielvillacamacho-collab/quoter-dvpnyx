# Decisiones técnicas (ADR-style)

Registro de decisiones técnicas que el equipo ha tomado. Estilo Architecture Decision Records: contexto, decisión, consecuencias.

Cuando tomes una decisión que afecta el código a futuro, **agrégala acá**. Una entrada vive para siempre — si después la cambias, no la borres, agrega una nueva que la supersede.

Formato: `<ID> · <título> · <fecha> · <estado>`

Estados: 🟢 vigente · ⚪ superada · 🔴 rechazada

---

## Índice

- [TIME-MODEL · Coexistencia daily + weekly time tracking](#time-model)
- [AUDIT-DUAL · audit_log + events coexistencia](#audit-dual)
- [SQUAD-HIDDEN · Squads ocultos del UI](#squad-hidden)
- [MIGRATE-MONOLITH · migrate.js como archivo único](#migrate-monolith)
- [PG-VECTOR-OPTIONAL · pgvector como best-effort](#pg-vector-optional)
- [AI-LOGGER-MANDATORY · ai_logger.run() obligatorio](#ai-logger-mandatory)
- [QUOTATION-DUAL · Editor Unified vs no-Unified](#quotation-dual)
- [LEVEL-MIXED · INT vs VARCHAR para level](#level-mixed)
- [SOFT-DELETE-ONLY · No hard deletes](#soft-delete-only)
- [JSONB-NO-AJV · Validador propio en lugar de ajv](#jsonb-no-ajv)
- [MULTI-TENANT-DEFER · No multi-tenancy](#multi-tenant-defer)
- [TS-NO-MIGRATION · No migrar a TypeScript](#ts-no-migration)
- [REVENUE-PLACEHOLDER · Revenue MVP simplificado](#revenue-placeholder)
- [SLUG-LATER · Slugs aditivos sin populate inicial](#slug-later)
- [SUBTYPE-FROM-QUOTATION-NULL · from-quotation no exige subtype](#subtype-from-quotation-null)
- [EMPLOYEE-COSTS · Decisiones de diseño del módulo de costos](#employee-costs)

---

## TIME-MODEL

**Coexistencia daily + weekly time tracking** · 2026-04 · 🟢 vigente

**Contexto.** Hay dos modelos de time tracking: `time_entries` (horas diarias por asignación) y `weekly_time_allocations` (% semanal). El primero existía desde Sprint 5 ET-*. El segundo se agregó en Time-MVP-00.1 cuando se pidió un modelo más simple para empleados que no llevan horas precisas.

**Decisión.** Mantener ambos por ahora. El UI los expone en rutas distintas (`/time/me` daily, `/time/team` weekly).

**Consecuencias.**
- Reportes pueden divergir: el cumplimiento de time tracking calcula sobre `time_entries`; el plan-vs-real calcula sobre `weekly_time_allocations`.
- La consolidación es decisión de producto (¿cuál es el modelo "correcto" para DVPNYX?), no técnica.
- Mientras coexistan, los nuevos features de time tracking se construyen sobre `weekly_time_allocations` (que es el más reciente y el que conecta con plan-vs-real).
- Ver [`docs/specs/v2/03_data_model.md §7`](specs/v2/03_data_model.md#7-time-tracking-dos-modelos-coexisten).

**Acción pendiente.** Producto debe elegir. Una vez elegido, eng team migra data del descartado y borra el modelo viejo.

---

## AUDIT-DUAL

**audit_log + events coexistencia** · 2026-04 · 🟢 vigente

**Contexto.** El sistema V1 tenía `audit_log` (single-purpose, login/password/admin actions). En V2 se introdujo `events` como audit log estructurado con `event_type/entity_type/entity_id/payload`.

**Decisión.** No migrar `audit_log` a `events` en este sprint. Las dos tablas coexisten. Los nuevos features escriben a `events` vía `utils/events.js :: emitEvent`. Los legacy paths (login, password change) siguen escribiendo a `audit_log`.

**Consecuencias.**
- Para hacer audit completo de un período, hay que UNION ambas tablas.
- No se permite agregar features nuevos a `audit_log`. Está congelado.
- Cuando se haga el cleanup, los login/password rows se migran a `events` con event_types `auth.login`, `auth.password_changed`, etc.

---

## SQUAD-HIDDEN

**Squads ocultos del UI** · 2026-04 · 🟢 vigente

**Contexto.** El schema V2 introdujo `squads` para agrupar oportunidades, contratos, empleados. Después la organización decidió que squads no eran un concepto operativo (se manejan vía áreas + manager_user_id).

**Decisión.** Mantener `squad_id NOT NULL` en contracts y opportunities. El backend auto-provisiona "DVPNYX Global" si la tabla está vacía. El UI no expone squads.

**Consecuencias.**
- Toda quotation/opportunity/contract apunta al squad default.
- Reportes filtran por squad_id pero el filtro siempre devuelve todo.
- Si se decide eliminar squads, hay que dropear `NOT NULL` y actualizar 5+ rutas.

**Acción pendiente.** Decidir en próximos 90 días si se dropea o no.

---

## MIGRATE-MONOLITH

**migrate.js como archivo único** · 2026-04 · 🟢 vigente (con caveat)

**Contexto.** `server/database/migrate.js` es un solo archivo de ~860 líneas que contiene V1_SCHEMA + V2_NEW_TABLES + V2_ALTERS + AI_READINESS_SQL + V2_SEEDS_SQL. Se ejecuta en cada deploy. Idempotente.

**Decisión.** Mantener el archivo monolítico hasta que el equipo de infra tenga bandwidth para introducir herramientas de migration management (`node-pg-migrate`, `umzug`, etc.).

**Consecuencias positivas.** Cero infra. Idempotente. Funciona en dev local sin setup adicional.

**Consecuencias negativas.** No hay rollback. No hay "DOWN migrations". Conflictos de merge dolorosos. Imposible saber qué cambió desde un punto en el tiempo sin git blame line-by-line.

**Mitigación.** Cada nueva sección lleva header con fecha + nombre del feature. Idempotencia obligatoria (`IF NOT EXISTS` en todo).

**Acción pendiente.** Cuando infra esté disponible, migrar a numbered migrations. Estimado 1 día.

---

## PG-VECTOR-OPTIONAL

**pgvector como best-effort** · 2026-05 · 🟢 vigente

**Contexto.** La capa AI-readiness requiere pgvector para embeddings. La extensión está en RDS Postgres 15+, pero no en todas las imágenes Docker estándar.

**Decisión.** El migrate intenta `CREATE EXTENSION IF NOT EXISTS vector` con try/catch. Si falla (extensión no instalada, sin permisos), se loguea warning y el resto migra normal. Las columnas `*_embedding` y los HNSW indexes sólo se crean si pgvector está disponible.

**Consecuencias.**
- Sistema funciona idéntico en envs sin pgvector — sólo se pierde la capa de embeddings.
- Para activar AI semantic search, infra debe instalar la extensión y re-correr el migrate.
- En dev local con stock postgres puede no estar disponible; en RDS prod sí.

**Verificación.** `SELECT * FROM pg_extension WHERE extname = 'vector';` debe devolver una row.

---

## AI-LOGGER-MANDATORY

**ai_logger.run() obligatorio** · 2026-05 · 🟢 vigente

**Contexto.** Cualquier llamada a un agente IA puede ser caja negra: sin log, sin reproducibilidad, sin feedback loop, sin trazabilidad de costos.

**Decisión.** TODA llamada a un agente IA en este sistema debe pasar por `utils/ai_logger.js :: run()`. No hay excepciones. Cualquier endpoint que llame al modelo directamente sin pasar por el logger se considera bug y se rechaza en code review.

**Consecuencias.**
- Cada llamada queda registrada en `ai_interactions` (incluso si falla — para forensics).
- La inserción de log es tolerante a fallos: si la DB rechaza el INSERT, el flow del agente continúa.
- Habilita feedback loop, A/B de prompts, costos, métricas.
- Costo: ~5ms extra por llamada (un INSERT más).

**Ver:** [`AI_INTEGRATION_GUIDE.md §3`](AI_INTEGRATION_GUIDE.md#3-patrón-estándar-ai_loggerrun).

---

## QUOTATION-DUAL

**Editor Unified vs no-Unified** · 2026-03 · 🟢 vigente

**Contexto.** El editor de cotizaciones tuvo dos versiones: `StaffAugEditor.js` (legacy, separa staff_aug y fixed_scope en archivos distintos) y `StaffAugEditorUnified.js` (refactor que unifica). Ambos coexisten en código.

**Decisión.** No quitar el legacy hasta haber probado que el Unified maneja todos los edge cases (cotizaciones existentes, edición de v1 vs v2, etc.).

**Consecuencias.** Duplicación de lógica de UI. Ambos importan de `utils/calc.js`.

**Acción pendiente.** Cuando se haga la próxima iteración del cotizador, eliminar el legacy en el mismo PR.

---

## LEVEL-MIXED

**INT vs VARCHAR para level** · 2026-04 · 🟢 vigente (con caveat)

**Contexto.** `quotation_lines.level` es INT 1..11 (legacy V1). `employees.level` y `resource_requests.level` son VARCHAR `L1..L11` (V2 spec). Cualquier flow que cruce los modelos (kick-off, candidate matching) tiene que mapear.

**Decisión.** Mantener ambos formatos. Centralizar el mapeo en `server/utils/level.js`.

**Consecuencias.**
- Cualquier código que cruce modelos importa el helper.
- En reportes que joinean los dos, hay que castear: `'L' || ql.level::text = e.level`.
- Cuando se reescriba el cotizador, unificar a VARCHAR.

---

## SOFT-DELETE-ONLY

**No hard deletes** · 2026-03 · 🟢 vigente

**Contexto.** Para preservar trazabilidad financiera y operativa, ningún DELETE en producción debe ser hard.

**Decisión.** Toda tabla operativa tiene `deleted_at TIMESTAMPTZ NULL`. Los endpoints de DELETE marcan la columna en lugar de borrar la fila. SELECT de producción siempre filtran `WHERE deleted_at IS NULL`. UNIQUE constraints son partial (`WHERE deleted_at IS NULL`).

**Excepciones.**
- `assignments`: hard delete permitido SI no hay time_entries asociadas. Si hay, soft delete + status='cancelled'.
- Tabla puente `employee_skills`: hard delete (no es entidad principal).
- Lookups (`areas`, `skills`): no se borran. Se desactivan via `active=false`.

**Consecuencias.**
- Más complejidad en queries.
- Crece la tabla forever.
- Cuando se deba purgar (legal, performance), hay que escribir scripts dedicados.

---

## JSONB-NO-AJV

**Validador propio en lugar de ajv** · 2026-05 · 🟢 vigente

**Contexto.** Los JSONB libres (`metadata`, `payload`, etc.) necesitan validación de shape. La opción default es agregar `ajv` (~25 KB).

**Decisión.** Implementar un validador liviano en `utils/json_schema.js` (sin dependencia externa). Soporta los tipos que necesitamos (string, integer, number, boolean, date, uuid, object, array, oneOf) con bounds, enum, pattern, required, nullable, additionalProperties.

**Consecuencias.**
- Cero dependencias nuevas.
- No tenemos `$ref`, draft-07 completo, formats avanzados (regex pattern de email, etc.). Si llegamos a necesitar eso, migrar a ajv toma 1 hora.
- Schemas predefinidos en `SCHEMAS` (contractMetadata, userPreferences, etc.) — se documentan ahí para que routes los importen.

---

## MULTI-TENANT-DEFER

**No multi-tenancy** · 2026-04 · 🟢 vigente

**Contexto.** El sistema podría volverse SaaS y venderse a otras agencias. Multi-tenancy requiere `tenant_id` en todas las tablas + RLS o schema-per-tenant.

**Decisión.** Asumir single-tenant (DVPNYX) hasta que haya un segundo cliente real interesado.

**Consecuencias.**
- Ningún costo de complejidad hoy.
- Cuando se agregue, hay que tocar 28 tablas + ~85 endpoints + auth flow + filtros en queries. Estimado: 2-3 sprints.
- Pre-decisión: cuando se haga, usar **discriminator column** (`tenant_id UUID`) con RLS Postgres, no schema-per-tenant.

---

## TS-NO-MIGRATION

**No migrar a TypeScript** · 2026-03 · 🟢 vigente

**Contexto.** El código está en JS puro (CRA + Express). TypeScript daría safety en API contracts pero requiere refactor masivo.

**Decisión.** No migrar. Beneficio incremental no compensa el costo de transición + ralentización temporal del equipo durante la migración.

**Mitigación.** JSDoc cuando sea valioso. JSON Schema validation en boundaries (con `utils/json_schema.js`).

**Reconsiderar.** Si el equipo crece a > 4 devs y hay quejas frecuentes de bugs por tipos.

---

## REVENUE-PLACEHOLDER

**Revenue MVP simplificado** · 2026-04 · 🟢 vigente

**Contexto.** El módulo Revenue (RR-MVP-00.1) reemplaza el Excel mensual de DMs/CFO. La spec real (SPEC-RR-00) requiere modelo NIIF 15-friendly: immutability triggers, plan_frozen_at, service_period_history append-only, multi-currency, atomic worker async, 4 motores polimórficos.

**Decisión.** Implementar versión funcional simplificada: 1 columna en contracts (`total_value_usd`) + 1 tabla `revenue_periods` + 1 motor monthly_projection plano. Sin triggers DB. Sin multi-currency real más allá de `original_currency` + `exchange_rates`.

**Consecuencias.**
- DMs y CFO ya pueden operar el cierre mensual sin Excel paralelo.
- No es NIIF 15-compliant (rows `closed` no son inmutables a nivel DB).
- Cuando entre el equipo de eng a refactorizar, ver SPEC-RR-00 para el modelo real.

---

## SLUG-LATER

**Slugs aditivos sin populate inicial** · 2026-05 · 🟢 vigente

**Contexto.** En la rama AI-readiness se agregaron columnas `slug` a clients, opportunities, contracts, employees. URL-friendly + LLM-friendly.

**Decisión.** Agregar las columnas como `NULL` (sin populate inicial). El populate de datos existentes se hace en un job de backfill aparte (no incluido en la migración).

**Consecuencias.**
- Las entidades existentes tienen `slug = NULL` hasta que se corra el backfill.
- Los endpoints siguen aceptando UUID en `:id` — el slug es alternativa, no reemplazo.
- El frontend puede empezar a usar slugs en URLs cuando estén populados.

**Acción pendiente.** Job de backfill + endpoint admin `POST /api/admin/slugs/refresh` (no implementado).

---

## SUBTYPE-FROM-QUOTATION-NULL

**from-quotation no exige subtype** · 2026-04-28 · 🟢 vigente

**Contexto.** La SPEC `subtipo-contrato.docx` (Abril 2026) dice que el FORM de creación de contrato debe exigir `contract_subtype` cuando type es capacity o project. Para "creación desde oportunidad ganada" la spec aclara: "el subtipo debe aparecer vacío y ser obligatorio — no se asume ningún valor".

El sistema tiene dos caminos para crear contratos:
- `POST /api/contracts` — formulario manual (donde la spec aplica directo)
- `POST /api/contracts/from-quotation/:id` — atajo API que toma defaults de la quotation y crea con un click

**Decisión.** El formulario sí valida y exige `contract_subtype`. El endpoint `from-quotation` lo acepta opcionalmente: si no viene en body, queda NULL y el delivery manager lo completa después en el detalle del contrato (banner amarillo lo recuerda). Si viene y no es válido para el type derivado, devuelve 400.

**Razón.** El atajo de un click no debería romperse cuando el frontend nuevo lo invoca. El subtype es decisión operativa del DM, que típicamente NO está disponible al momento de ganar la oportunidad. La spec habla del FORM, no del atajo API.

**Consecuencias.**
- Contratos creados vía `from-quotation` pueden quedar con `subtype=NULL` por minutos/horas hasta que el DM lo complete.
- ContractDetail muestra banner si type requiere subtype pero está NULL — UX nudge sin bloqueo duro.
- Reportes deben filtrar `subtype=none` para encontrar contratos pendientes de clasificar.
- El día que se haga el módulo de billing, se debería bloquear billing setup hasta que el subtype esté seteado.

---

## EMPLOYEE-COSTS

**Decisiones de diseño del módulo de costos** · 2026-04-28 · 🟢 vigente

**Contexto.** Spec `spec_costos_empleado.docx` pide registrar el costo empresa mensual por empleado para calcular márgenes reales. La spec dejaba 8 decisiones técnicas abiertas; las resolvimos así (con razonamiento explícito).

### 1. Period: `CHAR(6)` `'YYYYMM'`
La spec proponía `VARCHAR(7) "2026-04"`. Elegimos `CHAR(6)` para alinear con el resto del sistema (`exchange_rates.yyyymm`, `revenue_periods.yyyymm`). Joins futuros entre estas tablas son sin cast.

### 2. `employees.company_monthly_cost` deprecada (no borrada)
La columna existía desde V2 inicial pero nunca se usó. Decidimos:
- NO borrar (preserva schema histórico).
- Marcar con `COMMENT ON COLUMN ... IS 'DEPRECATED 2026-04: ver employee_costs'`.
- Nuevos empleados quedan con NULL.
- Fuente única de verdad: `employee_costs`.

### 3. FK `ON DELETE RESTRICT` (no CASCADE)
La spec proponía CASCADE. Lo cambiamos a RESTRICT porque el historial financiero debe ser inmutable (NIIF 15) aunque el empleado sea soft-deleteado. Si en el futuro hace falta purgar a un empleado, primero hay que archivar/borrar manualmente sus costos (decisión consciente).

### 4. Empleados nuevos: costo opcional, badge "Nuevo"
Si un empleado entró este mes y no tiene costo del mes anterior para copiar, NO bloqueamos su carga. La mass view muestra badge "Nuevo" + el costo teórico del nivel como placeholder gris (no guardado). Finanzas decide cuándo cargarlo.

### 5. Recálculo FX manual con endpoint dedicado
Cuando exchange_rates cambia para un período con costos ya cargados, NO recalculamos automáticamente. La razón: re-disparar UPDATEs masivos sin contexto humano genera audit log noise y sorpresas. En su lugar:
- Endpoint explícito `POST /api/employee-costs/recalculate-usd/:period`.
- Botón "🔄 Recalcular USD" en el mass view.
- Solo afecta rows abiertos (locked NO se tocan, requiere superadmin para deslockear).

### 6. Encryption at rest: diferida
La spec lo recomienda pero requiere infra (key management con KMS o pgcrypto + secret rotation). Por ahora:
- Plaintext en `gross_cost` y `cost_usd`.
- Acceso restringido por rol a nivel de route + UI.
- COMMENT ON COLUMN marca los campos como `PII:high`.

Cuando llegue el equipo de infra, evaluar `pgcrypto` con keys gestionadas externamente.

### 7. Período futuro: máximo +1 mes
Para forecasting básico permitimos cargar costos del mes siguiente al actual. Más allá → 400 con `code:'period_too_far_future'`. Razón: evita que finanzas cargue por error costos de 2027 y los descubra meses después.

### 8. Bulk: patrón preview/commit (alineado con `bulk_import`)
Dos endpoints separados:
- `bulk/preview` → dry-run, devuelve errors/warnings/applied sin escribir.
- `bulk/commit` → atómico (si CUALQUIER error, ROLLBACK).

Esto refactoriza `processBulk` en 2 fases (validar todos → aplicar todos) — garantiza atomicidad.

### Por qué no se hicieron otras cosas

- **Audit de READs**: spec lo sugiere. Decidimos diferir hasta que llegue cliente externo o auditoría real lo exija; por ahora el acceso restringido por rol + audit de mutaciones es suficiente.
- **Trigger DB de inmutabilidad para locked rows**: lo enforce el código del route. Trigger DB sería más robusto pero más complejo de revertir si se necesita superadmin override.
- **Auto-merge inteligente en CSV import** (detección de duplicados, fuzzy match de emails): YAGNI hasta que finanzas reporte un caso real.

---

## Cómo agregar una decisión

1. ID en kebab-case (max 4 palabras).
2. Fecha de cuando se tomó (`YYYY-MM`).
3. Estado: 🟢 vigente · ⚪ superada · 🔴 rechazada.
4. Contexto: por qué hubo que decidir algo.
5. Decisión: qué se eligió.
6. Consecuencias: qué implica esto a futuro (positivas y negativas).
7. Acción pendiente: si la decisión es temporal, qué se hará cuando llegue el momento.

Cuando una decisión se supersede, marcar la antigua ⚪ y agregar la nueva con un link "(supersede [ID-VIEJO](#id-viejo))".

---

*Este archivo es la memoria institucional del proyecto. Si una decisión no está acá, el equipo entrante va a tener que descubrirla por reverse engineering del código. Sé generoso documentando.*
