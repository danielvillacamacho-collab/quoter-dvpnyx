# 04.05 — Módulo: Time Tracking

Registro de horas trabajadas por los empleados sobre sus asignaciones. Diseñado para ser **liviano, retroactivo y amigable**, con foco en cumplimiento más que en control granular.

---

## Principios de diseño

1. **Retroactividad por defecto:** es normal que la gente registre horas días o semanas después. El sistema acepta backfills dentro de una ventana configurable (default 30 días).
2. **Bajo fricción:** registrar 8 horas debe tomar <3 clicks.
3. **Visibilidad, no vigilancia:** el objetivo es ver dónde se va el esfuerzo, no auditar a la gente minuto a minuto.
4. **Sin tarifas en V2:** no se calculan costos ni facturación a partir de las horas. Las horas son input futuro para esos cálculos, pero V2 solo registra.
5. **Primary key = (empleado, asignación, fecha):** no se permiten dos entries del mismo empleado-asignación-fecha. Se edita el existente.

---

## Concepto

Un **Time Entry** es el registro de cuántas horas trabajó un empleado en una asignación específica en una fecha específica.

- Un empleado puede tener múltiples time entries por día (uno por cada asignación activa).
- La suma diaria no debe exceder una cota razonable (default 16 h/día), configurable como parámetro.
- Las horas están en unidades decimales (0.5 h granularidad mínima).
- Cada entry tiene una descripción libre del trabajo realizado.

---

## Pantallas

### `/time/me` — Mi time tracking (vista principal para FTE y PM)

Vista calendario semanal por default. Cabecera con selector de semana (← → y date picker).

**Layout:**
- Filas: asignaciones activas del empleado en esa semana.
- Columnas: L M X J V S D (7 días).
- Celdas: input numérico (horas). Vacías se muestran como "-".
- Totales:
  - Última columna: total semanal por asignación.
  - Última fila: total diario sumado de todas las asignaciones.
  - Esquina inferior derecha: **total semanal**, comparado con capacity del empleado (ej: "38 / 40 h").
- Colores:
  - Días con >capacidad diaria: celda amarilla (warning).
  - Días pasados sin horas: celda rojiza pálida con tooltip "Sin registro".
  - Días futuros: celdas deshabilitadas con tooltip "Aún no registra".
  - Fin de semana: fondo gris claro, input habilitado pero default 0.

**Al editar una celda:**
- Al salir del input (blur) o presionar Tab/Enter → autosave inmediato.
- Si es celda nueva → POST `time_entries`.
- Si ya había valor → PUT.
- Indicador de guardado (spinner brevísimo / tick).

**Botones en la cabecera:**
- `Copiar semana anterior` (modal preview: "¿Copiar L 8h BackendDev a esta semana? 5 entradas, 40 horas?"). Solo copia días con horas y asignaciones que sigan activas.
- `Rellenar 8h/día en asignación X` (dropdown por asignación; rellena de L-V con 8h donde no hay valor).
- `Nueva entrada ad-hoc` (modal: elige asignación, fecha, horas, descripción). Para entries que no caben en la matriz (asignaciones antiguas ya cerradas pero pendientes de registrar).

**Panel lateral: Descripciones**
- Al hacer click en una celda, aparece panel lateral con textarea para `description` del entry.
- La descripción es por entry, no por semana. El panel muestra la descripción del entry seleccionado.
- Guardar descripción al blur o Ctrl+Enter.

**Indicador de cumplimiento al tope de la pantalla:**
- Tarjeta: **Cumplimiento últimos 30 días: 92%** (= días hábiles con ≥1 entry vs. días hábiles totales).
- Otra tarjeta: **Semanas pendientes de completar:** lista semanas con <40 horas registradas de las últimas 4.

### `/time/team` — Time tracking del equipo (Lead+, CM, DM, PM)

Vista para ver cumplimiento del equipo.

Tabla: Empleado · Capacity semanal · Horas esta semana · Horas semana pasada · Cumplimiento 30d · Última entrada · Acciones.

- Filtros: squad, área, manager, país.
- Orden default: menor cumplimiento primero (para priorizar seguimiento).
- Botón `Recordar por email` por empleado (futuro — en V2 solo registra evento `time.reminder_sent`).
- Click en empleado → abre su calendario semanal en modo lectura.

### `/time/approve` — Aprobación (reservado para futuro)

En V2 no hay flujo de aprobación. Esta ruta existe como placeholder y muestra un mensaje "Próximamente". El módulo se prepara para aprobación semanal a futuro (ver hooks en `03_data_model.md`).

---

## Formulario / Payload de Time Entry

Campos:
- `employee_id` (requerido)
- `assignment_id` (requerido)
- `entry_date` (requerido)
- `hours` (requerido, decimal 0.5–24, en pasos de 0.5)
- `description` (opcional, textarea)
- `category` (opcional, dropdown: `delivery` / `meeting` / `training` / `support` / `other`; default delivery)
- `is_billable` (boolean, default true; reservado para cuando se active facturación)

Validaciones:
- `entry_date` entre `assignment.start_date` y `assignment.end_date` (o start_date..TODAY si end_date IS NULL).
- `entry_date <= TODAY` (no se permiten entries futuras; max 0 días adelante).
- `entry_date >= TODAY - backfill_window_days` (parámetro, default 30). Entries más antiguas requieren permiso especial (admin+ puede registrar fuera de ventana).
- `hours` entre 0.5 y 24.
- `hours` suma del día para ese empleado ≤ max_daily_hours (parámetro, default 16).
- Solo el empleado dueño o un admin/lead de su squad puede crear/editar.

---

## Reglas de negocio

### Ventana retroactiva

- Parámetro `time_tracking.backfill_window_days` (default 30).
- Para empleados normales: solo pueden crear/editar entries dentro de los últimos N días desde hoy.
- Admin+ puede crear entries fuera de la ventana con warning: "Estás registrando horas de hace >30 días. Esto queda logueado."
- Evento `time.late_entry` se dispara si entry_date < TODAY - backfill_window_days.

### Edición y borrado

- Empleado puede editar/borrar sus propios entries dentro de 30 días desde la fecha del entry (parámetro `time_tracking.edit_window_days`).
- Lead puede editar entries de su squad dentro de la misma ventana.
- Admin puede editar cualquier entry siempre, con log.
- Fuera de ventana: solo admin, con confirmación y evento.

### Multi-asignación en el mismo día

- Empleado puede tener entries a múltiples asignaciones en la misma fecha.
- Suma total del día no puede exceder `max_daily_hours`.
- UI ayuda: al editar una celda muestra cuánto queda disponible en el día.

### Contrato en `on_hold` o `completed`

- No se permite crear entries nuevas para asignaciones cuyo contrato esté en esos estados, incluso si están dentro de la ventana.
- Sí se permite editar/borrar existentes (para corregir errores).

### Empleado en `on_leave`

- No se pueden crear entries nuevas con entry_date dentro del período de leave.
- Si el empleado volvió de leave, puede registrar entries posteriores normalmente.

### Días feriados

- V2 no tiene calendario de feriados. Todos los días son registrables.
- Futuro (no V2): calendario por país.

---

## Reportes relacionados (detallados en `04_modules/06_reports.md`)

- Cumplimiento de registro (%) por empleado/squad/área.
- Horas cargadas vs. horas asignadas (gap analysis).
- Distribución de horas por categoría.
- Horas por contrato / por cliente (burn rate).
- Ranking de empleados con menor cumplimiento.
- Empleados con horas cargadas > capacity (sobrecarga).

---

## UX details & mobile

- Mobile: la vista calendario se adapta con swipe horizontal por día; cada día muestra lista de asignaciones con input numérico.
- Atajos de teclado:
  - `↑ ↓ ← →` navega entre celdas.
  - `Tab` avanza a la siguiente celda del día.
  - `Enter` guarda y pasa a la siguiente fila.
  - `Ctrl+C / Ctrl+V` en una celda copia/pega valor.
  - `Esc` cancela la edición de la celda actual.
- Undo: al guardar, mostrar toast con `Deshacer` por 5 segundos (revierte la acción).

---

## Eventos generados

- `time_entry.created` (payload: entry_id, assignment_id, date, hours)
- `time_entry.updated` (payload: before/after)
- `time_entry.deleted`
- `time.late_entry` (payload: days_late)
- `time.out_of_window_edit` (payload: who, when, why)
- `time.reminder_sent` (futuro)

---

## Notificaciones

- **Recordatorio semanal (viernes 5pm):** a empleados con <32 horas cargadas esa semana. (Implementado en V2; no disruptivo.)
- **Empleado con 0 registros en los últimos 5 días hábiles:** notificar a su manager.
- **Empleado registró horas fuera de ventana (admin):** notificar a admin con detalles.

Las notificaciones in-app se listan en la campanita del header. En V2 no hay email push — solo in-app.

---

## Parámetros configurables (category: time_tracking)

| Key | Default | Descripción |
|---|---|---|
| `backfill_window_days` | 30 | Días hacia atrás que se pueden registrar entries |
| `edit_window_days` | 30 | Días durante los cuales un entry es editable sin admin |
| `max_daily_hours` | 16 | Máximo de horas sumadas por día por empleado |
| `min_weekly_hours_reminder` | 32 | Umbral semanal bajo el cual se envía recordatorio |
| `default_entry_category` | delivery | Categoría default al crear entry |

---

## API afectada

Ver `05_api_spec.md`. Endpoints principales:

- `GET /api/time-entries?employee_id=&start_date=&end_date=` — listar entries
- `POST /api/time-entries` — crear
- `PUT /api/time-entries/:id` — editar
- `DELETE /api/time-entries/:id` — borrar
- `POST /api/time-entries/bulk` — crear múltiples (para "rellenar semana")
- `POST /api/time-entries/copy-week` — copiar semana anterior
- `GET /api/time-entries/compliance?scope=me|team|org&period=30d` — métricas de cumplimiento
- `GET /api/employees/:id/time-summary?period=week&week_of=2026-04-13` — resumen semanal

---

## Historias relacionadas

Ver `09_user_stories_backlog.md` épica **ET — Time Tracking**.
