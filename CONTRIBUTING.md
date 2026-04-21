# Contributing

Guía corta de cómo trabajar este repo sin romperlo. Si algo no está acá, preguntar antes de asumir.

## TL;DR

1. Ramear desde `develop`, PR hacia `develop`.
2. Tests obligatorios (back y front). El CI los corre igualmente.
3. Commits `feat: …` / `fix: …` / `chore: …`, en inglés o español consistente con el resto del hilo.
4. No tocar `main` directo. `main` = producción.
5. No commitear secretos ni `.env`. El `.gitignore` los filtra pero verificá.

---

## Ramas

| Rama | Propósito | CI |
|------|-----------|----|
| `main` | Producción (`quoter.doublevpartners.com`). **Read-only excepto por release PR desde `develop`.** | `deploy.yml` → EC2 |
| `develop` | Integración continua. Todo PR nuevo va aquí. Deploy auto a `dev.quoter.doublevpartners.com`. | `develop-ci.yml` + `deploy-dev.yml` |
| `feat/<scope>` | Una feature | Tests en PR |
| `fix/<scope>` | Una corrección | Tests en PR |
| `chore/<scope>` | Docs / infra / tooling | Tests en PR |

Nombrar la rama con el dominio afectado: `feat/ui-refresh-phase13-*`, `fix/assignment-overbooking`, `chore/handoff-package`. **Un PR = una intención clara.**

Activar "auto-delete branches on merge" en GitHub Settings (tarea pendiente del equipo entrante).

---

## Commits

Formato mínimo:

```
<type>(<scope>): <resumen imperativo de 50-72 chars>

<cuerpo opcional: qué / por qué — no cómo>

<footer opcional: refs, co-author>
```

Tipos aceptados: `feat`, `fix`, `chore`, `refactor`, `perf`, `test`, `docs`, `security`.

Scopes típicos del repo: `ui`, `api`, `auth`, `capacity`, `quotations`, `employees`, `rr` (resource requests), `preferences`, `infra`, `ci`.

Ejemplos:
- `feat(ui): Phase 10 — Preferencias page (scheme / accentHue / density)`
- `fix(rr): align US-RR-2 scoring with historias spec (area=40, level=30, skills=20, avail=10)`
- `chore(docs): add HANDOFF.md and ARCHITECTURE.md for engineering handoff`

Evitar commits "WIP", "updates", "stuff". Si el trabajo es grande, hacer commits atómicos (`git add -p`) y squashear en el merge.

---

## Pull requests

### Requisitos para merge
- ✅ Todos los workflows de CI verdes (tests + lint + build + health check).
- ✅ Descripción clara: qué cambia, por qué, cómo se testea.
- ✅ Tests nuevos si hay comportamiento observable (endpoint nuevo, componente nuevo, branch lógica nueva).
- ✅ Si toca schema de DB: migración en `server/database/migrate.js` **idempotente** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`).
- ✅ Si toca API: actualizar `docs/specs/v2/05_api_spec.md`.
- ✅ Si toca comportamiento de usuario: actualizar `docs/MANUAL_DE_USUARIO.md` y `CHANGELOG.md`.
- ✅ Sin secretos. Sin `console.log` huérfanos en código de producción (ok en tests).

### Formato de descripción de PR

```
## Summary
- Qué cambia (1-3 bullets)

## Why
- Contexto: issue, user story, audit gap, etc.

## Test plan
- [ ] Cómo verificarlo manualmente
- [ ] `npx jest` en server / `react-scripts test` en client
- [ ] Si es UI: screenshot o GIF antes/después

## Rollback
- Una línea: qué pasa si esto explota en prod y qué revertir.
```

### Review
- Al menos 1 aprobador del equipo activo.
- Si toca DB o CI: 2 aprobadores.
- Auto-merge permitido solo si todos los checks están verdes.

---

## Tests

### Correr local

```bash
# Backend
cd server && npx jest
cd server && npx jest --coverage   # con coverage

# Frontend
cd client && CI=true npx react-scripts test --watchAll=false
cd client && CI=true npx react-scripts test --watchAll=false --coverage
```

### Qué se espera

- **Backend**: Jest + supertest, Postgres de test en CI (service docker en GitHub Actions). Cobertura actual: **456 tests en 25 suites**. Thresholds sugeridos:
  - statements: 80%
  - branches:  70%
  - functions: 80%
  - lines:     80%

- **Frontend**: Jest + React Testing Library. Queries por `findByText` / `getByLabelText` en español. **318 tests en 32 suites**. Mock de `apiV2` / `api` por suite.

### Patrones

- **Backend**: un archivo de test por ruta (`routes/foo.test.js`) + uno por módulo puro (`utils/foo.test.js`). Los utilitarios puros (`calc.js`, `candidate_matcher.js`, `capacity_planner.js`, `assignment_validation.js`, `bulk_import.js`) tienen su propio test file.
- **Frontend**: un archivo de test por módulo (`modules/Foo.test.js`). Mockear la red con `jest.mock('../utils/apiV2')`. Para modales y flujos complejos, testear el comportamiento observable (clicks, asserts de DOM) — no implementación interna.

### Cuándo NO escribir un test
- CSS puro / tokens / estilos inline sin lógica.
- Wrapper triviales que solo re-exportan.
- UI que es puramente presentacional y no branchea.

---

## Estilo de código

### JavaScript

- **ES módulos** en client (CRA). **CommonJS** en server.
- **No lint config obligatoria todavía** — usa el sentido común de lo que ya existe:
  - 2 espacios de indent.
  - Single quotes salvo JSX attrs.
  - Semicolons.
  - Arrow functions por default.
  - Destructuring temprano.
  - Early returns en vez de `if/else` profundos.

### React

- **Functional components + hooks**. No class components.
- **Estilos inline con tokens del DS**: `style={{ color: 'var(--ds-text)' }}`. Para listas de estilos repetidas, extraer a un objeto `const s = { ... }` arriba del componente (ver `Preferencias.js`, `CapacityPlanner.js`).
- **Nunca hardcodear colores hex.** Siempre `var(--ds-*)`.
- **Nunca bullets unicode** (`•`). Usar `<ul>` / `<ol>`.
- **Accesibilidad**: `aria-label`, `role`, `aria-live` cuando aplique. Lucide icons con `aria-hidden="true"`.

### SQL

- Queries parametrizadas siempre (`$1, $2`) — **nunca** string interpolation.
- `SELECT *` está ok en funciones internas, **nunca** en respuestas HTTP directas (filtrar campos sensibles como `password_hash`).
- Soft delete: todos los `SELECT` productivos incluyen `WHERE deleted_at IS NULL`.
- Migraciones idempotentes: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`.

### Comentarios

Preferir explicar **por qué** en vez de qué. Si un bloque tiene una razón no obvia (workaround, hack temporal, constraint de performance, decisión de producto), documentarla inline. Ver `server/utils/candidate_matcher.js` y `client/src/AuthContext.js` como modelos.

---

## Migraciones de DB

Este repo **no usa** una herramienta tipo knex/prisma/sequelize. Todo pasa por `server/database/migrate.js`:

```js
// server/database/migrate.js
const V2_ALTERS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb`,
  // ...
];
```

Reglas:
1. **Siempre `IF NOT EXISTS`** (o equivalente) para que rerunning sea seguro.
2. **Nunca** DROP columnas en caliente. Si es necesario: feature-flag → migración lectura → migración escritura → drop en una siguiente release.
3. Data migrations (seeds específicos, backfills) van en `migrate_v2_data.js`, que **NO corre en dev** automáticamente.
4. Probar local con `docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up --build`.

---

## Secretos y variables de entorno

- `.env` es ignorado por git. **Nunca** commitear uno.
- Al introducir una variable nueva: actualizarla en `.env.example` y en `server/.env.example`.
- En producción las vars vienen del entorno de EC2 (systemd / docker compose). En dev vienen del `.env` local.
- Secretos compartidos (JWT_SECRET, DB_PASSWORD) se comparten por 1Password del equipo — **no por Slack / email / commit**.

---

## Reporte de vulnerabilidades

Ver [`SECURITY.md`](SECURITY.md). En corto: **no abras issue pública** por un bug de seguridad. Contactar al PO directamente.

---

## Estilo de documentación

- Markdown, 80-120 cols.
- Español por default para docs de producto y user-facing. Inglés OK para docs técnicas.
- Si un doc queda desactualizado en un PR, **actualizarlo en el mismo PR**. La deuda de docs se acumula rápido.

---

## Preguntas frecuentes del equipo entrante

**¿Puedo refactorizar los estilos inline a styled-components?**
Sí, pero como fase planificada y con aprobación del PO. Hoy el DS ya funciona con tokens; el paso a CSS-in-JS debería ser incremental, no big-bang.

**¿Puedo cambiar la lib de routing / state / UI?**
Evaluar costo-beneficio con el PO. No hay nada de fanatismo — lo que hay funciona, y cualquier cambio grande de stack impacta tests y deploys.

**¿Puedo dropear `squad_id`?**
Sí, pero siguiendo la regla de migraciones de arriba: feature flag → parar escrituras → migración destructiva. **Aclarar antes con el PO** si squads vuelven en v3.

**¿Dónde está la documentación de la API?**
Hoy en Markdown: `docs/specs/v2/05_api_spec.md`. OpenAPI formal está en el backlog. Si lo agregan, mantenerlo sincronizado o no sirve.
