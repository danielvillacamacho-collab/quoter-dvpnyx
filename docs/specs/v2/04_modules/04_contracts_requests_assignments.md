# 04.04 — Módulo: Contratos, Solicitudes de Recurso y Asignaciones

Este módulo es el corazón operativo del sistema. Conecta lo comercial (oportunidades ganadas) con lo humano (empleados trabajando) a través de tres entidades encadenadas: **Contrato → Solicitudes de Recurso → Asignaciones**.

---

## Contratos

### Concepto

Un **Contrato** es una unidad de entrega activa hacia un cliente. Tiene alcance, fechas, tipo de negocio (capacity o projects) y agrupa las solicitudes de recursos necesarias para cumplirlo.

Un contrato nace típicamente de una oportunidad ganada pero puede crearse manualmente (oportunidades históricas migradas, acuerdos de palabra ya en ejecución, etc.).

### Pantallas

**`/contracts`** — Lista de contratos

Columnas: Nombre · Cliente · Tipo · Status · Inicio · Fin · # Solicitudes · # Asignaciones activas · Squad · Acciones.

- Filtros: status (draft/active/on_hold/completed/cancelled), tipo (capacity/project), cliente, squad, rango de fechas activas.
- Búsqueda por nombre.
- Vista alternativa: **Timeline** por cliente (barras horizontales de cada contrato en un gantt simple).
- Botón header: `+ Nuevo Contrato`.

**`/contracts/:id`** — Ficha del contrato

Header: Nombre · Cliente · Tipo · Status badge · Fechas · Squad · Delivery Manager · Botones de acción según estado.

Tabs:
- **Resumen:** datos del contrato, descripción, notas, cotización origen (link), oportunidad origen (link), PM asignado, tags.
- **Solicitudes:** lista de resource requests del contrato. Columnas: perfil (nivel + área), país, status (open/partial/filled/closed), cobertura (asignado/requerido), fechas, horas/semana. Botón `+ Nueva Solicitud`.
- **Asignaciones:** vista unificada de todas las asignaciones del contrato (a través de sus solicitudes). Tabla con empleado, solicitud, fechas, horas/semana, status.
- **Horas:** time entries agregadas de todas las asignaciones del contrato, por semana o por empleado.
- **Actividad:** event log filtrado.

Tarjetas destacadas en Resumen:
- **Cobertura del contrato:** horas solicitadas totales vs. horas asignadas totales, con barra de progreso.
- **Horas ejecutadas en el mes:** total de time entries del mes actual.
- **Riesgos abiertos:** contador de solicitudes con status `open` o `partial` + número de semanas hasta que empiezan.

### Formulario de Contrato

Campos:
- `name` (requerido)
- `client_id` (requerido, selector)
- `opportunity_id` (opcional, selector filtrado por cliente)
- `source_quotation_id` (opcional, selector; si se elige, pre-rellena tipo y notas)
- `type` (requerido: `capacity` / `project`)
- `start_date` (requerido)
- `end_date` (opcional; si vacío, es contrato abierto)
- `status` (default `draft`)
- `pm_user_id` (selector de usuarios con función PM, opcional)
- `delivery_manager_id` (selector de usuarios con función DM, opcional)
- `squad_id` (default = squad del creador)
- `description`, `notes`, `tags`

Validaciones:
- `end_date >= start_date` si presente.
- Si `opportunity_id` presente: cliente debe coincidir.
- Si `source_quotation_id` presente: debe pertenecer a la oportunidad y estar en estado `approved` (idealmente `won`).

### Crear contrato desde cotización ganada

Flujo rápido desde `/quotations/:id` cuando la cotización está `approved` y su oportunidad está `won`:
- Botón: `Crear contrato desde esta cotización`.
- Abre el form de contrato con estos campos pre-rellenados: client_id, opportunity_id, source_quotation_id, type, name (sugerido: `{proyecto} — {cliente}`), start_date (sugerido: hoy), squad_id.
- El usuario completa PM, DM, fechas definitivas y notas, luego guarda.
- Como bonus, si la cotización tiene líneas (capacity) o fases+allocation (projects), ofrece **pre-generar solicitudes de recurso** a partir de ellas (ver sección siguiente).

### Pre-generación de solicitudes desde cotización

En el formulario de contrato, si hay `source_quotation_id`, mostrar sección expandible:
**"Generar solicitudes de recurso a partir de la cotización"** (checkbox, default off).

Si se activa:
- **Cotización tipo Capacity:** por cada línea `quotation_lines`, generar una `resource_request` con: level (mapeado de line.level), area (mapeado de line.specialty), country (line.country), weekly_hours (line.hours_per_week), start_date (contract.start_date), end_date calculado por duration_months, required_count = line.quantity, status=`open`.
- **Cotización tipo Projects:** por cada persona-fase presente en `quotation_allocations` con hours>0, generar una `resource_request` agrupada por línea+fase, horas/semana derivadas del total/semanas disponibles en la fase.

El usuario ve una tabla preview de las solicitudes a generar y puede editarlas o desmarcarlas antes de confirmar. Se persisten en `resource_requests` ligadas al contrato recién creado.

### Estados del contrato

| Status | Significado | Permite asignaciones? | Permite time entries? |
|---|---|---|---|
| draft | En preparación | No | No |
| active | En ejecución | Sí | Sí |
| on_hold | Pausado (cliente suspendió) | No (bloquear nuevas) | No (bloquear nuevas) |
| completed | Terminado exitosamente | No | No |
| cancelled | Cancelado por cliente o DVPNYX | No | No |

Transiciones válidas:
- `draft` → `active`, `cancelled`
- `active` → `on_hold`, `completed`, `cancelled`
- `on_hold` → `active`, `cancelled`, `completed`
- `completed` / `cancelled` son terminales (se pueden reabrir solo por Superadmin con advertencia).

Al pasar a `completed` o `cancelled`:
- Asignaciones con status `active` terminan en la fecha del cambio (end_date=TODAY, status=`completed` o `cancelled`).
- Solicitudes con status `open` o `partial` pasan a `closed`.
- Time entries existentes se preservan.

### Reglas

- Solo admins/leads pueden cambiar status de un contrato.
- Contrato con asignaciones activas no se puede eliminar (solo cancelar).
- Contrato con time entries no se puede hard-deletear bajo ninguna circunstancia.

---

## Solicitudes de Recurso (Resource Requests)

### Concepto

Una **solicitud de recurso** describe una necesidad concreta dentro de un contrato: "necesito 1 desarrollador Senior backend Node.js en Colombia, 40 h/semana, del 1 de mayo al 31 de julio".

Una solicitud puede ser cubierta por una o varias asignaciones (si se divide entre dos empleados, por ejemplo) y puede quedar parcialmente cubierta si falta contratar.

### Pantallas

La gestión de solicitudes ocurre **dentro de la ficha del contrato** (tab Solicitudes). No hay listado global de solicitudes por sí mismas — sí hay reportes globales en el módulo de reportes.

**Formulario de solicitud (modal o página):**

Campos:
- `profile_title` (texto descriptivo, ej. "Backend Dev Senior Node.js")
- `area_id` (requerido, selector)
- `level` (requerido, dropdown L1-L11)
- `country_preference` (opcional, combobox; null = cualquier país)
- `language_requirement` (opcional, ej. "Inglés B2+")
- `required_skills` (multi-select de skills, opcional)
- `weekly_hours` (numérico, default 40, 1-80)
- `start_date` (requerido)
- `end_date` (opcional; null = abierta)
- `required_count` (numérico, default 1; número de personas con este perfil)
- `modality` (dropdown: Remoto / Hybrid / On-site)
- `priority` (dropdown: alta / media / baja; default media)
- `notes` (textarea)
- `external_reason` (textarea opcional: justificación al cliente si aplica)

Validaciones:
- `end_date >= start_date` si presente.
- `weekly_hours` entre 1 y 80.
- `required_count >= 1`.
- Solo se puede crear si el contrato está en `draft` o `active`.

### Estados de la solicitud

| Status | Significado |
|---|---|
| open | Sin cobertura alguna (0 asignaciones activas) |
| partial | Algunas asignaciones cubren parte; falta completar |
| filled | Cobertura completa (asignaciones suman = required_count × weekly_hours del período) |
| closed | Cerrada administrativamente (contrato terminó o solicitud ya no aplica) |
| cancelled | Se canceló antes de cubrir |

Status es **calculado** (no editable directo), salvo `closed` / `cancelled` que son explícitos. Se recalcula cada vez que se crea/edita/elimina una asignación vinculada a la solicitud.

### Acciones en la ficha de solicitud

- **Asignar empleado:** abre flujo de creación de asignación (ver abajo).
- **Ver candidatos sugeridos:** panel lateral con lista de empleados que matchean nivel+área+skills, ordenados por utilización ascendente (más disponible primero). Sugerencia no es vinculante.
- **Editar solicitud.**
- **Cancelar solicitud** (si no tiene asignaciones activas; si las tiene, primero terminarlas).
- **Cerrar solicitud** (admin).

### Cálculo de cobertura

```
cobertura_horas = Σ(asignaciones.weekly_hours WHERE status IN ('active','planned') AND asignaciones.request_id=X)
requerimiento_horas = solicitud.weekly_hours × solicitud.required_count

status_calculado =
  CASE
    WHEN cobertura_horas = 0 THEN 'open'
    WHEN cobertura_horas >= requerimiento_horas THEN 'filled'
    ELSE 'partial'
  END
```

Exception: si la solicitud está explícitamente `closed` o `cancelled`, no se recalcula.

---

## Asignaciones

### Concepto

Una **asignación** vincula a un empleado a una solicitud de recurso con una dedicación semanal y un rango de fechas. Es la unidad atómica de capacidad consumida.

### Pantallas

Hay varias entradas al gestor de asignaciones:

**Desde `/contracts/:id` tab Asignaciones:** ver arriba.

**Desde `/employees/:id` tab Asignaciones:** ver módulo de empleados.

**Desde `/assignments`** — Vista maestra (admin+, CM, DM)

Tabla con: Empleado · Contrato · Solicitud · Inicio · Fin · h/sem · Status · Acciones.

- Filtros: status, contrato, empleado, squad, rango de fechas, área.
- Vista alternativa: **Calendario** (semanal) mostrando quién está asignado a qué cada semana. Hover muestra detalles; click abre asignación.
- Vista alternativa: **Gantt por empleado** — filas = empleados, columnas = semanas, celdas coloreadas por asignación.

**Formulario de asignación (modal):**

Contexto: se abre desde una solicitud específica. La solicitud pre-rellena contract_id y request_id.

Campos:
- `employee_id` (requerido, selector; sugerencias filtradas por nivel+área de la solicitud, mostrando utilización actual)
- `start_date` (requerido; default = solicitud.start_date o TODAY si es mayor)
- `end_date` (opcional; default = solicitud.end_date)
- `weekly_hours` (requerido; default = solicitud.weekly_hours / required_count)
- `role_title` (texto libre opcional; ej. "Tech Lead del módulo de pagos")
- `notes` (textarea)
- `status` (default `planned` si start_date > TODAY, sino `active`)

Validaciones al guardar:
- Empleado activo y no en `on_leave` o `terminated`.
- Empleado está en el squad del contrato? (warning no blocking)
- `weekly_hours` > 0.
- `start_date <= end_date` si ambos presentes.
- **Overbooking check:** `Σ(weekly_hours activas del empleado en el rango) + new_weekly_hours <= employee.weekly_capacity_hours * 1.10` (permite 10% sobre capacidad; más que eso requiere override del admin con confirmación).
- **Solapamiento exacto con otra asignación** del mismo empleado a la misma solicitud → error 409.

Warnings (no bloquean, muestran alerta):
- Empleado ya tiene utilización > 100% en el período.
- Empleado no tiene alguno de los `required_skills` de la solicitud.
- Empleado está en un país distinto al `country_preference` de la solicitud.

### Estados de asignación

| Status | Significado | Contribuye a utilización? |
|---|---|---|
| planned | Futura (start_date > TODAY) | Sí (en cálculo de utilización futura) |
| active | En ejecución (start_date <= TODAY <= end_date, o end_date IS NULL) | Sí |
| completed | Terminó normalmente (fecha pasada) | No |
| cancelled | Cancelada antes o durante | No |

Transiciones:
- Planned → Active (automático al llegar start_date; se puede hacer nightly job).
- Active → Completed (automático al pasar end_date).
- Cualquiera → Cancelled (manual, requiere razón).

### Acciones

- **Extender asignación:** cambiar `end_date` a fecha futura. Si hay solapamiento con otra asignación del mismo empleado, validar.
- **Terminar anticipadamente:** setear `end_date = TODAY` y status=completed. Pide razón.
- **Dividir asignación:** partir en dos con fechas distintas (útil para cambiar horas/semana a mitad de camino). UI: "Cambiar dedicación a partir de…".
- **Reemplazar empleado:** modal que termina la actual en fecha X y crea otra nueva de empleado Y a partir de X+1.

### Eliminación

- Asignación sin time entries → hard delete permitido.
- Asignación con time entries → solo soft delete + status=cancelled. Los time entries se preservan (quedan huérfanos del assignment pero con assignment_id aún válido).

---

## Reglas cruzadas

### Cálculo de overbooking (referencia)

Para un empleado E en una fecha D:
```
horas_asignadas(E, D) = Σ(weekly_hours) de asignaciones activas donde:
  assignment.employee_id = E
  AND assignment.status IN ('planned', 'active')
  AND assignment.deleted_at IS NULL
  AND assignment.start_date <= D
  AND (assignment.end_date >= D OR assignment.end_date IS NULL)

overbooking(E, D) = MAX(0, horas_asignadas(E, D) - employee.weekly_capacity_hours)
```

Se valida al crear/editar una asignación sobre el rango [new.start_date, new.end_date].

### Cobertura de solicitud (ya descrito arriba)

### Sincronía de fechas

Si el contrato cambia fechas:
- Nuevas fechas no pueden excluir solicitudes ya creadas con fechas fuera del nuevo rango → warning con opción de ajustar.
- Si se reduce end_date del contrato: asignaciones activas que terminarían después se ajustan a la nueva fecha (con confirmación).

---

## Eventos generados

- `contract.created`, `contract.updated`, `contract.status_changed`, `contract.deleted`
- `resource_request.created`, `resource_request.updated`, `resource_request.status_changed`, `resource_request.closed`, `resource_request.cancelled`
- `assignment.created`, `assignment.updated`, `assignment.status_changed`, `assignment.cancelled`, `assignment.deleted`
- `assignment.overbooking_warning` (cuando se crea con override de overbooking)

---

## Notificaciones

- **Solicitud sin cobertura en los próximos 14 días:** notificar al DM del contrato y a People (alerta diaria).
- **Empleado asignado:** notificar al empleado y a su manager.
- **Asignación cancelada:** notificar al empleado, al DM y al PM.
- **Contrato cambia a `on_hold`:** notificar al PM, DM y empleados con asignaciones activas.

---

## API afectada

Ver `05_api_spec.md`. Principales endpoints:

- `POST /api/contracts`, `GET /api/contracts`, `GET /api/contracts/:id`, `PUT /api/contracts/:id`, `DELETE /api/contracts/:id`
- `POST /api/contracts/:id/status` — cambiar estado con validación de transición
- `POST /api/contracts/:id/resource-requests` — crear solicitud
- `POST /api/contracts/:id/generate-requests-from-quotation` — auto-generación
- `GET /api/resource-requests?contract_id=...&status=...`
- `POST /api/resource-requests/:id/assignments` — asignar empleado
- `GET /api/assignments?employee_id=...&contract_id=...&status=...`
- `POST /api/assignments/:id/end-early`
- `POST /api/assignments/:id/split`
- `GET /api/employees/:id/candidates-for-request/:request_id` — compatibilidad (sugerencias)

---

## Historias relacionadas

Ver `09_user_stories_backlog.md` épicas **EC — Contratos** y **ER — Resource Requests** y **EA — Asignaciones**.
