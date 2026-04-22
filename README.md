# DVPNYX Quoter + Capacity Planner

SaaS interno de Double V Partners que integra **quote → contract → staff → bill**: cotizaciones de staff augmentation y proyectos de alcance fijo, gestión de contratos, solicitudes de recursos, asignación de empleados, time tracking y reportes ejecutivos.

**Producción:** https://quoter.doublevpartners.com · **Dev:** https://dev.quoter.doublevpartners.com

---

## 📦 Entrega a nuevo equipo

Si estás arrancando con este proyecto, **empezá aquí**:

1. [`HANDOFF.md`](HANDOFF.md) — punto de entrada, 10 min de lectura.
2. [`docs/PROJECT_STATE_HANDOFF.md`](docs/PROJECT_STATE_HANDOFF.md) — estado real del sistema, tech debt, preguntas abiertas.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) — diagramas, flujos, puntos de extensión.
4. [`CONTRIBUTING.md`](CONTRIBUTING.md) — ramas, commits, PRs, tests.
5. [`CHANGELOG.md`](CHANGELOG.md) — historial por fases.
6. [`SECURITY.md`](SECURITY.md) — modelo de amenazas y reporte de vulnerabilidades.

---

## 🚀 Quick start (5 minutos)

### Desarrollo local — un comando

```bash
docker compose -f docker-compose.dev.yml up --build
# → cliente: http://localhost:3000
# → API:     http://localhost:4000
# → DB:      127.0.0.1:55432 (postgres/postgres, db: dvpnyx)
```

Credenciales seed:
- `admin@dvpnyx.com` / `admin123` — superadmin
- `user@dvpnyx.com` / `user123` — member

### Tests

```bash
# Backend — 456 tests en 25 suites
cd server && npx jest

# Frontend — 318 tests en 32 suites
cd client && npm run test:ci

# Con cobertura
cd server && npm run test:coverage
cd client && npm run test:coverage
```

Setup detallado, troubleshooting y variables de entorno: [`docs/ONBOARDING_DEV.md`](docs/ONBOARDING_DEV.md).

---

## 🧱 Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + react-router-dom 6, Create React App 5, fonts self-hosted (`@fontsource/*`), DS con tokens CSS (`--ds-*`) |
| Backend | Node 20 + Express 4, `pg` driver nativo, JWT (`jsonwebtoken`), `helmet`, `express-rate-limit`, `express-validator` |
| DB | PostgreSQL 16 |
| Packaging | Dockerfile multi-stage; `client/build` servido por el mismo Express en prod |
| Reverse proxy | Traefik (TLS + host rule) |
| CI/CD | 6 GitHub Actions → GHCR → EC2 (ver [`.github/workflows/`](.github/workflows/)) |
| Testing | Jest + supertest (backend) · Jest + React Testing Library (frontend) |
| Infra alterna | AWS CDK (TypeScript) en [`infra/`](infra/) — stack listo para activar |

---

## 📂 Layout del repo

```
dvpnyx-quoter/
├── HANDOFF.md              ← primer archivo a leer
├── ARCHITECTURE.md         ← diagramas + flujos técnicos
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── client/                 # React 18 SPA (CRA)
│   └── src/
│       ├── App.js
│       ├── AuthContext.js
│       ├── theme.css       # tokens DS — fuente única de estilos
│       ├── modules/*.js    # una pantalla por módulo
│       ├── shell/*.js      # Sidebar, Topbar, StatusBadge, Avatar, …
│       └── utils/{api,apiV2,calc}.js
├── server/                 # Express + pg
│   ├── index.js
│   ├── database/
│   │   ├── migrate.js      # DDL idempotente (corre en cada deploy)
│   │   ├── migrate_v2_data.js
│   │   ├── seed.js
│   │   └── pool.js
│   ├── middleware/auth.js
│   ├── routes/*.js         # una ruta por entidad
│   └── utils/{calc,events,candidate_matcher,capacity_planner,assignment_validation,bulk_import,…}.js
├── docs/
│   ├── PROJECT_STATE_HANDOFF.md
│   ├── MANUAL_DE_USUARIO.md
│   ├── ONBOARDING_DEV.md
│   ├── runbooks/           # DEPLOY / ROLLBACK / DR / BULK / V2_MIGRATION
│   └── specs/v2/           # specs originales (pueden estar desfasadas; código manda)
├── infra/                  # AWS CDK (TS)
├── .github/workflows/
├── Dockerfile
├── docker-compose.yml      # prod-like
└── docker-compose.dev.yml
```

---

## 🔐 Roles y permisos (V2)

| Rol | Descripción | Permisos típicos |
|-----|-------------|------------------|
| `superadmin` | Dios | Todo + impersonation |
| `admin` | Operativo | CRUD de todas las entidades |
| `lead` | Lidera un squad | Aprueba asignaciones (aspiracional — chequeo formal pendiente) |
| `member` | Usuario estándar | Cotiza, registra horas, ve sus propios datos |
| `viewer` | Solo lectura | Acceso lectura a reportes |

Campo adicional `users.function` (comercial / preventa / delivery / capacity / finanzas) para visibilidades futuras por función.

---

## 🌿 Branching

| Rama | Destino | CI/CD |
|------|---------|-------|
| `main` | Producción (`quoter.doublevpartners.com`) | `deploy.yml` (manual release PR desde `develop`) |
| `develop` | Dev (`dev.quoter.doublevpartners.com`) | `develop-ci.yml` + `deploy-dev.yml` |
| `feat/*`, `fix/*`, `chore/*` | — | Tests en PR |

Detalle en [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## 🧪 Salud del código al momento de la entrega (2026-04-21)

| Métrica | Valor |
|---------|-------|
| Tests backend | 456 / 456 ✅ |
| Tests frontend | 318 / 318 ✅ |
| Build warnings | 0 |
| TODOs / FIXMEs huérfanos | 0 |
| Secretos commiteados | 0 |
| CI pipelines activos | 6 |

---

## 🛠️ Deploy

### Local (desarrollo)
`docker compose -f docker-compose.dev.yml up --build` — todo en contenedores.

### Producción actual (Traefik + EC2 + GHCR)
Flujo automatizado vía GitHub Actions. Runbook: [`docs/runbooks/DEPLOY.md`](docs/runbooks/DEPLOY.md).
Rollback: [`docs/runbooks/ROLLBACK.md`](docs/runbooks/ROLLBACK.md).
DR: [`docs/runbooks/DR.md`](docs/runbooks/DR.md).

### Alternativa AWS (CDK)
Stack TypeScript en [`infra/`](infra/). Inactivo hoy; activable cuando se decida migrar de EC2 a ECS/Fargate + RDS.

---

## 🔧 Variables de entorno

| Variable | Descripción | Default (dev) |
|----------|-------------|---------------|
| `DB_HOST` | Host Postgres | `localhost` |
| `DB_PORT` | Puerto Postgres | `5432` |
| `DB_NAME` | Database | `dvpnyx` |
| `DB_USER` | Usuario | `postgres` |
| `DB_PASSWORD` | Password | (requerido en prod) |
| `JWT_SECRET` | Secreto JWT | (requerido) |
| `JWT_EXPIRES_IN` | TTL del token | `8h` |
| `PORT` | Puerto API | `4000` |
| `NODE_ENV` | Ambiente | `development` |
| `CLIENT_URL` | Origin CORS | `http://localhost:3000` |
| `APP_VERSION` | Versión (para `/api/health`) | `2.0.0-dev` |
| `GIT_SHA` / `REACT_APP_GIT_SHA` | SHA commit (para `/api/health`) | `unknown` |

Ver [`server/.env.example`](server/.env.example) y [`.env.example`](.env.example).

---

## 📜 Licencia

Propiedad de Double V Partners. Ver [`LICENSE`](LICENSE). Third-party bajo sus licencias respectivas (ver `node_modules/`).

---

*README actualizado 2026-04-21 como parte de la entrega formal a nuevo equipo. Si algo acá queda desactualizado, la fuente de verdad es `HANDOFF.md` + el código.*
