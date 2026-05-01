# Roadmap — DVPNYX Quoter

Estado de cada capacidad del producto: ✅ live, 🚧 wip, ❌ no implementado, ⚠️ con caveat. Snapshot 2026-05.

---

## ✅ Live en producción

### Comercial
- Master de **clientes** con CRUD + soft delete + activate/deactivate
- **Oportunidades** con pipeline Kanban, probability/weighted automática vía trigger, transitions con side effects
- **Cotizador** staff_aug (lista de recursos por mes) con motor de cálculo
- **Cotizador** fixed_scope con phases + epics + milestones + allocations
- Conversión **quotation → contract** de un click (`POST /api/contracts/from-quotation/:id`)

### Delivery
- **Contratos** con types `capacity | project | resell` y lifecycle completo
- **Kick-off del contrato**: lee winning_quotation y crea resource_requests automáticos. Permisos: admin / DM / owner / cap-manager
- **Resource requests** con quantity, priority, language_requirements, skills, status computado
- **Candidate ranking** boolean (área + level + skills + availability) en `utils/candidate_matcher.js`
- **Assignment validation engine** con 4 motores (área, level, capacity, overlap) + override structurado
- **Capacity Planner** timeline + métricas + asignación in-place desde modal de candidatos
- Notificaciones in-app a stakeholders en mutations relevantes

### Time tracking
- **`/time/me`**: matriz semanal de horas diarias por asignación (`time_entries`)
- **`/time/team`**: % semanal por asignación con bench auto-calculado (`weekly_time_allocations`). Coexisten — ver decisión [TIME-MODEL](DECISIONS.md#time-model)
- Permisos: empleados se ven a sí mismos, leads ven sus reportes directos, admins ven todo

### Reportes
- Utilization, Bench, Pending Requests, Hiring Needs, Coverage, Time Compliance
- **Plan-vs-Real semanal**: compara `assignments.weekly_hours / capacity` vs `weekly_time_allocations.pct` con tolerancia ±10pp y status (`on_plan | over | under | missing | unplanned | no_data`)
- Auto-scoping por rol (lead → manager_user_id forzado, member → su employee)
- Executive Dashboard, My Dashboard

### Personas
- Master de **empleados** con skills (proficiency: beginner/intermediate/advanced/expert)
- 9 áreas + ~60 skills en 8 categorías (seeds idempotentes)
- **Manager / lead** assigning desde EmployeeDetail (admin-only)
- Status lifecycle: `active ↔ on_leave ↔ bench → terminated`

### Finanzas (placeholder explícito)
- **Revenue periods** mensual por contrato (RR-MVP-00.1)
- **Exchange rates** mensuales tipo USD↔ con conversión multi-período

### Plataforma
- **JWT auth** con bcrypt cost 12, rate limit en login
- **Roles**: `superadmin > admin > lead > member > viewer` (+ `preventa` legacy)
- **Bulk import** CSV con dry-run + commit
- **Command palette** Cmd-K
- **Notifications drawer** lateral
- **User preferences**: dark mode, accent hue, density (con optimistic UI)
- **Design system** con tokens CSS OKLCH, dark mode, 6 presets de acento

### AI-readiness (mayo 2026)
- Schema: `ai_interactions`, `ai_prompt_templates`, `delivery_facts`, embeddings vector(1536) en 7 tablas (si pgvector disponible)
- Helpers: `ai_logger`, `slug`, `level`, `json_schema` validator
- Endpoints: `GET /api/ai-interactions` (admin), `POST /:id/decision` (feedback loop)
- HNSW indexes con `vector_cosine_ops`
- Function `refresh_delivery_facts(from, to)` para job nocturno
- Materialized view `mv_plan_vs_real_weekly`
- Ver [`AI_INTEGRATION_GUIDE.md`](AI_INTEGRATION_GUIDE.md)

---

## ⚠️ Con caveat (live pero limitado)

### Squads ocultos
- `squad_id NOT NULL` en contracts y opportunities pero el UI no expone squads. Auto-provisión de "DVPNYX Global" si la tabla está vacía.
- **Decisión pendiente:** dropear o exponer.

### Quotation dual-write
- Editores Unified vs no-Unified coexisten en el código.
- Modelo legacy `client_name VARCHAR` denormalizado vs `client_id UUID` FK ambos vivos.
- Refactor pendiente cuando se toque cotizador a fondo.

### Time tracking duplicado
- Dos modelos paralelos (`time_entries` daily + `weekly_time_allocations` weekly). Decisión consolidación pendiente — ver [DECISIONS.md](DECISIONS.md#time-model).

### Override sin enforce DB
- `assignments.override_*` capturados pero no enforced por trigger. Depende del código no permitir bypass silencioso.

### Revenue immutability
- Rows `closed` en `revenue_periods` deberían ser inmutables (NIIF 15) pero el código depende de no permitir UPDATEs sin que haya trigger DB.

### Approvals aspirational
- `assignments.approval_required/approved_at/approved_by` y `time_entries.status='submitted'` existen pero el flow de aprobación no está construido. Hoy todo está pre-aprobado.

### pgvector best-effort
- Si la imagen postgres no tiene la extensión, las columnas `*_embedding` no se crean y el resto migra normal. Los HNSW indexes tampoco. AI semantic search no funciona hasta que infra instale la extensión.

---

## 🚧 En progreso / planeados

### Recién entregado (mayo 2026 inicial)

- ✅ **Sortable tables** (Phase 17) — todas las tablas paginadas tienen click-to-sort en columnas de atributos, `<SortableTh>` accesible (aria-sort, Enter/Space), tie-breaker estable. Cableado en Contracts, Employees, Opportunities, Clients, ResourceRequests, Assignments. Pendientes: Reports, EmployeeCosts mass view (sortRows client-side).
- ✅ **PERF-001/002/003** — visibility-gate del polling de notifications, JOIN ON filter en reports/utilization+bench, índice parcial `assignments_employee_active_idx`.
- ✅ **INC-002 fix** — defense-in-depth con SAVEPOINT en `notify()` y `emitEvent()` cuando se llaman desde un client de transacción.
- ✅ **INC-003 fix** — endpoints `/lookup` dedicados en employees y resource-requests, sin paginación, para alimentar dropdowns que necesitan el universo completo.
- ✅ **Housekeeping mayo 2026** — 87 ramas remotas mergeadas eliminadas; deps no usadas removidas (`uuid`, `express-validator`, `jspdf`, `jspdf-autotable`, `@dnd-kit/sortable`); `.docx` binarios untrackeados.

### Próxima ola (Q3 2026 sugerida)

- **Backfill de embeddings** (job + endpoint admin)
- **Cron job nocturno** para `refresh_delivery_facts`
- **Switch del endpoint plan-vs-real** a leer de `mv_plan_vs_real_weekly` con `REFRESH CONCURRENTLY`
- **Backfill de slugs** para entidades existentes
- **Backfill de narrative en areas y skills** (con LLM o manualmente)
- **Primer agente productivo**: candidate ranking con embeddings (ver [`AI_INTEGRATION_GUIDE.md §7.1`](AI_INTEGRATION_GUIDE.md))
- **UI de feedback loop** para `ai_interactions` (botones accept/reject en cada sugerencia)

### Fundaciones técnicas (cuando haya bandwidth de infra)

- **Migrar a node-pg-migrate** (cambia deployment workflow)
- **Particionar `events` por mes** (data migration)
- **Consolidar `audit_log` → `events`** (data migration + cleanup de write paths)
- **Materialized views** para más reportes (utilization mensual, bench histórico)
- **Connection pooling externo** (PgBouncer) para horizontal scale

---

## ❌ No implementado todavía

### Producto
- **Billing / facturación / integración contable** — el ciclo termina en `time_entries`. No hay export a contabilidad.
- **Aprobación de assignments** (lead) y **time entries** (manager) como flow formal.
- **Forecasting de capacidad** (3-6 meses adelante con probability del pipeline).
- **Calendario de vacaciones / ausencias** integrado con utilización.
- **Integración CRM externa** (HubSpot, Salesforce). Sólo hay `external_crm_id` placeholder.
- **Plantillas de proyecto** reutilizables (rebajar boilerplate de fixed_scope quotations).
- **Margen real** vs proyectado por contrato (requiere capturar costos reales).
- **OKRs / metas** por squad/persona.

### Plataforma
- **Multi-tenant** (separación lógica por cliente final del SaaS, si DVPNYX vende esto a otra agencia).
- **RLS / row-level security** para enforcement DB-side.
- **Encryption at column level** (pgcrypto) para `cost_*`.
- **MFA** y **failed_login_attempts** en `users`.
- **SSO** corporate (SAML / OIDC).
- **Observabilidad real**: Datadog / Sentry / OpenTelemetry. Hoy sólo `console.error` + GitHub Actions logs.
- **APM** y métricas de latencia P50/P99.
- **Audit de READS** sobre datos sensibles (PII, costos).

### Arquitectura
- **Microservicios** o **CQRS** — hoy monolito Express. Escala bien hasta ~50 empleados / 1 cliente / 100K events.
- **Event bus** real (SNS/SQS, Kafka). Hoy `events` table sin consumers.
- **Worker async** para PDF/XLSX export pesado (corre en el thread principal).
- **CDN** para assets — los sirve el mismo Express.

### AI / ML
- **Embeddings populados automáticamente** al crear/editar entidades.
- **Async embedding generation** vía queue (no inline en INSERT).
- **Análisis de overrides** con clasificador automático.
- **Asistente Q&A** sobre histórico (RAG).
- **Sugerencias proactivas**: "Este empleado está con bench 3 semanas, hay 2 requests abiertos que matchean".
- **Auto-resumen** de quotations / contracts.

---

## Decisiones diferidas

Items que conscientemente NO vamos a hacer hasta tener feedback de uso real:

| Item | Por qué se difiere |
|---|---|
| Multi-tenant | Single-tenant (DVPNYX) bastará por ≥1 año. Cuando se venda a 2do cliente, evaluar |
| RLS | Permisos en app code son suficientes hoy. RLS agrega complejidad y debug difícil |
| Migrate to TypeScript | Refactor masivo. Beneficio incremental no compensa el costo de transición |
| Workers async | Volumen de exports actual no satura el thread |
| Event bus externo | events table cumple para audit y replay; consumers en otra app vendrán después |
| Facturación / contabilidad | Está en otro sistema (Holded) — se integra al final |

---

## Métricas actuales (mayo 2026)

| Métrica | Valor |
|---|---|
| Tablas en DB | ~28 |
| Endpoints API | ~85 |
| Módulos UI | ~25 |
| Tests server | 638 / 638 ✅ |
| Tests client | 325 / 327 ✅ (2 TimeMe pre-existentes) |
| Build production cliente | clean, sin warnings |
| Test coverage | server ~80%, client ~70% |
| Líneas de código | server ~12K, client ~18K |

---

## ¿Cómo cambia este roadmap?

1. **Cuando algo de ❌ pasa a 🚧:** un PR con la rama, deja un link en este archivo.
2. **Cuando algo de 🚧 pasa a ✅:** mover de sección. Actualizar el [`CHANGELOG.md`](../CHANGELOG.md).
3. **Cuando algo de ⚠️ se resuelve:** quitar el caveat, mover a ✅.
4. **Cuando se decide diferir algo nuevo:** documentar en [`DECISIONS.md`](DECISIONS.md) con razón.

---

*Este archivo se mantiene a mano. Si pasa más de 2 sprints sin actualizarse, dejá de creer en él y revisa el código.*
