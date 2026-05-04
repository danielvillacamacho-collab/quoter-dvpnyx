# State of the Union — DVPNYX Quoter

> **Fecha del snapshot:** 2026-05-02 (revisado a EOD).
> **Para:** equipo senior que toma operación + crecimiento del producto desde **2026-05-15**.
> **De:** Daniel Villa Camacho (Product Owner saliente, queda como referente de producto).
> **Esto qué es:** la **carta de aterrizaje** del día 1. Léela completa antes de abrir nada más. Después seguís con [`HANDOFF.md`](HANDOFF.md) → [`docs/PROJECT_STATE_HANDOFF.md`](docs/PROJECT_STATE_HANDOFF.md) → [`ARCHITECTURE.md`](ARCHITECTURE.md).
>
> **Tiempo:** 12-15 min de lectura.
>
> **Promesa:** acá no hay marketing, no hay aspiraciones, no hay "deberíamos". Solo lo que es.

---

## 0. La idea de una frase

Producto interno de DVPNYX que integra el ciclo **quote → contract → staff → time tracking** en una sola herramienta. Antes vivía en 3 spreadsheets desincronizados; ahora vive acá. La facturación queda en Holded — esto **no factura**.

Si funciona bien, los flujos de negocio son:

1. **Comercial** crea cliente → oportunidad → cotización (staff aug o fixed scope).
2. **Comercial** marca la oportunidad como ganada → quotation se convierte en contrato con un click.
3. **Delivery / Capacity** hace kick-off del contrato → el sistema crea resource_requests automáticos.
4. **Capacity** asigna empleados a las requests desde el Capacity Planner.
5. **Empleados** registran horas contra sus asignaciones.
6. **Lead / Finance** ven plan-vs-real semanal, idle time mensual, revenue periods.

Pasaron 30+ módulos por acá. La columna vertebral son esos 6 pasos.

---

## 1. Lo que funciona y NO hay que romper

Items con uso real en producción y tests verdes. Si los toca el equipo entrante, debe ser con cuidado deliberado, no como casualidad de un refactor:

- **Quote → Contract → Staff → Time tracking end-to-end**. Es la tesis. Si algo se rompe, todo se rompe.
- **Capacity Planner timeline** con asignación in-place desde modal de candidatos. Lo más usado por Capacity Manager.
- **Plan-vs-Real semanal** con tolerancia ±10pp y auto-scoping por rol. Reporte estrella post planning-loop.
- **Pipeline 9 estados + Postponed + opportunity_number** (SPEC-CRM-00, mayo 2026). Recién entregado, recién testeado, recién mergeado. **No reescribir el SSOT del pipeline** sin sincronizar los 3 puntos: `server/utils/pipeline.js` + `client/src/utils/pipeline.js` + trigger DB `opp_pipeline_recalc()`.
- **RBAC 7 roles + scoping inline** en oportunidades (SPEC-CRM-00). Las macros canónicas (`SEE_ALL_ROLES`, `WRITE_ROLES`) están en [`server/middleware/auth.js`](server/middleware/auth.js); úsenlas, no harcodeen listas de roles en cada route.
- **Sistema de alertas A1-A5** con dedup 24h sobre la tabla de notifications. Documentado en [`ARCHITECTURE.md §6.1`](ARCHITECTURE.md). Diseñado para que `POST /api/opportunities/check-alerts` corra en cron diario — todavía no está cableado a un cron real (ver §3).
- **Auto-rollback en deploy a prod** ([`docs/runbooks/DEPLOY.md`](docs/runbooks/DEPLOY.md)). Health check + rollback automático si falla. Probado.
- **Idempotencia de migrate.js**. 2267 líneas de DDL, todo `IF NOT EXISTS`. Corre en cada deploy. **No** escribir migraciones destructivas sin discutirlo primero.
- **CI con 6 pipelines** que cubren tests en PR, deploy a dev al mergear, deploy a prod manual desde develop, rollback manual, backup nightly, y un stack CDK inactivo listo para activar.
- **Capa AI-readiness** (tablas + helpers + endpoints). Aunque hoy es shelfware (ver §4), la fundación está bien diseñada — no la borren sin razón.

---

## 2. Lo que ya está marcado "wip" o "aspirational" — y nadie lo está moviendo

Espacio limpio para que el equipo entrante decida. **Nadie está activamente trabajando en estos**, así que pueden tomarlos sin pisar a nadie:

| Item | Estado actual | Decisión que pesa |
|---|---|---|
| `squad_id NOT NULL` en `contracts/opportunities` con UI que no expone squads | Auto-provisión `DVPNYX Global` tapa el problema. Schema no refleja dominio. | **Dropear o exponer.** No hay tercer camino bonito. |
| Dual-write de cotizaciones (legacy `quotation_lines` + V2 `quotation_allocations`) | Ambos modelos vivos, escritura en ambos. | **Cortar a V2 puro** o seguir soportando legacy. Al refactor que haga el corte le va a doler. |
| Aprobaciones (`assignments.approval_required/approved_at/approved_by`, `time_entries.status='submitted'`) | Columnas existen, flow no construido. Todo es pre-aprobado hoy. | **Construir el flow** o quitar las columnas. Los datos hablan: lleva ~6 meses sin tocarse. |
| Revenue immutability (`revenue_periods.status='closed'` debería ser inmutable por NIIF 15) | Código depende de no permitir UPDATEs sin trigger DB. | **Agregar trigger** si hay auditoría externa o riesgo finance. |
| Override de assignments (`override_*`) sin enforce DB | Capturado pero confiamos en que el código no haga bypass silencioso. | Idem revenue: **trigger DB** si quieren defense-in-depth. |
| pgvector best-effort | Si la imagen Postgres no tiene la extensión, las columnas `*_embedding` no se crean. AI semantic search no funciona hasta que infra instale. | **Instalar pgvector** en RDS prod cuando se decida estrenar el primer agente IA. |
| `events` y `notifications` con uso parcial | `events` se escribe en cada mutation pero **sin consumer**. `notifications` la SPA la consume vía polling cada 60s, pero la tabla crece sin retention policy. | **Consumer de events** (worker / cron / dashboard) y **archivar notifications** con >90 días. |

---

## 3. Las 4 (5) decisiones abiertas que dejé sin tomar

Conscientemente las dejé para vos porque o (a) requieren input de stakeholders que no tengo a la mano, o (b) son decisiones de roadmap que no me corresponde tomar como PO interino:

1. **Squads**: ¿se dropea del schema o se expone en la UI?
   - *Por qué pesa*: cada cliente nuevo de DVP probablemente lo va a querer (segmentación de portafolio), pero al ritmo actual single-tenant tampoco urge.
2. **Dual-write de cotizaciones**: ¿se corta a V2 puro o se mantiene el legacy indefinido?
   - *Por qué pesa*: cualquier refactor del cotizador en V3 (nueva UI, nuevos campos, etc.) duplica el costo si tiene que mantener el dual-write.
3. **Billing**: ¿se construye o se difiere "definitivamente" a Holded?
   - *Por qué pesa*: el README solía prometer "→ bill" y no era real. Hoy ya no lo promete (PR #112). La pregunta es si DVPNYX quiere cerrar el loop financiero acá o aceptar que Holded es la fuente de verdad final.
4. **AI layer**: ¿se estrena el primer agente productivo o se congela la fundación hasta que haya un caso de uso con KPI?
   - *Por qué pesa*: la fundación está construida y mantener la complejidad cuesta. El primer agente obvio sería **candidate ranking con embeddings** (ver [`docs/AI_INTEGRATION_GUIDE.md §7.1`](docs/AI_INTEGRATION_GUIDE.md)), pero requiere instalar pgvector + popular embeddings + cablear a la UI de modal de candidatos.
5. **(bonus)** **Cron de alertas CRM**: el endpoint `POST /api/opportunities/check-alerts` está implementado pero no cableado a un cron real. La cadencia recomendada es diaria — ¿se hace con `cron` en el host EC2, con GitHub Actions schedule, con AWS EventBridge, o se corre manual por Daniel hasta que sea problema?

Mi sugerencia táctica: tomen las 4 grandes en una sesión de 90 min con Daniel + un Slack del CCO en los próximos 30 días. La 5ª la pueden resolver solos en 15 min.

---

## 4. Lo que YO recomendaría como CTO entrante (en orden)

Esto es opinión, no instrucción. Tómenlo como hipótesis.

### Primeros 30 días — observabilidad + entender el sistema

1. **Sentry + structured logging (`pino`)**. Hoy hay **97 `console.error/log/warn`** en `server/{routes,utils,middleware}` sin contexto enriquecido. Es lo que les va a doler en el primer incidente. ROI altísimo, costo 2-3 días.
2. **Healthcheck en `docker-compose.yml`**. `/api/health` existe pero no hay liveness probe en compose. Si Express cuelga, Docker no lo detecta. 30 min.
3. **Análisis de uso real con PostHog (free tier)**. Sin telemetría, no hay forma de saber qué de los 30 módulos usa la gente. Apuesto sin verificar que 5-7 módulos concentran el 80% del uso y el resto está dormido — esos serían candidatos a deprecation explícita.
4. **Métricas North Star del producto**. No hay KPIs documentados. Conversación con Daniel + CCO para definir 3-5 (utilización media, % requests filled <72h, NPS interno, adoption por módulo, time-to-staff).

### Días 30-90 — seguridad + roadmap real

5. **MFA para `superadmin` + SSO Google Workspace**. Threat model está documentado en [`SECURITY.md`](SECURITY.md). MFA falta hace tiempo y es low-cost. SSO casi todos los DVPers ya tienen Google.
6. **`npm audit` en CI** + Dependabot/Renovate.
7. **JWT en HttpOnly cookie** (vs `localStorage` actual). Defense-in-depth contra XSS.
8. **Cron de alertas CRM** cableado. Es el siguiente paso natural del PR 4 de SPEC-CRM-00.

### Cuando los toquen y no antes — refactor de archivos monstruo

- [`client/src/modules/CapacityPlanner.js`](client/src/modules/CapacityPlanner.js) — **1.203 líneas**.
- [`server/routes/employee_costs.js`](server/routes/employee_costs.js) — **1.190 líneas**.
- [`server/routes/contracts.js`](server/routes/contracts.js) — **967 líneas**.
- [`server/routes/opportunities.js`](server/routes/opportunities.js) — **1.270+ líneas** post SPEC-CRM-00.

A esa densidad, el primer dev nuevo demora semanas en tocarlos con confianza. **Working agreement sugerido**: target `<400 LOC/módulo`. Refactor incremental cuando se toquen — no big-bang.

---

## 5. Cosas que probablemente NO valen la pena

Lo dejo escrito para que no caigan en la tentación de "limpiar" cosas que ya tomamos como decisión de difer:

| Item | Por qué difer |
|---|---|
| Multi-tenant | Single-tenant (DVPNYX) bastará por ≥1 año. Cuando se venda a 2do cliente, evaluar. |
| RLS / row-level security | Permisos en app code son suficientes hoy. RLS agrega complejidad y debug difícil. |
| Migrate to TypeScript | Refactor masivo. Beneficio incremental no compensa el costo de transición. |
| Workers async para PDF/XLSX | Volumen actual no satura el thread principal. |
| Event bus externo (SNS/SQS, Kafka) | `events` table cumple para audit y replay; consumers en otra app vendrán después. |
| Microservicios / CQRS | Monolito Express escala bien hasta ~50 empleados / 1 cliente / 100K events. Estamos en ~30 empleados. |
| Migrar a node-pg-migrate | Cambia el deployment workflow. `migrate.js` idempotente cumple bien. |

Si cambia algo de esto, va a [`docs/DECISIONS.md`](docs/DECISIONS.md) como ADR antes de empezar a tocar código.

---

## 6. Cosas verdaderas que conviene saber (no van en otro doc)

### 6.1 La capa AI-readiness es **shelfware**

Esto importa decirlo en voz alta porque el README la pinta importante:

- El backend tiene 7 columnas `*_embedding vector(1536)` con HNSW indexes.
- 3 tablas (`ai_interactions`, `ai_prompt_templates`, `delivery_facts`).
- Helpers (`ai_logger.js`, `slug.js`, `level.js`, `json_schema.js`) listos.
- Endpoints `GET /api/ai-interactions` (admin) + `POST /:id/decision` (feedback loop).
- **`grep -rn "anthropic\|openai" server` retorna CERO matches en código productivo.** No hay agente conectado.

La fundación está bien construida, pero hoy mantenerla cuesta y no produce valor. Decisión #4 de §3.

### 6.2 Observabilidad real = no hay

Source of truth de errores en prod hoy:
1. `docker compose logs server | grep -i error` (manual, en EC2).
2. GitHub Actions logs del último deploy.
3. Reportes de usuarios via Slack interno.

No hay APM, no hay tracing, no hay alertas automáticas. Si algo falla en prod a las 3am, nadie se entera hasta que el primer usuario lo nota a las 9am. Recomendación #1 de §4.

### 6.3 Backup y DR — probado pero no probado

[`docs/runbooks/DR.md`](docs/runbooks/DR.md) tiene 1.509 líneas y cubre backup nightly + restore. **El restore real no se ha probado en >6 meses.** Recomiendo correr una restauración en staging dentro de los primeros 60 días — no sea cosa que el día que lo necesiten descubran que algo cambió.

### 6.4 Hay 30 módulos UI; probablemente 5-7 concentran el 80% del uso

Sin telemetría no se puede confirmar. La hipótesis más probable es:
- **Top-uso**: Capacity Planner, Time/Me, Opportunities (lista + Kanban), Reports, Dashboard.
- **Uso medio**: Clients, Contracts, Assignments, Resource Requests, Time/Team.
- **Cola larga**: 15+ módulos que pueden estar dormidos (Iniciativas internas, Novelties, Idle Time, Country Holidays, Wiki, etc.).

Esto importa porque el costo de mantener un módulo crece con el tiempo. Si algo está dormido, vale la pena saberlo y tomar decisión explícita (deprecate vs invertir vs mantener as-is).

### 6.5 Los 2 tests rojos en TimeMe

Reportados como "pre-existentes, no bloqueantes" desde hace meses. Sospecha primaria documentada en el header de [`client/src/modules/TimeMe.test.js`](client/src/modules/TimeMe.test.js): cálculo dinámico de Lunes con timezone/DST. Fix probable: `jest.useFakeTimers().setSystemTime()`. Esfuerzo estimado: 30-60 min.

---

## 7. Día 1 / Día 7 / Día 30 — sugerencia de onboarding

### Día 1 (lunes 2026-05-15)

- [ ] Leer este doc + [`HANDOFF.md`](HANDOFF.md) + [`docs/PROJECT_STATE_HANDOFF.md`](docs/PROJECT_STATE_HANDOFF.md). 1.5 horas.
- [ ] Levantar local: `docker compose -f docker-compose.dev.yml up --build`. Login con `admin@dvpnyx.com / admin123`.
- [ ] Recorrer los 3 happy paths del [`docs/AUDIT_2026-05.md §2`](docs/AUDIT_2026-05.md). 1 hora.
- [ ] Sesión de 30 min con Daniel (PO referente) — preguntar **cualquier cosa**.

### Días 2-7

- [ ] Leer [`ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md), [`docs/MODULES_OVERVIEW.md`](docs/MODULES_OVERVIEW.md), [`docs/specs/v2/03_data_model.md`](docs/specs/v2/03_data_model.md).
- [ ] Tomar 1 bug pequeño del backlog para "warm up". Cualquier cosa de [`docs/AUDIT_2026-05.md §3`](docs/AUDIT_2026-05.md) sirve (los 2 tests rojos de TimeMe son perfectos).
- [ ] Sesión de 90 min con Daniel para resolver las 4 decisiones abiertas (§3).
- [ ] Decidir cadencia de standups + retros + 1-on-1.

### Días 8-30

- [ ] Instalar Sentry + structured logging (recomendación #1).
- [ ] Definir 3-5 KPIs North Star + instalar PostHog.
- [ ] Configurar MFA para superadmin.
- [ ] Cablear cron de alertas CRM (decisión §3.5).
- [ ] Roadmap de los próximos 90 días basado en datos de PostHog + decisiones de §3.

---

## 8. Cómo me contactan

Daniel sigue como **PO referente** para preguntas de producto, contexto de decisiones pasadas, e introducción a stakeholders (CCO, CFO, finance). No espera estar en el día a día técnico — el equipo senior es dueño de eso.

| Canal | Para qué |
|---|---|
| Slack DM a Daniel | Preguntas de producto, contexto histórico, introducción a stakeholders |
| Slack `#quoter-handoff` (a crear) | Comunicación grupal del primer mes |
| GitHub issues | Bugs, features, deuda técnica formal |
| `docs/DECISIONS.md` | ADRs nuevos. Si toman una decisión grande de arquitectura/producto, documentar aquí en el mismo PR. |

---

## 9. Lo último

Este doc es un snapshot del 2026-05-02. **Si algo no calza con lo que ven en el código, el código gana** — esa es la regla heredada. Avisen si encuentran cosas que estén mal documentadas; cualquier inconsistencia es deuda que dejé yo.

El producto funciona. La documentación está al día (acabamos de cerrar el drift de SPEC-CRM-00 en el PR #113). Los tests están verdes salvo los 2 conocidos. El deploy automatizado tiene auto-rollback.

Lo que falta es lo que falta en cualquier producto real: observabilidad, telemetría de uso, refactor de las 3 monsters, MFA. Todo manejable. Nada de eso es bloqueante para que el negocio siga funcionando hoy.

Suerte. Y gracias por agarrar esto.

— Daniel (vía Claude, su asistente de los últimos 13 días)

---

*Documento vivo. Última revisión: 2026-05-02. Si pasa más de 1 sprint sin actualizarse después de un cambio grande, dejá de creerle.*
