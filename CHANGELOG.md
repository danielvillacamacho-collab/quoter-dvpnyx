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

_Nada pendiente al momento de la entrega. Todas las 6 brechas del audit UI fueron cerradas (Fases 7 → 12)._

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
