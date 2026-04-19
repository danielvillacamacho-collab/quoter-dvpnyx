# 04.06 — Módulo: Reportes

Los reportes de V2 son la capa de visibilidad ejecutiva y operativa. Se agrupan en un hub único (`/reports`) con navegación por categorías.

## Principios

- **Todo reporte es filtrable y exportable.** CSV mínimo; XLSX si el reporte tiene formato (header bold, freeze row).
- **Todo reporte tiene URL compartible** — los filtros aplicados se reflejan en query params.
- **Los reportes son read-only.** No se edita entidades desde un reporte; se navega a la entidad.
- **Performance objetivo:** < 2 segundos para reportes sobre < 100k filas. Con índices apropiados, ningún reporte de V2 debería acercarse a ese límite.
- **Sin costos, sin tarifas.** Las cifras monetarias que aparezcan vienen de cotizaciones aprobadas, no de costos.

---

## Hub de reportes — `/reports`

Landing page con tarjetas categorizadas:

**Capacidad y Utilización:**
- Utilización por empleado
- Bench
- Distribución de capacidad por squad/área
- Overbooking

**Demanda y Cobertura:**
- Solicitudes pendientes de cubrir
- Necesidades de contratación
- Cobertura por contrato
- Pipeline de oportunidades

**Tiempo y Ejecución:**
- Cumplimiento de time tracking
- Horas por cliente / contrato
- Horas por categoría
- Burn rate de contratos

**Comercial:**
- Embudo de oportunidades
- Cotizaciones por estado
- Win rate por squad / owner
- Valor en pipeline

**Calidad de datos:**
- Empleados sin skills
- Solicitudes huérfanas
- Asignaciones sin time entries recientes
- Contratos sin PM/DM asignado

Cada tarjeta abre la pantalla del reporte correspondiente. Cada reporte tiene breadcrumb `Reportes > {Categoría} > {Nombre}`.

---

## Reporte: Utilización por empleado — `/reports/utilization`

**Objetivo:** ver cómo está cargado cada empleado activo.

**Filtros:**
- Rango de fechas (default: semana actual).
- Squad (multi-select).
- Área (multi-select).
- Nivel (multi-select).
- País.
- Solo activos (default on).

**Columnas:**
- Empleado
- Área · Nivel
- País
- Capacidad semanal
- Horas asignadas (suma weekly_hours de asignaciones activas en el período)
- **Utilización % (asignadas / capacidad)**
- Horas cargadas en el período (time entries)
- Cumplimiento (cargadas / asignadas)
- # Asignaciones activas
- Semáforo:
  - Verde: 70–100%
  - Amarillo: 60–70% o 100–110%
  - Rojo: <60% (bench) o >110% (overbooking)
- Acciones: Ver ficha

**Vistas alternativas:**
- **Gráfico de barras** (stack) con utilización agrupada por squad o área.
- **Heatmap semanal** (filas = empleados, columnas = semanas del rango, color = utilización).

**Export:**
- CSV: todas las filas filtradas.
- XLSX con formato: header bold, conditional formatting para el % (verde/amarillo/rojo).

---

## Reporte: Bench — `/reports/bench`

**Objetivo:** lista de empleados activos con utilización baja.

**Filtros:**
- Umbral de utilización (default 60% — parámetro `reports.bench_threshold`).
- Squad, área, nivel, país.
- Incluir bench explícito (status=bench): default on.

**Columnas:**
- Empleado
- Área · Nivel · País
- Status (active / bench)
- Utilización actual
- Días en bench (desde última asignación activa terminada)
- Skills top 3
- Última asignación (link)
- Acciones: Ver ficha · Asignar a solicitud

**Acciones masivas:**
- Seleccionar N empleados → "Sugerir matches" → sistema cruza skills/área/nivel con solicitudes abiertas y muestra matches.

---

## Reporte: Solicitudes pendientes — `/reports/open-requests`

**Objetivo:** ver todas las solicitudes de recurso sin cobertura total.

**Filtros:**
- Status (open, partial).
- Rango fecha de inicio (default: próximos 60 días).
- Cliente, squad, área, nivel, país.
- Prioridad.

**Columnas:**
- Cliente · Contrato
- Perfil solicitado (área, nivel, skills)
- País preferencia
- Inicio · Fin
- h/semana · Personas
- Cobertura % (horas asignadas / horas requeridas)
- Días hasta inicio (con color si <14)
- Prioridad
- Acciones: Ver contrato · Sugerir candidatos

**Alertas integradas:**
- Tarjeta destacada: "**N solicitudes inician en los próximos 7 días sin cobertura total**".
- Tarjeta: "**M horas semanales sin cubrir** en solicitudes activas".

---

## Reporte: Necesidades de contratación — `/reports/hiring-needs`

**Objetivo:** agregado de qué perfiles están faltando para decidir contrataciones.

Agrupa solicitudes pendientes (open + partial) por `área + nivel + país_preferencia`. Muestra:

**Columnas:**
- Área
- Nivel
- País (o "Cualquiera")
- # Solicitudes agrupadas
- Horas/semana total sin cubrir
- Personas equivalentes (horas/40)
- Período de demanda (min start_date — max end_date de las agrupadas)
- Clientes afectados (lista)

**Filtros:**
- Ventana de demanda (default: próximos 90 días).
- Squad.

**Vista alternativa:**
- **Tabla de brecha:** para cada combinación, muestra "Empleados disponibles en bench que matchean: N" vs "Horas faltantes: M". Ayuda a diferenciar "hay gente, solo hay que asignar" de "hay que contratar".

**Export:**
- CSV para compartir con People / recruiting.

---

## Reporte: Cobertura por contrato — `/reports/contract-coverage`

**Objetivo:** por cada contrato activo, ver cuán cubierto está.

**Columnas:**
- Contrato · Cliente
- Tipo (capacity / project)
- PM · DM
- Fechas · Días restantes
- # Solicitudes (total, open, partial, filled)
- Horas semanales requeridas totales
- Horas semanales asignadas actuales
- **Cobertura %**
- Riesgo (alta si cobertura <80% y solicitudes empiezan en <14 días)
- Acciones: Ver contrato

---

## Reporte: Cumplimiento de time tracking — `/reports/time-compliance`

**Objetivo:** quién está llenando sus horas y quién no.

**Filtros:**
- Período (default últimos 30 días).
- Squad, área, manager.
- Solo activos.

**Columnas:**
- Empleado
- Squad · Manager
- Días hábiles del período
- Días con registros
- **Cumplimiento % (días con registros / días hábiles)**
- Horas totales cargadas
- Horas esperadas (días hábiles × 8)
- Delta
- Última entrada (fecha)
- Acciones: Ver calendario · Enviar recordatorio

**Métricas agregadas top:**
- Cumplimiento global del período.
- Total de horas cargadas.
- # Empleados con 0 registros.

**Ranking:**
- **Top 10 empleados con peor cumplimiento.**
- **Top 10 empleados con mayor carga de horas.**

---

## Reporte: Horas por cliente / contrato — `/reports/hours-by-contract`

**Objetivo:** burn rate de ejecución.

**Filtros:**
- Cliente, contrato, período, squad.

**Vista principal — tabla:**
- Cliente
- Contrato
- Horas cargadas en período
- Horas asignadas "ideales" (Σ weekly_hours × semanas)
- Ratio
- # Empleados participantes
- Acciones: Ver detalle

**Vista alternativa — gráfico:**
- Línea temporal de horas semanales por contrato (múltiples líneas).
- Barras apiladas por categoría (delivery/meeting/training/support).

---

## Reporte: Embudo de oportunidades — `/reports/pipeline`

**Objetivo:** estado del pipeline comercial.

**Métricas top:**
- Valor total en pipeline (Σ de cotizaciones más recientes por oportunidad en estados open/qualified/proposal/negotiation).
- # Oportunidades abiertas.
- Oportunidades por cerrar (expected_close_date este mes).
- Win rate YTD.

**Vistas:**
- **Embudo visual:** barras horizontales (ancho = valor, etiqueta = # opps) por cada status.
- **Tabla:** Oportunidad, Cliente, Owner, Squad, Status, Expected close, Valor (cotización más reciente).
- **Gráfico de área:** evolución mensual del valor en pipeline (últimos 12 meses).

**Filtros:**
- Squad, owner, cliente, rango fechas expected close.

---

## Reporte: Cotizaciones por estado — `/reports/quotations`

**Objetivo:** analítica de cotizaciones.

**Columnas:**
- Cotización · Proyecto
- Cliente · Oportunidad
- Tipo
- Status
- Creador
- Created_at
- Última edición
- Valor (precioFinal o similar)
- Acciones: Abrir

**Filtros:** status, cliente, tipo, owner, rango de fechas.

**Gráficos:**
- Torta por status.
- Barras por creador (cantidad y valor).

---

## Reporte: Win rate — `/reports/win-rate`

**Objetivo:** medir efectividad de cierre por equipo y por tipo.

**Métricas top (YTD, último trimestre, último mes):**
- Oportunidades cerradas (won + lost): N
- Won: M — **Win rate: M/N %**
- Valor won / Valor total cerrado

**Cortes:**
- Por squad
- Por owner
- Por tipo (capacity / project)
- Por rango de valor (bandas)
- Por outcome_reason (entre perdidas)

---

## Reporte: Calidad de datos — `/reports/data-quality`

Tarjetas clickeables que abren listas:

- **Empleados sin skills asignados:** N empleados — ir a lista.
- **Empleados sin squad:** N.
- **Empleados sin user_id vinculado:** N.
- **Solicitudes huérfanas** (sin asignaciones y contrato ya iniciado): N.
- **Asignaciones sin time entries en los últimos 14 días:** N.
- **Contratos sin PM asignado:** N.
- **Contratos sin DM asignado:** N.
- **Oportunidades sin cotización después de 14 días de creadas:** N.

Estas listas permiten identificar huecos operativos rápido.

---

## Reporte: Distribución de skills — `/reports/skills-distribution`

**Objetivo:** radiografía de competencias de la organización.

**Vistas:**
- Tabla: Skill · # Empleados (beginner/intermediate/advanced/expert) · Total · Categoría.
- **Heatmap área × skill:** filas = áreas, columnas = skills top 30, celdas = conteo.
- **Top skills:** ranking.
- **Skills huérfanos:** skills con 0 o 1 empleado.

Útil para planeación de training y hiring.

---

## Reporte: Overbooking — `/reports/overbooking`

**Objetivo:** detectar empleados con asignaciones que suman más de su capacidad.

**Columnas:**
- Empleado
- Capacidad semanal
- Horas asignadas
- **Overbooking (horas)**
- Overbooking %
- Semana del pico
- Asignaciones involucradas (contar)
- Acciones: Ver ficha

**Filtros:**
- Rango de fechas.
- Umbral (default: horas asignadas > capacidad × 1.00).
- Squad, área.

---

## Dashboards (view helpers en `/dashboard/*`)

Los dashboards no son propiamente reportes pero consumen los mismos datos. Referenciados en `06_frontend_ux.md`.

Función → widgets clave (referencia, detalle en UX spec):
- **Comercial:** Oportunidades mías · Pipeline squad · Cotizaciones recientes · Win rate personal.
- **Preventa:** Cotizaciones en draft/sent · Cotizaciones recientes · Alertas de cotizaciones sin respuesta.
- **Capacity Manager:** Utilización del portafolio · Bench · Alertas overbooking · Solicitudes abiertas.
- **Delivery Manager:** Contratos activos · Solicitudes abiertas · Horas cargadas · Alertas cobertura.
- **PM:** Mis asignaciones · Mis horas esta semana · Contrato principal · Cumplimiento del equipo.
- **FTE técnico:** Mis asignaciones · Cumplimiento mis horas · Recordatorios · Link directo a calendario.
- **People:** Necesidades de contratación · Skills faltantes · Empleados en on_leave próximos a volver · Nuevas incorporaciones.
- **PMO / Finance / Admin:** vista agregada general.

---

## Implementación

**Backend:**
- Endpoints bajo `/api/reports/*` con query params documentados.
- Agregaciones en SQL puro con vistas materializadas donde aplique (`mv_utilization_current`, `mv_bench_current`).
- Refresh de vistas materializadas cada N minutos (parámetro, default 15).

**Frontend:**
- Componente `<ReportShell>` que envuelve filtros + tabla + export.
- Filtros sincronizados con URL via query params.
- Export CSV via fetch a endpoint + download blob.

**Tests:**
- Para cada reporte, test de:
  - SQL correcto con dataset conocido.
  - Filtros alteran query esperada.
  - Export produce archivo válido.

---

## Parámetros configurables (category: reports)

| Key | Default | Descripción |
|---|---|---|
| `bench_threshold_pct` | 60 | Umbral utilización bajo el cual se considera bench |
| `overbooking_threshold_pct` | 100 | Umbral utilización sobre el cual se considera overbooking |
| `hiring_needs_window_days` | 90 | Ventana de demanda futura para necesidades de contratación |
| `materialized_view_refresh_minutes` | 15 | Frecuencia de refresh de vistas materializadas |
| `default_report_period_days` | 30 | Período default para reportes que no especifican |

---

## Historias relacionadas

Ver `09_user_stories_backlog.md` épica **EI — Reportes**.
