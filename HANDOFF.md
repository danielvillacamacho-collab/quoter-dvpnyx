# Entrega — DVPNYX Quoter + Capacity Planner

**Para:** el equipo de ingeniería y producto que toma el proyecto.
**De:** equipo saliente (Daniel Villa + agentes Claude).
**Fecha de snapshot:** 2026-04-21
**Rama base:** `develop` (al día con `main`).
**Repo:** `git@github.com:danielvillacamacho-collab/quoter-dvpnyx.git`

Este es el punto de entrada. Léelo completo (10 min) antes de abrir cualquier otro archivo. Todo lo demás está linkeado desde aquí.

---

## 1. ¿Qué es esto?

SaaS interno de **DVP (Double V Partners)** que integra en un solo producto el ciclo **quote → contract → staff → bill**:

- **Comercial**: clientes → oportunidades → cotizaciones (staff augmentation y proyecto de alcance fijo).
- **Delivery**: contratos → solicitudes de recursos → asignaciones → time tracking.
- **Gente**: áreas, skills, empleados (con proficiency).
- **Reportes**: pipeline, utilización, gap de skills, dashboards personales y ejecutivo.

Producción: **`quoter.doublevpartners.com`** · Dev: **`dev.quoter.doublevpartners.com`**.

---

## 2. Arranque rápido (5 minutos)

```bash
# Levantar todo local (DB + API + cliente) con datos demo
docker compose -f docker-compose.dev.yml up --build

# → cliente: http://localhost:3000
# → API:     http://localhost:4000
# → DB:      127.0.0.1:55432  (user/pass: postgres/postgres, db: dvpnyx)
```

Usuarios seed (`server/database/seed.js`):
- `admin@dvpnyx.com` / `admin123` — superadmin
- `user@dvpnyx.com`  / `user123`  — member

Pasos detallados, variables de entorno y troubleshooting: **[`docs/ONBOARDING_DEV.md`](docs/ONBOARDING_DEV.md)**.

---

## 3. Lectura obligatoria (por orden)

| # | Documento | Qué contiene | Tiempo |
|---|-----------|--------------|--------|
| 1 | Este archivo (`HANDOFF.md`) | Overview + orden de lectura | 10 min |
| 2 | [`docs/PROJECT_STATE_HANDOFF.md`](docs/PROJECT_STATE_HANDOFF.md) | **Fuente de verdad del estado actual**: módulos vivos, decisiones recientes, tech debt, preguntas abiertas | 20 min |
| 3 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Diagrama de componentes, flujo de request, modelo de datos | 15 min |
| 4 | [`docs/specs/v2/01_vision_and_scope.md`](docs/specs/v2/01_vision_and_scope.md) | Visión de producto — ojo: las specs pueden estar desfasadas respecto al código, el código gana | 15 min |
| 5 | [`docs/MANUAL_DE_USUARIO.md`](docs/MANUAL_DE_USUARIO.md) | Cómo se usa el producto end-to-end, vista funcional | 30 min |
| 6 | [`CONTRIBUTING.md`](CONTRIBUTING.md) | Reglas del juego: ramas, commits, PRs, tests | 10 min |
| 7 | [`CHANGELOG.md`](CHANGELOG.md) | Historial por fases (último: Phase 12 — RR-2 scoring) | 10 min |

Documentación complementaria (on demand):
- [`docs/specs/v2/05_api_spec.md`](docs/specs/v2/05_api_spec.md) — API por endpoint.
- [`docs/specs/v2/09_user_stories_backlog.md`](docs/specs/v2/09_user_stories_backlog.md) — backlog de historias.
- [`docs/runbooks/`](docs/runbooks/) — deploy, rollback, DR, bulk import, migración V2.
- [`SECURITY.md`](SECURITY.md) — reporte de vulnerabilidades, política de secretos.

---

## 4. Estado del sistema en 60 segundos

✅ **En producción, con tests, y estable:**
- Módulos V2 completos: clients, opportunities, employees, contracts, resource_requests, assignments, time_entries, quotations (staff aug + fixed scope), areas, skills, reports, dashboard, command palette, bulk import, notifications (backend + UI), preferencias de usuario.
- **Capacity Planner** con timeline + validación de asignaciones + sugerencia de candidatos (US-RR-2).
- **Design system** basado en tokens CSS (`--ds-*`, `--accent-hue`, `--density`) con dark mode + 6 presets de acento.
- Fonts self-hosted (`@fontsource/*` — Inter, Montserrat, JetBrains Mono).
- CI/CD activo (GitHub Actions → GHCR → EC2 vía Traefik).

⚠️ **En stub (existe la tabla pero no la UI completa):**
- `/api/squads` (squads ocultos deliberadamente de la UI; schema conserva la columna).
- `/api/events` (emisión sí existe, consulta histórica todavía no).

❌ **No existe todavía** (espacio para las siguientes iteraciones):
- Billing / facturación / integración contable.
- Flujos de aprobación (lead/finanzas) para asignaciones o time entries.
- Integración CRM externa (solo hay `external_crm_id`).
- Forecasting de capacidad y calendario de vacaciones.
- Multi-tenant.
- Observabilidad real (Datadog/Sentry) — hoy sólo `console.error`.

Detalle completo: **[`docs/PROJECT_STATE_HANDOFF.md §8`](docs/PROJECT_STATE_HANDOFF.md)**.

---

## 5. Salud del código al momento de la entrega

| Métrica | Valor |
|---------|-------|
| Tests backend | **456 / 456** (Jest + supertest, 25 suites) |
| Tests frontend | **318 / 318** (Jest + RTL, 32 suites) |
| Warnings / errores de build | 0 |
| Secretos en repo | 0 (verificado con `git grep`) |
| TODOs / FIXMEs huérfanos | 0 |
| CI pipelines | 6 workflows activos (`develop-ci`, `deploy`, `deploy-dev`, `rollback`, `aws-infra`, `backup-nightly`) |
| Versiones de Node | ≥ 20.x (probado en 20.18) |
| Versiones de Postgres | 16 |

Verifícalo tú:
```bash
cd server && npx jest          # 456 ✅
cd client && CI=true npx react-scripts test --watchAll=false  # 318 ✅
```

---

## 6. Las 5 decisiones que más te ahorrarán tiempo

1. **El código gana a la spec.** Las specs en `docs/specs/v2/` fueron escritas antes del build y en varios puntos están desfasadas. Cuando haya conflicto, confía en el código + `PROJECT_STATE_HANDOFF.md`.

2. **`squad_id` sigue NOT NULL en `contracts` y `opportunities`**, pero los squads están ocultos de la UI. El backend auto-provisiona "DVPNYX Global" si la tabla está vacía. **Decidir en los próximos 90 días si se dropea o no.**

3. **Modelo de cotizaciones dual-write**: existe el legacy (`quotation_lines`, `quotation_phases`, `quotation_epics`, `quotation_milestones`, `quotation_allocations`) y el V2 relacional (`quotation_allocations` es el puente). Ambos se escriben a la vez (EX-4). Cuando se toque cotizaciones, saber que **nada se ha migrado todavía**.

4. **Estilos**: ya no se usan clases legacy. Todo pasa por `client/src/theme.css` (tokens `--ds-*`). Para agregar una pantalla nueva, seguir `client/src/shell/tableStyles.js` y `shell/StatusBadge` / `shell/Avatar`.

5. **Preferencias de usuario** viven en `users.preferences JSONB`. Flip de tema / hue / densidad se aplica optimistamente a `:root` en `AuthContext.updatePreferences`. Para agregar una preferencia nueva: allowlist en `server/routes/auth.js :: sanitizePrefs` + control en `client/src/modules/Preferencias.js`.

---

## 7. Layout del repo en 30 segundos

```
dvpnyx-quoter/
├── HANDOFF.md                  ← estás aquí
├── ARCHITECTURE.md             ← diagramas + flujos
├── CHANGELOG.md                ← historial por fases
├── CONTRIBUTING.md             ← reglas del juego
├── SECURITY.md                 ← vulnerabilidades + secretos
├── LICENSE                     ← propiedad DVP
├── README.md                   ← overview histórico (ver HANDOFF para lo actual)
├── client/                     ← React 18 SPA
│   └── src/
│       ├── App.js              ← rutas + layout
│       ├── AuthContext.js      ← JWT + preferencias
│       ├── theme.css           ← DS tokens (SOURCE OF TRUTH para estilos)
│       ├── modules/*.js        ← una pantalla por módulo
│       ├── shell/*.js          ← sidebar, topbar, badges, avatars, tablas
│       └── utils/{api,apiV2,calc}.js
├── server/                     ← Express + pg
│   ├── index.js                ← entry + mount de routes
│   ├── database/
│   │   ├── migrate.js          ← DDL idempotente (corre en cada deploy)
│   │   ├── migrate_v2_data.js  ← seeds V2 (NO corre en dev)
│   │   ├── seed.js             ← demo data
│   │   └── pool.js
│   ├── middleware/auth.js      ← JWT + adminOnly
│   ├── routes/*.js             ← una ruta por entidad
│   └── utils/{events,calc,capacity_planner,candidate_matcher,…}.js
├── docs/
│   ├── PROJECT_STATE_HANDOFF.md     ← estado actual (fresco)
│   ├── MANUAL_DE_USUARIO.md         ← manual funcional
│   ├── ONBOARDING_DEV.md
│   ├── runbooks/                    ← DEPLOY / DR / ROLLBACK / BULK / V2_MIGRATION
│   └── specs/v2/                    ← especificaciones (pueden estar desfasadas)
├── infra/                      ← AWS CDK (TS) — stack alterno, inactivo hoy
├── .github/workflows/          ← 6 pipelines
├── Dockerfile                  ← multi-stage
├── docker-compose.yml          ← prod-like
└── docker-compose.dev.yml      ← dev local
```

---

## 8. Primer día del equipo entrante — checklist sugerida

- [ ] Clonar el repo y levantar `docker-compose.dev.yml` sin tocar nada. Verificar que todas las pantallas cargan con la seed.
- [ ] Leer `HANDOFF.md` (este archivo) + `PROJECT_STATE_HANDOFF.md` + `ARCHITECTURE.md`.
- [ ] Correr ambas suites de tests y confirmar 456 + 318 en verde.
- [ ] Hacer un PR trivial (corregir un typo en algún comentario) contra `develop` para probar el pipeline de CI.
- [ ] Abrir la app con las credenciales seed y recorrer los 3 flujos happy path:
  1. Crear cliente → crear oportunidad → crear cotización staff aug → revisar resumen.
  2. Crear contrato desde oportunidad → abrir resource request → asignar empleado (sugerencias).
  3. Registrar time entries del empleado asignado → abrir Dashboard del mismo usuario.
- [ ] Revisar las 4 **preguntas abiertas** al Product Owner en `PROJECT_STATE_HANDOFF.md §10` y conversarlas con Daniel antes de planear sprint 1.

---

## 9. Contactos

| Rol | Persona | Contacto |
|-----|---------|----------|
| Product Owner / origen | Daniel Villa Camacho | GitHub `@danielvillacamacho-collab` |
| Infra / AWS | TBD | TBD |
| On-call | TBD | Definir al arrancar |

Si algo no está documentado: preferir **preguntar en el primer sprint** que asumir. El código y `PROJECT_STATE_HANDOFF.md` cubren ~90% del estado real, pero hay decisiones que solo viven en la cabeza del dueño de producto.

---

*Este documento es la primera cosa que debería actualizar el equipo entrante cuando cambie una convención crítica (branching, nombres de entornos, owners). Si se queda desactualizado, pierde su valor.*
