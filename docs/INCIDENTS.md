# Registro de incidentes

Memoria institucional de los incidentes en producción y sus aprendizajes. No es un log exhaustivo de bugs — solo aquellos donde la causa raíz vale la pena recordar para no repetirla.

Formato: incident card + post-mortem. Estilo blameless: hablamos del sistema, no de personas.

---

## INC-001 — Login bloqueado para todos los usuarios (rate limiter mal calibrado)

**Severidad:** P0 — producción totalmente inutilizable.
**Fecha:** 2026-04-28.
**Duración:** ~30 minutos desde el reporte hasta el fix desplegado.
**Reportado por:** Daniel Villa Camacho (PO) tras intento de login fallido.

### Síntoma

Pantalla de login mostraba el error:

```
Unexpected token 'T', "Too many r"... is not valid JSON
```

al intentar autenticarse. **Todos** los usuarios de la oficina afectados simultáneamente.

### Causa raíz

3 problemas combinados en `server/index.js`:

1. **Rate limiter global subdimensionado**
   - Config: `max: 200 / 15min` por IP.
   - Realidad operativa: toda la oficina sale a internet por una **sola IP NAT corporativa**.
   - La SPA hace 5–10 calls al backend por navegación (sidebar params, dashboard data, listings).
   - 10 usuarios × 20 calls = 200 → cuota agotada en minutos. A partir de ahí, **todo el equipo bloqueado por 15 min** independientemente de quién intentaba qué.

2. **`app.set('trust proxy')` no activado**
   - Detrás de Traefik (1 proxy hop), `req.ip` era el IP del container Traefik para todos.
   - El `keyGenerator` por defecto del rate limiter usa `req.ip` → todos compartían el mismo bucket aunque vinieran de IPs reales distintas.
   - Aunque la oficina hubiera tenido IPs públicas distintas, el limiter no podía distinguirlas.

3. **Respuesta del 429 era plain text**
   - El limiter global no tenía `message` configurado → devolvía la respuesta default `text/plain "Too many requests, please try again later."`.
   - El cliente (SPA) hacía `await response.json()` ciegamente → `JSON.parse` lanzaba `SyntaxError: Unexpected token 'T'...`.
   - Consecuencia: en lugar de un mensaje útil ("intentá en unos minutos"), el usuario veía un error críptico que parecía un bug aleatorio del sistema, dificultando el diagnóstico inicial.

### Detección

PO reportó el síntoma. La causa raíz se identificó rápido grepeando `Too many` en el código (sólo 1 hit relevante) + leyendo `index.js` línea 13.

### Fix

Cambios en `server/index.js`:

| Item | Antes | Ahora |
|---|---|---|
| Trust proxy | desactivado | `app.set('trust proxy', 1)` |
| Global limit | 200/15min, key=IP | 2000/15min, key por user_id si autenticado, sino IP |
| Login limit | 10/15min, key=IP | 30/15min, key por (email + IP) |
| Health bypass | no | `skip` para `/health` |
| Respuesta 429 | text/plain default | JSON `{ error, code: 'rate_limited', retry_after_seconds }` |
| Headers | sin estándar | `RateLimit-*` draft-7 expuestos |

PR: `hotfix/rate-limit-login`. Commit: `d43c762`.

### Validación

- Tests server: 678/678 verde post-fix.
- Server module carga limpio sin throws.
- Bypass de `/health` confirmado (monitoring no consume cuota).
- Cherry-picked a `develop` el mismo día para evitar regresión cuando se mergee algo nuevo.

### Aprendizajes

1. **Rate limit por IP no funciona con NAT corporativo.** Si la app va a ser usada por una empresa, el bucket por IP penaliza a todos. La granularidad correcta es por `user_id` autenticado, con IP solo como fallback antes del login.

2. **Las respuestas 429 deben ser JSON.** Cualquier endpoint que el cliente consume con `.json()` debe responder JSON consistentemente. Esto se generaliza: errores middleware (helmet, cors, rate-limit) suelen tener defaults plain text que rompen clientes SPA modernos.

3. **`trust proxy` es mandatorio detrás de un load balancer.** Sin esto, `req.ip` miente y cualquier feature basado en IP (rate limit, audit log, geo) está roto silenciosamente. Debería ser parte del checklist inicial del proyecto.

4. **`/health` siempre debe estar exento de rate limit.** Monitoring (Better Stack, UptimeRobot) puede hacer 60+ checks/minuto. Si entra al bucket, agota la cuota antes que cualquier usuario real haga login.

5. **Los límites deben asumir uso normal × factor de seguridad.** 10 usuarios concurrentes × 20 calls/nav × 5 navs = 1000. Con factor 2x = 2000. Subdimensionar para "ahorrar" recursos termina costando más en downtime.

### Acciones derivadas

- [x] **Hotfix** desplegado.
- [x] **Documentar** este incidente.
- [ ] **Backlog**: migrar rate-limiter a backend Redis (`rate-limit-redis`) para que un restart no resetee contadores y para soportar escala horizontal cuando lleguen múltiples instancias.
- [ ] **Backlog**: agregar al onboarding/CONVENTIONS.md una sección sobre middleware patterns: trust proxy, JSON-only responses, health bypass.
- [ ] **Backlog**: monitor pasivo de tasa de 429 — si supera 1% de los requests, alerta al on-call. Hoy no tenemos APM.

### Cómo se podría haber prevenido

- Tests de integración con load simulation (10 usuarios × 100 requests). Habría disparado la alarma en CI.
- Code review más riguroso del PR original que introdujo el limiter — la combinación "IP-only key + low max" es un anti-patrón conocido en setups con NAT.
- Linting: una regla custom que prohíba rate limiters sin `handler` JSON explícito.

---

## INC-002 — Asignaciones imposibles de crear para 5 empleados específicos (txn envenenada por notify dentro de la transacción)

**Severidad:** P1 — funcionalidad crítica del módulo Capacity rota para un subset de empleados.
**Fecha:** 2026-04-29.
**Duración:** ~días desde que apareció hasta el reporte; fix aplicado el mismo día del reporte.
**Reportado por:** Daniel Villa Camacho — primero notó que no podía asignar a Alejandro Vertel; al investigar, otros 4 empleados (Andrés Vasquez, Samuel Solano, Lorenzo Reinso, Juan Uni) presentaban el mismo síntoma. El resto del equipo asignaba sin problema.

### Síntoma

`POST /api/assignments` devolvía **500 "Error interno"** únicamente para esos empleados. Validaciones (área/nivel/capacidad/fechas) no se mostraban, no aparecía el modal de override — solo un error genérico desde el servidor. La asignación nunca se persistía.

### Causa raíz

El handler en `server/routes/assignments.js` ejecutaba `notify(conn, ...)` y `notifyMany(conn, ...)` **dentro** de la transacción abierta (`BEGIN` … queries … notify … `COMMIT`). El helper `notify()` tiene su propio `try/catch` que atrapa los errores de DB y devuelve `null` para que las notificaciones sean best-effort.

Pero hay una sutileza de Postgres: **cuando una query falla dentro de una transacción, Postgres marca la txn como ABORTED**. Cualquier query siguiente — incluyendo el `COMMIT` — falla con:

> `current transaction is aborted, commands ignored until end of transaction block`

El `try/catch` interno de `notify()` ocultaba el error JS pero no rescataba el estado de la transacción. El `COMMIT` posterior fallaba, caía al catch externo del handler → `ROLLBACK` → 500.

¿Por qué solo afectaba a 5 empleados? Porque **`employees.user_id` apuntaba a un `users.id` que ya no existía** (hard-deleted en alguna limpieza previa o seed inválido). El `INSERT INTO notifications (user_id, ...)` violaba el FK constraint solo para esos empleados; el otro 95% tenía `user_id` válido o `NULL` y no entraba al INSERT.

### Fix

Tres cambios coordinados en `fix/assignments-notify-poisons-txn`:

1. **`server/routes/assignments.js`** — mover el bloque de notificaciones después del `COMMIT` y usar el `pool` directo en vez del `conn` de la transacción. Las notificaciones ahora son verdaderamente best-effort: si fallan, la asignación ya está persistida y el `res.status(201)` ya se envió.
2. **`server/utils/notifications.js`** — defensiva en profundidad: cuando `notify()` recibe un client de transacción (detectado por la ausencia de `.connect`), envuelve el INSERT en un `SAVEPOINT … RELEASE/ROLLBACK TO SAVEPOINT`. Así, si un futuro caller usa el patrón viejo por error, no envenena la txn.
3. **`server/utils/events.js`** — mismo blindaje en `emitEvent()`, que tiene la **misma forma** y se llama dentro de transacciones en todas las rutas del producto.
4. **Hotfix de datos** (run-once en producción): `UPDATE employees SET user_id = NULL WHERE user_id NOT IN (SELECT id FROM users);` — desbloquea inmediatamente a los 5 empleados sin necesidad de redeploy.

### Aprendizajes

- **Helpers que atrapan errores DENTRO de una transacción son una trampa.** El JS sigue, pero el estado SQL no se recupera. Si un helper hace una query que puede fallar, debe correr en una conexión propia (pool) o usar SAVEPOINT explícito.
- **"Best-effort" no significa "no falla nunca"** — significa "no debe abortar la operación principal". Para conseguirlo de verdad, el helper tiene que correr fuera de la txn principal o aislarse con un savepoint.
- **Bugs que afectan a un subset extraño de filas suelen ser FK rotos.** Cuando el síntoma es "5 empleados sí, los demás no", la primera query a correr es `LEFT JOIN ... WHERE other.id IS NULL`.
- **Los logs sí lo decían**, pero el mensaje real (`notify() failed: ... foreign key constraint`) estaba degradado a `console.error` y se perdía entre el ruido. La línea de `POST /assignments failed` que sí se notaba era el síntoma, no la causa.

### Acciones derivadas

- [ ] Auditar todas las llamadas a `emitEvent(conn, ...)` y `notify(conn, ...)` en el resto de rutas. Hoy quedan blindadas por el savepoint, pero la guideline debe ser "siempre `pool` después del COMMIT".
- [ ] Agregar a `docs/CONVENTIONS.md` una sección "Helpers dentro de transacciones" con la regla y un par de ejemplos.
- [ ] Test pre-deploy o seed-validator que detecte `employees.user_id` con FK rotos antes de que aparezcan en producción.
- [ ] Considerar reemplazar `console.error` por un logger estructurado con niveles, para que errores como `FK violation` salten en alertas en vez de perderse.

### Prevención

- **Test de regresión** (`assignments.test.js` "INC-002: assignment is created (201) even when notify() throws"): mockea un fallo en `notify` y verifica que el POST devuelve 201. Si alguien revierte el orden notify→commit, este test rompe.
- **Test del savepoint** en `notifications.test.js` y `events.test.js`: verifican que cuando se llama con un txn client y el INSERT falla, se emiten las queries `SAVEPOINT` y `ROLLBACK TO SAVEPOINT` en orden.

---

## INC-003 — Empleados ausentes del dropdown de "Nueva asignación" por cap silencioso de paginación

**Severidad:** P1 — funcionalidad crítica del módulo Capacity rota para un subset de empleados (los del final del alfabeto).
**Fecha:** 2026-04-29.
**Duración:** detectado el mismo día del reporte; primer fix aplicado al `notify` (INC-002) resultó adyacente; este fix corrige la causa real.
**Reportado por:** Daniel Villa Camacho — incluso después del fix de INC-002, los 5 empleados (Alejandro Vertel, Andrés Vasquez, Samuel Solano, Lorenzo Reinso, Juan Uni) seguían sin poder ser asignados.

### Síntoma

En el formulario "Nueva asignación", al buscar a esos 5 empleados en el combobox de empleado, el resultado era **"Sin coincidencias"**. En la página `/empleados` aparecían normales, con status `active`. No había error en el backend — el frontend simplemente no los listaba como opciones.

### Causa raíz

`server/utils/sanitize.js → parsePagination()` define **`maxLimit = 100`** como default, y aplica:

```js
const limit = Math.min(Math.max(limitRaw, 1), maxLimit);
```

El frontend pedía `/api/employees?limit=500` esperando recibir todos los empleados, pero el server **silenciosamente** capaba el limit a 100 sin emitir warning ni bandera. La query corría con `LIMIT 100 ORDER BY last_name, first_name`, devolviendo solo el top 100 alfabético.

Los 5 empleados afectados tienen apellidos **R**einso, **S**olano, **U**ni, **V**asquez, **V**ertel — todos al final de la lista ordenada — y por eso caían fuera del top 100. Con ~110-130 empleados en producción, ese era exactamente el corte. Mismo patrón con `/api/resource-requests?limit=500` para el dropdown de Solicitud.

INC-002 (notify dentro de txn) era un bug **adyacente** real, pero no era la causa del síntoma reportado. El fix de INC-002 protege el sistema de un futuro fallo silencioso de FK pero no podía resolver INC-003.

### Fix

1. **Endpoints `/lookup` dedicados, sin paginación:**
   - `GET /api/employees/lookup` — todos los empleados no eliminados; excluye `terminated` por default; `?include_terminated=true` para casos legítimos (reportes históricos).
   - `GET /api/resource-requests/lookup` — todos los requests `open`/`partially_filled`; `?contract_id=` opcional para filtrar; `?include_all=true` levanta el filtro.
2. **Frontend (`client/src/modules/Assignments.js`):** `loadLookups()` ahora llama a los nuevos endpoints. Comentario explica por qué — para que nadie regrese al endpoint paginado pensando que "subir el limit" basta.
3. **Defense-in-depth:** se mantienen los filtros client-side `filter(filled/cancelled)` y `filter(terminated)` aunque el server ya filtra. Si un día se cambia el server, la UI no se rompe.

### Aprendizajes

- **Caps silenciosos son mentiras del API.** Si `limit=500` no devuelve 500, el endpoint debe (a) responder 400 "limit excede el máximo", (b) devolver el top N pero con un campo `pagination.capped: true` visible, o (c) ser explícito en docs. No "Math.min" callado.
- **Lookups y listados son endpoints distintos.** Un dropdown necesita TODO el universo (id + label + un par de campos para filtrar). Una tabla necesita paginación. Mezclarlos en el mismo endpoint con un `limit` configurable lleva a esto.
- **"El bug está donde más se siente"**: los 5 empleados afectados no estaban "rotos", estaban ordenados alfabéticamente al final. El patrón "5 personas específicas" debió hacer pensar más en *ordenamiento + cap* y no solo en *FK roto*. Pero el segundo era visible en el código del POST y el primero era invisible (en un util genérico). Lección: cuando hay un patrón de subset, mirar también qué los une **fuera del recurso afectado** (apellidos al final del alfabeto, IDs altos, fechas recientes, etc.).

### Acciones derivadas

- [ ] Migrar otros dropdowns con cap potencial a endpoints `/lookup`: `/api/clients` (en `Contracts.js`), `/api/contracts` (en `ResourceRequests.js`), `/api/resource-requests?contract_id=` (en `ContractDetail.js` — probablemente seguro porque está filtrado por contract, pero validar).
- [ ] `parsePagination`: cambiar el `Math.min` callado por una respuesta explícita o un warning header (`X-Limit-Capped: true`).
- [ ] Agregar a `docs/CONVENTIONS.md` la guía: "Endpoints de selector → `/<resource>/lookup`, no `/<resource>?limit=N`".
- [ ] Lint custom o code review: detectar `apiGet(...?limit=NNN)` y sugerir migrar a `/lookup` si es para un selector.

### Prevención

- **Test de regresión** (`employees.test.js`, `resource_requests.test.js`): los nuevos tests "returns ALL ... no pagination cap" mockean 250 filas y verifican que el endpoint `/lookup` devuelve los 250. Si alguien aplica accidentalmente `parsePagination` al `/lookup`, esos tests rompen inmediatamente.

---

## Cómo agregar un incidente a este registro

Cuando ocurre algo que afecta usuarios reales (no un bug menor):

1. Crear nuevo card `## INC-NNN — Título corto del síntoma observado`.
2. Severidad: P0 (todo el sistema down) / P1 (módulo crítico down) / P2 (degradación) / P3 (bug visible pero recuperable).
3. Documentar **síntoma observado**, no la solución. La solución vive en el commit/PR.
4. **Causa raíz**: el "por qué" técnico. Si hay 3 cosas combinadas, listarlas todas.
5. **Aprendizajes**: 3-5 bullets accionables. No "tenemos que tener más cuidado" — algo concreto.
6. **Acciones derivadas**: checkboxes con backlog.
7. Cerrar siempre con un comentario sobre prevención (test que faltaba, lint que no atajó, etc.).

> Mantenelo blameless. Hablá del sistema, no de quién hizo el commit. Los incidentes son señales del proceso, no de personas.
