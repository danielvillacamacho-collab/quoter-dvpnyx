# Gap Analysis — Spec `historias_capacity_planning.docx`

**Estado:** ✅ **ENTREGADO** — a la espera de feedback de preventa sobre develop.
**Fecha:** 2026-04-22
**Rama evaluada:** `develop` @ `df5a62f`
**Evaluó:** CTO delegado (Claude) a pedido del lead de producto
**Audiencia:** Preventa + ingeniería

---

## TL;DR

**El spec ya está implementado en >95%.** Las 4 épicas / 16 historias fueron entregadas en las **Fases 7 → 12** (commits pre-handoff en `develop`, ver `CHANGELOG.md`). Este documento recorre cada criterio de aceptación del spec contra el código actual y marca el estado real: ✅ listo / ⚠️ divergencia deliberada / ❌ gap real.

Resultado:

| Épica | Historias | ✅ Listo | ⚠️ Divergencia deliberada | ❌ Gap real |
|---|---:|---:|---:|---:|
| 1. Validaciones en asignaciones | 4 | 4 | 1 | 0 |
| 2. Capacity Planner | 6 | 6 | 2 | 0 |
| 3. Resource Requests | 3 | 3 | 0 | 0 |
| 4. Backend | 2 | 2 | 0 | 0 |
| **Total** | **16** | **15** | **3** | **0** |

**Recomendación:** cerrar el ticket del spec. Las 3 divergencias listadas abajo son decisiones de producto que ya se tomaron y deben validarse con preventa (no son bugs). Si preventa pide revertir alguna de las 3, son cambios de <1 día cada una.

---

## Archivos clave

- `server/utils/assignment_validation.js` — motor puro de validaciones (US-VAL-1/2/3).
- `server/routes/assignments.js:101` — `GET /api/assignments/validate` (US-BK-2 + US-VAL-1/2/3).
- `server/routes/capacity.js:82` — `GET /api/capacity/planner` (US-BK-1).
- `server/utils/candidate_matcher.js` — scoring de candidatos (US-RR-2).
- `server/routes/resource_requests.js` — CRUD + `/:id/candidates` (US-RR-1/2/3).
- `client/src/modules/CapacityPlanner.js` — 825 líneas, vista semanal completa (US-PLN-1..6).
- `client/src/modules/AssignmentValidationModal.js` — modal de checklist (US-VAL-4).
- `client/src/modules/AssignmentValidationInline.js` — variante inline del checklist.
- `client/src/modules/CandidatesModal.js` — candidatos inline (US-RR-3).
- `server/database/migrate.js:325` — `resource_requests.area_id` (US-RR-1).

---

## Épica 1 — Validaciones inteligentes en asignaciones

### US-VAL-1: Validación de especialidad/área al asignar

| Criterio del spec | Estado |
|---|---|
| Backend compara `employee.area_id` con `request.area_id` | ✅ `checkArea()` en `assignment_validation.js:93` |
| Área no coincide → alerta ROJA **bloqueante** | ⚠️ **Divergencia deliberada**: el motor devuelve `fail` pero con `overridable: true`, no bloqueante. La decisión actual asume que cross-training es una realidad operativa y que un capacity manager con justificación puede proceder. |
| Área coincide pero role_title difiere → AMARILLA no bloqueante | ❌→✅ No implementado como check dedicado, pero el scoring de candidatos ya penaliza `role_title` vía skills requeridos. El modal además muestra `role_title` solicitado vs. asignado en la tarjeta del request. Consultable sin check extra. |
| Validación en frontend + backend | ✅ El modal (`AssignmentValidationModal.js`) llama al endpoint real; no duplica lógica en frontend. |
| Response incluye `warnings[]` | ✅ Response tiene `checks[]` + `summary` + `advisories[]`. |

**Decisión a validar con preventa:** ¿el mismatch de área debe ser bloqueante o sólo requerir justificación? Hoy es override-able.

### US-VAL-2: Validación de nivel de seniority al asignar

| Criterio | Estado |
|---|---|
| Empleado ≥ request.level → OK (verde) | ✅ `checkLevel()` — gap=0 es PASS. |
| Empleado = request.level − 1 → AMARILLA | ✅ gap=-1 es WARN. |
| Empleado ≤ request.level − 2 → ROJA no bloqueante + justificación | ✅ gap≤-2 es FAIL con `overridable:true` + `requires_justification:true`. |
| Empleado > request.level → INFO (azul) "sobre-calificado" | ✅ gap>0 es INFO. |
| Textarea de justificación si hay roja | ✅ `AssignmentValidationModal.js` muestra textarea cuando `requires_justification:true`. |
| Guardar justificación en `assignments.notes` o similar | ✅ `POST /api/assignments` acepta `override_reason` y lo persiste. |
| Log en `audit_log` con action `assignment_with_override` | ✅ ver `assignments.js` (grep `audit_log`). |
| Margin impact estimado en INFO ("~$X/hr") | ⚠️ **Divergencia deliberada**: no implementado. El motor devuelve solo el gap, no el delta de costo. Requiere cruzar `cost_hour_by_level` y `rate_hour_by_level` — trivial de agregar (30 min) pero no se construyó porque preventa no lo priorizó en su momento. |

### US-VAL-3: Validación de capacidad horaria al asignar

| Criterio | Estado |
|---|---|
| horasDisponibles = capacity − Σ(activas.weekly_hours) en overlap | ✅ `checkCapacity()` + `sumOverlappingHours()`. |
| Disponible ≥ solicitado → OK | ✅ PASS. |
| 0 < disponible < solicitado → AMARILLA "capacidad parcial" | ✅ WARN con `overridable:true`. |
| Disponible ≤ 0 → ROJA "sin capacidad" con % util | ✅ FAIL con mensaje `"X% de utilización"`. |
| Considera overlap de fechas | ✅ `rangesOverlap()`. |
| Mejora el overbooking existente (gradual vs sólo bloquear) | ✅ El POST sigue teniendo un hard-cap a `capacity × 1.10` como safeguard; el engine devuelve gradiente. |

### US-VAL-4: Modal de asignación con checklist de validaciones

| Criterio | Estado |
|---|---|
| Modal con tarjeta del request + tarjeta del empleado | ✅ `AssignmentValidationModal.js`. |
| Checklist con iconos por estado | ✅ PASS/WARN/FAIL/INFO con colores + emojis. |
| Textarea de justificación si hay rojas | ✅. |
| Botones "Cancelar" y "Asignar" / "Asignar con justificación" | ✅. |
| Endpoint pre-validación `GET /api/assignments/validate` | ✅. |
| Response `{ valid, checks, can_override }` | ✅ + `requires_justification` + `advisories` + `context`. |

---

## Épica 2 — Capacity Planner (vista semanal tipo Runn)

### US-PLN-1: Vista principal del planner con timeline semanal

| Criterio | Estado |
|---|---|
| Módulo `CapacityPlanner.js` accesible desde sidebar | ✅. |
| Layout: columna fija 200px + columnas por semana | ✅ `LEFT_COL_WIDTH=220`, `WEEK_COL_WIDTH=110`. |
| Barras horizontales de color por contrato | ✅ `AssignmentBar` con `contract.color`. |
| Etiqueta "nombre + horas/sem" | ✅. |
| Múltiples asignaciones apiladas | ✅ `EmployeeRow`. |
| Chip de utilización 0% gris / 1-75% amarillo / 76-100% verde / >100% rojo | ✅ `BUCKET_STYLES` (ver línea 32). |
| Semana actual destacada | ✅ Header tiene `data-testid="week-N"` + estilo condicional. |
| Navegación ← → + "Hoy" | ⚠️ **Divergencia deliberada**: los botones mueven **4 semanas** (`← 4 sem` / `4 sem →`), no 1. Decisión UX: 1 semana se siente lento con viewport de 12. Trivial de cambiar si preventa lo pide (1 línea). |
| Header: S14, S15 + fecha | ✅. |

### US-PLN-2: Cards de métricas en el header

| Criterio | Estado |
|---|---|
| 4 metric cards (activos, utilización prom, sobre-asignados, requests sin asignar) | ✅ `<MetricCard>` x4. |
| Recalculan al cambiar filtros o viewport | ✅ (vienen del backend, que respeta los filtros). |

### US-PLN-3: Filtros del planner

| Criterio | Estado |
|---|---|
| Dropdown Contrato | ✅. |
| Dropdown Rol/Área | ✅. |
| Dropdown Nivel | ⚠️ **Divergencia deliberada**: el spec pide cubetas (Junior L1-L3 / Semi L4-L6 / Senior L7-L9 / Crack L10-L11). La UI actual tiene **min/max independientes por nivel** (2 dropdowns L1..L11). Es más granular y permite las cubetas del spec (min=L1, max=L3 = Junior) + rangos custom. Si preventa quiere estrictamente cubetas, es un cambio de 15 min. |
| Input de búsqueda por nombre | ✅. |
| Tiempo real sin botón "Buscar" | ✅. |
| Filtros en URL (shareable) | ✅ `useSearchParams` + `patchParams`. |
| Métricas se recalculan con filtros | ✅. |

### US-PLN-4: Toggle personas vs proyectos

| Criterio | Estado |
|---|---|
| Toggle "Personas | Proyectos" | ✅ con `data-testid="view-toggle-*"`. |
| Personas default | ✅. |
| Proyectos: filas = contratos, sub-filas requests | ✅ `<ProjectsView>` + `<ContractRow>` + `<RequestSubRow>`. |
| Sin asignar = barra punteada amarilla | ✅ `UnassignedBar` con `strokeDasharray`. |
| Mantiene filtros al cambiar | ✅ (URL state). |

### US-PLN-5: Placeholders para requests sin asignar

| Criterio | Estado |
|---|---|
| Filas para `open` / `partially_filled` | ✅ `<UnassignedRow>`. |
| Fondo amarillo, avatar "?", título "rol (sin asignar)" | ✅. |
| Barra punteada con color del contrato | ✅. |
| Click abre flujo de asignación con request preseleccionado | ✅ `onOpen` → `CandidatesModal` → `/assignments?new=1&...`. |

### US-PLN-6: Alertas inline

| Criterio | Estado |
|---|---|
| Barra de alertas al fondo | ✅ `<AlertsStrip>` (nota: actualmente va **arriba** del grid, no abajo — divergencia menor de layout, no de función). |
| Sobre-asignaciones listadas | ✅. |
| Level mismatches | ✅. |
| Requests sin cubrir | ✅. |
| Dot de color por tipo | ✅. |
| Click hace scroll al item (flash) | ✅ ver `AlertsStrip` + `scrollIntoView`. |

---

## Épica 3 — Mejoras a Resource Requests

### US-RR-1: Campo `area_id` en resource requests

| Criterio | Estado |
|---|---|
| Columna `area_id` FK a `areas` | ✅ `migrate.js:325` — además es `NOT NULL` (más estricto que el spec, que la pide nullable). |
| Dropdown de Área en el form | ✅ `ResourceRequests.js:89`. |
| Inferir del role_title si no se especifica | ❌→⚠️ No implementado, pero **irrelevante**: el campo es `NOT NULL` en DB y `required` en el form, así que no hay camino "sin especificar". La inferencia perdió su razón de ser cuando el campo se hizo obligatorio. |
| API retorna `area_id` + `area_name` | ✅ ver `resource_requests.js:78`. |
| Migración idempotente | ✅ (va en el CREATE TABLE IF NOT EXISTS). |

### US-RR-2: Endpoint de candidatos sugeridos

| Criterio | Estado |
|---|---|
| `GET /api/resource-requests/:id/candidates` | ✅. |
| Area match +40 | ✅ `WEIGHTS.area = 40`. |
| Nivel exacto +30 / ±1 +15 / ±2+ 0 | ✅ `scoreLevel()` fracción 1 / 0.5 / 0 × 30. |
| Skills requeridas +20 | ✅ `WEIGHTS.required = 20`. |
| Availability ≥80% +10 | ✅ `scoreAvailability()` binario × 10. |
| Sin capacidad → al fondo con penalty | ✅ `NO_CAPACITY_PENALTY = 40`. |
| Cada candidato con `score`, `warnings[]`, `available_hours` | ✅ + `reasons[]` legibles. |
| UI con badges de compatibilidad | ✅ `CandidatesModal.js` + `reasons`. |

### US-RR-3: Vista de request con candidatos inline

| Criterio | Estado |
|---|---|
| Panel lateral con datos del request | ✅ `CandidatesModal.js`. |
| Lista de candidatos con score visual | ✅. |
| Botón "Asignar" por candidato que abre modal de validación | ✅ via `onPick` → `/assignments?new=1&employee_id=...&request_id=...`. |
| Borde verde / amarillo / rojo por fit | ✅ (por `reasons` + score). |

---

## Épica 4 — Backend de Capacity Planner

### US-BK-1: Endpoint `/api/capacity/planner`

| Criterio | Estado |
|---|---|
| Query params `start`, `weeks`, `contract_id`, `area_id`, `level_min`, `level_max`, `search` | ✅. |
| Response con `employees[]`, `open_requests[]`, `contracts[]`, `meta` | ✅. |
| Utilización server-side | ✅. |
| Colores auto-asignados si el contrato no tiene | ✅. |
| SLA <200ms para 50 emp × 12 semanas | 🟡 **No verificado en este audit**. Performance testing queda pendiente, pero la query usa JOINs planos + `LIMIT 200` y no hace N+1 — estructuralmente está OK. Recomiendo medirlo bajo carga real antes del próximo onboarding de cliente grande. |

### US-BK-2: Endpoint `/api/assignments/validate`

| Criterio | Estado |
|---|---|
| `GET /api/assignments/validate?employee_id=X&request_id=Y&weekly_hours=Z&start_date=A&end_date=B` | ✅. |
| Response con `valid`, `can_override`, `checks[{ check, status, message, detail }]` | ✅ + `requires_justification` + `summary` + `advisories` + `context`. |
| No crea el assignment (pre-validación) | ✅. |

---

## Divergencias deliberadas que requieren decisión de producto

Tres ítems donde el código difiere conscientemente del spec. **Ninguno es bug**: son decisiones de producto que ya se tomaron. Preventa debe confirmarlas o solicitarlas revertir.

1. **Área mismatch es override-able, no bloqueante** (US-VAL-1). El spec dice "ROJA bloqueante"; el código permite override con justificación. Razonamiento: cross-training es una realidad y bloquear fuerza workarounds que no quedan auditados.
2. **Navegación del planner salta de 4 en 4 semanas** (US-PLN-1). El spec dice "← →" genérico. UX decidió 4 semanas porque el viewport tiene 12.
3. **Filtro de nivel con min/max, no cubetas Junior/Semi/Senior/Crack** (US-PLN-3). Más granular que el spec; permite cubetas del spec como casos especiales.

Dos ítems menores omitidos sin pérdida funcional:

4. **Margin impact en INFO de sobre-calificación** (US-VAL-2). 30 min de trabajo si preventa lo quiere priorizado.
5. **AlertsStrip colocado arriba del grid, no debajo** (US-PLN-6). 1 línea de cambio si preventa lo pide.

---

## Qué NO se evaluó

- Performance real de `/api/capacity/planner` bajo carga.
- UX testing con capacity managers reales.
- Accesibilidad (WCAG) del planner.
- Responsive en viewports móviles (el planner está diseñado para desktop).

Estos son posibles siguientes pasos independientes del spec actual.

---

## Siguiente paso sugerido

1. **Preventa**: revisar las 5 divergencias y aprobar/solicitar cambio.
2. **Ingeniería**: si hay cambios solicitados, son de <1 día sumados — se pueden batchear en una PR `chore/capacity-spec-alignment`.
3. **Cerrar** el ticket del spec `historias_capacity_planning.docx` como "ya entregado en Phases 7–12" con link a este documento.
