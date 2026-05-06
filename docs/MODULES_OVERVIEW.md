# Mapa de módulos — DVPNYX Quoter

Vista funcional + técnica de cada módulo del sistema. Por cada uno: qué hace, dónde vive en el código, endpoints clave, archivos UI, y deuda activa.

Útil para onboarding rápido y para saber dónde tocar cuando cambia un requerimiento.

---

## Índice por área de negocio

- **Comercial**: [Clients](#clients) · [Contacts](#contacts) · [Opportunities](#opportunities) · [Activities](#activities) · [Quotations](#quotations)
- **Delivery**: [Contracts](#contracts) · [Resource Requests](#resource-requests) · [Assignments](#assignments) · [Capacity Planner](#capacity-planner)
- **Time Tracking**: [Time Entries (`/time/me`)](#time-entries-timeme) · [Weekly Allocations (`/time/team`)](#weekly-allocations-timeteam)
- **Personas**: [Employees](#employees) · [Areas + Skills](#areas--skills)
- **Finanzas**: [Revenue](#revenue) · [Exchange Rates](#exchange-rates) · [Budgets](#budgets)
- **Reportes**: [Reports + Plan-vs-Real](#reports--plan-vs-real) · [Executive Dashboard](#executive-dashboard)
- **Plataforma**: [Auth + Users](#auth--users) · [Notifications](#notifications) · [Bulk Import](#bulk-import) · [Parameters](#parameters) · [AI Interactions](#ai-interactions)

---

## Clients

**Qué hace:** CRUD de clientes finales (Bancolombia, Acme, etc.). Punto de partida del pipeline comercial.

| Aspecto | Ubicación |
|---|---|
| Server route | `server/routes/clients.js` |
| Tests | `server/routes/clients.test.js` |
| UI lista | `client/src/modules/Clients.js` |
| UI detalle | `client/src/modules/ClientDetail.js` |
| Tabla | `clients` |
| Endpoints | `GET /api/clients`, `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/activate`, `POST /:id/deactivate`, `DELETE /:id` |

**Reglas:**
- `name` UNIQUE case-insensitive entre activos.
- Soft delete bloqueado si tiene opportunities/contracts no-eliminados (devuelve 409 con instrucción).
- `tier`: `enterprise | mid_market | smb`.

**Deuda:** ninguna activa.

---

## Contacts

> **Nuevo en SPEC-CRM-01** (mayo 2026).

**Qué hace:** personas de contacto en clientes. Cada contacto pertenece a un `client_id` y puede vincularse a N oportunidades vía `opportunity_contacts` con un deal role (economic_buyer, champion, coach, decision_maker, influencer, technical_evaluator, procurement, legal, detractor, blocker).

| Aspecto | Ubicación |
|---|---|
| Server route | `server/routes/contacts.js` |
| UI lista | `client/src/modules/Contacts.js` |
| Tabla | `contacts` + `opportunity_contacts` (bridge) |
| Endpoints | `GET /api/contacts`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `GET /by-client/:clientId`, `GET /by-opportunity/:oppId`, `POST /opportunity-link`, `DELETE /opportunity-link/:id` |

**Reglas:**
- `seniority` enum: `c_level | vp | director | manager | senior | mid | junior | intern`.
- `opportunity_contacts` upsert vía `ON CONFLICT (opportunity_id, contact_id)`.
- Soft delete.

**Deuda:** ninguna.

---

## Opportunities

> **Reescrito en SPEC-CRM-00 v1.1** (mayo 2026): pipeline 9 estados + revenue model + margin + RBAC scoping + alertas. Enriquecido en **SPEC-CRM-01** con `deal_type`, `co_owner_id`, exit criteria por etapa, y vínculos a contactos/actividades. Ver [`CHANGELOG.md`](../CHANGELOG.md) y [`API_REFERENCE.md#opportunities`](API_REFERENCE.md) para detalle.

**Qué hace:** pipeline comercial. Cada cliente puede tener N oportunidades. Estados forman un Kanban con probabilidades calibradas.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/opportunities.js` (~1250 LOC post CRM-01) |
| Helpers server | `server/utils/pipeline.js`, `server/utils/booking.js`, `server/utils/alerts.js` |
| Helpers client | `client/src/utils/pipeline.js`, `client/src/utils/booking.js` |
| UI lista | `client/src/modules/Opportunities.js` |
| UI detalle | `client/src/modules/OpportunityDetail.js` |
| UI Kanban | `client/src/modules/PipelineKanban.js` |
| Tablas | `opportunities` (+ trigger `opp_pipeline_recalc`), reutiliza `notifications` para alertas |
| Endpoints | listado + `/kanban` + `/:id/status` + `/:id/check-margin` + `/check-alerts` |

**Pipeline 9 estados (post CRM-00):**
```
lead → qualified → solution_design → proposal_validated → negotiation → verbal_commit → {closed_won | closed_lost | postponed}
```
Probabilidades 5/15/30/50/75/90/100/0/0. `postponed` es **limbo no terminal** — solo sale a `qualified` (reactivar) o `closed_lost`. Requiere `postponed_until_date` futura.

`opportunity_number = OPP-{cc}-{year}-{seq}` correlativo por (country, year), backfill idempotente para legacy.

Las transiciones permiten saltos hacia atrás (Kanban drag-and-drop), pero generan warnings (`amount_zero`, `backwards`, `close_date_past`, `a4_margin_low`) — son nudges, no bloqueos.

**Migración legacy:** `open→lead`, `proposal→proposal_validated`, `won→closed_won`, `lost+cancelled→closed_lost`. Se hace una sola vez en migrate.js.

**Modelo de revenue (CRM-00 PR 2):**
- `revenue_type`: `one_time | recurring | mixed` con booking derivado por trigger DB.
  - `one_time` → `booking = one_time_amount_usd`.
  - `recurring` → `booking = mrr_usd × contract_length_months`.
  - `mixed` → suma de ambos.
- Helpers `booking.js` (server + client) replican la fórmula.
- Champion/EB flags + funding source + drive_url.
- Loss reason enum extendido + detail ≥30 chars.

**Margin (CRM-00 PR 3):**
- `estimated_cost_usd` + `margin_pct` persistidos.
- `MARGIN_LOW_THRESHOLD = 20%`.
- Endpoint `POST /:id/check-margin` auto-computa desde líneas si no se pasa el costo.

**Side effects al transition:**
- `closed_won`: requiere `winning_quotation_id`. Si la cotización está en `sent`, pasa a `approved`. `closed_at = NOW()`. **Y ofrece crear contrato** vía `POST /api/contracts/from-quotation/:id`.
- `closed_lost`: requiere `loss_reason` + `loss_reason_detail` (≥30 chars). Cotizaciones en `sent` pasan a `rejected`. Legacy `outcome_reason` sigue como fallback.
- `postponed`: requiere `postponed_until_date` futura.
- Avanzar a `solution_design+` dispara A3 fire-and-forget si Champion/EB están vacíos.
- Avanzar a `proposal_validated/negotiation/verbal_commit/closed_won` con margen <20% emite warning `a4_margin_low` y evento `opportunity.margin_low`.

**Trigger DB:**
- Al insertar/actualizar, calcula `booking_amount_usd` derivado de `revenue_type`, luego `weighted_amount_usd = booking × probability / 100`.

**RBAC scoping (CRM-00 PR 4):**
- `superadmin/admin/director` → ven todo.
- `lead` → su squad.
- `member` → solo donde es `account_owner_id` o `presales_lead_id`.
- `external` → 403.

**Sistema de alertas (CRM-00 PR 4):** ver [`ARCHITECTURE.md §6.1`](../ARCHITECTURE.md). A1-A5 con dedup 24h. A3 inline en transiciones; A1/A2/A5 vía `POST /check-alerts` (cron diario).

**Eventos:** `opportunity.created`, `.updated`, `.deleted`, `.status_changed`, `.won`, `.lost`, `.cancelled`, `.postponed`, `.reactivated`, `.margin_low`.

**Deal type (CRM-01):** `new_business | upsell_cross_sell | renewal | resell`. Backfilled a `new_business`, NOT NULL con CHECK.

**Co-owner (CRM-01):** `co_owner_id` FK a `users` permite split credit. Visible en listado y detalle.

**Exit criteria (CRM-01):** soft validation al avanzar de etapa. 422 con `exit_criteria_missing` array si faltan campos:
- `qualified+`: descripción requerida.
- `solution_design+`: `expected_close_date` + `next_step`.
- `negotiation+`: `champion_identified`.
- `verbal_commit+`: `economic_buyer_identified`.
Admin/superadmin pueden pasar `override_exit_criteria: true` para bypasear.

**Deuda:** ninguna activa post CRM-01. SSOT del pipeline (`pipeline.js` server + client + trigger DB) requiere sincronizar los tres puntos cuando se cambien estados — comentado en cada archivo.

---

## Activities

> **Nuevo en SPEC-CRM-01** (mayo 2026).

**Qué hace:** log de interacciones comerciales con clientes/oportunidades. Cada actividad tiene un tipo, fecha, asunto, notas, y puede estar vinculada a una oportunidad, cliente y contacto.

| Aspecto | Ubicación |
|---|---|
| Server route | `server/routes/activities.js` |
| UI lista | `client/src/modules/Activities.js` |
| Tabla | `activities` |
| Endpoints | `GET /api/activities`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `GET /by-client/:clientId` |

**Tipos:** `call | email | meeting | note | proposal_sent | demo | follow_up | other`.

**Side effects:**
- POST auto-actualiza `clients.last_activity_at` (resuelve `client_id` desde la oportunidad si no se pasa directo).
- Solo el creador o admin puede editar/eliminar.

**Deuda:** ninguna.

---

## Quotations

**Qué hace:** cotizador. Dos tipos:
- **`staff_aug`**: lista de recursos por mes.
- **`fixed_scope`**: proyecto con phases, epics, milestones.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/quotations.js` |
| Cálculo | `server/utils/calc.js` (mismo motor en cliente: `client/src/utils/calc.js`) |
| Export | `server/utils/quotation_export.js` (XLSX/PDF) |
| UI editor staff aug | `client/src/StaffAugEditor.js` (legacy) + `StaffAugEditorUnified.js` (nuevo) |
| UI editor proyecto | `client/src/ProjectEditor.js` |
| UI modal pre | `client/src/modules/NewQuotationPreModal.js` |
| Tablas | `quotations` + `quotation_lines` + `quotation_phases` + `quotation_epics` + `quotation_milestones` + `quotation_allocations` |

**Conversión a contrato:**
- `POST /api/contracts/from-quotation/:quotation_id` toma defaults sensatos: project_name → name, type mapping, client del FK, fechas hoy. Devuelve contrato `planned`.

**Deuda:**
- Mezcla legacy V1 (`client_name` denormalizado) + V2 (`client_id` FK).
- 5 tablas hijas con CASCADE — duplicación de modelo en JSONB (`hours_by_profile`) + tabla relacional (`quotation_allocations`).
- Ambos editores (Unified vs no-Unified) coexisten en repo.

---

## Contracts

**Qué hace:** contrato firmado. Una vez ganada una opp, se crea un contrato. Alberga las solicitudes de recursos.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/contracts.js` |
| UI lista | `client/src/modules/Contracts.js` |
| UI detalle | `client/src/modules/ContractDetail.js` |
| Tabla | `contracts` |
| Endpoints | CRUD + `/from-quotation/:qid` + `/:id/kick-off` + `/:id/status` + `/export.csv` |

**Flujo kick-off (clave):**
1. Admin asigna `delivery_manager_id` desde el detalle del contrato.
2. Delivery manager presiona "Iniciar kick-off" + da `kick_off_date`.
3. Sistema lee `winning_quotation` y crea `resource_requests` automáticos (mapea level INT→VARCHAR, mapea specialty→area_id heurístico, calcula end = start + duration_months × 30).
4. DM puede editar después.

**Permisos kick-off:** admin O delivery_manager_id O account_owner_id O capacity_manager_id del contrato.

**Estados:**
```
planned → active → paused → completed
                          → cancelled
```

**Subtipos** (SPEC subtipo-contrato Abril 2026): cada contrato lleva un `contract_subtype` además del `type`. Catálogo controlado en `utils/contract_subtype.js`:
- `capacity` → `staff_augmentation` | `mission_driven_squad` | `managed_service` | `time_and_materials`
- `project` → `fixed_scope` | `hour_pool`
- `resell` → siempre NULL

Obligatorio al crear/editar capacity y project. Validación server-side con códigos de error específicos. Filtro `?subtype=` en GET.

**Deuda:** `total_value_usd` editable libre, sin reconciliación con quotation_lines.

---

## Resource Requests

**Qué hace:** necesidades de recursos por contrato. Una row puede tener `quantity > 1`.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/resource_requests.js` |
| UI lista | `client/src/modules/ResourceRequests.js` |
| Sub-route | `GET /:id/candidates` (ranking de candidatos para asignar) |
| Tabla | `resource_requests` |

**Candidate ranking** (US-RR-2):
- `server/utils/candidate_matcher.js` — scoring puro: área + level + skills + availability.
- Llamado desde `client/src/modules/CandidatesModal.js`.
- Listo para reemplazo por embeddings semánticos cuando se conecte AI.

**Estados:**
- Stored: `open | partially_filled | filled | cancelled`.
- Computado: `computeStatus(stored, active_assignments_count, quantity)` — devuelve el efectivo. La UI muestra el computado.

---

## Assignments

**Qué hace:** empleado asignado a un resource_request. **El plan**.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/assignments.js` |
| UI lista | `client/src/modules/Assignments.js` |
| Validación | `server/utils/assignment_validation.js` (engine de checks) |
| Tabla | `assignments` |
| Endpoints | CRUD + `/validate` (dry-run) + `/export.csv` |

**Validation engine** corre antes de cada POST/PUT:
- Área match
- Level gap (si > 2 niveles, warning)
- Capacity (suma de overlapping assignments + propuesto)
- Date overlap

**Overbooking:** si suma > `weekly_capacity_hours × 1.10` → 409 salvo `force: true` + `override_reason` (mín 10 chars). El override queda capturado en `override_checks JSONB` para que la IA aprenda.

**Estados:** `planned | active | ended | cancelled`.

**Tests:** 40+ casos de validación y overbooking.

---

## Capacity Planner

**Qué hace:** vista timeline tipo Runn de utilización por empleado por semana.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/capacity.js` (`GET /api/capacity/planner`) |
| Cálculo | `server/utils/capacity_planner.js` |
| UI | `client/src/modules/CapacityPlanner.js` (~880 líneas, candidata a refactor) |
| Modal candidatos | `client/src/modules/CandidatesModal.js` |

**Indicadores visuales:** 4 buckets — `idle | light | healthy | overbooked` con colores OKLCH.

**Asignación in-place:** click en barra "Sin asignar" → modal de candidatos → "Asignar →" llama `POST /api/assignments` directo. Si validation pide override (overbooking), redirige a form manual con prefill.

---

## Time Entries (`/time/me`)

**Qué hace:** registro de horas diarias por asignación. Matriz semanal (Lun-Dom × asignaciones).

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/time_entries.js` |
| UI | `client/src/modules/TimeMe.js` |
| Tabla | `time_entries` |
| Endpoints | CRUD + `/copy-week` |

**Estados:** `draft | submitted | approved | rejected`. Aprobación todavía no formalizada en flow (TODO).

---

## Weekly Allocations (`/time/team`)

**Qué hace:** registro de % semanal por asignación. Bench = `100 - SUM(pct)`. Modelo paralelo a `time_entries`.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/time_allocations.js` |
| UI | `client/src/modules/TimeTeam.js` |
| Tabla | `weekly_time_allocations` |
| Endpoints | `GET /` + `PUT /bulk` |

**Reglas:**
- Empleados ven sólo lo suyo.
- Leads ven sus reportes directos (`employees.manager_user_id = caller`).
- Admins ven a todos. Admins/leads sin `employees` row reciben picker.
- Suma debe ser ≤ 100. Si <100 al guardar, modal de confirmación de bench.

**Deuda:** coexiste con `time_entries`. Decisión consolidación pendiente.

---

## Employees

**Qué hace:** master data de personas DVPNYX. Distinto de `users` (login).

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/employees.js` |
| UI lista | `client/src/modules/Employees.js` (~570 líneas) |
| UI detalle | `client/src/modules/EmployeeDetail.js` |
| Tablas | `employees` + `employee_skills` |
| Endpoints | CRUD + nested `/skills` |

**Manager / lead picker:** admin asigna `manager_user_id` desde EmployeeDetail. Eso habilita que un lead vea el tiempo de su equipo.

**Status:** `active | on_leave | bench | terminated`. `terminated` bloquea nuevas asignaciones.

---

## Areas + Skills

**Qué hace:** catálogos lookup. 9 áreas DVPNYX, ~60 skills en 8 categorías.

| Aspecto | Ubicación |
|---|---|
| Areas server | `server/routes/areas.js` |
| Skills server | `server/routes/skills.js` |
| UI areas | `client/src/modules/Areas.js` (admin) |
| UI skills | `client/src/modules/Skills.js` (admin) |
| Tablas | `areas`, `skills` |

**Reglas:** no hay hard delete. Deactivate si no hay employees activos asociados.

**Deuda:** `description` y `narrative` opcionales — para RAG, ambos deberían estar poblados. Backfill pendiente.

---

## Revenue

**Qué hace:** reconocimiento mensual de ingresos por contrato (RR-MVP-00.1, placeholder explícito).

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/revenue.js` |
| UI | `client/src/modules/Revenue.js` + `RevenuePlanEditor.js` |
| Tablas | `revenue_periods` (PK compuesta `(contract_id, yyyymm)`) |

**Modelo simplificado:** un row por (contrato, mes). Para `type='project'` se usa `projected_pct × total_value_usd`. Para los demás, `projected_usd` directo.

**Deuda relevante:**
- Sin trigger de inmutabilidad para rows `closed`. Comment dice "TODO eng team: ver SPEC-RR-00 para modelo NIIF 15 real".
- Sin multi-currency real (usa `original_currency` + `exchange_rates`).

---

## Budgets

> **Nuevo en SPEC-CRM-01** (mayo 2026).

**Qué hace:** targets de booking comercial por período. Permite comparar metas vs actuals (booking de opps closed_won) para forecasting y gestión.

| Aspecto | Ubicación |
|---|---|
| Server route | `server/routes/budgets.js` |
| UI | `client/src/modules/Budgets.js` |
| Tabla | `budgets` |
| Endpoints | `GET /api/budgets`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `GET /summary` |

**Reglas:**
- Admin-only para escritura.
- Ciclo de vida: `draft → active → closed`.
- `approved_by` / `approved_at` se auto-setean al pasar a `active`.
- `GET /summary` agrega target USD vs booking real (closed_won del período).
- Hard delete (config data, no transaccional).

**Deuda:** ninguna.

---

## Employee Costs (admin/superadmin only)

**Qué hace:** registra el costo empresa mensual real de cada empleado. PII salarial. Habilita cálculo de márgenes y P&L por contrato.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/employee_costs.js` |
| Util | `server/utils/cost_calc.js` (validaciones + conversión USD) + `client/src/utils/cost.js` (formato + helpers UI) |
| UI mass view | `client/src/modules/EmployeeCosts.js` (`/admin/employee-costs`) |
| UI CSV import | `client/src/modules/EmployeeCostsImport.js` (`/admin/employee-costs/import`) |
| UI per-employee | sección "Costos" en `client/src/modules/EmployeeDetail.js` |
| Tabla | `employee_costs` (PK = id; UNIQUE `(employee_id, period)`) |

**Flujo principal (operaciones, ~5 min/mes):**
1. Finanzas abre `/admin/employee-costs`, selecciona el mes.
2. Click en **"📋 Copiar del mes anterior"** → trae los costos de N-1.
3. Ajusta los 3-5 que cambiaron en la tabla in-place.
4. Click en **"💾 Guardar todo"** → bulk/commit atómico.
5. Al final del mes: **"🔒 Cerrar período"** → lock; sólo superadmin puede revertir.

**Multi-currency:** USD, COP, MXN, GTQ, EUR. Conversión vía `exchange_rates`. Si no hay tasa del período, fallback a la última conocida (warning visible). Recálculo manual cuando cambia FX.

**CSV import:** preview con validación + commit atómico.

**Deuda:** ninguna activa (deprecación de columnas en `employees` ya marcada con COMMENT).

---

## Exchange Rates

**Qué hace:** tasas mensuales USD↔otra. Admin las gestiona desde `/admin/exchange-rates`.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/exchange_rates.js` |
| UI | `client/src/modules/ExchangeRates.js` |
| Tabla | `exchange_rates` (PK `(yyyymm, currency)`) |
| Helper | `server/utils/fx.js` |

Convención: `usd_rate = N` ⟹ `1 USD = N <currency>`. USD propio NO vive en la tabla.

---

## Reports + Plan-vs-Real

**Qué hace:** 7 reportes operativos.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/reports.js` |
| UI | `client/src/modules/Reports.js` |

**Reportes disponibles:**

| ID | Nombre | Endpoint |
|---|---|---|
| EI-2 | Utilización | `GET /api/reports/utilization` |
| EI-3 | Banca | `GET /api/reports/bench?threshold=` |
| EI-4 | Solicitudes pendientes | `GET /api/reports/pending-requests` |
| EI-5 | Necesidades de contratación | `GET /api/reports/hiring-needs` |
| EI-6 | Cobertura por contrato | `GET /api/reports/coverage` |
| EI-7 | Cumplimiento time tracking | `GET /api/reports/time-compliance?from=&to=` |
| EI-8 | **Plan vs Real (semanal)** | `GET /api/reports/plan-vs-real?week_start=&[manager_id=]` |
| ED-1 | My Dashboard | `GET /api/reports/my-dashboard` |

**Plan-vs-real** compara plan (assignments.weekly_hours / capacity) con real (`weekly_time_allocations.pct`). Status por línea: `on_plan | over | under | missing | unplanned | no_data` con tolerancia ±10pp.

**Auto-scoping** según rol: lead → manager_user_id forzado; member → su employee; admin → todos.

**Materialized view disponible:** `mv_plan_vs_real_weekly` (no consumida aún por el endpoint — pendiente switch).

---

## Executive Dashboard

**Qué hace:** rollup ejecutivo: revenue mes/YTD, pipeline weighted, utilization, alertas.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/dashboard.js` (`GET /api/dashboard/overview`) |
| UI | `client/src/modules/DashboardMe.js` (personal) + `App.js :: Dashboard` (ejecutivo) |

---

## Auth + Users

**Qué hace:** login JWT + gestión de usuarios.

| Aspecto | Ubicación |
|---|---|
| Auth route | `server/routes/auth.js` (`/login`, `/me`, `/change-password`, `/me/preferences`) |
| Users route | `server/routes/users.js` (admin only) |
| Middleware | `server/middleware/auth.js` |
| UI users | `client/src/modules/Users.js` |
| UI prefs | `client/src/modules/Preferencias.js` |

**Roles:** `superadmin > admin > lead > member > viewer`. `requireRole(...)` exporta middleware compositor.

**Preferencias:** JSONB en `users.preferences`. Allowlist en `auth.js`. Aplicación optimista en `AuthContext.applyPreferences()` (modificada para evitar stale closure en rollback).

---

## Notifications

**Qué hace:** notificaciones in-app.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/notifications.js` |
| UI drawer | `client/src/shell/NotificationsDrawer.js` |
| Helper | `server/utils/notifications.js` (`notify`, `notifyMany`) |
| Tabla | `notifications` |

---

## Bulk Import

**Qué hace:** import CSV admin con validation + dry-run.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/bulk_import.js` |
| Engine | `server/utils/bulk_import.js` |
| UI | `client/src/modules/BulkImport.js` |
| Templates CSV | `GET /api/bulk-import/templates/:entity` |

**Entities soportadas:** clients, employees, areas, skills (ver `ENTITIES`).

---

## Parameters

**Qué hace:** catálogo operativo de parámetros (cost rates, country deltas, time tracking thresholds).

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/parameters.js` (admin only para PUT) |
| UI | `client/src/modules/AdminParams.js` |
| Tabla | `parameters` UNIQUE (category, key) |

---

## AI Interactions

**Qué hace:** log de cada llamada a un agente IA + decisión humana.

| Aspecto | Ubicación |
|---|---|
| Server | `server/routes/ai_interactions.js` |
| Helper | `server/utils/ai_logger.js` (`run`, `recordDecision`) |
| Tablas | `ai_interactions`, `ai_prompt_templates` |
| Endpoints | `GET /` (admin) + `GET /:id` (admin) + `POST /:id/decision` (owner+admin) |
| UI | ❌ pendiente |

Ver [`AI_INTEGRATION_GUIDE.md`](AI_INTEGRATION_GUIDE.md) para flow completo.

---

## Cómo agregar un módulo nuevo

1. **DB:** push al final de `V2_NEW_TABLES` o `V2_ALTERS` en `server/database/migrate.js`. Idempotente (`CREATE TABLE IF NOT EXISTS`).
2. **Server route:** copiar `server/routes/skills.js` como template + su test. Importar `parsePagination`, `serverError`.
3. **Server tests:** mock pool con `queryQueue` + `mockUser`.
4. **Client module:** copiar `client/src/modules/Areas.js` + `Areas.test.js`.
5. **Wiring:** registrar ruta en `server/index.js`, ruta SPA en `client/src/App.js`, link en `client/src/shell/Sidebar.js`.
6. **Docs:** agregar entrada en este archivo + en [`API_REFERENCE.md`](API_REFERENCE.md).

---

*Si agregas o eliminas un módulo, actualiza este documento en el mismo PR.*
