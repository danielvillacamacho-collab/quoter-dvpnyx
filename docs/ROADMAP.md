# Roadmap — DVPNYX Quoter

Estado de cada capacidad del producto: ✅ live, 🚧 wip, ❌ no implementado, ⚠️ con caveat. Snapshot **2026-05-02** (post SPEC-CRM-00 v1.1).

---

## ✅ Live en producción

### Comercial — **expandido con SPEC-CRM-00 v1.1 (mayo 2026)**
- Master de **clientes** con CRUD + soft delete + activate/deactivate
- **Oportunidades** con pipeline Kanban + **9 estados** (`lead → qualified → solution_design → proposal_validated → negotiation → verbal_commit → {closed_won | closed_lost | postponed}`), probabilidades 5/15/30/50/75/90/100/0/0, transitions con side effects
- **Postponed** como limbo no terminal (sale a `qualified` o `closed_lost`); requiere `postponed_until_date` + razón
- **`opportunity_number`** correlativo `OPP-{cc}-{year}-{seq}` (cc = country del cliente)
- **Modelo de revenue**: `one_time | recurring | mixed` con booking derivado por trigger DB. Helpers `server/utils/booking.js` + `client/src/utils/booking.js` mantienen la fórmula sincronizada. Columnas: `revenue_type`, `one_time_amount_usd`, `mrr_usd`, `contract_length_months`
- **Champion + Economic Buyer** flags + funding source (con MDF) + `drive_url`
- **Loss reason enum extendido** (price/competitor_won/no_decision/budget_cut/champion_left/wrong_fit/timing/incumbent_win/other) con detail ≥30 chars
- **Margen** persistido (`estimated_cost_usd`, `margin_pct`) con CHECK constraints + endpoint `POST /api/opportunities/:id/check-margin` (auto-computa desde líneas si no se pasa el costo)
- **RBAC 7 roles** scopeado en `GET /api/opportunities` y `GET /kanban`: see-all (superadmin/admin/director) ven todo; lead ve squad; member ve solo las suyas; external → 403
- **Sistema de alertas CRM** (A1 estancada >30d, A2 next_step vencido, A3 Champion/EB gap, A4 margen bajo, A5 cierre próximo). `POST /api/opportunities/check-alerts` para cron diario; A3 inline en transiciones
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

### Recién entregado (mayo 2026)

- ✅ **SPEC-CRM-00 v1.1** (4 PRs, 2026-05-01 a 2026-05-02) — pipeline 9 estados + Postponed + opportunity_number; revenue model formal con booking derivado; champion/EB + funding + loss reasons enum extendido; margin_pct + endpoint check-margin; RBAC 7 roles con scoping inline; sistema de alertas A1-A5 con dedup 24h. Detalle en [`CHANGELOG.md`](../CHANGELOG.md).
- ✅ **Sortable tables** (Phase 17) — todas las tablas paginadas tienen click-to-sort en columnas de atributos, `<SortableTh>` accesible (aria-sort, Enter/Space), tie-breaker estable. Cableado en Contracts, Employees, Opportunities, Clients, ResourceRequests, Assignments. Pendientes: Reports, EmployeeCosts mass view (sortRows client-side).
- ✅ **PERF-001/002/003** — visibility-gate del polling de notifications, JOIN ON filter en reports/utilization+bench, índice parcial `assignments_employee_active_idx`.
- ✅ **INC-002 fix** — defense-in-depth con SAVEPOINT en `notify()` y `emitEvent()` cuando se llaman desde un client de transacción.
- ✅ **INC-003 fix** — endpoints `/lookup` dedicados en employees y resource-requests, sin paginación, para alimentar dropdowns que necesitan el universo completo.
- ✅ **Housekeeping mayo 2026** — 87 ramas remotas mergeadas eliminadas; deps no usadas removidas (`uuid`, `express-validator`, `jspdf`, `jspdf-autotable`, `@dnd-kit/sortable`); `.docx` binarios untrackeados.
- ✅ **Cleanups pre-handoff 2026-05-02** (`#112`) — dead import borrado en `App.js`, README/HANDOFF alineados al alcance real (sin "→ bill"), corrección de stub falso de `/api/notifications` en PROJECT_STATE_HANDOFF, nota explicativa en TimeMe.test.js, [`docs/AUDIT_2026-05.md`](AUDIT_2026-05.md) como hoja de ruta de los 13 días previos al handoff.

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

## Métricas actuales (mayo 2026, post SPEC-CRM-00 v1.1)

| Métrica | Valor |
|---|---|
| Tablas en DB | ~28 (sin contar columnas nuevas de CRM-00) |
| Endpoints API | ~88 (incluye `check-margin`, `check-alerts`) |
| Módulos UI | ~30 |
| Tests server | ~1018 ✅ (post SPEC-CRM-00) |
| Tests client | ~471 / 473 ✅ (2 TimeMe pre-existentes — DST/timezone, ver header del archivo) |
| Build production cliente | clean, sin warnings |
| Test coverage | server ~80%, client ~70% |
| Líneas de código | server ~14K, client ~20K |

---

## ¿Cómo cambia este roadmap?

1. **Cuando algo de ❌ pasa a 🚧:** un PR con la rama, deja un link en este archivo.
2. **Cuando algo de 🚧 pasa a ✅:** mover de sección. Actualizar el [`CHANGELOG.md`](../CHANGELOG.md).
3. **Cuando algo de ⚠️ se resuelve:** quitar el caveat, mover a ✅.
4. **Cuando se decide diferir algo nuevo:** documentar en [`DECISIONS.md`](DECISIONS.md) con razón.

---

*Este archivo se mantiene a mano. Si pasa más de 2 sprints sin actualizarse, dejá de creer en él y revisa el código.*
