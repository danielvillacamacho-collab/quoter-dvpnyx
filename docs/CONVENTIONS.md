# Convenciones técnicas — DVPNYX Quoter

Patrones que el código del repo sigue **hoy**. Si vas a contribuir, segui estos para no introducir inconsistencia. Si encontrás algo en el código que rompe estas convenciones, probablemente sea deuda técnica que vale la pena corregir en el mismo PR.

---

## Índice

1. [Principios](#1-principios)
2. [Server: rutas Express](#2-server-rutas-express)
3. [Server: utilidades obligatorias](#3-server-utilidades-obligatorias)
4. [Server: SQL y pool](#4-server-sql-y-pool)
5. [Server: transacciones](#5-server-transacciones)
6. [Server: emisión de eventos](#6-server-emisión-de-eventos)
7. [Server: tests](#7-server-tests)
8. [Client: módulos React](#8-client-módulos-react)
9. [Client: estilos / Design System](#9-client-estilos--design-system)
10. [Client: fetch + auth](#10-client-fetch--auth)
11. [Naming, comentarios y commit messages](#11-naming-comentarios-y-commit-messages)
12. [Anti-patterns conocidos](#12-anti-patterns-conocidos)

---

## 1. Principios

1. **El código gana a la spec.** Si una spec en `docs/specs/` y el código discrepan, el código es la verdad.
2. **Cada cambio aditivo, nunca destructivo.** Migraciones idempotentes. Rutas nuevas, no rutas alteradas en silencio.
3. **Logging > comentarios.** Una línea `console.error('GET /foo failed:', err)` salva una hora de debug en prod.
4. **Validar en el server, optimistic en el client.** El cliente puede mandar basura; el servidor nunca confía.
5. **Tests acompañan cada cambio funcional.** Añadir endpoint sin test es deuda inmediata.
6. **No agregar libs grandes** (charting, grids, state managers) sin discusión con PO. La app es liviana a propósito.

---

## 2. Server: rutas Express

Patrón estándar de cada `server/routes/<entidad>.js`:

```js
const router = require('express').Router();
const pool = require('../database/pool');
const { auth, adminOnly } = require('../middleware/auth');
const { emitEvent } = require('../utils/events');
const { parsePagination, isValidUUID } = require('../utils/sanitize');
const { serverError, safeRollback } = require('../utils/http');

router.use(auth);   // toda la ruta requiere login

/* -------- LIST -------- */
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const wheres = ['deleted_at IS NULL'];
    const filterParams = [];
    const add = (v) => { filterParams.push(v); return `$${filterParams.length}`; };

    if (req.query.status) wheres.push(`status = ${add(req.query.status)}`);

    const where = `WHERE ${wheres.join(' AND ')}`;
    const limitIdx  = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM things ${where}`, filterParams),
      pool.query(
        `SELECT * FROM things ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...filterParams, limit, offset]
      ),
    ]);
    res.json({
      data: rowsRes.rows,
      pagination: { page, limit, total: countRes.rows[0].total, pages: Math.ceil(countRes.rows[0].total / limit) || 1 },
    });
  } catch (err) { serverError(res, 'GET /things', err); }
});

/* -------- CREATE (admin+) -------- */
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name es requerido' });

    const { rows } = await pool.query(
      `INSERT INTO things (name, created_by) VALUES ($1, $2) RETURNING *`,
      [String(name).trim(), req.user.id]
    );

    await emitEvent(pool, {
      event_type: 'thing.created',
      entity_type: 'thing',
      entity_id: rows[0].id,
      actor_user_id: req.user.id,
      payload: { name: rows[0].name },
      req,
    });

    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, 'POST /things', err); }
});

module.exports = router;
```

**Reglas:**
- `router.use(auth)` siempre. Excepción: rutas públicas (`/login`, `/health`).
- `adminOnly` específico por handler en lugar de bloque entero (más legible).
- Validación de inputs **antes** de cualquier query.
- `serverError(res, where, err)` cierra todo `try/catch`. Nunca `res.status(500).json(...)` directo.
- 4xx con mensaje en español; 5xx con `'Error interno'` (detalle queda en logs).

### Códigos HTTP esperados

| Código | Cuándo |
|---|---|
| 200 | GET / PUT / POST con resultado idempotente |
| 201 | POST que creó una entidad nueva |
| 204 | DELETE sin body de respuesta (raro) |
| 400 | Input inválido / faltante. Mensaje en `error` debe ser accionable |
| 401 | Sin token o token inválido (gestionado por `auth` middleware) |
| 403 | Token válido pero rol/scope insuficiente |
| 404 | Entidad no encontrada |
| 409 | Conflicto: duplicado, FK rota, transición ilegal, validación que requiere override |
| 413 | Payload demasiado grande (bulk import) |
| 500 | Catch-all. Loggea con `serverError()` |

---

## 3. Server: utilidades obligatorias

Estas viven en `server/utils/` y **deben** usarse en lugar de reinventar el patrón:

### `utils/sanitize.js`

| Función | Uso |
|---|---|
| `parsePagination(query, opts?)` | Parsea `?page=&limit=` con clamps consistentes. Devuelve `{ page, limit, offset }` |
| `parseFiniteInt(input, fallback?)` | Number entero; fallback si NaN/Infinity |
| `parseFiniteNumber(input, fallback?)` | Idem pero permite decimales |
| `isValidUUID(s)` | Validación de UUID antes de query parameterizada |
| `isValidISODate(s)` | Rechaza fechas calendarialmente inválidas (ej. `2026-02-30`) |
| `mondayOf(dateIso)` | Snap a lunes UTC. Usado en time tracking weekly |

### `utils/http.js`

| Función | Uso |
|---|---|
| `serverError(res, where, err)` | Logea con stack trace + responde 500. Nunca `res.status(500)` manual |
| `safeRollback(conn, where)` | ROLLBACK que logea si falla. Reemplaza el patrón silencioso `.catch(()=>{})` |

### `utils/events.js`

| Función | Uso |
|---|---|
| `emitEvent(pool, payload)` | INSERT en `events`. Llamar después de cada mutation relevante |
| `buildUpdatePayload(before, after, fields)` | Diff entre snapshots para `event.payload.changes` |

### `utils/level.js`

Mapeo bidireccional INT (legacy `quotation_lines.level`) ↔ VARCHAR `L1..L11` (V2 `employees.level`, `resource_requests.level`).

| Función | Uso |
|---|---|
| `levelIntToString(n)` | `5 → 'L5'`, fallback `null` |
| `levelStringToInt(s)` | `'L5' → 5` |
| `normalizeLevel(input)` | acepta INT, string numérico, o `'Lx'` → `'Lx'` o null |
| `levelDistance(a, b)` | distancia entre niveles para validation engines |

### `utils/slug.js`

| Función | Uso |
|---|---|
| `slugify(text, opts?)` | NFD + diacríticos + truncate por palabra. Devuelve null si vacío |
| `uniqueSlug(text, existsFn, opts?)` | Resuelve colisiones con `-2`, `-3`, … respetando maxLength |

### `utils/json_schema.js`

Validador liviano para shapes JSONB sin agregar `ajv`:

```js
const { validate, makeValidator, SCHEMAS } = require('../utils/json_schema');

// Inline
const errors = validate(payload, SCHEMAS.contractMetadata);
if (errors.length) return res.status(400).json({ error: errors.join(', ') });

// Reusable
const isValidPrefs = makeValidator(SCHEMAS.userPreferences);
```

`SCHEMAS` predefinidos: `contractMetadata`, `userPreferences`, `resourceRequestLanguageRequirements`. Si añades un JSONB con shape estable, agrega su schema acá.

### `utils/ai_logger.js`

Wrapper para registrar TODA llamada a un agente IA. Ver [`AI_INTEGRATION_GUIDE.md`](AI_INTEGRATION_GUIDE.md).

---

## 4. Server: SQL y pool

### Reglas

1. **SIEMPRE parameterizado**. Nunca string interpolation con `req.X` en SQL.
   ```js
   // ✅
   pool.query(`SELECT * FROM things WHERE name = $1`, [req.query.name]);

   // ❌
   pool.query(`SELECT * FROM things WHERE name = '${req.query.name}'`);
   ```

2. **Excepciones controladas**: cuando el valor está saneado a tipo numérico (page, limit, offset). Aún así, preferir `$N` por consistencia.

3. **Soft delete siempre filtrado**: todo SELECT de prod debe llevar `WHERE deleted_at IS NULL` (o el alias correspondiente).

4. **Joins con users para nombres**: cuando devuelvas un campo `user_id`, joinea para incluir `name` y `email` legibles. Ver `routes/contracts.js :: GET /:id` como ejemplo.

5. **No `SELECT *` en respuestas externas**: puede filtrar `password_hash`, columnas internas, embeddings de varios KB. Selecciona explícitamente los campos que el cliente necesita.

### Patrón listado paginado

Ya está estandarizado vía `parsePagination` + `filterParams` array + `[...filterParams, limit, offset]` en la query final.

---

## 5. Server: transacciones

```js
const conn = await pool.connect();
try {
  await conn.query('BEGIN');

  // ... múltiples queries ...

  await conn.query('COMMIT');
  res.json(result);
} catch (err) {
  await safeRollback(conn, 'POST /things/bulk');
  serverError(res, 'POST /things/bulk', err);
} finally {
  conn.release();
}
```

**Reglas:**
- `pool.connect()` SIEMPRE con `finally { conn.release(); }`.
- ROLLBACK con `safeRollback(conn, where)` — nunca `.catch(()=>{})` silencioso.
- Si el endpoint puede tardar más de 2 segundos, evaluar si requiere transacción o si pueden ser queries individuales.
- Identificadores explícitos (`'POST /things/bulk'`) para que los logs sean buscables.

---

## 6. Server: emisión de eventos

Cada mutation relevante emite un evento estructurado:

```js
await emitEvent(pool, {
  event_type:    'contract.kicked_off',  // namespace.action en snake.case
  entity_type:   'contract',
  entity_id:     contractId,
  actor_user_id: req.user.id,
  payload: {                              // qué cambió, parámetros relevantes
    kick_off_date: kickOffDate,
    seeded_requests: created.length,
  },
  req,                                    // captura ip + user_agent
});
```

**Naming de event_type:**
- `<entity>.<action>` en lowercase, snake.case si action es compuesta.
- Eventos comunes: `*.created`, `*.updated`, `*.deleted`, `*.status_changed`.
- Eventos específicos del dominio: `assignment.overbooked`, `contract.kicked_off`, `opportunity.won`.

**Cuándo emitir:**
- Sí: creación, actualización de campos críticos, transiciones de status, overrides de validación.
- No: lecturas, paginations, cambios de UI prefs (eso es `audit_log` legacy si acaso).

---

## 7. Server: tests

Patrón mock de `pool` + middleware:

```js
const queryQueue = [];
const issuedQueries = [];
const mockControlSql = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);

jest.mock('../database/pool', () => {
  const pushAndPop = (sql, params) => {
    issuedQueries.push({ sql, params });
    if (mockControlSql.has(sql)) return { rows: [] };
    if (!queryQueue.length) throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
    const next = queryQueue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    query: jest.fn(async (sql, params) => pushAndPop(sql, params)),
    connect: jest.fn(async () => ({
      query: async (sql, params) => pushAndPop(sql, params),
      release: () => {},
    })),
  };
});

let mockUser = { id: 'u1', role: 'admin' };
jest.mock('../middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  adminOnly: (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    next();
  },
  superadminOnly: (req, res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
```

**Reglas:**
- Cubrir happy path + 4xx específicos + permisos.
- `queryQueue.push({ rows: [...] })` por cada query esperada en orden.
- `issuedQueries` para verificar shape de la query (qué SQL se mandó, qué params).
- No mockear `pg` directamente, mockear `database/pool`.

**Nuevos endpoints sin test = PR rechazado.** Sin excepciones.

---

## 8. Client: módulos React

```js
// client/src/modules/Things.js
import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/apiV2';
import { useAuth } from '../AuthContext';

const s = {
  page:  { maxWidth: 1100, margin: '0 auto' },
  card:  { background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', padding: 16, borderRadius: 6 },
};

export default function Things() {
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const [data, setData] = useState({ data: [], pagination: { page: 1, total: 0 } });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await apiGet('/api/things?page=1&limit=25');
      setData(r || { data: [], pagination: {} });
    } catch (e) { setErr(e.message || 'Error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={s.page}>Cargando…</div>;
  if (err) return <div style={s.page}><div style={{ color: 'var(--ds-bad)' }}>{err}</div></div>;

  return (
    <div style={s.page}>
      <h1>Things</h1>
      {data.data.map((t) => <div key={t.id} style={s.card}>{t.name}</div>)}
    </div>
  );
}
```

**Reglas:**
- Una pantalla por archivo. Si pasa de ~600 líneas, dividir en sub-componentes en el mismo archivo o sacar a `<EntityForm>` etc.
- `useAuth() || {}` para tolerar tests sin AuthProvider.
- `useCallback` + `useEffect([load])` para load function recargable.
- Defensive nullables: `data.data || []` siempre.
- `key={item.id}` SIEMPRE — nunca `key={index}`.
- Cleanup en `useEffect` cuando hay timers o subscriptions.

---

## 9. Client: estilos / Design System

```js
// ✅ tokens DS
const s = {
  card: {
    background: 'var(--ds-surface)',
    border: '1px solid var(--ds-border)',
    color: 'var(--ds-text)',
    padding: 'calc(16px * var(--density, 1))',
    borderRadius: 'var(--ds-radius, 6px)',
  },
};

// ❌ hardcoded
const bad = { background: '#ffffff', color: '#1e0f1c', padding: 16, borderRadius: 6 };
```

**Tokens disponibles** (en `client/src/theme.css`):

| Token | Uso |
|---|---|
| `--ds-accent`, `--ds-accent-soft`, `--ds-accent-text` | Color de marca (deriva de `--accent-hue`) |
| `--ds-surface`, `--ds-bg-soft` | Fondos |
| `--ds-text`, `--ds-text-dim` | Texto |
| `--ds-border` | Bordes |
| `--ds-ok`, `--ds-ok-soft` | Verde (success) |
| `--ds-warn`, `--ds-warn-soft` | Naranja |
| `--ds-bad`, `--ds-bad-soft` | Rojo (danger) |
| `--ds-radius`, `--ds-radius-lg` | 6px / 10px |
| `--ds-row-h` | altura derivada de `--density` |
| `--font-ui`, `--font-mono` | Inter, JetBrains Mono |

Para dark mode: `[data-scheme="dark"]` re-define los neutrales. Lo hace `AuthContext.applyPreferences()` según `users.preferences.scheme`.

**Componentes reusables del shell:**
- `<StatusBadge domain="contract" value={status} />` — badges con `TONE_MAP` por dominio
- `<Avatar name={user.name} size={28} />` — círculo con iniciales y hue determinista
- `tableStyles.{th,td}` — tablas
- `<CommandPalette />` — Cmd-K
- `<NotificationsDrawer />` — drawer lateral
- `<ErrorBoundary />` — wrap routes

**No reimplementar** chips/badges/avatars en cada módulo. Si falta un dominio en `StatusBadge.TONE_MAP`, agregarlo allí.

---

## 10. Client: fetch + auth

```js
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiV2';

// GET — devuelve null en 401 (apiV2 redirige a /login automáticamente)
const data = await apiGet('/api/things');

// POST/PUT — lanza Error con e.message del server
try {
  await apiPost('/api/things', { name: 'x' });
} catch (e) {
  alert(e.message);  // mensaje del server (4xx)
}
```

**Convenciones:**
- URL siempre con `/api/...`.
- Auth header se inyecta automáticamente desde `localStorage.dvpnyx_token`.
- Si el response es 401, `apiV2` limpia el token y redirige a `/login`. El caller obtiene `null`.
- 4xx/5xx lanzan `Error` con mensaje del server.

---

## 11. Naming, comentarios y commit messages

### Naming

| Tipo | Convención | Ejemplo |
|---|---|---|
| DB columns | `snake_case` | `weekly_capacity_hours` |
| API responses | `snake_case` (igual a DB) | `{ employee_id, weekly_hours }` |
| JS variables | `camelCase` | `weeklyHours` |
| React components | `PascalCase` | `<EmployeeDetail />` |
| Files (server) | `snake_case.js` | `time_allocations.js` |
| Files (client) | `PascalCase.js` para componentes, `camelCase.js` para utils | `TimeTeam.js`, `apiV2.js` |
| Branches | `<type>/<short-desc>` | `feat/contract-kickoff`, `fix/time-team-blank` |

### Comentarios en código

- **Por qué, no qué.** El qué se lee del código. El por qué (decisión, restricción, deuda) merece comentario.
- En español está bien.
- Bloques `/** ... */` arriba de cada ruta o función pública con: propósito, params relevantes, response shape si aplica.
- Marcar deuda con `TODO eng team:` (no `XXX`, no `HACK`).

### Commit messages

```
<type>(<scope>): <summary corto>

<body explicando QUÉ cambió y POR QUÉ — no cómo>

Co-Authored-By: ...
```

Tipos: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.

Ejemplos buenos:
- `feat(planning-loop): cierra el ciclo cotización→contrato→plan→real`
- `fix(time-allocations): 500 'Error interno' en /time/team por columna inexistente employees.name`
- `chore(cleanup): deuda técnica, manejo de errores, hardening de pagination`

---

## 12. Anti-patterns conocidos

❌ **No hagas estos:**

- `console.log` en código de producción (ok en tests).
- `SELECT *` en respuestas HTTP.
- String interpolation en SQL con valores de `req`.
- `res.status(500)` sin `serverError()` (perdés el log con stack).
- `pool.connect()` sin `finally { conn.release(); }`.
- `ROLLBACK.catch(()=>{})` silencioso. Usar `safeRollback`.
- Clases CSS con nombres propios (`.my-module-btn`). Usar tokens o componente del shell.
- Hardcodear colores hex fuera de `theme.css`.
- `key={index}` en listas con IDs disponibles.
- Nuevas libs grandes sin discutirlo.
- `setTimeout`/`setInterval` huérfanos sin cleanup.
- Estados derivados en `useState` cuando un `useMemo` alcanza.
- `dangerouslySetInnerHTML` sin code review obligatorio.
- Hardcoding de roles (`['admin','superadmin']`) por todas partes — usar `auth.isAdmin` / middleware `adminOnly`.
- Tests que no validan al menos un 4xx además del happy path.
- Endpoint nuevo sin test.

---

## Checklist antes de abrir PR

- [ ] Tests pasan local (`server`: `./node_modules/.bin/jest`; `client`: `react-scripts test`)
- [ ] Build de producción del cliente compila sin warnings
- [ ] Cambios en schema reflejados en `docs/specs/v2/03_data_model.md`
- [ ] Endpoints nuevos con tests (happy path + al menos un 4xx + permisos)
- [ ] `console.error` con contexto en cada catch (o usar `serverError()`)
- [ ] No `SELECT *` ni interpolación SQL nueva
- [ ] Nuevos JSONB con shape estable: schema en `utils/json_schema.js`
- [ ] Commit message con `<type>(<scope>): <summary>`

---

*Si este documento se desactualiza, prefiere borrar la sección desfasada antes que dejar mentiras. La fuente de verdad es el código.*
