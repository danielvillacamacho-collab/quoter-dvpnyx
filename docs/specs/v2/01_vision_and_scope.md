# 01 — Visión y Alcance de V2

## Visión

Convertir el cotizador actual en un **sistema operativo ligero de DVPNYX** que cubra el ciclo: cotizar → ganar → planear demanda → asignar gente → registrar horas → ver utilización y necesidades de contratación. Todo en una sola aplicación, sin tarifas ni costos por ahora.

## Por qué ahora

Hoy el ciclo vive en cuatro herramientas (Cotizador + Excel + runn.io + Clockify). Cada una tiene su data, su login, su criterio. La fricción de moverse entre ellas y la imposibilidad de cruzar datos hace que no podamos responder preguntas básicas: ¿qué tan utilizada está nuestra gente?, ¿qué perfiles nos faltan?, ¿qué cotizamos vs qué entregamos?

V2 no busca reemplazar feature por feature lo que hace cada herramienta — busca capturar el 20% que DVPNYX usa de cada una y unificarlo.

## Audiencias

**Comercial y Preventa.** Siguen siendo los usuarios primarios del cotizador. Ganan trazabilidad por cliente y oportunidad.

**Capacity Manager y Delivery Manager.** Nuevos usuarios. Gestionan asignaciones, ven utilización del portafolio.

**People.** Nuevo usuario en modo lectura. Ve necesidades de contratación, perfil de empleados, capacidad agregada por área.

**FTE (Project Manager y técnicos).** Nuevos usuarios. Registran sus horas. Ven sus asignaciones.

**Heads, COO y CEO.** Lectura de reportes ejecutivos. Visión de portafolio.

## Alcance — IN

### Cotizador (pulido)
- Cálculo canónico en servidor
- Linkage a Cliente y Oportunidad
- Snapshot de parámetros al pasar a `sent` o `approved`
- Historial básico de cambios visible
- Mejoras de navegación y UX

### Clientes y Oportunidades
- CRUD de Cliente
- CRUD de Oportunidad con outcome (won/lost/cancelled)
- Cotizaciones cuelgan de oportunidades

### Empleados, Áreas y Skills
- CRUD de Empleado con perfil, área, nivel, país, idioma, capacidad semanal
- Catálogo de Skills (tags)
- Asignación de skills al empleado con nivel de proficiencia
- Catálogo de Áreas (Desarrollo, Infra, Testing, etc.)

### Contratos, Solicitudes de Recurso y Asignaciones
- CRUD de Contrato (nace de oportunidad ganada o se crea manual)
- CRUD de Solicitud de Recurso dentro de un contrato (perfil deseado, fechas, horas/semana)
- Asignación de Empleados a Solicitudes con porcentaje de dedicación
- Estado de fulfillment de cada solicitud

### Registro de Horas (Time Tracking)
- Entrada retroactiva por día y por asignación
- Vista semanal y mensual del propio empleado
- Vista de equipo para CMs/DMs
- Sin flujo de aprobación en V2 (campos reservados en BD)

### Reportes
- Utilización por empleado, área, squad
- Bench (gente sin asignación o subutilizada)
- Necesidades de contratación (solicitudes sin cubrir agregadas)
- Compliance de time tracking
- Burn de horas por contrato (planeado vs registrado)
- Vista de contrato con todos sus recursos

### Roles y Permisos
- Modelo de 5 roles + función opcional (ver `02_glossary_and_roles.md`)
- Squads como entidad simple

### Infraestructura mínima
- Tabla `events` estructurada (reemplazo evolutivo del audit_log)
- Notificaciones in-app básicas (bandeja)
- Indicador de versión visible en UI
- Backup script documentado para Postgres

## Alcance — OUT (explícitamente fuera de V2)

- Costos de empleados (`company_monthly_cost`, `hourly_cost`) — schema reservado, sin lógica
- Cálculo de bonos (FPP, TMP, ACP, bloques)
- Scope governance (flujo de aprobación de change requests)
- KPIs ejecutivos avanzados (CPI, SPI, EAC, churn calculado)
- Dashboards con widgets configurables
- Comentarios y menciones (etapa 3 futura)
- Diff visual entre versiones de cotización
- Export a PDF profesional (placeholder sigue)
- 2FA
- Token de primer acceso por correo (sigue 000000)
- Templates de cotización
- Integración Giitic, Slack, Google Chat, nómina
- Portal cliente
- IA, embeddings, sugerencias automáticas
- Integración API con Clockify o runn.io
- Reportes financieros (no hay costos)
- Multi-currency
- Mobile app nativa (responsive web sí, app no)

## Criterios de éxito de V2

V2 se considera entregada cuando:

1. Las historias de `09_user_stories_backlog.md` marcadas como **MUST** están completadas y sus criterios de aceptación cumplidos.
2. La migración de `08_migration_plan.md` corre sin pérdida de datos.
3. Los tests unitarios y de integración pasan en CI.
4. El sistema es desplegable con el pipeline existente (`deploy.yml`).
5. Un usuario nuevo puede: crear cliente → crear oportunidad → cotizar → ganar → crear contrato → solicitar recursos → asignar empleados → empleados registran horas → ver utilización en reporte. Todo sin salir del sistema.

## Riesgos identificados y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Scope creep en construcción | Si no está en spec, no se construye. Se reporta al final. |
| Romper V1 | Migración explícita, tests sobre rutas existentes antes de mergear. |
| Performance con joins anchos en reportes | Indexar las FKs y campos de filtro frecuente. Reportes paginados. |
| Confusión entre Quotation y Contract | Glosario explícito; UI con badges de tipo distintos. |
| Empleados sin user account | Permitido. `employees.user_id` es nullable. |
