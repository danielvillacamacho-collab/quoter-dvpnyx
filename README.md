# DVPNYX Quoter + Capacity Planner

SaaS interno de **Double V Partners** que integra el ciclo **quote → contract → staff → time tracking**: cotizaciones de staff augmentation y proyectos de alcance fijo, contratos, solicitudes de recursos, asignación de empleados, time tracking, plan-vs-real semanal, revenue mensual y reportes ejecutivos.

> Nota de alcance: la **facturación / invoicing** vive en otro sistema (Holded); este producto cubre desde la oportunidad hasta el reconocimiento de ingresos (`revenue_periods`). No hay integración contable automática.

**Producción:** https://quoter.doublevpartners.com · **Dev:** https://dev.quoter.doublevpartners.com

> **Última actualización docs:** Mayo 2026. Snapshot post `chore/ai-readiness-foundations`.

---

## 📚 Documentación — empezá por acá

| # | Documento | Para quién | Tiempo |
|---|---|---|---|
| **0** | [`STATE_OF_THE_UNION.md`](STATE_OF_THE_UNION.md) | **Equipo senior entrante (2026-05-15)** — carta de aterrizaje día 1 | **15 min** |
| 1 | [`HANDOFF.md`](HANDOFF.md) | Punto de entrada técnico | 10 min |
| 2 | [`docs/PROJECT_STATE_HANDOFF.md`](docs/PROJECT_STATE_HANDOFF.md) | Estado real del sistema, deudas, decisiones | 20 min |
| 3 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Diagramas, flujos, stack, AI layer | 15 min |
| 4 | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | Patrones de código actuales (server + client) | 15 min |
| 5 | [`docs/MODULES_OVERVIEW.md`](docs/MODULES_OVERVIEW.md) | Mapa módulo por módulo (qué/dónde/deuda) | 20 min |
| 6 | [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | Catálogo de ~85 endpoints | referencia |
| 7 | [`docs/specs/v2/03_data_model.md`](docs/specs/v2/03_data_model.md) | Schema completo (28 tablas) | referencia |
| 8 | [`docs/AI_INTEGRATION_GUIDE.md`](docs/AI_INTEGRATION_GUIDE.md) | **Cómo conectar agentes IA** (Claude/GPT) | 25 min |
| 9 | [`docs/ROADMAP.md`](docs/ROADMAP.md) | Qué está vivo / qué falta / qué se difiere | 10 min |
| 10 | [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisiones técnicas (ADR-style) | referencia |
| 11 | [`docs/MANUAL_DE_USUARIO.md`](docs/MANUAL_DE_USUARIO.md) | Vista funcional end-to-end | 30 min |
| 12 | [`docs/ONBOARDING_DEV.md`](docs/ONBOARDING_DEV.md) | Setup dev local, troubleshooting | referencia |
| 13 | [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branching, commits, PRs, tests | 10 min |
| 14 | [`CHANGELOG.md`](CHANGELOG.md) | Historial por fases | referencia |
| 15 | [`SECURITY.md`](SECURITY.md) | Modelo de amenazas, secrets | 10 min |
| 16 | [`docs/RUNBOOKS_INDEX.md`](docs/RUNBOOKS_INDEX.md) | Runbooks ops (deploy, rollback, DR) | referencia |

---

## 🚀 Quick start (5 minutos)

### Desarrollo local — un comando

```bash
docker compose -f docker-compose.dev.yml up --build
# → cliente: http://localhost:3000
# → API:     http://localhost:4000
# → DB:      127.0.0.1:55432 (postgres/postgres, db: dvpnyx)
```

Credenciales seed (`server/database/seed.js`):
- `admin@dvpnyx.com` / `admin123` — superadmin
- `user@dvpnyx.com` / `user123` — member

### Tests

```bash
# Backend — 638 tests en 36 suites
cd server && ./node_modules/.bin/jest

# Frontend — 325/327 (las 2 fallas son TimeMe pre-existentes)
cd client && CI=true node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false

# Build de producción del cliente
cd client && CI=true node node_modules/react-scripts/bin/react-scripts.js build
```

Setup detallado: [`docs/ONBOARDING_DEV.md`](docs/ONBOARDING_DEV.md).

---

## 🧱 Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + react-router-dom 6, Create React App 5, fonts `@fontsource/*`, design tokens CSS OKLCH |
| Backend | Node 20 + Express 4, `pg` driver nativo, JWT, `helmet`, `bcryptjs`, `express-rate-limit` |
| DB | PostgreSQL 16 (con `uuid-ossp` siempre, `vector` opcional) |
| AI-readiness | `ai_interactions` log, `ai_prompt_templates` versioning, embeddings `vector(1536)` con HNSW |
| Packaging | Dockerfile multi-stage; `client/build` servido por Express en prod |
| Reverse proxy | Traefik (TLS + host rule) |
| CI/CD | 6 GitHub Actions → GHCR → EC2 |
| Testing | Jest + supertest + RTL |
| Infra alterna | AWS CDK (TS) en `infra/` — listo para activar |

---

## 📂 Layout del repo

```
dvpnyx-quoter/
├── README.md                 ← este archivo
├── HANDOFF.md                ← punto de entrada del equipo
├── ARCHITECTURE.md           ← diagramas + flujos técnicos
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── client/                   # React 18 SPA (CRA)
│   └── src/
│       ├── App.js
│       ├── AuthContext.js
│       ├── theme.css         # tokens DS — fuente única de estilos
│       ├── modules/*.js      # una pantalla por módulo
│       ├── shell/*.js        # Sidebar, Topbar, Badges, ErrorBoundary, …
│       └── utils/{api,apiV2,calc}.js
├── server/                   # Express + pg
│   ├── index.js
│   ├── database/
│   │   ├── migrate.js        # DDL idempotente (corre en cada deploy)
│   │   ├── seed.js
│   │   └── pool.js
│   ├── middleware/auth.js
│   ├── routes/*.js           # una ruta por entidad
│   └── utils/                # helpers compartidos
│       ├── sanitize.js, http.js
│       ├── events.js
│       ├── ai_logger.js, json_schema.js, level.js, slug.js
│       ├── calc.js, candidate_matcher.js, capacity_planner.js
│       └── assignment_validation.js
├── docs/
│   ├── PROJECT_STATE_HANDOFF.md
│   ├── MANUAL_DE_USUARIO.md
│   ├── ONBOARDING_DEV.md
│   ├── CONVENTIONS.md         ← patrones de código
│   ├── MODULES_OVERVIEW.md    ← mapa módulo por módulo
│   ├── API_REFERENCE.md       ← catálogo de endpoints
│   ├── AI_INTEGRATION_GUIDE.md
│   ├── ROADMAP.md
│   ├── DECISIONS.md           ← ADR-style
│   ├── RUNBOOKS_INDEX.md
│   ├── runbooks/              # deploy, rollback, DR, bulk import, V2 migration
│   └── specs/v2/              # specs originales (código gana cuando hay conflicto)
├── infra/                    # AWS CDK (TS) — stack listo para activar
├── .github/workflows/        # 6 pipelines
├── Dockerfile
├── docker-compose.yml
└── docker-compose.dev.yml
```

---

## 🔐 Roles y permisos

7 roles activos (post SPEC-CRM-00 v1.1) + `preventa` legacy. Macros operativas en [`server/middleware/auth.js`](server/middleware/auth.js): `ROLES`, `SEE_ALL_ROLES`, `WRITE_ROLES`. Detalle completo y matriz de permisos en [`docs/specs/v2/02_glossary_and_roles.md`](docs/specs/v2/02_glossary_and_roles.md).

| Rol | Descripción | Permisos típicos |
|---|---|---|
| `superadmin` | Bypass total | Todo + impersonation. Único que crea otros admin/superadmin. |
| `admin` | Operativo | CRUD de todas las entidades, kick-off de cualquier contrato. Ve todo. |
| `director` *(SPEC-CRM-00)* | VP / C-suite | Ve **todo** el pipeline + reportes. Sin permisos administrativos sobre usuarios. |
| `lead` | Líder de equipo | Ve tiempo + plan-vs-real de sus reportes directos (`employees.manager_user_id = users.id`). Puede hacer kick-off si es DM del contrato. |
| `member` | Usuario estándar | Cotiza, registra horas, ve sus propios datos. En oportunidades **ve solo las suyas** (account_owner o presales_lead). |
| `viewer` | Solo lectura | Reportes. |
| `external` *(SPEC-CRM-00)* | Acceso restringido | Usuarios fuera de DVP (clientes en demo, partners). En oportunidades retorna **403**. |
| `preventa` (legacy) | Backward-compat | Middleware reescribe a `member` + `function='preventa'`. No usar para usuarios nuevos. |

Campo adicional `users.function` (comercial / preventa / delivery_manager / capacity_manager / project_manager / fte_tecnico / people / finance / pmo / admin) para visibilidades futuras.

---

## 🌿 Branching

| Rama | Destino | CI/CD |
|---|---|---|
| `main` | Producción (`quoter.doublevpartners.com`) | `deploy.yml` (PR manual desde `develop`) |
| `develop` | Dev (`dev.quoter.doublevpartners.com`) | `develop-ci.yml` + `deploy-dev.yml` |
| `feat/*`, `fix/*`, `chore/*`, `docs/*` | — | Tests en PR |

Convenciones de commits y PRs: [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## 🧪 Salud del código (mayo 2026)

| Métrica | Valor |
|---|---|
| Tests backend | **1018+ / 1018+** ✅ (post SPEC-CRM-00) |
| Tests frontend | 470+ / 472+ (2 fallos pre-existentes en `client/src/modules/TimeMe.test.js`, sospecha DST/timezone — ver nota en cabecera del archivo) |
| Build cliente | Limpio, sin warnings |
| Tablas en DB | 28 |
| Endpoints API | ~85 |
| Módulos UI | ~25 |
| TODOs huérfanos | 0 |
| Secretos commiteados | 0 |
| CI pipelines activos | 6 |

Verifícalo:
```bash
cd server && ./node_modules/.bin/jest          # 638 ✅
cd client && CI=true node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false
```

---

## 🛠️ Deploy

### Local (desarrollo)
`docker compose -f docker-compose.dev.yml up --build` — todo en contenedores.

### Producción (Traefik + EC2 + GHCR)
Automatizado vía GitHub Actions.
- Runbook: [`docs/runbooks/DEPLOY.md`](docs/runbooks/DEPLOY.md)
- Rollback: [`docs/runbooks/ROLLBACK.md`](docs/runbooks/ROLLBACK.md)
- DR: [`docs/runbooks/DR.md`](docs/runbooks/DR.md)

### Alternativa AWS (CDK)
Stack TypeScript en [`infra/`](infra/). Inactivo hoy; activable cuando se decida migrar de EC2 a ECS/Fargate + RDS.

---

## 🔧 Variables de entorno

| Variable | Descripción | Default (dev) |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Postgres | `localhost`, `5432`, `dvpnyx`, `postgres`, … |
| `DB_SSL` | Habilitar SSL (RDS) | `false` |
| `JWT_SECRET` | Secreto JWT | (requerido) |
| `JWT_EXPIRES_IN` | TTL del token | `8h` |
| `PORT` | Puerto API | `4000` |
| `NODE_ENV` | Ambiente | `development` |
| `CLIENT_URL` | Origin CORS | `http://localhost:3000` |
| `APP_VERSION` | Versión (para `/api/health`) | `2.0.0-dev` |
| `GIT_SHA`, `REACT_APP_GIT_SHA` | SHA commit (para `/api/health`) | `unknown` |
| `ANTHROPIC_API_KEY` | (futuro, para agentes IA) | — |
| `OPENAI_API_KEY` | (futuro, para embeddings) | — |

Ver [`server/.env.example`](server/.env.example) y [`.env.example`](.env.example).

---

## 🤖 AI-readiness

El sistema tiene capa lista para integrar agentes IA con observabilidad y feedback loop. **Antes de conectar el primer agente, leer [`docs/AI_INTEGRATION_GUIDE.md`](docs/AI_INTEGRATION_GUIDE.md)**.

Resumen:
- `ai_interactions` table loguea cada llamada (modelo, prompt, output, decisión humana, costo, latencia).
- `ai_prompt_templates` versionados para reproducibilidad y A/B testing.
- `pgvector` opcional con columnas `*_embedding vector(1536)` en 7 tablas (skills, employees, requests, opportunities, contracts, quotations, areas).
- `utils/ai_logger.js :: run()` — wrapper obligatorio para toda llamada a un agente.
- `delivery_facts` denormalizada para forecasting ML.

---

## 📜 Licencia

Propiedad de Double V Partners. Ver [`LICENSE`](LICENSE). Third-party bajo sus licencias respectivas.

---

*Si algo aquí queda desactualizado, la fuente de verdad es `HANDOFF.md` + el código. Actualizar este README cuando cambien tests counts, endpoints clave o cuando se agregue un módulo nuevo.*
