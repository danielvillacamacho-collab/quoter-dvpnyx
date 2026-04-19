# 06 — Frontend / UX

## Stack

- React 18 (CRA). **No migrar a Vite/Next en V2.**
- React Router v6 para navegación.
- Estado: Context API para sesión/usuario; `react-query` o fetch + hooks custom para data.
- Estilos: mantener enfoque actual (CSS modules / CSS plano). En V2 NO se migra a Tailwind ni CSS-in-JS.
- UI components: usar los existentes de V1; crear nuevos siguiendo mismas convenciones.
- Charts: recharts (ya usado en V1 dashboard) para gráficos.
- Tablas grandes: componente propio o `react-table` (decisión Claude Code según menor fricción).
- Fechas: `date-fns` (ya usado).

## Layout global

```
┌────────────────────────────────────────────────────────┐
│  [logo DVPNYX]  Búsqueda global       [🔔 N] [avatar]  │ Header
├─────────┬──────────────────────────────────────────────┤
│         │                                              │
│ Sidebar │            Main content area                 │
│         │                                              │
│ [items] │  Breadcrumb                                  │
│         │  Título · acciones                           │
│         │                                              │
│         │  Contenido                                   │
│         │                                              │
└─────────┴──────────────────────────────────────────────┘
                                               v2.0.x · build <sha>
```

### Header
- Logo a la izquierda — link a `/dashboard/me`.
- Búsqueda global (comando K): busca clientes, oportunidades, empleados, contratos por nombre.
- Campana de notificaciones con contador no leído.
- Avatar (iniciales) con dropdown: ver perfil, cambiar contraseña, logout.

### Sidebar (colapsable)

Items visibles dependen de la **función**. Los permisos de acción dependen del rol.

Estructura base del sidebar (orden):
- **Inicio** (`/dashboard/me`)
- **Comercial**
  - Clientes
  - Oportunidades
  - Cotizaciones
- **Delivery**
  - Contratos
  - Solicitudes de Recurso
  - Asignaciones
- **Gente**
  - Empleados
  - Áreas (admin+)
  - Skills (admin+)
  - Squads (admin+)
  - Usuarios (admin+)
- **Time Tracking**
  - Mis horas (`/time/me`)
  - Horas del equipo (`/time/team`, lead+)
- **Reportes** (`/reports`)
- **Configuración** (admin+)
  - Parámetros
  - Wiki / Metodología

**Visibilidad por función (default):**

| Función | Items visibles |
|---|---|
| Comercial | Inicio, Clientes, Oportunidades, Cotizaciones, Contratos (leer), Reportes |
| Preventa | Inicio, Oportunidades, Cotizaciones, Clientes, Reportes |
| Capacity Manager | Inicio, Empleados, Asignaciones, Contratos, Solicitudes, Reportes |
| Delivery Manager | Inicio, Contratos, Solicitudes, Asignaciones, Empleados, Time, Reportes |
| Project Manager | Inicio, Contrato propio, Solicitudes (leer), Time team |
| FTE Técnico | Inicio, Mis horas |
| People | Inicio, Empleados, Areas, Skills, Reportes |
| Finance | Inicio, Reportes (limitados) |
| PMO | Inicio, Contratos, Reportes |
| Admin | Todo |

Items fuera de la función del usuario no aparecen en sidebar pero son accesibles vía URL si el rol permite (para navegación cruzada).

### Breadcrumb
Siempre visible debajo del header. Ej: `Clientes > Acme Corp > Oportunidad #123 > Cotización v2`.

### Footer
Pequeño, sticky bottom-right:
`v2.0.x · build <gitsha>` · link a wiki · link a reportes.

---

## Dashboards

Landing post-login según función. Estructura común: grid 12-col con widgets (cada widget = card con título, data, acción).

### `/dashboard/me` — universal base
- **Mis asignaciones** (lista con contrato, cliente, fechas, h/sem).
- **Mis horas esta semana** (suma, % cumplimiento) con botón `Registrar horas`.
- **Mi squad** (link, breve info).
- **Mis notificaciones** (top 5).

### `/dashboard/commercial`
- Mis oportunidades por status (kanban compacto).
- Mis cotizaciones recientes.
- Pipeline squad (valor y conteo).
- Win rate personal (mes, trimestre).
- Clientes top (por pipeline).

### `/dashboard/presales`
- Cotizaciones en draft.
- Cotizaciones enviadas esperando respuesta.
- Top oportunidades por squad.
- Tiempo medio de elaboración de cotización.

### `/dashboard/capacity`
- Heatmap utilización squad.
- Top 10 empleados bench.
- Top 10 overbooking.
- Solicitudes abiertas en mi ámbito.
- Empleados con nueva skill agregada esta semana.

### `/dashboard/delivery`
- Contratos activos (lista con coverage %).
- Solicitudes pendientes de cubrir (priorizado por start_date).
- Alertas (cobertura baja, horas no cargadas).
- Horas cargadas esta semana por contrato.

### `/dashboard/people`
- Necesidades de contratación (top 10 perfiles faltantes).
- Empleados en on_leave próximos a volver.
- Nuevas incorporaciones último mes.
- Skills más demandadas en solicitudes abiertas.

### `/dashboard/pmo`
- Contratos activos.
- Riesgos abiertos (sin cobertura, horas bajas).
- Horas totales cargadas (org).

### `/dashboard/general` (Finance, Admin)
- Pipeline total.
- Contratos activos (conteo).
- Empleados activos (conteo).
- Utilización promedio.
- Horas cargadas total mes.

Cada widget tiene link a reporte correspondiente.

---

## Pantallas principales

### Lista estándar (patrón)
```
Breadcrumb
Título         [+ Nuevo] [Filtros ▼] [Exportar] [Vista: Tabla|Kanban|Cards]
┌─────────────────────────────────────────┐
│ Búsqueda                                │
│ Filtros activos (chips)                 │
│                                         │
│ [Tabla]                                 │
│                                         │
│ Paginación                              │
└─────────────────────────────────────────┘
```

### Ficha estándar (patrón)
```
Breadcrumb
Título + Status badge             [Botón primario] [⋮]
Meta: key1 · key2 · key3

[Tab 1] [Tab 2] [Tab 3] [Actividad]

── contenido del tab ──

Tarjetas destacadas (si aplica)
```

### Editor de cotización
Mantener V1 con los cambios descritos en `04_modules/01_cotizador.md`.

### Calendario time tracking (detallado en módulo 05)
Layout matriz semanal con inputs; panel lateral para descripciones.

---

## Componentes reutilizables

- `<DataTable>`: tabla con sort, pagination, filtros URL-sync.
- `<FilterBar>`: chips de filtros con dropdowns.
- `<StatusBadge>`: badge coloreado por status (tipado por entidad).
- `<UserAvatar>`: iniciales + color hash.
- `<EmployeeChip>`: avatar + nombre + área.
- `<ClientChip>` / `<OpportunityChip>` / `<ContractChip>`: tags navegables.
- `<UtilizationBar>`: barra % con color según umbrales.
- `<EventTimeline>`: lista de eventos con fecha relativa, actor, acción, detalle expandible.
- `<DateRangePicker>`: selector de rango con presets (esta semana, este mes, últimos 30d, custom).
- `<MultiSelect>`: combobox multiselect con búsqueda.
- `<ConfirmModal>`: modal de confirmación con razón opcional.
- `<NotificationBell>`: campana con dropdown de notificaciones.
- `<CopyLinkButton>`: copia URL actual al clipboard.
- `<ExportButton>`: dropdown CSV / XLSX.
- `<Breadcrumb>`: navegación jerárquica.
- `<TabsBar>`: tabs con URL hash.
- `<EmptyState>`: mensaje + CTA cuando no hay data.

---

## Búsqueda global (command-K)

- Atajo `Cmd/Ctrl + K` abre modal de búsqueda.
- Búsqueda server-side sobre: clientes (name, legal_name), oportunidades (name), empleados (first_name, last_name, corporate_email), contratos (name), cotizaciones (project_name).
- Resultados agrupados por tipo con iconos.
- Navegación con flechas + Enter.
- Debounce 250 ms.
- Endpoint: `GET /api/search?q=...`.

---

## Notificaciones

Lista in-app (campana header):
- Items con icono por tipo, mensaje, fecha relativa, link a entidad.
- Read/unread state.
- Acción "Marcar todo como leído".
- Infinite scroll.

Tipos:
- `assignment.created` → "Te asignaron a {contrato}"
- `opportunity.owner_changed` → "Ahora eres owner de {oportunidad}"
- `time.reminder` → "Llena tus horas de la semana"
- `contract.on_hold` → "{contrato} fue pausado"
- `opportunity.won` → "¡Ganamos {oportunidad}!"
- `request.uncovered_soon` → "Solicitud sin cubrir inicia en 7 días"
- (lista completa por módulo en specs correspondientes)

---

## Estados vacíos

Siempre con icono + mensaje + CTA.
Ej: en `/employees` sin empleados: "No hay empleados aún. [+ Nuevo Empleado] o importa desde CSV."

---

## Accesibilidad

- Contraste WCAG AA.
- Navegación por teclado (Tab, Shift+Tab, Enter, Esc consistentes).
- Labels asociados a inputs.
- Roles ARIA en componentes custom.
- Skip to main content link al inicio.

---

## Responsive

- Breakpoints:
  - Mobile: <640 px (vista limitada; sidebar se convierte en drawer; tablas se vuelven cards apiladas).
  - Tablet: 640–1024 px (sidebar colapsado por default).
  - Desktop: >1024 px (sidebar expandido).

- Prioridad V2: desktop-first. Mobile usable para time tracking y lectura, no para edición de cotizaciones/contratos.

---

## Tema

- **Light por default.** (Dark mode: reservado para futuro.)
- Paleta DVPNYX existente. Confirmar con Daniel si evoluciona el branding.
- Tipografía: system fonts o Inter (ligera).

---

## Internacionalización

- **Solo español en V2.** Strings en archivos `locales/es.js`. Preparados para i18n pero sin traducciones.

---

## Performance

- Code splitting por ruta (React.lazy).
- Prefetch de rutas frecuentes.
- Lista virtualizada (react-window) en tablas con >500 filas esperadas.
- Debounce en búsquedas (300 ms default).
- Imágenes y avatares lazy loaded.

---

## Tests

- Componentes principales con React Testing Library.
- Flujos críticos E2E con Playwright (smoke test):
  - Login + cambio contraseña.
  - Crear cliente → oportunidad → cotización → contrato → solicitud → asignación → time entry.
  - Marcar cotización ganadora.
  - Ver reporte de utilización.

---

## Handoff a Claude Code

Ordenar el trabajo de front por módulos (no por layer):
1. Shell (header, sidebar, layout, navegación).
2. Módulo Clientes.
3. Módulo Oportunidades.
4. Evolución cotizador.
5. Módulo Empleados + Áreas + Skills.
6. Módulo Contratos + Solicitudes + Asignaciones.
7. Módulo Time Tracking.
8. Reportes.
9. Dashboards.

Cada módulo incluye: rutas + pantallas + hooks de data + tests.
