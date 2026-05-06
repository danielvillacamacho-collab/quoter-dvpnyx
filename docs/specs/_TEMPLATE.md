# SPEC-XXX — `<slug-corto>`

> **Antes de empezar:** leer [`docs/SPEC_AGENT_BRIEF.md`](../SPEC_AGENT_BRIEF.md).
> Este template es obligatorio. Si una sección no aplica, escribir
> `N/A — razón: ...` en vez de borrarla.

| Campo | Valor |
|---|---|
| **ID** | `SPEC-XXX` |
| **Título** | (oración corta, en español) |
| **Pedido por** | (rol o persona) |
| **Fecha** | YYYY-MM-DD |
| **Tamaño estimado** | S (≤ 1 día) / M (1-3 días) / L (>3 días — partir) |
| **Rama destino** | `develop` |
| **Specs relacionados** | `SPEC-YYY` (si aplica) |
| **ADRs afectadas** | (de [`docs/DECISIONS.md`](../DECISIONS.md), si aplica) |

---

## 1. Objetivo (1 párrafo)

¿Qué problema resuelve y por qué importa? Una persona que no leyó el
ticket debe entender la motivación leyendo este párrafo. **No** describir
la solución acá — solo el "para qué".

---

## 2. Glosario y entidades involucradas

Listar los conceptos del dominio que aparecen en el spec. Por cada uno,
una línea de definición en el contexto de este spec.

- **`<entidad>`** — ...
- **`<concepto>`** — ...

---

## 3. Cambios en el sistema

> **Regla:** cada item de las tablas de abajo debe estar marcado
> `[EXISTE]` o `[NUEVO]` contra el inventario del brief
> ([`docs/SPEC_AGENT_BRIEF.md`](../SPEC_AGENT_BRIEF.md)). Si decís `[EXISTE]` pero no aparece en el
> brief, el spec se rechaza.

### 3.1 Base de datos

| Tabla | Columna | Tipo | NULL | Default | Constraint | Estado |
|---|---|---|---|---|---|---|
| `assignments` | `is_locked` | BOOLEAN | NOT NULL | FALSE | — | `[EXISTE]` |
| `<tabla>` | `<col>` | `<tipo>` | YES/NO | `<def o —>` | `<UNIQUE/CHECK/FK o —>` | `[EXISTE]` / `[NUEVO]` |

**Migración (idempotente):**

```sql
-- Pegar el SQL exacto que se agregará a server/database/migrate.js
ALTER TABLE <tabla> ADD COLUMN IF NOT EXISTS <col> ...;
CREATE INDEX IF NOT EXISTS ... ON <tabla> (...);
```

Si NO toca DB: `N/A — razón: ...`.

### 3.2 Endpoints

| Método | Ruta | Archivo | Middleware | Estado |
|---|---|---|---|---|
| `GET` | `/api/<recurso>` | `server/routes/<file>.js` | `auth` | `[EXISTE]` / `[NUEVO]` |
| ... | | | | |

Por cada endpoint **NUEVO** o **MODIFICADO**, una sub-sección:

#### `<METHOD> /api/<ruta>`

- **Auth:** rol(es) que pueden llamarlo.
- **Query params:** `?foo=...&bar=...` (con tipos y obligatoriedad).
- **Body (si aplica):** ejemplo JSON real.
  ```json
  { "field": "value" }
  ```
- **Response 200/201:** ejemplo JSON real.
- **Errores:** `400` (validación), `403` (rol), `404`, `409` (conflict), `423` (lock), `500`.
- **Transaccionalidad:** ¿múltiples queries que mutan? si sí, especificar BEGIN/COMMIT.
- **Eventos / audit log:** ¿inserta en `events` o `audit_log`? especificar `event_type`.

Si NO toca endpoints: `N/A — razón: ...`.

### 3.3 Frontend

| Módulo | Archivo | Cambio | Estado |
|---|---|---|---|
| `Capacity Planner` | `client/src/modules/CapacityPlanner.js` | Botón nuevo | `[EXISTE]` |
| ... | | | |

**Nuevos módulos** (si aplica): listar `client/src/modules/<Name>.js`,
`<Name>.module.css`, `<Name>.test.js` y la entrada en `Sidebar.js` /
ruta en `App.js`.

Si NO toca UI: `N/A — razón: ...`.

### 3.4 Permisos

Tabla de quién puede hacer qué. Solo usar roles del brief.

| Acción | Roles permitidos |
|---|---|
| Ver lista | `superadmin, admin, director, lead, member, staff` |
| Crear | `superadmin, admin, lead` |
| Editar / borrar | `superadmin, admin` |

---

## 4. Acceptance criteria

Mínimo 3, máximo 8. Cada uno chequeable sin levantar la UI (`curl` +
`psql`).

1. **Dado** un usuario `<rol>` con `<estado>`, **cuando** `<accion>`, **entonces** `<resultado>` (status, body, side effect en DB).
2. ...
3. ...

---

## 5. Edge cases / errores explícitos

- ¿Qué pasa si `<entidad>` no existe? → `404`.
- ¿Qué pasa si dos requests concurrentes? → ...
- ¿Qué pasa si `<input>` está fuera de rango? → `400` con mensaje.
- ¿Qué pasa con soft-deletes (`deleted_at IS NOT NULL`)? → ...

---

## 6. No-objetivos

Lista corta de qué este spec **NO** hace, para evitar scope creep.

- No incluye notificaciones por email (queda para SPEC-YYY).
- No reescribe la columna `assignments.is_locked` (deuda técnica reconocida).
- ...

---

## 7. Plan de pruebas

- **Unit tests:** archivos donde van + casos a cubrir.
- **Smoke con data real:** pasos para validar en `develop` antes de merge a `main`.
- **Rollback:** si la migración rompe algo, ¿cómo revertir?

---

## 8. Riesgos y deuda técnica

- **Riesgo:** ... — Mitigación: ...
- **Deuda dejada:** ... — Por qué se acepta: ...

---

## 9. Open questions

> Agregarlas acá antes de mergear el spec. Cada una bloquea o
> condiciona la implementación.

- [ ] ¿...?
- [ ] ¿...?
