# 09 — Backlog de Historias de Usuario

Este documento es el backlog priorizado y granular que Claude Code puede convertir directamente en tickets. Organizado por **épicas** y con criterios de aceptación en formato Gherkin-lite.

**Prioridades:**
- **MUST:** no se puede shippear V2 sin esto.
- **SHOULD:** se incluye salvo que el tiempo aprete.
- **COULD:** se incluye si sobra tiempo; queda para V2.1 si no.

---

## Épica EX — Cotizador pulido

### EX-1 (MUST) — Cotización exige cliente y oportunidad
**Como** usuario  
**Quiero** que al crear una cotización nueva deba seleccionar cliente y oportunidad existentes o crear nuevos desde la misma pantalla  
**Para** asegurar trazabilidad comercial.

**Criterios:**
- Dado que estoy en `/quotations`, cuando hago clic en `+ Staff Augmentation` o `+ Proyecto`, veo modal previo que pide cliente y oportunidad.
- Si no existen, puedo crear cliente y/o oportunidad sin salir del flujo.
- POST `/api/quotations` sin `client_id` u `opportunity_id` devuelve 400.
- Cotizaciones migradas legacy tienen cliente y oportunidad auto-creados.

### EX-2 (MUST) — Cálculo canónico en servidor
**Como** sistema  
**Quiero** recalcular outputs en el servidor al guardar una cotización  
**Para** que sean la fuente de verdad.

**Criterios:**
- El cliente envía solo inputs al PUT.
- El servidor recalcula y persiste outputs; responde con los valores canónicos.
- Diferencia > 0.01 USD entre cliente y servidor → evento `quotation.calc_drift` logueado.
- Test contrato entre `client/src/utils/calc.js` y `server/utils/calc.js`.

### EX-3 (MUST) — Snapshot de parámetros al pasar a sent/approved
**Como** comercial  
**Quiero** que al enviar la cotización se congelen los parámetros  
**Para** que cambios futuros no afecten la cotización enviada.

**Criterios:**
- Al transicionar de `draft` → `sent` o `approved` por primera vez, se captura `parameters_snapshot`.
- Al recargar una cotización con snapshot, los cálculos usan el snapshot, no los parámetros vigentes.
- Test: editar un parámetro después de `sent` no altera totales de la cotización.

### EX-4 (MUST) — Allocation en tabla propia
**Como** sistema  
**Quiero** migrar la matriz de allocation de JSONB a tabla relacional  
**Para** consultas futuras eficientes.

**Criterios:**
- Tabla `quotation_allocations` existe.
- GET/PUT `/api/quotations/:id` sigue devolviendo/aceptando el formato legacy.
- Migración pobla la tabla desde `metadata.allocation`.

### EX-5 (SHOULD) — Versión + SHA en footer
**Como** usuario  
**Quiero** ver la versión y el commit actual  
**Para** reportar bugs con contexto.

**Criterios:**
- Footer muestra `v2.0.x · build <short_sha>`.
- SHA inyectado via `REACT_APP_GIT_SHA` en build.

### EX-6 (SHOULD) — Historial read-only de la cotización
**Como** usuario  
**Quiero** ver el historial de eventos de la cotización  
**Para** entender quién hizo qué.

**Criterios:**
- Tab `Historial` en editor muestra lista cronológica de eventos.
- Cada evento muestra fecha relativa, usuario, acción, detalle expandible.
- Endpoint `GET /api/quotations/:id/events`.

### EX-7 (MUST) — Marcar cotización como ganadora
**Como** comercial  
**Quiero** marcar una cotización ganadora  
**Para** cerrar la oportunidad y sugerir contrato.

**Criterios:**
- Botón disponible si cotización en `sent/approved` y opp abierta.
- Click: modal de confirmación. Confirmado: opp → `won`, winning_quotation_id seteado, opp.closed_at=NOW.
- Cotización pasa a `approved` si estaba en `sent`.
- Se ofrece "Crear contrato desde esta cotización".

### EX-8 (SHOULD) — Breadcrumb y badges en editor
**Como** usuario  
**Quiero** navegar jerárquicamente desde el editor  
**Para** moverme rápido entre cliente/opp/cotización.

**Criterios:**
- Breadcrumb `Clientes > {Cliente} > Oportunidades > {Opp} > Cotizaciones > {Cot}`.
- Badge de oportunidad al lado del project name.
- Header sticky con totales.

---

## Épica EC — Clientes

### EC-1 (MUST) — CRUD de clientes
**Como** comercial  
**Quiero** crear, editar, ver y desactivar clientes.

**Criterios:**
- `/clients` lista con filtros, búsqueda, paginación.
- `/clients/:id` ficha con tabs Resumen, Oportunidades, Contratos, Actividad.
- Formulario con validaciones descritas.
- Nombre duplicado devuelve 409 con sugerencia.

### EC-2 (MUST) — No se puede eliminar cliente con opps/contratos
**Criterios:**
- DELETE devuelve 409 sugiriendo desactivar.

### EC-3 (SHOULD) — Tags y notas
**Criterios:**
- Chip input en formulario, visible en ficha.

---

## Épica EO — Oportunidades

### EO-1 (MUST) — CRUD de oportunidades
**Criterios:**
- `/opportunities` lista con filtros, búsqueda.
- `/opportunities/:id` con tabs Resumen, Cotizaciones, Actividad.
- Formulario con validaciones.
- Owner, preventa lead, squad asignables.

### EO-2 (MUST) — Flujo de status
**Como** comercial  
**Quiero** mover una oportunidad por su flujo  
**Para** reflejar el estado comercial.

**Criterios:**
- Transiciones válidas enforced en backend.
- Won requiere winning_quotation_id.
- Lost/cancelled requiere outcome_reason.
- Modal captura razón al perder/cancelar.

### EO-3 (SHOULD) — Vista Kanban
**Criterios:**
- Vista alternativa kanban con columnas por status.
- Drag-and-drop entre columnas respeta transiciones válidas.

### EO-4 (COULD) — Oportunidad con múltiples cotizaciones
**Criterios:**
- Una opp puede tener varias cotizaciones.
- Al ganar, se elige cuál cotización ganó (si hay más de una).

---

## Épica EE — Empleados

### EE-1 (MUST) — CRUD de empleados
**Criterios:**
- `/employees` lista con filtros, búsqueda, vista tabla y cards.
- `/employees/:id` ficha con tabs Resumen, Skills, Asignaciones, Horas, Actividad.
- Formulario con validaciones.
- Distinción Empleado vs Usuario (user_id nullable).

### EE-2 (MUST) — Estados del empleado
**Criterios:**
- Status active/on_leave/bench/terminated con reglas descritas.
- Cambio a terminated cancela asignaciones futuras.
- Cambio a on_leave alerta al manager.

### EE-3 (MUST) — Skills con proficiency
**Criterios:**
- Tab Skills editable inline (admin+).
- Asignar skill pide proficiency, years, notes.
- Skills inactivos no aparecen en selectores.

### EE-4 (SHOULD) — Acción "Crear usuario para este empleado"
**Criterios:**
- Botón en ficha si user_id IS NULL.
- Pre-rellena email, nombre.
- Pide rol y función.
- Genera password `000000` con must_change_password=true.

### EE-5 (SHOULD) — Utilización en tarjeta
**Criterios:**
- Ficha muestra tarjeta con % utilización actual.
- Color según umbrales.

### EE-6 (COULD) — Importación masiva CSV
**Criterios:**
- `POST /api/employees/bulk-import`.
- Preview de primeras 10 filas antes de confirmar.
- Reporte de errores por línea.

---

## Épica EA — Áreas y Skills (catálogos)

### EA-1 (MUST) — Catálogo de áreas
**Criterios:**
- 9 áreas seedeadas.
- `/admin/areas` admin+.
- Crear nueva, editar, desactivar.
- No desactivable si hay empleados activos.

### EA-2 (MUST) — Catálogo de skills
**Criterios:**
- ~50 skills seedeados.
- `/admin/skills` admin+.
- Categorías predefinidas.
- Duplicados (case-insensitive) rechazados.
- No eliminable si hay empleados asignados.

---

## Épica EK — Contratos

### EK-1 (MUST) — CRUD de contratos
**Criterios:**
- `/contracts` lista + filtros.
- `/contracts/:id` ficha con tabs.
- Formulario con validaciones.
- Creación desde oportunidad ganada pre-rellena campos.

### EK-2 (MUST) — Flujo de status del contrato
**Criterios:**
- Transiciones draft→active→on_hold/completed/cancelled.
- Al completar/cancelar: side effects sobre asignaciones y solicitudes.

### EK-3 (SHOULD) — Pre-generación de solicitudes desde cotización
**Criterios:**
- Checkbox al crear contrato desde cotización.
- Preview de solicitudes con capacidad de editar/descartar.
- Se crean al confirmar.

### EK-4 (SHOULD) — Tarjetas de coverage y riesgo
**Criterios:**
- Ficha muestra cobertura horas solicitadas vs asignadas.
- Contador de riesgos abiertos.

### EK-5 (COULD) — Vista timeline de contratos por cliente
**Criterios:**
- Gantt horizontal.

---

## Épica ER — Solicitudes de Recurso

### ER-1 (MUST) — CRUD de solicitudes
**Criterios:**
- Creación desde ficha de contrato.
- Formulario con validaciones.
- Status calculado (open/partial/filled/closed/cancelled).

### ER-2 (MUST) — Visualización en tab del contrato
**Criterios:**
- Tabla de solicitudes con columnas descritas.
- Link a asignar empleado.

### ER-3 (SHOULD) — Sugerencias de candidatos
**Criterios:**
- Panel lateral con empleados que matchean.
- Score basado en nivel + área + skills + utilización.

### ER-4 (COULD) — Cerrar/cancelar solicitud
**Criterios:**
- Admin puede cerrar o cancelar con razón.

---

## Épica EN — Asignaciones

### EN-1 (MUST) — Crear asignación desde solicitud
**Criterios:**
- Modal con empleado, fechas, horas/semana.
- Validaciones: overbooking, solapamiento, status empleado.
- Warnings descriptivos (no bloqueantes).

### EN-2 (MUST) — Overbooking check
**Criterios:**
- Al guardar, chequea suma de horas activas del empleado.
- Si excede capacity × 1.10 → error.
- Admin puede override con confirmación.

### EN-3 (SHOULD) — Acciones: extender / terminar anticipadamente / dividir / reemplazar
**Criterios:**
- Botones en ficha/modal con validaciones.
- Eventos logueados.

### EN-4 (SHOULD) — Vista maestra `/assignments`
**Criterios:**
- Tabla + filtros.
- Vista calendario semanal.
- Vista gantt por empleado.

### EN-5 (MUST) — Eliminación con reglas
**Criterios:**
- Sin time entries → hard delete permitido.
- Con time entries → soft delete + cancelled.

---

## Épica ET — Time Tracking

### ET-1 (MUST) — Calendario `/time/me`
**Criterios:**
- Vista matriz semanal: filas = asignaciones, columnas = días.
- Inputs numéricos con autosave.
- Totales por fila, columna y semanal.
- Colores por estado.

### ET-2 (MUST) — CRUD de time entries
**Criterios:**
- POST, PUT, DELETE con validaciones descritas.
- Ventana retroactiva 30 días por default.
- Suma diaria ≤ 16h (configurable).

### ET-3 (MUST) — Copiar semana anterior
**Criterios:**
- Botón en cabecera de calendario.
- Modal preview.
- Solo copia días con horas y asignaciones activas.

### ET-4 (SHOULD) — Rellenar 8h/día
**Criterios:**
- Botón por asignación.
- Llena días L-V sin valor con 8h.

### ET-5 (SHOULD) — Vista team `/time/team`
**Criterios:**
- Tabla con cumplimiento por empleado.
- Filtros.

### ET-6 (MUST) — Reglas de edición
**Criterios:**
- Empleado edita propios dentro de ventana.
- Lead edita de su squad dentro de ventana.
- Admin puede cualquier siempre, log.

### ET-7 (MUST) — Sin entries futuras
**Criterios:**
- `entry_date > TODAY` → 400.

### ET-8 (COULD) — Descripciones por entry
**Criterios:**
- Panel lateral.
- Categoría opcional.

### ET-9 (SHOULD) — Recordatorios
**Criterios:**
- Notificación viernes 5pm si <32h en la semana.
- In-app, sin email.

---

## Épica EI — Reportes

### EI-1 (MUST) — Hub `/reports`
**Criterios:**
- Landing con tarjetas categorizadas.

### EI-2 (MUST) — Utilización por empleado
**Criterios:**
- Tabla + heatmap.
- Filtros descritos.
- Export CSV/XLSX.

### EI-3 (MUST) — Bench
**Criterios:**
- Lista empleados con utilización < umbral.
- Acción "Sugerir matches".

### EI-4 (MUST) — Solicitudes pendientes
**Criterios:**
- Lista con alertas destacadas.

### EI-5 (MUST) — Necesidades de contratación
**Criterios:**
- Agrupado por área+nivel+país.
- Export.

### EI-6 (MUST) — Cobertura por contrato
**Criterios:**
- Lista con % cobertura.
- Riesgo calculado.

### EI-7 (MUST) — Cumplimiento de time tracking
**Criterios:**
- Por empleado con métricas descritas.
- Rankings top 10.

### EI-8 (SHOULD) — Horas por cliente/contrato
**Criterios:**
- Tabla + gráfico temporal.

### EI-9 (SHOULD) — Pipeline de oportunidades
**Criterios:**
- Embudo visual.
- Evolución temporal.

### EI-10 (SHOULD) — Cotizaciones por estado
**Criterios:**
- Tabla + gráficos.

### EI-11 (SHOULD) — Win rate
**Criterios:**
- Métricas agregadas.
- Cortes varios.

### EI-12 (COULD) — Distribución de skills
**Criterios:**
- Heatmap área × skill.

### EI-13 (COULD) — Overbooking
**Criterios:**
- Tabla con picos semanales.

### EI-14 (SHOULD) — Calidad de datos
**Criterios:**
- Tarjetas con conteo + link a listas.

---

## Épica EU — Usuarios, Roles, Squads

### EU-1 (MUST) — CRUD de usuarios
**Criterios:**
- `/admin/users` admin+.
- Formulario con rol, función, squad.
- Reglas V1 preservadas (superadmin protection).

### EU-2 (MUST) — Squads como entidad
**Criterios:**
- `/admin/squads` admin+.
- Mover usuarios entre squads.
- Seed DVPNYX Global.

### EU-3 (MUST) — Funciones como atributo
**Criterios:**
- Campo en usuario.
- Determina dashboard default y visibilidad de sidebar.

### EU-4 (MUST) — Permisos hardcoded
**Criterios:**
- Capability bundle en middleware.
- No UI para editar permisos.
- Matriz en `02_glossary_and_roles.md`.

---

## Épica ED — Dashboards

### ED-1 (MUST) — Dashboard personal `/dashboard/me`
**Criterios:**
- Widgets universales.

### ED-2 (SHOULD) — Dashboards por función
**Criterios:**
- 8 dashboards (commercial, presales, capacity, delivery, people, pmo, general, admin).
- Redirect al login según función.

### ED-3 (COULD) — Widgets configurables por usuario
**Criterios:**
- Reservar para V2.1.

---

## Épica EV — Navegación y UX Shell

### EV-1 (MUST) — Layout global (header + sidebar + footer)
### EV-2 (MUST) — Sidebar según función
### EV-3 (MUST) — Breadcrumbs en todas las pantallas
### EV-4 (SHOULD) — Búsqueda global Cmd+K
### EV-5 (SHOULD) — Campana de notificaciones in-app
### EV-6 (MUST) — Footer con versión y SHA
### EV-7 (COULD) — Theming / dark mode

---

## Épica EG — Migración desde V1

### EG-1 (MUST) — Scripts de DDL V2
### EG-2 (MUST) — Script de data migration
### EG-3 (MUST) — Validación post-migración
### EG-4 (MUST) — Plan de rollback
### EG-5 (SHOULD) — Snapshot retroactivo opcional

---

## Épica ES — Eventos y Notificaciones

### ES-1 (MUST) — Tabla events estructurada
**Criterios:**
- Eventos polimórficos con payload JSONB.
- Índices en (entity_type, entity_id) y (actor_user_id, created_at).

### ES-2 (MUST) — Emisores de eventos en todos los módulos
**Criterios:**
- Cada CRUD emite evento correspondiente.
- Cambios de status emiten evento.

### ES-3 (SHOULD) — Notificaciones in-app
**Criterios:**
- Tabla notifications.
- Campana con conteo no leído.
- Read/unread.

### ES-4 (COULD) — Notificaciones por email
**Criterios:**
- Reservar para V2.1.

---

## Épica EP — Parámetros

### EP-1 (MUST) — Parámetros editables (admin+)
**Criterios:**
- UI existente V1 preservada.
- Nuevas categorías time_tracking, reports.

### EP-2 (SHOULD) — Audit de cambios de parámetros
**Criterios:**
- Cada cambio emite evento.

---

## Épica EW — Wiki

### EW-1 (MUST) — Preservar wiki V1
**Criterios:**
- Ruta `/wiki` funcional.
- Sin cambios en V2.

---

## Épica EF — Infraestructura y CI/CD

### EF-1 (MUST) — Docker Compose actualizado
### EF-2 (MUST) — GitHub Actions con lint + test + build
### EF-3 (MUST) — Healthcheck `/api/health`
### EF-4 (SHOULD) — Script de deploy idempotente
### EF-5 (SHOULD) — Backup automático nocturno
### EF-6 (COULD) — Vistas materializadas con refresh job

---

## Orden de ejecución recomendado (para Claude Code)

Construcción sin interrumpir V1, en este orden:

**Sprint 1 — Cimientos**
- EF-* (infraestructura)
- EG-1 a EG-4 (DDL y migración)
- EU-* (usuarios/roles/squads)
- EV-1, EV-2, EV-3, EV-6 (shell UX)

**Sprint 2 — Comercial**
- EC-* (clientes)
- EO-1, EO-2 (oportunidades básicas)
- EX-1 a EX-4 (cotizador linked)

**Sprint 3 — Gente**
- EA-* (catálogos)
- EE-1, EE-2, EE-3 (empleados)

**Sprint 4 — Delivery core**
- EK-1, EK-2 (contratos)
- ER-1, ER-2 (solicitudes)
- EN-1, EN-2, EN-5 (asignaciones)

**Sprint 5 — Tiempo**
- ET-1, ET-2, ET-3, ET-6, ET-7 (time tracking core)

**Sprint 6 — Visibilidad**
- EI-1 a EI-7 (reportes críticos)
- ED-1 (dashboard personal)

**Sprint 7 — Refinamientos**
- EX-5 a EX-8 (editor pulido)
- EE-4 a EE-6 (empleados avanzado)
- EK-3 a EK-5 (contratos avanzado)
- ER-3, ER-4 (solicitudes avanzado)
- EN-3, EN-4 (asignaciones avanzado)
- ET-4, ET-5, ET-8, ET-9 (time tracking avanzado)
- EI-8 a EI-14 (reportes adicionales)
- ED-2 (dashboards por función)
- EO-3, EO-4 (oportunidades avanzado)
- EV-4, EV-5 (búsqueda + notifs)
- ES-* (eventos y notifs)

**Sprint 8 — Cierre**
- EG-5 (snapshot retroactivo)
- EF-5, EF-6 (ops avanzado)
- EP-2 (audit params)
- Regression test completo
- Deploy a producción con migración
