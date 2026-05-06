# SPEC_AGENT_BRIEF

> **Para qué sirve este archivo**
> Es el **único archivo** que el agent que escribe specs lee antes de
> empezar. Le da el estado real del sistema (endpoints, tablas, módulos,
> roles) para que NO alucine entidades, columnas o rutas que no existen.
>
> **No editar las secciones marcadas `<!-- AUTO:*:start -->`** —
> se regeneran con `node scripts/regen-spec-brief.js`.
> El header (esta sección + "Reglas") es curado a mano.

<!-- AUTO:stamp:start -->
_Generado: pendiente · regenerar con `node scripts/regen-spec-brief.js`._
<!-- AUTO:stamp:end -->

---

## Cómo usar este brief

1. **Antes de invocar al spec agent**, correr:
   ```bash
   node scripts/regen-spec-brief.js
   ```
   Esto refresca el snapshot del código (5 secciones AUTO).
2. Pasarle al agent **solo este archivo** + el ticket / pedido del usuario.
3. El agent debe usar la plantilla de [`docs/specs/_TEMPLATE.md`](specs/_TEMPLATE.md) y, en cada
   sección "Cambios en el sistema", marcar **EXISTE / NUEVO** contra
   las tablas y rutas listadas abajo.

Si el agent propone una entidad/ruta que no aparece acá como EXISTENTE,
o no la marca explícitamente como NUEVA, el spec **se devuelve sin revisar**.

---

## Reglas para el spec agent (no negociables)

1. **Idioma:** Spec en español. Identificadores de código (rutas, columnas, roles, IDs de eventos) en inglés/snake_case como ya están en el repo.
2. **Roles:** Solo proponer permisos sobre los roles listados en la tabla de roles. Cualquier otro rol = inválido.
3. **DB:** Cualquier columna nueva en una tabla existente o tabla nueva tiene que decir explícitamente:
   - Tipo SQL exacto (UUID, INT, NUMERIC(p,s), VARCHAR(n), DATE, TIMESTAMPTZ, BOOLEAN, JSONB).
   - NULL / NOT NULL.
   - DEFAULT si aplica.
   - Constraint UNIQUE/CHECK/FK si aplica.
   - Migración como `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` o `CREATE TABLE IF NOT EXISTS` (idempotente — corre en cada deploy).
4. **Endpoints:** Si propone una ruta nueva, debe declarar:
   - `METHOD path` y archivo destino (ej. `server/routes/<file>.js`).
   - Middleware (`auth` por default; `adminOnly` o `requireRole(...)` si restringe).
   - Body / query / response shape (ejemplo JSON real, no `{...}`).
   - Códigos HTTP esperados (200/201, 400, 401, 403, 404, 409, 423, 500).
   - Si toca múltiples queries que mutan, exigir transacción.
5. **Frontend:** Si toca un módulo, dar la lista exacta de archivos del listado de módulos. Nuevos módulos van en `client/src/modules/<Name>.js` + `<Name>.module.css` + `<Name>.test.js`.
6. **Convenciones de código:** ver [`docs/CONVENTIONS.md`](CONVENTIONS.md) y [`docs/CSS_CONVENTION.md`](CSS_CONVENTION.md) — el spec NO repite esas reglas, las da por leídas.
7. **Decisiones técnicas previas:** ver [`docs/DECISIONS.md`](DECISIONS.md). Si el spec contradice una ADR, debe explicarlo en una sección "Reversión de ADR" y pedir aprobación.
8. **No proponer:**
   - Cambios al modelo de auth/roles (lo decide el equipo senior).
   - Migraciones destructivas (`DROP TABLE`, `DROP COLUMN`) sin aprobación explícita en el ticket.
   - Endpoints fuera de `/api/*`.
   - Reescritura de módulos completos cuando un cambio incremental sirve.
9. **Acceptance criteria:** mínimo 3, máximo 8, en formato `Dado / Cuando / Entonces`. Cada uno debe ser testeable sin levantar la UI (chequeable via `curl` + `psql`).
10. **Tamaño:** un spec apunta a 1-3 días de implementación. Si es más grande, partirlo en sub-specs (`SPEC-XXX-a`, `-b`, ...).

---

## Documentación complementaria (leer si el spec lo requiere)

| Archivo | Cuándo leerlo |
|---|---|
| [`docs/MODULES_OVERVIEW.md`](MODULES_OVERVIEW.md) | Antes de tocar un módulo: explica qué hace, archivos, deuda activa. |
| [`docs/API_REFERENCE.md`](API_REFERENCE.md) | Para entender el shape exacto de un endpoint existente que se va a modificar. |
| [`docs/DECISIONS.md`](DECISIONS.md) | Antes de proponer algo arquitectónico (caching, validation engine, eventos). |
| [`docs/ROADMAP.md`](ROADMAP.md) | Para no proponer features ya planeadas o ya hechas. |
| [`docs/CONVENTIONS.md`](CONVENTIONS.md) | Naming, estructura de tests, manejo de errores. |
| [`docs/CSS_CONVENTION.md`](CSS_CONVENTION.md) | Si el spec toca UI: CSS Modules + tokens, no inline styles. |
| [`docs/INCIDENTS.md`](INCIDENTS.md) | Para no replicar bugs ya resueltos. |
| [`STATE_OF_THE_UNION.md`](../STATE_OF_THE_UNION.md) | Métricas y prioridades del equipo. |

Si el ticket toca AI: [`docs/AI_INTEGRATION_GUIDE.md`](AI_INTEGRATION_GUIDE.md).

---

## Roles

<!-- AUTO:roles:start -->
_(pendiente — correr `node scripts/regen-spec-brief.js`)_
<!-- AUTO:roles:end -->

Convenciones aparte de lo de arriba:
- `staff` y `viewer` son lectura-solo en su scope.
- `external` es para usuarios fuera de la org (clientes en portal). El spec NO debe proponer endpoints accesibles a `external` sin autorización explícita en el ticket.

---

## Tablas existentes

> **Cómo leer esto:** son las tablas del schema canónico (extraído de
> `server/database/migrate.js`). Para detalles de columnas, constraints
> y FKs, leer ese archivo directamente. No alucinar columnas que no
> aparecen en migrate.js.

<!-- AUTO:tables:start -->
_(pendiente — correr `node scripts/regen-spec-brief.js`)_
<!-- AUTO:tables:end -->

---

## Módulos frontend existentes

> Cada nombre corresponde a `client/src/modules/<Nombre>.js`. Si el
> spec necesita cambios en uno, ver [`docs/MODULES_OVERVIEW.md`](MODULES_OVERVIEW.md) para
> archivos relacionados (tests, modal hijos, etc.).

<!-- AUTO:modules:start -->
_(pendiente — correr `node scripts/regen-spec-brief.js`)_
<!-- AUTO:modules:end -->

---

## Endpoints existentes

> Snapshot de `server/routes/*.js`. La columna **Middleware** indica el
> guard que aplica además del `router.use(auth)` global de cada router.
> `adminOnly` = `superadmin | admin`. `requireRole(...)` = lista
> explícita.

<!-- AUTO:routes:start -->
_(pendiente — correr `node scripts/regen-spec-brief.js`)_
<!-- AUTO:routes:end -->

---

## Specs previos (referencia)

<!-- AUTO:specs:start -->
_(pendiente — correr `node scripts/regen-spec-brief.js`)_
<!-- AUTO:specs:end -->

---

## Plantilla de spec

Usar [`docs/specs/_TEMPLATE.md`](specs/_TEMPLATE.md). Copiar a `docs/specs/v3/SPEC-XXX-<slug>.md` (o el path
que corresponda) y llenarla. No omitir secciones — si una no aplica,
escribir explícitamente "N/A — razón: ...".
