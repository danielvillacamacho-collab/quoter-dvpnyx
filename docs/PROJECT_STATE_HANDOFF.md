# DVPNYX Cotizador — Project State Handoff

> **Propósito de este documento:** dar contexto completo a un agente/persona
> que va a **diseñar las siguientes iteraciones** del sistema, partiendo de
> la base actual. Es un snapshot del estado real (no del roadmap original
> ni de specs aspiracionales).
>
> **Fecha del snapshot:** 2026-05 (refresh post AI-readiness foundations + cleanup técnico + planning loop closure)
> **Rama base:** `develop` (al día con `main`)
> **Repo:** https://github.com/danielvillacamacho-collab/quoter-dvpnyx
>
> **Complemento**:
> - [`HANDOFF.md`](../HANDOFF.md) — punto de entrada del equipo entrante.
> - [`ARCHITECTURE.md`](../ARCHITECTURE.md) — diagramas técnicos.
> - [`docs/MODULES_OVERVIEW.md`](MODULES_OVERVIEW.md) — mapa módulo por módulo.
> - [`docs/ROADMAP.md`](ROADMAP.md) — qué está vivo / qué falta.
> - [`docs/DECISIONS.md`](DECISIONS.md) — decisiones técnicas (ADR).

---

## 0. Lo que cambió desde 2026-04-21 (previa snapshot)

Si tenías esta documentación cargada de la versión anterior, lo importante es:

### Nuevos features productivos

- **Plan-vs-Real semanal** (`/reports/plan-vs-real`): compara `assignments.weekly_hours / weekly_capacity_hours` (planeado %) contra `weekly_time_allocations.pct` (real %) con tolerancia ±10pp. Auto-scoping por rol (lead → sus reportes; member → él mismo; admin → todos).
- **Conversión cotización → contrato de un click** (`POST /api/contracts/from-quotation/:id`).
- **Kick-off del contrato** (`POST /api/contracts/:id/kick-off`): el delivery_manager da una `kick_off_date` y el sistema lee la `winning_quotation` y crea `resource_requests` automáticos.
- **Manager / lead role**: `employees.manager_user_id` (ya existía en schema) ahora se aprovecha. Rol `lead` ve su equipo en `/time/team` y `/reports/plan-vs-real`. EmployeeDetail (admin-only) tiene picker de líder directo.
- **Asignación in-place desde Capacity Planner**: click en barra "Sin asignar" → modal de candidatos → `Asignar →` llama POST /api/assignments inline. Si overbooking, cae al form manual con prefill.
- **`/time/team`** con admin/lead picker cuando el caller no tiene `employees` row, y null-safe rendering + ErrorBoundary global.

### Cleanup técnico (sin cambios funcionales)

- Helpers nuevos `utils/sanitize.js` (parsePagination, isValidUUID, …) y `utils/http.js` (serverError, safeRollback).
- Pagination parameterizada en 8 rutas (LIMIT/OFFSET via $N).
- Error logging estandarizado en 40+ endpoints (eran one-liner sin contexto).
- ROLLBACK silenciosos `.catch(()=>{})` reemplazados por `safeRollback` con logging.
- bulk_import: validación de `entity` antes de `setHeader` (filename injection).
- AuthContext.updatePreferences: stale closure bug en rollback corregido.
- _stubs.js: limpiado, sólo squads + events restantes (los demás eran redundantes).

### Capa AI-readiness (mayo 2026)

- 3 tablas nuevas: `ai_interactions`, `ai_prompt_templates`, `delivery_facts`.
- pgvector best-effort: 7 columnas `*_embedding vector(1536)` con HNSW indexes (si la extensión está activa).
- Helpers: `utils/ai_logger.js` (mandatory wrapper), `utils/level.js` (INT↔Lx), `utils/slug.js`, `utils/json_schema.js`.
- Endpoints `GET /api/ai-interactions` (admin) + `POST /:id/decision` (feedback loop).
- Materialized view `mv_plan_vs_real_weekly` + función plpgsql `refresh_delivery_facts()`.
- 8 CHECK constraints adicionales (capacity bounds, hours bounds, date order, quantity).
- COMMENT ON TABLE/COLUMN para 7 tablas + JSONB críticos.
- Slugs URL-friendly + LLM-friendly en clients/opportunities/contracts/employees.
- Narrative TEXT en areas y skills para RAG.

### Tests

- Server: 456 → **638 / 638** (+182 nuevos en cleanup + AI-readiness + planning-loop + kick-off).
- Cliente: 318 → 325 (+7), 2 fallas TimeMe pre-existentes (no bloqueantes).
- Build de producción cliente: limpio, sin warnings.

### Documentación

- 9 documentos nuevos en `docs/`: CONVENTIONS, MODULES_OVERVIEW, API_REFERENCE, AI_INTEGRATION_GUIDE, ROADMAP, DECISIONS, RUNBOOKS_INDEX.
- Reescritos: README, HANDOFF, ARCHITECTURE, CHANGELOG, data_model.

---

---

## 1. Qué es DVPNYX Cotizador

SaaS interno de **DVP (Double V Partners)** para:

1. **Comercial**: gestionar clientes → oportunidades → cotizaciones (staff augmentation y proyectos con scope fijo).
2. **Delivery**: traducir una cotización ganada a un **contrato**, emitir **solicitudes de recursos**, crear **asignaciones** sobre empleados, y hacer **time tracking** contra esas asignaciones.
3. **Gente**: catálogos de áreas, skills, empleados, y sus skills con nivel de proficiency.
4. **Reportes**: pipeline comercial, utilización, gaps de skills, reportes personales.

La tesis es un "quote → contract → staff → bill" integrado, no tres herramientas separadas.

### Usuarios y roles
Modelo V2 (ya productivo):
- **superadmin** — god mode.
- **admin** — crea/edita todo.
- **lead** — lidera un squad, aprueba asignaciones.
- **member** — usuario estándar (comercial, preventa, delivery).
- **viewer** — solo lectura.
- Campo adicional `users.function` (comercial / preventa / delivery / capacity / finanzas) para futuras visibilidades por función.

---

## 2. Stack técnico (real, no aspiracional)

| Capa | Tecnología |
|------|------------|
| Frontend | React 18 SPA con `react-router-dom` v6, estilos inline + `App.css`, sin librería UI (todo custom con variables CSS) |
| Backend | Node.js + Express (`^4.18`), `pg` (driver Postgres nativo), `jsonwebtoken` para auth, `helmet`, `express-rate-limit`, `express-validator` |
| DB | PostgreSQL 16 |
| Auth | JWT emitido por `/api/auth/login`; middleware `auth` y `adminOnly` en casi todas las rutas |
| Packaging | Docker multi-stage; `client/build` servido por el mismo Express en prod |
| Reverse proxy | Traefik (TLS, Host rule por env) |
| CI/CD | GitHub Actions → build + push a GHCR → SSH a EC2 → `docker compose pull` y restart |
| Tests | Jest + supertest (backend, **638 tests**) · Jest + RTL (frontend, **325/327** — 2 fallas pre-existentes) |
| AI-readiness | `ai_interactions` log + `ai_prompt_templates` versionados + embeddings `vector(1536)` con HNSW (pgvector opcional) + `delivery_facts` denormalizado + materialized view |

### Entornos
- **Prod**: `quoter.doublevpartners.com` — rama `main`.
- **Dev**: `dev.quoter.doublevpartners.com` — rama `develop`.
- **Local**: `docker compose` con base propia.

### Variables de entorno críticas
`DB_PASSWORD`, `JWT_SECRET`, `DVPNYX_HOST`, `CLIENT_URL`, `IMAGE_TAG` (lo setea el pipeline), y opcional Basic Auth Traefik para dev.

---

## 3. Módulos vivos hoy

Todos estos endpoints **existen, tienen tests, y están desplegados**:

### Backend (`server/routes/`)
| Ruta | Estado | Notas |
|------|--------|-------|
| `/api/health` | ✅ | Readiness + DB ping |
| `/api/auth` | ✅ | Login JWT, `POST /login` |
| `/api/users` | ✅ | CRUD admin; V2 roles |
| `/api/parameters` | ✅ | Tabla clave-valor para configuración |
| `/api/quotations` | ✅ | Staff aug + fixed-scope; lines, phases, epics, milestones, allocations |
| `/api/clients` | ✅ | CRUD + tier + país + soft delete |
| `/api/opportunities` | ✅ | CRUD, status (prospect/qualified/proposal/won/lost), linked a clients |
| `/api/employees` | ✅ | CRUD + status transitions con side-effects (EE-2), skills con proficiency |
| `/api/skills` | ✅ | Catálogo |
| `/api/areas` | ✅ | Catálogo |
| `/api/contracts` | ✅ | CRUD + status flow (planned/active/paused/completed/cancelled) |
| `/api/resource-requests` | ✅ | Solicitudes de perfiles por contrato |
| `/api/assignments` | ✅ | Con validación de overbooking (horas ≤ capacidad) |
| `/api/time-entries` | ✅ | Time tracking por empleado contra asignaciones |
| `/api/reports` | ✅ | 6 reportes críticos + dashboard personal |
| `/api/bulk-import` | ✅ | CSV upload para empleados / clientes (admin+) |
| `/api/squads` | ⚠️ **stub** | Devuelve array vacío. Squads **quitados de la UI** pero aún existen en DB como columna NOT NULL (ver §6) |
| `/api/events` | ⚠️ stub | Hay tabla `events` pero la ruta aún no expone histórico |
| `/api/notifications` | ⚠️ stub | Tabla existe, sin UI |

### Frontend (`client/src/modules/`)
Módulos con pantalla operativa:
- `Clients` + `ClientDetail` — lista, filtros (búsqueda/país/tier), crear/editar/eliminar, detalle con sub-tablas. **País es dropdown LATAM** (commit más reciente en el PR abierto).
- `Opportunities` + `OpportunityDetail`.
- `Contracts` + `ContractDetail` — con botones de transición de status y contadores de requests/assignments abiertos.
- `ResourceRequests`.
- `Assignments`.
- `Employees` + `EmployeeDetail` — con status transitions y skills.
- `Areas`, `Skills` — catálogos.
- `TimeMe` — tracking personal.
- `Reports` — hub con los 6 reportes.
- `DashboardMe` — home por usuario.
- `Users` — admin de usuarios + roles V2 + función.
- `BulkImport` — CSV.
- `NewQuotationPreModal` — forza elegir cliente + oportunidad antes de abrir editor (EX-1).
- `ProjectEditor` (fixed-scope) y el editor legacy de staff aug.
- `Wiki` — contenido estático.

Shell compartido: `shell/Breadcrumb`, `shell/ComingSoon`, `shell/Footer`. Sidebar con grupos colapsables y scroll (parche reciente — resolvía módulos cortados debajo del fold en pantallas chicas).

---

## 4. Modelo de datos (tablas reales en `server/database/migrate.js`)

Todas usan UUID, `created_at`, `updated_at`, `deleted_at` (soft delete) y FK a `users(id)` en `created_by`/`updated_by` salvo donde se indique.

- **users** — email, password_hash, role, function, squad_id(null), active.
- **parameters** — key/value global.
- **squads** — name, description, active. **Sigue en DB pero oculta al usuario.**
- **clients** — name, legal_name, country, industry, tier (enterprise/mid_market/smb), preferred_currency, tags.
- **opportunities** — client_id, account_owner_id, presales_lead_id, squad_id **NOT NULL**, status, expected_close_date, external_crm_id.
- **areas** — jerarquía de áreas/disciplinas.
- **skills** — name, area_id, description.
- **employees** — first_name, last_name, email, area_id, role/level, status (active/leave/terminated/…), hire_date, weekly_capacity, squad_id(null).
- **employee_skills** — pivot con proficiency (1-5).
- **contracts** — client_id, opportunity_id, winning_quotation_id, type (capacity/project/resell), status, start/end_date, owners (account/delivery/capacity), squad_id **NOT NULL**.
- **resource_requests** — contract_id, role_title, level, quantity, priority, status (open/partially_filled/filled/cancelled).
- **assignments** — employee_id, contract_id, request_id, weekly_hours, start/end_date, status (active/ended/paused).
- **time_entries** — employee_id, assignment_id, date, hours, note, locked.
- **quotations** y dependientes (`quotation_lines`, `_phases`, `_epics`, `_milestones`, `_allocations`) — modelo legacy V1 + puente V2 (`quotation_allocations` es la versión relacional nueva, EX-4).
- **audit_log** — todo cambio crítico se loguea.
- **events** — event sourcing ligero (escrito por `utils/events.js`).
- **notifications** — sin UI aún.

### Relaciones clave
```
clients 1—n opportunities 1—n quotations 1—0/1 contracts 1—n resource_requests 1—n assignments n—1 employees
employees n—n skills (via employee_skills)
contracts/opportunities/employees → squad (ver §6)
```

---

## 5. Flujo de deploy y estado de la rama

```
feature/fix branch → PR → develop → deploy-dev.yml → dev.quoter…
                                    ↓ (manual PR)
                                    main → deploy.yml → quoter…
```

- `deploy-dev.yml` corre `migrate.js` solamente.
- **`migrate_v2_data.js` NO se corre en dev** — por eso el squad `DVPNYX Global` no se seedea en dev. Se resolvió con auto-provisión desde el código (ver §6).
- Rollback manual: `rollback.yml` vuelve al `IMAGE_TAG` anterior.
- Backup nightly: `backup-nightly.yml`.

### Git hygiene
- Ramas por feature, PR a `develop`, merge con squash o fast-forward.
- Activar **auto-delete branches on merge** en GitHub Settings (recomendación pendiente).

---

## 6. Decisiones recientes importantes (que el siguiente agente DEBE conocer)

1. **Squads ocultos de la UI, pero aún en DB**:
   - `contracts.squad_id` y `opportunities.squad_id` son `NOT NULL`.
   - La UI ya no expone squads en ningún formulario.
   - El backend **auto-provisiona** un squad `DVPNYX Global` si la tabla está vacía (evita romper en dev limpio).
   - **Tech debt pendiente**: decidir si dropear columnas/tabla (migración destructiva) o dejarlo así indefinidamente.

2. **Cache-control en `index.html`**: se fuerza `no-cache` en el HTML para que deploys sean visibles sin que el usuario limpie cache.

3. **Sidebar con scroll**: `overflowY: auto` en `nav` — resuelto pero importante para siguientes módulos (si se agregan muchos items al sidebar, ya está listo).

4. **País del cliente = dropdown LATAM**: último PR abierto. Lista de 24 países alfabética hardcoded en `client/src/modules/Clients.js` (constante `LATAM_COUNTRIES`). Si el siguiente agente amplía catálogos, considerar moverla a `parameters` o a un endpoint `/api/catalogs/countries`.

5. **Modelo quotations dual**: existe el modelo legacy (`quotation_lines`, etc.) y el relacional nuevo (`quotation_allocations`). Ambos se escriben en dual-write (EX-4). Cuando el siguiente iterador toque cotizaciones, debe saber que **aún no se ha retirado** el modelo viejo.

---

## 7. Tech debt explícita y riesgos conocidos

| Ítem | Impacto | Notas |
|------|---------|-------|
| `squad_id NOT NULL` en `contracts`/`opportunities` | Medio | Auto-provisión lo tapa, pero schema no refleja el dominio real. |
| `events` y `notifications` sin UI | Bajo | Tablas llenándose sin consumidor. |
| Dual-write cotizaciones legacy↔V2 | Medio | Requiere decidir corte y migración backward. |
| Sin i18n formal | Bajo | UI en español, código/comentarios mezcla ES/EN. |
| Tests de frontend dependen de DOM labels en español | Medio | Si se introduce i18n, romperán. |
| No hay email/notifications transaccionales | Medio | Todo es in-app. |
| `_stubs.js` (`/api/squads`, `/events`, `/notifications`) devuelve arrays vacíos | Bajo | Consumidores ya lo esperan. |
| Estilos inline + App.css | Medio | Refactor a design system (ej. tokens + componentes) haría la próxima iteración mucho más rápida. |
| No hay observabilidad real (logs estructurados, traces) | Medio | `console.error` en catch. Pensar Datadog/Sentry. |
| Rate limiting básico (global `/api/*`) | Bajo | Login tiene el suyo, pero no hay por-usuario para escrituras. |

---

## 8. Qué NO existe todavía (espacio de diseño para las siguientes iteraciones)

- **Facturación / billing**: el ciclo termina en time_entries. No hay invoicing ni integración contable.
- **Aprobaciones**: no hay flujo de approval por lead/finanzas para asignaciones o time entries.
- **Integración CRM externa**: hay campo `external_crm_id` pero sin sync real.
- **Pipeline de oportunidades visual (Kanban)**: lista plana hoy.
- **Forecasting de capacidad**: hay datos (capacity + assignments + time) pero ningún módulo los proyecta hacia adelante.
- **Gestión de vacaciones / ausencias**: `employees.status` permite `leave` pero no hay calendario ni balance.
- **Skill gap alert automático**: hay reporte pero no notificación.
- **Mobile-first real**: funciona responsive, pero no es app nativa ni PWA.
- **Multi-tenant**: todo asume una sola org (DVP).
- **Roles granulares por módulo**: solo hay admin+/member/viewer a grano grueso.

---

## 9. Cómo leer el código (map rápido para el siguiente agente)

```
dvpnyx-quoter/
├── client/src/
│   ├── App.js                  # Layout + sidebar groups + routes
│   ├── App.css                 # Variables CSS + scrollbar custom
│   ├── AuthContext.js          # JWT en localStorage
│   ├── utils/
│   │   ├── api.js              # legacy V1 client (aún usado por quotations)
│   │   ├── apiV2.js            # V2 client (apiGet/Post/Put/Delete)
│   │   └── calc.js             # cálculos staff aug
│   ├── modules/*.js            # una pantalla por módulo (ver §3)
│   ├── modules/*Detail.js      # vistas de detalle
│   ├── modules/*.test.js       # RTL por cada módulo
│   ├── shell/                  # Breadcrumb, ComingSoon, Footer
│   └── ProjectEditor.js + Wiki.js   # fixed-scope y wiki
├── server/
│   ├── index.js                # Express + mount de rutas + estáticos prod
│   ├── middleware/auth.js      # JWT verify + adminOnly
│   ├── database/
│   │   ├── migrate.js          # DDL idempotente (corre en cada deploy)
│   │   ├── migrate_v2_data.js  # seeds V2 (NO corre en dev)
│   │   ├── pool.js             # pg Pool
│   │   └── seed.js             # datos demo
│   ├── routes/*.js             # una ruta por entidad (ver §3)
│   ├── routes/*.test.js        # supertest por cada ruta
│   └── utils/
│       ├── events.js           # emitEvent + buildUpdatePayload
│       └── bulk_import.js      # parser CSV
├── docs/specs/v2/              # specs originales (pueden estar desfasadas)
├── .github/workflows/          # deploy-dev, deploy (prod), rollback, backup, aws-infra
├── docker-compose.yml
└── Dockerfile                  # multi-stage
```

### Patrones del código
- **Soft delete**: `WHERE deleted_at IS NULL` en todos los SELECT.
- **Event emission**: toda mutación llama a `emitEvent(pool, { type, entity, ... })`.
- **Adminonly**: casi todas las escrituras requieren rol ≥ admin.
- **Normalización server-side**: los aliases legacy (`draft`→`planned`) se mapean en el boundary.
- **Tests de backend**: usan `pool` real contra DB de test; corren en CI con Postgres service.
- **Tests de frontend**: mock de `apiV2` con Jest, queries por `findByText` / `getByLabelText` en español.

---

## 10. Para el siguiente agente: cómo arrancar

1. **Lee primero**: este documento, `docs/specs/v2/01_vision_and_scope.md`, y `docs/specs/v2/09_user_stories_backlog.md`. Recordar que las specs pueden estar desfasadas respecto a lo que realmente se construyó — **este doc es la fuente de verdad del estado actual**.
2. **Corre local**: `docker compose up` en la raíz.
3. **Antes de diseñar**, entiende:
   - Qué flujos end-to-end funcionan hoy (quote → contract → assignment → time).
   - Qué está en stubs y podría desbloquearse (events, notifications).
   - Qué deuda de schema existe (squad_id, quotations legacy).
4. **Cuando propongas features**, marca:
   - Si es frontend-only, backend-only, o full stack.
   - Si requiere migración de schema (y si es destructiva).
   - Qué tests hay que actualizar.
5. **Respeta el estilo**:
   - PRs pequeños, 1 feature por rama.
   - Base siempre `develop`, merge a `main` solo para release.
   - Tests nuevos por cada endpoint/módulo.

### Preguntas abiertas que conviene aclarar con el Product Owner (Daniel)
- ¿Se dropea el concepto de `squad` del schema o se mantiene para una v3?
- ¿Billing es prioridad antes o después de aprobaciones?
- ¿Mantener dual-write de quotations o cortar a V2 puro?
- ¿Meta de los próximos 90 días?

---

*Última actualización: 2026-04-21 por Claude (agent handoff). Si este doc se desincroniza del código, el código gana.*

---

## 11. Addendum 2026-04-21 — UI refresh completado (Phases 7 → 12)

Entre el snapshot original (2026-04-20) y la entrega formal al equipo entrante se cerraron 6 brechas identificadas en un audit post-Phase-7. Todas mergeadas a `develop`, todas con tests verdes, todas documentadas en [`CHANGELOG.md`](../CHANGELOG.md).

| Fase | Cambio | Archivo(s) clave |
|------|--------|------------------|
| 7 | Capacity Planner timeline con tokens DS | `client/src/modules/CapacityPlanner.js` |
| 8 | Editores (logo, botones, h3) migrados al DS | `client/src/App.js` |
| 9 | `StatusBadge` + `Avatar` centralizados | `client/src/shell/StatusBadge.js`, `shell/Avatar.js` |
| 10 | Página `/preferencias` (scheme / accentHue / density) | `client/src/modules/Preferencias.js`, `server/routes/auth.js` (`PUT /me/preferences`), `users.preferences JSONB` |
| 11 | Self-host de Inter / Montserrat / JetBrains Mono | `client/src/index.js` + `@fontsource/*` |
| 12 | Alinear scoring de candidatos con US-RR-2 (area=40, level=30, skills=20, avail=10, penalty=−40 si no capacidad) | `server/utils/candidate_matcher.js` |

**Consecuencias para el equipo entrante:**

- **DS maduro**: los tokens `--ds-*` cubren todo el producto; no queda legacy con colores hardcoded. Dark mode + hue + densidad son self-service vía `/preferencias`.
- **Fonts offline**: ya no dependemos de `fonts.googleapis.com`; la build es self-contained.
- **Scoring correcto**: el matcher de resource requests ahora sigue el spec del producto (docs/historias_capacity_planning.docx). Cualquier cambio futuro de pesos pasa por `WEIGHTS` en `candidate_matcher.js` + sus tests.
- **Nueva columna en `users`**: `preferences JSONB NOT NULL DEFAULT '{}'`. Migración idempotente ya aplicada en dev + prod.

Tests al cierre de la entrega: **456 backend + 318 frontend = 774 tests, 100% pasando**.

---

## 12. Qué mirar primero el día 1 como equipo nuevo

1. Leer [`HANDOFF.md`](../HANDOFF.md) (root) → este doc → [`ARCHITECTURE.md`](../ARCHITECTURE.md) → [`CONTRIBUTING.md`](../CONTRIBUTING.md).
2. Levantar local con `docker compose -f docker-compose.dev.yml up --build` y recorrer los 3 flujos happy path (ver §8 del HANDOFF).
3. Revisar las 4 **preguntas abiertas al Product Owner** (final de §10 arriba): squads, billing, dual-write de cotizaciones, meta de 90 días.
4. Si van a tocar algo grande: arrancar por el documento del dominio en `docs/specs/v2/` + el `routes/<dominio>.js` + su test file. **El código es la fuente de verdad**; las specs son un faro histórico.
