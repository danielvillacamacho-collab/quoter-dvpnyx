# DVPNYX Platform v2 — Especificación de Desarrollo

**Versión:** 2.0 · **Fecha:** Abril 2026 · **Modo:** Spec-Driven Development

Este paquete contiene la especificación completa de la versión 2 de la plataforma DVPNYX. Está pensada para ser ejecutada por Claude Code en un único ciclo de construcción agentic.

---

## Cómo leer esta documentación

Los documentos se leen en orden. Cada uno depende de los anteriores y profundiza en un aspecto específico del sistema.

| # | Documento | Propósito |
|---|-----------|-----------|
| 00 | README.md | Este archivo. Índice y principios. |
| 01 | vision_and_scope.md | Qué construimos y qué NO. |
| 02 | glossary_and_roles.md | Vocabulario y modelo de roles/funciones/squads. |
| 03 | data_model.md | Tablas, columnas, relaciones, DDL completo. |
| 04 | modules/01_cotizador.md | Pulido del cotizador actual. |
| 04 | modules/02_clients_opportunities.md | Cliente y Oportunidad como entidades. |
| 04 | modules/03_employees_and_skills.md | Inventario de empleados, áreas, skills. |
| 04 | modules/04_contracts_requests_assignments.md | Contratos, solicitudes, asignaciones. |
| 04 | modules/05_time_tracking.md | Registro retroactivo de horas. |
| 04 | modules/06_reports.md | Catálogo de reportes. |
| 05 | api_spec.md | Endpoints REST. |
| 06 | frontend_ux.md | Navegación, layout, pantallas clave. |
| 07 | nonfunctional_requirements.md | Seguridad, performance, observabilidad. |
| 08 | migration_plan.md | Migración desde V1 actual. |
| 09 | user_stories_backlog.md | Historias de usuario priorizadas con criterios de aceptación. |
| 10 | operations_runbook.md | Despliegue, backup/restore, troubleshooting, monitoreo. |

---

## Principios guía

**Spec-driven.** Nada se construye sin estar especificado aquí. Si encuentras una ambigüedad, déjala marcada como `// SPEC GAP:` en el código y reporta al final.

**Simplicity-first.** Robustez suficiente, mínima complejidad. No agregar features que no estén en la spec aunque parezcan obvias.

**Sin tarifas en V2.** Esta versión NO calcula ni almacena costos de empleados. El modelo de datos reserva los campos `company_monthly_cost` y `hourly_cost` en empleados (NULL por ahora) para activarlos en una versión futura sin migrar datos.

**No rompemos V1.** El cotizador actual sigue funcionando. V2 lo evoluciona sin obligar a re-cotizar nada.

**Soft delete por defecto.** Toda entidad principal tiene `deleted_at TIMESTAMPTZ NULL`. No se hacen DELETE físicos.

**Snapshot de cálculos al persistir.** Cuando una cotización pasa a `sent` o `approved`, se congela el snapshot de los parámetros usados.

**Server como fuente de verdad.** El cliente puede recalcular en vivo para UX, pero el servidor recalcula y persiste. Nunca confiar en valores enviados por el cliente para campos calculados.

---

## Convenciones

**IDs:** UUID v4 para todas las entidades nuevas. PostgreSQL `uuid-ossp` extension.

**Timestamps:** `TIMESTAMPTZ` (con zona horaria) para todo. Default `NOW()` en `created_at`.

**Soft delete:** `deleted_at TIMESTAMPTZ NULL`. Las queries por defecto filtran `WHERE deleted_at IS NULL`.

**Auditoría:** Toda escritura genera un registro en `events` (ver data model).

**Naming:** snake_case en BD y API, camelCase en frontend (transformación en la capa de cliente).

**Status enums:** Strings en CHECK constraints, no smallint.

**Money:** No aplica en V2 (sin tarifas), pero columnas reservadas usan `NUMERIC(14,2)`.

**Hours:** `NUMERIC(5,2)` (permite hasta 999.99 con 2 decimales).

**Percentages:** `NUMERIC(5,4)` (0.0000 a 1.0000), no entero.

---

## Stack técnico (sin cambios respecto a V1)

- **Frontend:** React 18, React Router v6
- **Backend:** Node.js 20 + Express
- **DB:** PostgreSQL 16
- **Auth:** JWT en Authorization header
- **Deploy:** Docker Compose + Traefik en EC2
- **CI/CD:** GitHub Actions (existente, no se modifica)

NO se cambia el stack en V2. No se introduce TypeScript, Vite, Next.js, ni cambios de base. Eso es discusión futura.

---

## Cómo ejecutar este spec con Claude Code

1. Leer en orden los archivos 00 → 10.
2. Construir migraciones (`server/database/migrate.js`) según `03_data_model.md`.
3. Construir endpoints según `05_api_spec.md`.
4. Construir frontend según `06_frontend_ux.md` y los specs de cada módulo.
5. Implementar las historias de usuario de `09_user_stories_backlog.md` en orden de prioridad.
6. Cumplir requisitos no funcionales de `07_nonfunctional_requirements.md`.
7. Ejecutar la migración descrita en `08_migration_plan.md` para preservar datos de V1.
8. Reportar al final: historias completadas, historias bloqueadas, decisiones tomadas en gaps de spec.

---

## Decisiones pendientes (NO bloquean el desarrollo)

- **Nombre del producto:** Hoy es "DVPNYX Cotizador". Con la expansión, candidato a renombrar a "DVPNYX Atlas" o similar. Decisión del CEO. Mientras tanto, en código y UI sigue siendo "Cotizador".
- **Nombre de dominio:** sigue siendo `quoter.doublevpartners.com`.
- **Tarifas y costos:** activación futura, ya hay hooks en el modelo.
