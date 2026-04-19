# 04.03 — Módulo: Empleados, Áreas y Skills

## Empleados

### Concepto

El **Empleado** es la persona real que trabaja en DVPNYX. Es distinto del **Usuario** del sistema:
- Un empleado puede ser usuario (FTE técnico que se loguea para registrar horas, PM que ve sus asignaciones) — `employees.user_id` apunta al user.
- Un empleado puede NO ser usuario (todavía no le crearon cuenta, o no necesita acceso) — `employees.user_id IS NULL`.
- Un usuario puede NO ser empleado (Comercial externo, Admin del sistema sin perfil técnico).

Esta distinción es crítica. Las asignaciones y el time tracking operan sobre Empleado. El login y permisos operan sobre User.

### Pantallas

**`/employees`** — Lista de empleados

Columnas: Nombre · Área · Nivel · País · Status · Squad · Capacidad · Utilización actual · Acciones.

- Búsqueda por nombre, email.
- Filtros: área, nivel, país, status (active/on_leave/bench/terminated), squad, skill (multi-select).
- Ordenamiento por cualquier columna.
- Paginación 25/página.
- Botón header: `+ Nuevo Empleado` (admin+).
- Vista alternativa: **Tarjetas** mostrando avatar (iniciales), nombre, área, nivel, top 3 skills.

**`/employees/:id`** — Ficha del empleado

Tabs:
- **Resumen:** datos personales, área, nivel, país, idiomas, capacidad, status, manager.
- **Skills:** lista de skills asignados con proficiency. Editable inline (admin+).
- **Asignaciones:** lista de asignaciones actuales y pasadas. Activas primero. Link a contrato y solicitud.
- **Horas:** vista calendario/tabla de time entries del empleado (últimos 90 días por default).
- **Actividad:** event log filtrado.

Header con tarjeta destacada: **Utilización actual** (% asignado / capacidad), barra visual con código de color (verde 60-100%, amarillo 100-110%, rojo >110% o <50%).

### Formulario de Empleado

Campos:
- `first_name`, `last_name` (requeridos)
- `personal_email`, `corporate_email` (opcionales; corporate único)
- `country` (combobox), `city` (texto opcional)
- `area_id` (selector de áreas activas, requerido)
- `level` (dropdown L1-L11, requerido)
- `seniority_label` (dropdown: Junior, Semi Senior, Senior, Lead, Principal — auto-sugerido por nivel pero editable)
- `employment_type` (dropdown: Fulltime, Parttime, Contractor)
- `weekly_capacity_hours` (numérico, default 40, range 1-80)
- `languages` (lista editable de pares language+level: inglés C1, español nativo, etc.)
- `start_date` (requerido), `end_date` (opcional)
- `status` (dropdown active/on_leave/bench/terminated, default active)
- `squad_id` (selector, opcional)
- `manager_user_id` (selector de usuarios, opcional — típicamente CM o Head)
- `notes` (textarea), `tags` (chip input)
- `user_id` (selector de usuarios sin empleado vinculado, opcional)

Validaciones:
- Corporate email único entre empleados activos.
- Si se asigna `user_id`, validar que ese usuario no esté ya vinculado a otro empleado.
- `weekly_capacity_hours` entre 1 y 80.
- `end_date >= start_date` si ambos están presentes.

### Acción "Crear usuario para este empleado"

Botón en la ficha (admin+): si el empleado no tiene `user_id`, crear un usuario asociado:
- Pre-rellena email = corporate_email
- Pre-rellena nombre = first_name + " " + last_name
- Pide rol y función (ver módulo de usuarios)
- Genera clave temporal `000000` con `must_change_password=true`
- Vincula `employees.user_id` al recién creado.

### Status del empleado

| Status | Significado | Aparece en bench? | Permite asignación? |
|---|---|---|---|
| active | Empleado activo | Sí, si su utilización < umbral | Sí |
| on_leave | Vacaciones, licencia, incapacidad | No | No (bloquear) |
| bench | Sin asignación, esperando | Sí | Sí |
| terminated | Salió de DVPNYX | No | No (bloquear) |

Cambios de status:
- A `terminated`: pide fecha (default hoy). Cancela todas las asignaciones futuras (status=cancelled). Asignaciones activas terminan en la fecha de terminación.
- A `on_leave`: pide fechas tentativas. No bloquea asignaciones existentes pero alerta al manager.

### Eliminación de empleado

- Soft delete con confirmación.
- Bloqueado si hay asignaciones activas → 409 sugerir cambiar status a `terminated`.
- Bloqueado si hay time entries en últimos 90 días → 409 (preservar historial).

---

## Áreas

### Concepto

Catálogo de especialidades funcionales. Determina:
- Categorización del empleado
- Filtros en reportes
- Sugerencias de skills relevantes (futuro)

### Pantalla

**`/admin/areas`** (admin+ only)

Tabla simple con: Key · Nombre · Descripción · Sort order · Active · Editar · Desactivar.

Botón `+ Nueva Área`. Las áreas no se eliminan (solo desactivan) porque están referenciadas por empleados.

### Reglas

- Las 9 áreas seedeadas no se pueden desactivar si tienen empleados activos asignados.
- Crear área nueva: solo requiere key, name, sort_order.

---

## Skills

### Concepto

Catálogo de capacidades técnicas y de dominio que se asignan a empleados. Lista plana, sin jerarquía.

### Pantalla

**`/admin/skills`** (admin+ only)

Tabla con: Nombre · Categoría · # Empleados con este skill · Activo · Editar · Desactivar.

- Filtro por categoría.
- Búsqueda por nombre.
- Botón `+ Nuevo Skill`.

### Formulario

- `name` (requerido, único case-insensitive)
- `category` (dropdown sugerido: language, framework, cloud, data, ai, tool, methodology, soft, otros)
- `description` (textarea opcional)
- `active` (toggle)

### Reglas

- Skills duplicados (case-insensitive) son rechazados.
- Skills con empleados asignados no se eliminan (solo desactivan).
- Skills inactivos no aparecen en selectores de búsqueda de empleados, pero se conservan visibles en perfiles existentes.

### Asignación de skills al empleado

En `/employees/:id` tab Skills:
- Buscador de skills (autocompletado sobre nombre).
- Al seleccionar uno, modal pide proficiency (Beginner / Intermediate / Advanced / Expert), years_experience (numérico opcional), notes (opcional).
- Al guardar, se inserta en `employee_skills`.
- Se puede editar y eliminar cada skill del empleado.

---

## Cálculo de utilización (referencia para reportes)

```
utilizacion_actual(employee) = 
  Σ(weekly_hours de asignaciones activas con start_date <= TODAY <= end_date) 
  / weekly_capacity_hours
```

- Asignación activa = `status IN ('planned','active') AND deleted_at IS NULL`.
- Si `end_date IS NULL`, la asignación se considera abierta (vigente).
- Resultado expresado como decimal (0.75 = 75%).

Usado en:
- Tarjeta de utilización en ficha del empleado
- Reporte de utilización
- Reporte de bench (utilización <= bench_threshold parámetro)
- Validación de overbooking al crear asignación nueva

---

## Eventos generados

- `employee.created`, `employee.updated` (payload con before/after)
- `employee.status_changed` (from, to, reason)
- `employee.skill_added`, `employee.skill_removed`
- `employee.user_linked`
- `employee.deleted`
- `area.created`, `area.updated`, `area.deactivated`
- `skill.created`, `skill.updated`, `skill.deactivated`

---

## Notificaciones

- **Empleado nuevo en mi squad:** notificar al squad lead.
- **Empleado pasa a `terminated`:** notificar al manager y CMs/DMs con asignaciones suyas activas.
- **Empleado pasa a `bench`:** notificar a People y al squad lead.

---

## Importación masiva (opcional pero recomendado)

Endpoint `POST /api/employees/bulk-import` que acepta un CSV con columnas:
`first_name, last_name, corporate_email, country, area_key, level, weekly_capacity_hours, start_date, status, squad_name`

- Validación por línea, reporte de errores.
- Idempotencia: si `corporate_email` ya existe, skip con warning.
- UI: pantalla de upload con preview de las primeras 10 filas y resumen post-import.

Esto facilita poblar la base inicial desde el Excel actual.
