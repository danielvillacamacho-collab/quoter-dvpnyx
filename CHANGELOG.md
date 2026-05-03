# Changelog

Todas las entregas notables del proyecto. El formato sigue vagamente [Keep a Changelog](https://keepachangelog.com/), pero agrupado por **fases** (que es como se ejecutó el trabajo) en vez de versiones semver — todavía no hay tagging formal.

Convención:
- **feat**: feature nueva para el usuario.
- **fix**: corrección de bug.
- **chore**: tooling, docs, infra, refactor sin impacto funcional.
- **perf**: mejoras de performance.
- **security**: parche de seguridad.

La fuente de verdad para commits es `git log` sobre `develop`. Este archivo cubre las fases grandes y los hitos que un equipo entrante debería conocer.

---

## [Unreleased] — entregas en curso

### chore(handoff): cleanups pre-handoff equipo senior — 2026-05-02

Pase de saneamiento previo al handoff al equipo senior del 2026-05-15. Cambios cosméticos / de documentación, **cero modificación funcional**.

- `client/src/App.js`: borrado de import muerto `ComingSoon`.
- `README.md` + `HANDOFF.md`: reemplazo de la promesa `quote → contract → staff → bill` por `quote → contract → staff → time tracking` + nota explícita de que la facturación queda en Holded.
- `docs/PROJECT_STATE_HANDOFF.md`: corrige afirmación falsa — `/api/notifications` **no es stub** (la SPA hace polling de `/unread-count` cada 60s desde `Layout`). Aclara que los stubs reales (`squads`, `events`) devuelven `501` con JSON.
- `client/src/modules/TimeMe.test.js`: cabecera explicativa identificando los 2 sospechosos primarios de los fallos pre-existentes.
- Nuevo: [`docs/AUDIT_2026-05.md`](docs/AUDIT_2026-05.md) — hoja de ruta de los 13 días previos al handoff (matriz módulo-por-módulo, happy paths, lista explícita de "no tocar").

### feat(spec-crm-00): pipeline 9 estados + revenue + margin + RBAC + alertas — 2026-05-01 a 2026-05-02

Cuatro PRs grandes que materializan el contrato CCO de SPEC-CRM-00 v1.1 sobre el módulo de oportunidades. Schema, código y tests al día; documentación operativa cubierta en este CHANGELOG y en [PROJECT_STATE_HANDOFF.md §0](docs/PROJECT_STATE_HANDOFF.md).

**PR 1/4 — Pipeline 9 estados + Postponed + opportunity_number** (`c246b05`)

- Pipeline migrado de 7 → 9 estados: `lead → qualified → solution_design → proposal_validated → negotiation → verbal_commit → {closed_won | closed_lost | postponed}`. Probabilidades 5/15/30/50/75/90/100/0/0.
- `postponed` es un **limbo no terminal**: solo sale a `qualified` (reactivar) o `closed_lost`. Requiere `postponed_until_date` futura + razón opcional.
- `opportunity_number = OPP-{cc}-{year}-{seq}` (cc = country del cliente, seq correlativo por (country, year), backfill idempotente).
- Migración legacy: `open→lead`, `proposal→proposal_validated`, `won→closed_won`, `lost+cancelled→closed_lost`. CHECK constraints reescritos idempotentes (descubre nombre dinámicamente).
- UX: botones de transición por estado actual (KISS), modal de Postergar con date picker (default +30d) + textarea, banner violeta en detalle cuando `status=postponed`.
- Soft warnings (`amount_zero / backwards / close_date_past`) — el spec pide nudges, no bloqueos.
- SSOT compartido: `server/utils/pipeline.js` + `client/src/utils/pipeline.js` + trigger DB `opp_pipeline_recalc()` deben sincronizarse en los tres puntos (comentado en cada archivo).
- Eventos nuevos: `opportunity.postponed`, `opportunity.reactivated`.

**PR 2/4 — Revenue model + Champion/EB + funding + loss reasons** (`3e6d65c`)

- Modelo de revenue formal: `one_time | recurring | mixed` con booking derivado por trigger DB (`one_time → one_time_amount_usd`, `recurring → mrr × months`, `mixed → suma`).
- Nuevas columnas en `opportunities`: `revenue_type`, `one_time_amount_usd`, `mrr_usd`, `contract_length_months`, `champion_identified`, `economic_buyer_identified`, `funding_source`, `funding_amount_usd`, `loss_reason`, `loss_reason_detail`, `drive_url`. Backfill idempotente: legacy → `one_time` con monto previo.
- Loss reason enum extendido: `price | competitor_won | no_decision | budget_cut | champion_left | wrong_fit | timing | incumbent_win | other`. `loss_reason_detail` requerido ≥30 caracteres.
- Helpers: `server/utils/booking.js` + `client/src/utils/booking.js` (`computeBooking`, `validateRevenueModel`, `validateFunding`, `validateLossReason`) — misma fórmula que el trigger DB.
- API: `POST` y `PUT /api/opportunities` aceptan los nuevos campos con compat legacy (sin `revenue_type` → default `one_time`). `GET /` filtros nuevos: `revenue_type`, `has_champion`, `has_economic_buyer`, `funding_source` (valores fuera del enum se ignoran).
- Frontend: `OpportunityForm` con radio `revenue_type` + campos condicionales según motion + booking calculado en vivo + sección "Más opciones" (champion/EB/funding/drive_url). `TransitionModal closed_lost` con dropdown del enum + textarea con contador 0/30. `OpportunityDetail` con cards Revenue / Stakeholders & Funding / Loss reason.
- **Hotfix migración PR 1**: en RDS, `CHECK (status IN (...))` se reescribe a `CHECK ((status)::text = ANY (ARRAY[...]))`. El pattern del DO block dinámico nunca matcheó esa forma → CHECK legacy seguía vivo. Fix: buscar por literal `cancelled` (señal del enum legacy) y `ADD CONSTRAINT v11` idempotente con `DO/IF NOT EXISTS`.

**PR 3/4 — margin_pct + check-margin + Alerta A4** (`e234137`)

- Persiste el margen de la oportunidad: nuevas columnas `estimated_cost_usd` y `margin_pct` en `opportunities`. Constraints `opp_margin_pct_range` y `opp_estimated_cost_nonneg`. Partial index `opportunities_margin_low_idx` para reportes A4.
- `MARGIN_LOW_THRESHOLD = 20%` en `server/utils/booking.js` y `client/src/utils/booking.js`. `computeMargin()` y `validateMarginInput()` sincronizados.
- **Endpoint nuevo**: `POST /api/opportunities/:id/check-margin` — acepta `estimated_cost_usd` explícito o lo auto-computa desde `cost_hour/rate_hour` de las líneas; persiste ambos campos; emite `opportunity.margin_low` si < 20%.
- `POST /:id/status` ahora devuelve warning `a4_margin_low` (no bloqueante) al avanzar a `proposal_validated`/`negotiation`/`verbal_commit`/`closed_won` con margen bajo.
- Frontend: `OpportunityDetail` con card "Margen" + badge ⚠ A4 + botón "Calcular Margen" (prompt → auto-compute si vacío).

**PR 4/4 — RBAC 7 roles + alertas A1/A2/A3/A5** (`c8643d9`)

- **RBAC 7 roles** en `users.role` (`+preventa` por backward compat):
  - `superadmin` — bypass total.
  - `admin` — operativo, ve todo.
  - `director` — VP-level, ve todo (nuevo).
  - `lead` — su squad.
  - `member` — solo sus opps (account_owner o presales_lead).
  - `viewer` — solo lectura.
  - `external` — acceso restringido, 403 al endpoint de oportunidades (nuevo).
- `server/middleware/auth.js` exporta `ROLES`, `SEE_ALL_ROLES = {superadmin, admin, director}`, `WRITE_ROLES = {superadmin, admin, director, lead, member}`.
- Scoping inline en `GET /api/opportunities` y `GET /kanban`: admin/director/superadmin ven todo; lead ve su squad; member ve solo las suyas; external → 403.
- **Sistema de alertas CRM** (`server/utils/alerts.js`, 205 LOC):
  - `ALERT_DEFS` con A1, A2, A3, A4, A5.
  - `A1` — oportunidad estancada >30 días en mismo estado.
  - `A2` — `next_step` con fecha vencida.
  - `A3` — Champion/EB gap (a partir de `solution_design`).
  - `A4` — margen bajo (ya entregada en PR 3).
  - `A5` — cierre próximo, expected_close_date dentro de 7 días.
  - `createAlertNotification()` con dedup 24h (INSERT WHERE NOT EXISTS).
  - `runAlertScan()` con scoping por rol.
- **Endpoints nuevos**:
  - `POST /api/opportunities/check-alerts` — escanea y genera notificaciones (diseñado para cron diario o invocación manual).
- A3 inline: dispara fire-and-forget en `POST /:id/status` (al avanzar a `solution_design+`) y en `PUT /:id` (al cambiar champion/EB flags).
- Frontend: `OpportunityDetail` con badge ⚠ A3 en card MEDDPICC cuando aplica.

**Fix posterior — migración idempotente** (`c6e6997` + `dbca79b`)

- Hotfix de deploy: el CHECK del role en RDS se reescribió a `ANY (ARRAY[...])`. Backfill defensive de roles legacy. Block logging para que el deploy no quede mudo si la migración falla. Eliminados backticks dentro de SQL comments en el template literal de JS (causaban template-string parsing roto en imágenes RDS).

**Tests al cierre de SPEC-CRM-00**: server **988 → 1018+** (con A4/A5), client **463 → 470+**. Build limpio. Mantenemos los 2 fallos pre-existentes en `TimeMe.test.js` (DST/timezone, ver header del archivo).



- **Branches**: 87 ramas remotas mergeadas eliminadas (de 91 → 4 vivas). 81 locales borradas (90 → 9). El repo deja de tener "cementerio" de feature branches.
- **Deps**: removidos `express-validator` y `uuid` del server (no se usaban — UUID se genera en DB con `uuid_generate_v4()`); removidos `jspdf`, `jspdf-autotable` y `@dnd-kit/sortable` del client (jspdf nunca se importó; sortable nunca se usó en favor de `@dnd-kit/core` directo).
- **Docs binarios** (`docs/*.docx`) untrackeados. Son outputs/inputs efímeros del PO; el source-of-truth son los `.md`. `.gitignore` actualizado.
- **`server/package-lock.json`** ahora trackeado (era untracked — instalaciones no reproducibles).

### feat(sortable-tables): tablas paginadas ordenables — Phase 17

Todas las tablas paginadas tienen ahora click-to-sort en cada columna de atributos, con flecha indicadora (▲/▼/⇅), accesibilidad `aria-sort` + Enter/Space, y tie-breaker estable.

**Server** (`server/utils/sort.js` + 9 routes wired):
- `parseSort(query, SORTABLE, opts)` — whitelist de columnas (previene SQL injection en `ORDER BY`, columnas no parametrizables vía `$N`).
- `NULLS LAST` por default para predictibilidad.
- Defaults sensatos por route: contracts→`updated_at desc`, employees→`last_name asc`, opportunities→`created_at desc`, etc.

**Client** (`client/src/utils/useSort.js`, `sortRows.js`, `shell/SortableTh.js`):
- Hook `useSort({ field, dir })` con click cycle: `nuevo campo → asc`, `mismo campo → toggle`.
- `<SortableTh sort={sort} field="..." />` componente accesible (aria-sort + Enter/Space).
- `sortRows(rows, accessor, dir)` — sort estable client-side con locale es-CO + numeric collation (`L1 < L2 < L10`) para tablas no paginadas (Reports, EmployeeCosts).

**Cableado en módulos**: Contracts, Employees, Opportunities, Clients, ResourceRequests, Assignments. Pendiente para iteraciones siguientes: Reports + EmployeeCosts mass view (sortRows client-side), EmployeeDetail tabs.

### perf: tres optimizaciones de baseline (PERF-001/002/003) — 2026-05-01

- **PERF-001**: el polling de `/notifications/unread-count` cada 60s ahora respeta `document.visibilityState`. Tabs ocultos no consumen — con N tabs × M usuarios cada minuto era la carga de fondo dominante. Re-fetch al volver a foco.
- **PERF-002**: `reports/utilization` y `/bench` movieron filtros `status='active'` + `deleted_at IS NULL` del `SUM(...) FILTER` al `JOIN ON`. Cardinalidad: O(employees × all_assignments) → O(employees × active_assignments).
- **PERF-003**: índice parcial `assignments_employee_active_idx ON assignments(employee_id) WHERE deleted_at IS NULL AND status='active'`. Sirve a reports + a `sumOverlappingHours` en assignments.js.

Disparador: reporte de lentitud que resultó ser memoria de la instancia (resuelta por infra), pero estas mejoras siguen siendo válidas como reducción de baseline.

### fix(INC-003): empleados al final del alfabeto no aparecían en dropdowns — 2026-04-29

`parsePagination` capa silenciosamente cualquier `limit` > 100 (maxLimit default). El frontend pedía `/api/employees?limit=500` esperando todos, pero el server devolvía 100 → con ~110 empleados en prod ordenados por `last_name`, los 5 con apellidos al final (Reinso, Solano, Uni, Vasquez, Vertel) caían fuera del top 100 y nunca aparecían en el combobox del form de asignación. Mismo patrón en resource-requests.

Fix: endpoints dedicados sin paginación — `GET /api/employees/lookup` (excluye terminated por default) y `GET /api/resource-requests/lookup` (excluye filled/cancelled). Frontend cableado. Filtros client-side se mantienen como defense-in-depth. Post-mortem completo en `docs/INCIDENTS.md`.

### fix(INC-002): asignaciones imposibles para 5 empleados específicos — 2026-04-29

POST `/api/assignments` devolvía 500 para empleados cuyo `user_id` apuntaba a un `users.id` inexistente. `notify(conn, ...)` corría dentro de la transacción abierta; el INSERT en `notifications` violaba FK; el `try/catch` de notify atrapaba el error JS, pero **Postgres ya había marcado la txn ABORTED** → COMMIT fallaba con `current transaction is aborted` → 500.

Fix triple: (1) bloque de notify movido **después** del COMMIT, usando `pool` no `conn`; (2) defense-in-depth en `notify()` y `emitEvent()` — si reciben un client de transacción, envuelven el INSERT en `SAVEPOINT/RELEASE/ROLLBACK TO SAVEPOINT`; (3) test de regresión que mockea fallo en notify y verifica que la asignación devuelve 201. Post-mortem completo INC-002 en `docs/INCIDENTS.md`.

### feat(spec-ii-00): Iniciativas Internas, Novedades e Idle Time (Abril 2026)

Tres módulos acoplados + un catálogo de festivos por país. El idle time
deja de ser una estimación y pasa a ser un indicador defendible (capacity
total − festivos − novedades − asignaciones).

**Schema** (todo dentro del bloque `SPEC_II_00_SQL` en `migrate.js`,
idempotente igual que el resto del repo):
- Catálogos: `business_areas`, `novelty_types`, `countries`.
- `country_holidays` + seed embebido CO/MX/GT/EC/PA/PE/US para 2026 + 2027.
- `internal_initiatives` (presupuesto USD, status, business_area, owner).
- `internal_initiative_assignments` (employee_id + weekly_hours, snapshot
  de hourly_rate_usd al asignar).
- `employee_novelties` con trigger DB que bloquea overlaps usando
  `daterange && daterange` (sin requerir btree_gist).
- `idle_time_calculations` con trigger de inmutabilidad (status=`final`
  no se puede modificar — se recalcula via DELETE+recalculate).
- `employees.country_id` agregado con backfill best-effort desde
  `employees.country` (VARCHAR legacy).

**Decisiones de diseño** (documentadas en migrate.js):
- Sin `tenant_id` (single-tenant operativo, alineado con el resto del repo).
- assignments NO se refactoriza a XOR. Las asignaciones internas viven
  exclusivamente en `internal_initiative_assignments`. El idle engine
  suma ambas tablas para producir el snapshot mensual.
- `hourly_rate_usd` se deriva de `employee_costs.cost_usd` ÷ horas
  mensuales estimadas (`weekly_capacity_hours × 52/12`). Si un empleado
  no tiene `employee_cost`, el snapshot mantiene `idle_cost_usd = 0` con
  `flag missing_rate=true` en breakdown — no falla la calculación.
- Sin S3: las novedades aceptan URL externa (Drive/SharePoint) en
  `attachment_url`. Sin presigned upload en MVP.
- Sin cron real: admin/finance corren `POST /api/idle-time/calculate`
  manualmente o desde el botón "↻ Calcular período" del dashboard. La
  idempotencia está garantizada (UPSERT por `employee_id, period_yyyymm`).

**Server**:
- `utils/idle_time_engine.js` — motor puro con 22+ tests cubriendo todos
  los edge cases del spec §7.1 (vacaciones full-month, sobre-asignación,
  contratado mid-mes, festivo en sábado, corporate_training, missing_rate).
- `utils/initiative_code.js` — generación `II-{AREA}-{YYYY}-{SEQ5}` bajo
  advisory lock para evitar colisiones.
- `routes/internal_initiatives.js` — CRUD admin/owner + transitions
  (active ↔ paused, → completed/cancelled terminal). Soft-delete bloqueado
  si hay asignaciones activas. Sub-resource `/assignments` lookup
  automático de tarifa snapshot.
- `routes/novelties.js` — CRUD con scoping por `employees.user_id` y
  `employees.manager_user_id`. Trigger overlap → 422 con mensaje claro.
  `GET /calendar/:employee_id` consolida festivos + novedades + ambas
  asignaciones para el modal "Registrar novedad".
- `routes/holidays.js` — CRUD admin (lectura libre).
- `routes/idle_time.js` — endpoints individual / aggregate / calculate /
  finalize / recalculate / capacity-utilization / initiative-cost-summary.

**Cliente**:
- Nuevos módulos: `InternalInitiatives`, `InternalInitiativeDetail`,
  `Novelties`, `IdleTime`, `CountryHolidays`.
- Sidebar agrega grupo "Iniciativas internas" con 3 entries y entry de
  Festivos en Configuración (admin).
- `IdleTime` dashboard: 4 KPIs (idle %, costo bench, utilización facturable,
  inversión interna) + barra apilada de capacidad + tabla de idle por país +
  botón admin "↻ Calcular período" / "🔒 Finalizar".

**Cumplimiento del spec original**:
- ✅ 4 entidades nuevas (initiatives, iia, novelties, idle_calculations) +
  catálogos.
- ✅ Idle time engine con todos los edge cases del spec §7.1.
- ✅ Inmutabilidad de cálculos final via trigger.
- ✅ State machine de iniciativas (active ↔ paused, → completed/cancelled).
- ✅ Distinción visual morado=internal vs azul=contract en dashboard.
- ⚠ **Adaptaciones**: convención JS+CRA del repo (no TS+Zod+RQ5 del spec
  original); sin tenant_id; sin XOR refactor en assignments; sin S3;
  cron manual via endpoint admin. Razones documentadas en migrate.js.
- 🔜 Pendientes para iteración futura: rollout gradual con feature flags,
  e2e Playwright, performance test k6, time_entries específicos a
  iniciativas internas (consumed_usd hoy es proxy basado en horas
  planeadas × tarifa snapshot × semanas transcurridas).

---

## Phase 16.1 — Proyección de costos a futuro (2026-04-28)

### feat(employee-costs): "Proyectar a futuro" para planear gasto sin cargar mes por mes

Refinamiento solicitado tras Phase 16: finanzas necesita proyectar el gasto a los próximos meses sin tener que entrar manualmente cada uno.

**Schema:**
- Extiende `employee_costs.source` CHECK con valor `'projected'` (idempotente: dropea+recrea constraint en DBs ya migradas, sin perder datos).

**Util:**
- `addMonths(period, n)` y `periodsForward(start, count)` en `cost_calc.js` con tests (incluye rollovers de año, valores negativos, edge cases).

**Server:**
- `POST /api/employee-costs/project-to-future` con body `{ base_period?, months_ahead, growth_pct?, dry_run? }`.
  - `months_ahead` 1..12 (cap duro).
  - `growth_pct` opcional, repartido mensualmente vía `(1+r)^(1/12)`.
  - `dry_run` para preview con `details` antes de aplicar.
  - **No sobreescribe entradas manuales** (source != projected gana).
  - **No toca períodos cerrados** (locked).
  - **Reproyectable**: rows con source=projected se actualizan; idempotencia garantizada.
  - Skip empleados terminados/inactivos en el período destino.
  - Recalcula FX con la tasa del período destino (no asume base).
- Evento `employee_cost.projected_to_future` con resumen completo.

**Cliente:**
- Nuevo botón **"📈 Proyectar a futuro"** en `/admin/employee-costs`.
- Modal de 2 fases (preview → apply) con:
  - Selector de período base (default: auto-detectar último con costos).
  - Selector de meses (3/6/9/12).
  - Input de growth anual %.
  - Preview con conteos: a crear, a actualizar, preservados (manuales), saltados (locked), saltados (inactivos), warnings FX.
- Badge violeta **"📈 Proyectado"** en filas con source='projected' (mass view + EmployeeDetail). Editable: editar a mano transforma la fila en source='manual' y la respeta en proyecciones futuras.
- Badge azul claro **"📋 Copiado"** para `copy_from_prev` (visualmente distinguible).

**Tests:** +22 server (10 del endpoint nuevo, 12 de helpers `addMonths`/`periodsForward`). Total **774/774 server, 353/353 cliente**, build limpio.

**Casos cubiertos:**
✓ Rechaza months_ahead fuera de 1..12.
✓ Rechaza growth_pct fuera de -50..200.
✓ 400 con code accionable si DB vacía o base_period sin rows.
✓ Dry_run no escribe.
✓ Growth_pct anual aplicado mes a mes correctamente.
✓ Preserva manuales (skipped_existing).
✓ No toca locked.
✓ Actualiza projected anteriores (idempotente).
✓ Skip empleados terminados antes del período destino.
✓ Commit real ejecuta INSERTs.

---

## Phase 16 — Employee Costs (2026-04-28)

### feat(employee-costs): módulo de costos empresa mensual por empleado

Respuesta a `spec_costos_empleado.docx` (operaciones, prioridad ALTA). Habilita
cálculo de márgenes reales y prerequisito del módulo de billing. **PII salarial
— acceso restringido a admin/superadmin.**

**Schema (idempotente, aditivo):**
- Nueva tabla `employee_costs` con UNIQUE `(employee_id, period)`, CHECKs
  para currency/period/gross_cost, indexes en period/employee/(period,locked).
- FK `ON DELETE RESTRICT` para preservar historial financiero.
- COMMENT ON TABLE/COLUMN documentando PII:high y semánticas.
- Deprecación de columnas legacy en `employees.company_monthly_cost/...`
  con COMMENT (no se borran — preservación de schema).

**Helpers:**
- `server/utils/cost_calc.js`: validatePeriod (CHAR(6) + YYYY-MM input),
  previousPeriod, periodWithinAllowedFuture (default +1 mes), validateCurrency
  (USD/COP/MXN/GTQ/EUR), convertToUsd, validateEmployeePeriod (start_date /
  end_date check), deltaVsTheoretical (semáforo on_target/warn/alert por ±5/±15%).
- `client/src/utils/cost.js`: formatPeriod (YYYYMM↔YYYY-MM), formatMoney
  (Intl), defaultCurrencyForCountry (heurística CO/MX/GT/ES), recentPeriods,
  deltaZoneColor/Label.

**Server (`routes/employee_costs.js`, 11 endpoints):**
- `GET /api/employee-costs?period=YYYYMM` — mass view con summary
- `GET /employee/:id` — histórico DESC del empleado
- `GET /employee/:id/:period` — detalle puntual
- `GET /summary/:period` — KPIs ligeros
- `POST /` — UPSERT por (employee_id, period) con validación FX
- `PUT /:id` — edita por id; recalcula FX si cambia currency/gross
- `DELETE /:id` — admin si abierta, superadmin si locked
- `POST /bulk/preview` y `POST /bulk/commit` — patrón 2-fases con
  atomicidad (cualquier error → ROLLBACK completo). Cap 5000 items.
- `POST /copy-from-previous` — copia rows del período N-1 al N
  (skip activos sólo + skip ya en N). Recalcula FX con tasa nueva.
- `POST /lock/:period` — admin marca período como cerrado
- `POST /unlock/:period` — SOLO superadmin
- `POST /recalculate-usd/:period` — recalcula rows abiertos tras cambio FX

**Eventos emitidos** (audit log):
- employee_cost.created / updated / deleted
- .locked / .unlocked
- .recalculated_after_fx_change
- .bulk_committed / .copied_from_previous

**UI:**
- **EmployeeDetail (`/employees/:id`)**: nueva sección "Costos" admin-only
  con card del costo actual, tabla histórica, formulario inline para
  registrar/editar (period picker, currency dropdown según país, costo
  bruto, notas) + warnings FX + soporte para edit/delete con disabled
  para rows locked si no eres superadmin.
- **Mass view (`/admin/employee-costs`)**: tabla en pantalla con todos los
  empleados activos del período, inputs editables in-place con tracking
  de "drafts" sin guardar (badge naranja), 4 metric cards arriba (with_cost
  / total_usd / avg_usd / locked_count), botones "Copiar mes anterior",
  "Recalcular USD", "Cerrar período", "Reabrir (superadmin)", "Importar
  CSV" + "Guardar todo (N)" prominente. Lista colapsable de empleados sin
  costo. Δ vs teórico con semáforo de color por fila.
- **CSV Import (`/admin/employee-costs/import`)**: upload o paste de CSV,
  preview con tabla de errores/warnings/applied antes de aplicar, botón
  "Aplicar" deshabilitado si hay errores.
- **Sidebar**: nueva entrada "Costos del equipo" (admin-only, ícono dollar)
  en sección Configuración.

**Tests:**
- Server: 78 nuevos (utils/cost_calc.test.js + routes/employee_costs.test.js).
  Cubren todos los códigos de error, todas las reglas de coherencia con
  empleados (start/end), FX directo + fallback + missing, lock/unlock por
  rol, bulk con atomicidad, copy-from-previous con skip, recalc-USD respeta
  locked, permisos por rol (member/lead/viewer reciben 403, admin OK,
  superadmin extra).
- Cliente: 22 nuevos en `utils/cost.test.js` (formato monetario, períodos,
  default currency by country, semáforo).
- Totales post-implementación: **752 server** (era 674, +78 nuevos), **353 client** (era 331, +22 nuevos).

**Decisiones técnicas** (ver [`docs/DECISIONS.md :: EMPLOYEE-COSTS`](docs/DECISIONS.md#employee-costs)):
1. Period CHAR(6) alineado con resto del sistema.
2. Deprecación de columnas en employees.
3. ON DELETE RESTRICT (no CASCADE) — historial inmutable.
4. Empleados nuevos sin costo no bloquean la carga.
5. Recálculo FX manual (endpoint dedicado, no auto).
6. Encryption at rest diferida (requiere infra).
7. Permitir +1 mes hacia adelante.
8. Patrón preview+commit con atomicidad real.

---

## Phase 15 — Subtipo de contrato (2026-04-28)

### feat(contracts): contract_subtype field con catálogo controlado

Respuesta a `SPEC_subtipo-contrato.docx` (operaciones, prioridad ALTA).
Bloqueaba reportería por modelo de trabajo y era prerequisito del módulo
de billing.

**Schema (idempotente, aditivo):**
- Nueva columna `contracts.contract_subtype VARCHAR(50) NULL`.
- CHECK constraint con los 6 valores válidos a nivel DB.
- Index parcial `WHERE deleted_at IS NULL AND contract_subtype IS NOT NULL`.
- COMMENT ON COLUMN para documentar la regla type↔subtype.

**Catálogo (`utils/contract_subtype.js` server + `utils/contractSubtype.js` client):**
- `capacity` → 4 subtipos: `staff_augmentation`, `mission_driven_squad`,
  `managed_service`, `time_and_materials`.
- `project` → 2 subtipos: `fixed_scope`, `hour_pool`.
- `resell` → siempre NULL.
- Helper `validateContractSubtype(type, subtype, opts)` con códigos de
  error consistentes (`subtype_required` / `subtype_invalid_for_type` /
  `subtype_not_allowed_for_resell` / `subtype_unknown`).

**Server (`routes/contracts.js`):**
- POST acepta y valida (obligatorio para capacity/project).
- PUT diferencia el caso legacy (subtype=NULL existente, no se fuerza si
  el usuario no toca type) del caso "type cambió" (requiere subtype nuevo).
- GET acepta `?subtype=` (incluyendo `none` para filtrar legacy sin subtipo).
- `from-quotation` acepta subtype opcional (DM lo completa después si no
  viene en body — la spec dice que el FORM lo requiere, pero el atajo API
  permite NULL inicial).
- CSV export incluye columna Subtipo.
- Eventos `contract.created` y `contract.created_from_quotation` incluyen
  `contract_subtype` en el payload.

**Cliente (`modules/Contracts.js` + `ContractDetail.js`):**
- Dropdown Subtipo aparece debajo de Tipo, dependiente del valor de Tipo.
- Reset al cambiar tipo (con preservación inteligente: si el subtipo
  actual es válido para el nuevo tipo, no se borra).
- Validación: `<select required>` + chequeo manual con mensaje
  "Debes seleccionar un subtipo para continuar" debajo del campo.
- Excepción legacy: editar contratos pre-spec sin tocar el type permite
  guardar otros campos.
- Lista: nueva columna Subtipo (muestra etiqueta o "Sin especificar").
- Filtro de Subtipo en la lista (auto-restringido al tipo filtrado;
  incluye "Sin especificar" para legacy).
- ContractDetail: campo Subtipo en sección Resumen + banner amarillo si
  el contrato tiene type que requiere subtype y está vacío.
- CSV download incluye subtype filter.

**Tests:**
- Server: 36 nuevos en `routes/contracts.test.js` + `utils/contract_subtype.test.js` cubriendo todos los códigos de error, todos los caminos PUT (legacy, type-changed, subtype-changed-only), filtro GET, from-quotation con/sin/inválido subtype.
- Client: 4 nuevos cubriendo dropdown dependiente, reset al cambiar tipo, ocultarse en resell, y atributo `required` sobre el select.
- Total: 638 → **674 server**, 327 → **331 client**.

**Criterios de aceptación de la spec:** todos cubiertos.

---

## Phase 14 — Documentación integral refresh (2026-05)

### docs: refresh completo del set de documentación

Pase comprehensivo cuando el proyecto entró a estado "ready for handoff" tras la capa AI-readiness.

- **`docs/specs/v2/03_data_model.md`**: reescrito completo. 28 tablas, capa AI, vistas materializadas, glosario, deudas activas marcadas explícitamente.
- **`docs/CONVENTIONS.md`** (NUEVO): patrones de código actuales para server (rutas, helpers obligatorios, transacciones, eventos, tests) y client (módulos, DS tokens, fetch, naming).
- **`docs/AI_INTEGRATION_GUIDE.md`** (NUEVO): cómo conectar agentes IA end-to-end. Patrón `ai_logger.run()`, feedback loop, versionado de prompts, embeddings con pgvector, casos de uso priorizados, observabilidad/costos, seguridad/PII, antipatrones.
- **`docs/MODULES_OVERVIEW.md`** (NUEVO): mapa módulo por módulo (qué hace, dónde vive, endpoints, deuda activa).
- **`docs/API_REFERENCE.md`** (NUEVO): catálogo de los ~85 endpoints con shape, filtros, permisos y errores esperados.
- **`docs/ROADMAP.md`** (NUEVO): qué está vivo / con caveat / no implementado / decisiones diferidas.
- **`docs/DECISIONS.md`** (NUEVO): ADR-style. 14 decisiones técnicas documentadas (TIME-MODEL, AUDIT-DUAL, SQUAD-HIDDEN, PG-VECTOR-OPTIONAL, AI-LOGGER-MANDATORY, etc.).
- **`docs/RUNBOOKS_INDEX.md`** (NUEVO): índice de runbooks ops.
- **`README.md`**, **`HANDOFF.md`**, **`ARCHITECTURE.md`**, **`docs/PROJECT_STATE_HANDOFF.md`**, **`docs/ONBOARDING_DEV.md`**, **`docs/MANUAL_DE_USUARIO.md`**, **`CONTRIBUTING.md`**: refrescados con stats actuales (638 tests server, 28 tablas, AI layer, kick-off flow, plan-vs-real, manager role).

---

## Phase 13 — AI-readiness foundations (2026-05)

### feat(ai-readiness): fundaciones técnicas para integrar agentes IA

Cambios aditivos. NINGUNO altera comportamiento existente. El sistema sigue funcionando idéntico hoy, pero ahora tiene la capa para conectar agentes con observabilidad, feedback loop y semantic search.

**Schema (idempotente):**
- `ai_interactions`: log estructurado de cada llamada a un agente (modelo+versión, prompt template+versión, input/output JSONB redacted, decisión humana, costo USD, tokens, latencia, error).
- `ai_prompt_templates`: prompts versionados (UNIQUE name+version) para reproducibilidad y A/B testing.
- `delivery_facts`: tabla denormalizada por (fact_date, employee_id) con dimensiones snapshotted.
- pgvector best-effort: try/catch al CREATE EXTENSION. Si la imagen postgres no la tiene, se loguea warning y el resto migra normal.
- 7 columnas `vector(1536)` con HNSW indexes (skills, areas, employees, resource_requests, opportunities, contracts, quotations).
- Slugs URL-friendly + LLM-friendly en clients/opportunities/contracts/employees con UNIQUE partial.
- Narrative TEXT en areas y skills para RAG.
- 8 CHECK constraints adicionales (capacity bounds, hours bounds, date order, quantity).
- COMMENT ON TABLE/COLUMN para 7 tablas + JSONB críticos.
- Materialized view `mv_plan_vs_real_weekly` con UNIQUE INDEX para REFRESH CONCURRENTLY.
- Función plpgsql `refresh_delivery_facts(from, to)` idempotente.

**Helpers nuevos (`server/utils/`):**
- `ai_logger.js`: `run({ pool, agent, template, userId, entity, input, call })` ejecuta una llamada al modelo y registra TODO en ai_interactions (incluso si la llamada falla). `recordDecision()` registra accepted/rejected/modified/ignored cuando el humano decide. Tolerante a fallos: si el log a DB se cae, no rompe la llamada al agente.
- `level.js`: helper bidireccional INT (legacy de quotation_lines) ↔ VARCHAR L1..L11 (V2). `levelDistance()` para validation engines.
- `slug.js`: `slugify()` (NFD + diacríticos + truncate por palabra) y `uniqueSlug()` (resuelve colisiones con sufijos numéricos).
- `json_schema.js`: validador liviano para shapes JSONB sin agregar dependencia (no ajv). SCHEMAS predefinidos: contractMetadata, userPreferences, resourceRequestLanguageRequirements.

**Ruta nueva:**
- `GET /api/ai-interactions` (admin): listado paginado con filtros agent_name, prompt_template, user_id, entity_type/id, human_decision (incluyendo 'pending'), rango de fecha.
- `GET /api/ai-interactions/:id` (admin): detalle con payloads completos.
- `POST /api/ai-interactions/:id/decision`: registra decisión humana. Dueño O admin pueden modificarla.

**Tests:** 64 nuevos. Total server: 638/638 verde.

---

## Phase 12.5 — Cleanup técnico (2026-05)

### chore(cleanup): deuda técnica, manejo de errores, hardening de pagination

Pasada de limpieza basada en auditoría completa de develop. Sin cambios funcionales.

**Helpers nuevos:**
- `utils/sanitize.js`: `parsePagination`, `parseFiniteInt/Number`, `isValidUUID`, `isValidISODate` (rechaza fechas calendarialmente inválidas como 2026-02-30), `mondayOf` (movido desde time_allocations.js).
- `utils/http.js`: `serverError(res, where, err)` — logea con stack y responde 500 uniforme. `safeRollback(conn, where)` — reemplaza `ROLLBACK.catch(()=>{})` que enmascaraba errores.

**Pagination hardening (8 rutas):**
- LIMIT/OFFSET ahora pasan por $N parameterizado en vez de template literal en assignments, clients, contracts, employees, opportunities, quotations, resource_requests, time_entries.

**Error handling (40+ endpoints):**
- 23 catches one-liner que NO logueaban: ahora todos van por `serverError()` con identificador legible.
- 11 ROLLBACK silenciosos ahora usan `safeRollback` que LOGEA el fallo de rollback sin re-lanzar.
- `health.js`: log warn cuando la DB probe falla.

**Input validation:**
- `bulk_import`: validar `entity` contra whitelist ANTES de `setHeader` (cierra una vía menor de filename injection).
- `quotations`: filtro de "ver sólo mis drafts" para preventa ahora acepta tanto `role==='preventa'` (legacy) como `function==='preventa'` (post-normalization).

**Código muerto:**
- `_stubs.js`: tenía 13 stubs; 11 ya tenían ruta real. Quedan sólo 2 (squads, events).

**Cliente:**
- `AuthContext.updatePreferences`: rollback ahora captura `previousPrefs` ANTES del try (evita stale closure que revertía a estado equivocado en concurrencia).

**Tests:** +9 nuevos. Total: 574 → 638 server tests.

---

## Phase 12.4 — Contract kick-off (2026-04-30)

### feat(contract-kickoff): siembra solicitudes desde cotización ganadora

Cierra el flujo: oportunidad ganada → contrato → DM → kick-off → recursos auto-generados.

- **`POST /api/contracts/:id/kick-off`**: nuevo endpoint. Toma `kick_off_date`, lee quotation_lines de winning_quotation y crea resource_requests con defaults: role_title de la línea (o specialty+level si vacío), level mapeado INT→L1..L11, country, quantity, weekly_hours = hours_per_week, start_date = kick_off, end_date = kick_off + meses×30.
- **Mapeo specialty → area_id** heurístico (desarrollo→development, qa→testing, ux→ux_ui, etc.) con fallback a Desarrollo. Editable después.
- **Permisos**: admin, o DM/account_owner/capacity_manager del contrato. Lead que es DM puede invocar sin ser admin global.
- **Idempotencia**: 409 con `code:'already_seeded'` si el contrato ya tiene RRs; `?force=1` soft-deletea las anteriores y resembra. Las assignments existentes se preservan.
- **Metadata persisted**: `metadata.kick_off_date`, `kicked_off_at`, `kicked_off_by` en JSONB sin migración. Emite `contract.kicked_off` event.
- **GET /api/contracts/:id** ahora joinea users para nombres legibles del account_owner / delivery_manager / capacity_manager.

**UI (ContractDetail):**
- Admin ve picker de delivery_manager con admins+leads disponibles.
- Cuando hay winning_quotation y eres admin/DM/owner: panel de kick-off con date picker y botón "🚀 Iniciar kick-off". Si ya hay RRs, ofrece "🔄 Resembrar desde cotización".
- Banner amarillo recordatorio si hay quotation pero no hay DM.

**Tests:** 7 nuevos cubren 400/403/201/409 y caminos admin/DM-lead/stranger/no-quotation/completed.

---

## Phase 12.3 — Planning loop closure (2026-04-29)

### feat(planning-loop): cierra el ciclo cotización→contrato→plan→real

Cuatro features que cierran el flujo de capacity planning end-to-end:

1. **Plan vs Real (semanal)**. Nuevo `GET /api/reports/plan-vs-real` que compara `assignments.weekly_hours / weekly_capacity_hours` (planeado %) contra `weekly_time_allocations.pct` (real %). Status por línea: `on_plan` / `over` / `under` / `missing` / `unplanned` / `no_data`, con tolerancia ±10pp. UI en Reports.js con tabla agrupada por empleado, sub-totales semanales con bench, CSV export.

2. **Conversión cotización→contrato de un click**. Nuevo `POST /api/contracts/from-quotation/:id` con defaults sensatos (project_name → name, staff_aug→capacity, fixed_scope→project, client de la quotation o de su opportunity). El bloque "ganada" del detalle de oportunidad ahora ofrece el botón directamente.

3. **Rol manager (lead)**. Aprovecha `employees.manager_user_id` que ya estaba en el schema. `resolveEmployee` y la GET de /time-allocations reconocen `role='lead'` y devuelven picker con sus reportes directos. Plan-vs-real auto-scoping: lead → forzado a `manager_user_id=caller`, member → forzado a su employee. EmployeeDetail (admin-only) tiene un selector de líder directo.

4. **Asignar desde el planner sin salir**. CandidatesModal.onPick ahora hace POST /api/assignments inline; se queda en el planner, refresca data, muestra toast verde. Si el backend pide override (overbooking), cae al formulario manual con prefill.

---

## Phase 12.2 — TimeTeam fixes (2026-04-27 / 2026-04-28)

- `fix(time-team)`: admin sin employee row puede elegir empleado en vez de 500.
- `fix(time-allocations)`: 500 'Error interno' en /time/team por columna inexistente `employees.name` (la tabla tiene first_name + last_name).
- `fix(time-team)`: null-safe render + global ErrorBoundary. La pantalla en blanco era causada por accesos no defensivos (`data.employee.name`, `data.active_assignments.X`) que en React 18 sin boundary desmontan TODA la app ante un throw — sidebar y header incluidos.

---

## Phase 12.1 — Time-MVP-00.1 (2026-04-27)

### feat(time-team): registro semanal por % de asignación

- Nueva tabla `weekly_time_allocations` con UNIQUE (employee_id, week_start_date, assignment_id).
- Endpoints `GET /api/time-allocations` y `PUT /bulk` con bench auto-calculado.
- UI `/time/team` con selector de semana, tabla de asignaciones activas, input % por fila, total + bench visual.

---

### feat(capacity-editor): editor unificado de capacity + margen editable + export xlsx/pdf (2026-04-22)

Respuesta al pedido de preventa (`spec_capacity_editor.docx`, specs 3 y 4). Mirror exacto del flujo que se entregó para el cotizador de proyectos.

- **Nuevo `StaffAugEditorUnified`**: reemplaza el editor clásico por una vista de página única — info del proyecto colapsable, tabla de recursos con dropdowns inline (especialidad, L1–L11 con tooltip descriptivo, país, bilingüe, herramientas, stack, modalidad, cant, meses) y resumen financiero sticky a la derecha (total recursos, duración promedio, tarifa mensual total, total contrato, blend rate, TOTAL CON DESCUENTO). Defaults inteligentes para nuevo recurso (L5 / Colombia / no bilingüe / Sin herramientas / Estándar / Remoto / 1×6m) y botón ⎘ para duplicar fila.
- **Margen de contribución editable**: nuevo input en el panel financiero (además del descuento). Valor guardado en `metadata.margin_pct`; al cambiarlo se recalculan todas las líneas (`rate_hour`, `rate_month`, `total`) y la cascada completa (blend rate, total contrato, TOTAL CON DESCUENTO). Semáforo 🟢/🟡/🔴 sobre el margen aplicado con mínimo sugerido (35% talento) como referencia.
- **Vista clásica como fallback**: toggle con preferencia en `localStorage` (`dvpnyx_staff_aug_editor_classic`). El editor inline anterior se preserva como `StaffAugEditorClassic`.
- **Export**: `POST /api/quotations/:id/export?format=xlsx|pdf` ahora despacha por `quotation.type`. Filename `DVPNYX_Capacity_{project}_{YYYY-MM-DD}`. XLSX con Hoja 1 "Propuesta comercial" (cliente-facing, sin stack / sin cost empresa / sin margen) + Hoja 2 "Desglose tarifa" que justifica desde la tarifa base mensual ya con margen. PDF de 3 secciones (cover + equipo sin stack/modalidad/herramientas + resumen financiero). El desglose y las tarifas del export honran el `margin_pct` guardado en `metadata`.
- **Guards**: el route valida por tipo — fixed_scope requiere ≥1 perfil + ≥1 fase; staff_aug requiere ≥1 línea con `rate_month > 0`.

### docs(specs): gap analysis — `historias_capacity_planning.docx` ENTREGADO (2026-04-22)

Preventa compartió un spec marcado como urgente. Auditoría confirma que **15 de 16 historias ya estaban entregadas en Phases 7–12** (pre-handoff). Nuevo documento `docs/specs/GAP_ANALYSIS_capacity_planning_2026-04-22.md` recorre cada criterio de aceptación vs código real. 5 divergencias deliberadas identificadas que requieren decisión de preventa (ninguna es bug). Ticket marcado como entregado — a la espera de feedback de preventa sobre el estado actual en develop.

### feat(project-editor): editor unificado de proyectos + export xlsx/pdf (2026-04-22)

Respuesta al pedido urgente de preventa (`spec_editor_proyectos.docx`).

- **Nuevo `ProjectEditorUnified`**: reemplaza el stepper de 6 pasos por una vista de página única con 3 zonas (info colapsable, equipo + matriz + épicas, resumen financiero sticky a la derecha). Recálculo en tiempo real sobre todos los campos, semáforo de margen (🟢 ≥ 50%, 🟡 40–50%, 🔴 < 40%) y overrides editables de buffer/garantía/margen/descuento persistidos en `metadata.financial_overrides`.
- **Vista clásica como fallback**: toggle "Vista clásica / Vista unificada" con preferencia guardada en `localStorage` (`dvpnyx_project_editor_classic`). El editor original se preserva como `ProjectEditorClassic` sin cambios de comportamiento.
- **Export**: nuevo endpoint `POST /api/quotations/:id/export?format=xlsx|pdf` — XLSX de 4 hojas (Resumen, Asignación, Pagos, Épicas) con desglose interno de costos, y PDF cliente-facing que omite intencionalmente `cost_hour`, buffer, garantía y margen (solo muestra tarifa/hora y precio final).
- **Ownership**: creador, admin o superadmin. Usa `parameters_snapshot` si existe (EX-3), si no hace fallback a parámetros canónicos vivos.
- **Dependencias**: `exceljs ^4.4.0` y `pdfkit ^0.15.0` agregadas al server (require perezoso — si faltan, el endpoint responde 503 sin tirar el proceso).
- **Tests**: 9 nuevos tests cubren formato inválido, 404, 403 no-owner, admin-override, rechazo de staff_aug / sin perfiles / sin semanas, y headers correctos de xlsx/pdf (465/465 total verde).

---

## Phase 12 — US-RR-2 scoring realignment (2026-04-21)

- **fix(rr)**: alinear el matcher de candidatos con el spec de historias:
  `area = 40`, `level = 30 / 15 / 0`, `skills = 20`, `availability = 10`.
- Antes: `area = 20`, `level = 25` (curva asimétrica), `skills = 35`, `nice = 10`.
- `rankCandidates` ahora penaliza con **−40** a candidatos sin capacidad disponible (spec: "al fondo con score penalizado").
- `scoreAvailability` pasa a binario (≥ 80% de lo solicitado = +10), con `available_ratio` en el detalle para que la UI siga mostrando "15/20 h libres".
- Tests: `candidate_matcher.test.js` actualizado con aserciones explícitas del spec (22/22 pasan).

## Phase 11 — Self-host de fonts (2026-04-21)

- **feat(ui)**: self-host de Inter / Montserrat / JetBrains Mono vía `@fontsource/*`.
- Elimina el `<link>` a Google Fonts en `public/index.html` → **funciona offline** y sin CDN hop.
- JetBrains Mono ahora **sí** se carga (antes caía a Menlo fallback).
- CRA empaqueta 122 archivos de font (woff/woff2, subsets latin/latin-ext/cyrillic) bajo `build/static/media/`.

## Phase 10 — Preferencias de usuario (2026-04-20)

- **feat(ui)**: página `/preferencias` — tema (claro/oscuro), color de acento (0-360 con 6 presets: Violeta, Azul, Teal, Verde, Naranja, Rojo), densidad (Compacta 0.9 / Normal 1.0 / Relajada 1.1).
- Backend: columna `users.preferences JSONB NOT NULL DEFAULT '{}'`, `GET /auth/me` la devuelve, `PUT /auth/me/preferences` con allowlist (scheme / accentHue / density) y merge parcial.
- Cliente: `AuthContext.applyPreferences(prefs)` flipea `data-scheme` y setea `--accent-hue` / `--density` en `:root` al instante (optimistic UI con rollback si falla el PUT).
- Sidebar: entrada "Preferencias" con icono `Palette`, visible para todos los usuarios.

## Phase 9 — StatusBadge + Avatar centralizados (2026-04-20)

- **feat(ui)**: nuevo `client/src/shell/StatusBadge.js` con `TONE_MAP` por dominio (contract, assignment, opportunity, resource_request, employee, quotation).
- **feat(ui)**: nuevo `client/src/shell/Avatar.js` con `hueFromName()` determinista y `initialsFor()`. Reemplaza la tarjeta estática del sidebar y los avatares inline de Employees / TimeMe.
- Todas las tablas migradas a `<StatusBadge domain="..." value={x.status} />` (Contracts, Assignments, Opportunities, ResourceRequests, EmployeeDetail, OpportunityDetail, App.js).

## Phase 8 — Editores con tokens + typography (2026-04-19)

- **feat(ui)**: App.js — `css.logo` pasa de Montserrat a `--font-ui` 700; `css.btn` usa `--ds-accent` + `--ds-radius`; `css.btnOutline` pasa a tokens.
- H3 de todas las secciones de editor: 13/600, `--ds-text`, uppercase, `letterSpacing: 0.04`.
- Celdas monoespaciadas (`rate_month`, params value) con `--font-mono` + `tnum`.

## Phase 7 — Capacity Planner timeline (2026-04-19)

- **feat(ui)**: refresh visual de `CapacityPlanner.js` con tokens DS, tipografía coherente, métricas con color-coding (`--ds-accent`, `--ds-ok`, `--ds-bad`, `--ds-warn`) y fuente de contrato en `--font-ui` 600.

---

## Fases 1 → 6 (pre-UI-refresh)

Cubren el build inicial del producto V2. Resumen cronológico por bloque (detalle exacto en `git log` y `docs/specs/v2/09_user_stories_backlog.md`):

### Sprint 9 — Bulk import + Command Palette + Dashboard ejecutivo
- Importador CSV para empleados y clientes (`/api/bulk-import`, UI `BulkImport`).
- Palette `Cmd-K` con búsqueda global (`/api/search`, `shell/CommandPalette`).
- Dashboard ejecutivo (`routes/dashboard.js`, `modules/DashboardMe.js`).

### Sprint 8 — Notifications
- Tabla `notifications`, endpoints `/api/notifications`, drawer en el topbar.

### Sprint 7 — Reports
- 6 reportes críticos (`/api/reports/:type`), UI `Reports` con hub.

### Sprint 6 — Capacity Planner backend + frontend
- `GET /api/capacity/planner` (US-BK-1): utilización por semana calculada server-side.
- Módulo `CapacityPlanner` con timeline, filtros y gaps.

### Sprint 5 — Time tracking
- `/api/time-entries`, matriz semanal personal (`modules/TimeMe`), validación de retroactividad (configurable via `parameters`).

### Sprint 4 — Contracts + Resource Requests + Assignments
- `/api/contracts` con flujo `planned / active / paused / completed / cancelled`.
- `/api/resource-requests` (US-RR-1) + endpoint de candidatos (US-RR-2).
- `/api/assignments` con validación de overbooking / solapamiento.
- Pre-validación (US-BK-2): `POST /api/assignments/validate` sin crear.

### Sprint 3 — Employees + Skills + Areas
- `/api/employees` con status transitions y side-effects (EE-2).
- `/api/skills`, `/api/areas` catálogos.
- `employee_skills` con proficiency 1-5.

### Sprint 2 — Clients + Opportunities
- `/api/clients` (tier, país, industria, soft delete).
- `/api/opportunities` (status pipeline, linked a clients, squad auto-provisionado).

### Sprint 1 — Fundaciones V2
- Migrations V1 + V2 coexistiendo (idempotente).
- Roles V2: `superadmin / admin / lead / member / viewer` + `users.function`.
- Audit log + events + soft delete en todas las tablas nuevas.

### Sprint 0 — Cotizador V1
- Modelo legacy quotations (staff aug + fixed scope).
- Parámetros globales (costos por nivel, multiplicadores, buffer, garantía, margen).
- Seed con admin/user demo.

---

## Notas para el equipo entrante

- **Versionado formal pendiente**: hoy todo vive en `develop` / `main`. Al arrancar el primer sprint del nuevo equipo, sugerimos introducir tags (`v2.1.0`, etc.) y sincronizar con el `APP_VERSION` que consume `/api/health`.
- **Política de changelog**: actualizar este archivo en cada PR que cambie comportamiento observable por el usuario. Los commits `chore:` / `docs:` no necesitan entrada.
- **Fechas**: este proyecto trabaja en zona horaria del repositorio (UTC) y las fechas del changelog son las del merge a `develop`.
