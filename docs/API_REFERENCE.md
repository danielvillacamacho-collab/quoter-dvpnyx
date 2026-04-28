# API Reference — DVPNYX Quoter

Catálogo de endpoints REST. Esta referencia se mantiene a mano. Si agregas o cambias un endpoint, **debes** actualizar este archivo en el mismo PR.

**Base URL:** `/api`

**Auth:** todos los endpoints requieren `Authorization: Bearer <jwt>` salvo los marcados `🌐 público`.

**Paginación estándar:** los endpoints de listado aceptan `?page=&limit=` (defaults `1, 25`, max `100` salvo time_entries `500` y quotations `200`). Respuesta:

```json
{
  "data": [ ... ],
  "pagination": { "page": 1, "limit": 25, "total": 87, "pages": 4 }
}
```

**Filtros:** descritos por endpoint.

**Errores:**
- `400` — input inválido (mensaje accionable en `error`)
- `401` — sin token / token expirado
- `403` — rol insuficiente
- `404` — entidad no encontrada
- `409` — conflicto (duplicado, FK, transición ilegal, override requerido)
- `500` — error interno (logueado server-side con identificador)

---

## Índice

1. [Auth + Users](#auth--users)
2. [Clients](#clients-1)
3. [Opportunities](#opportunities-1)
4. [Quotations](#quotations-1)
5. [Contracts](#contracts-1)
6. [Resource Requests](#resource-requests-1)
7. [Assignments](#assignments-1)
8. [Capacity Planner](#capacity-planner-1)
9. [Time Entries (`/time/me`)](#time-entries)
10. [Time Allocations (`/time/team`)](#time-allocations)
11. [Employees + Skills](#employees--skills)
12. [Areas](#areas)
13. [Skills](#skills-1)
14. [Reports](#reports)
15. [Dashboard](#dashboard)
16. [Revenue + Exchange Rates](#revenue--exchange-rates)
17. [Notifications](#notifications-1)
18. [Bulk Import](#bulk-import-1)
19. [Search](#search)
20. [Parameters](#parameters-1)
21. [AI Interactions](#ai-interactions-1)
22. [Health](#health-1)

---

## Auth + Users

### `POST /api/auth/login` 🌐 público
Body: `{ email, password }`. Devuelve `{ token, user }`.
Rate-limited.

### `POST /api/auth/change-password`
Body: `{ current_password?, new_password }` (≥ 8 chars).

### `GET /api/auth/me`
Devuelve usuario actual + `preferences`.

### `PUT /api/auth/me/preferences`
Body PATCH del JSONB. Allowlist: `scheme`, `accentHue`, `density`. Validar con `SCHEMAS.userPreferences`.

### `GET /api/users` 🔒 admin
Listado paginado.

### `POST /api/users` 🔒 admin
Crear usuario. Roles asignables: `admin | lead | member | viewer`.

### `PUT /api/users/:id` 🔒 admin
Update parcial. Cambio de role validado.

### `POST /api/users/:id/reset-password` 🔒 admin
Marca `must_change_password=true` y setea password aleatorio (devuelve la contraseña).

### `DELETE /api/users/:id` 🔒 admin
Soft delete.

---

## Clients

### `GET /api/clients`
Filtros: `search`, `country`, `industry`, `tier`, `active`.

### `GET /api/clients/:id`

### `POST /api/clients` 🔒 admin
Body: `{ name*, legal_name?, country?, industry?, tier?, ... }`.

### `PUT /api/clients/:id` 🔒 admin

### `POST /api/clients/:id/activate` 🔒 admin
### `POST /api/clients/:id/deactivate` 🔒 admin
### `DELETE /api/clients/:id` 🔒 admin
Soft delete. 409 si tiene opps/contracts vivos.

---

## Opportunities

### `GET /api/opportunities`
Filtros: `search`, `client_id`, `status`, `owner_id`, `squad_id`, `from_expected_close`, `to_expected_close`.

### `GET /api/opportunities/kanban`
Devuelve agrupado por stage con summaries (count, total USD, weighted USD). Filtros igual que listado + `min_amount_usd`. Cap por columna 100.

### `GET /api/opportunities/:id`

### `POST /api/opportunities`
### `PUT /api/opportunities/:id`

### `POST /api/opportunities/:id/status`
Body: `{ new_status, winning_quotation_id?, outcome_reason?, outcome_notes? }`.
- `won` requiere `winning_quotation_id`.
- `lost` / `cancelled` requieren `outcome_reason`.

### `DELETE /api/opportunities/:id` 🔒 admin
Hard delete bloqueado si tiene quotations.

---

## Quotations

### `GET /api/quotations`
Pagination opt-in: con `?page=` o `?paginate=true` devuelve envelope, sin → array crudo (legacy).
Filtros: `client_id`, `opportunity_id`, `status`. **Preventa** ve sólo sus drafts.

### `GET /api/quotations/:id`
Devuelve quotation + lines + phases + epics + milestones.

### `POST /api/quotations`
Body con type, lines, phases, etc.

### `PUT /api/quotations/:id`

### `POST /api/quotations/:id/duplicate`
Crea v2 con lines/phases copiadas.

### `POST /api/quotations/:id/export`
Body: `{ format: 'xlsx' | 'pdf' }`. Devuelve binario.

### `DELETE /api/quotations/:id`

---

## Contracts

### `GET /api/contracts`
Filtros: `search`, `client_id`, `status`, `type`, `squad_id`. Status alias `draft→planned`, `on_hold→paused`.

### `GET /api/contracts/export.csv`

### `GET /api/contracts/:id`
Devuelve contract + nombres de owner/DM/CM (joins) + counts de requests/assignments.

### `POST /api/contracts` 🔒 admin
Body: `{ name*, client_id*, type*, start_date*, end_date?, opportunity_id?, winning_quotation_id?, ... }`. Squad auto-resuelto.

### `POST /api/contracts/from-quotation/:quotation_id` 🔒 admin
Crea contrato desde quotation con defaults sensatos. Body opcional override.
- `staff_aug → capacity`, `fixed_scope → project`.
- 400 con `code:'no_client_link'` si la quotation no tiene cliente.

### `POST /api/contracts/:id/kick-off` 🔒 admin / DM / owner / cap-manager
Body: `{ kick_off_date* }`. Lee winning_quotation y crea resource_requests.
- 409 con `code:'already_seeded'` si ya tiene RRs (usar `?force=1` para resembrar).
- 400 si no hay winning_quotation o si quotation está vacía.
- Persiste `metadata.kick_off_date` y emite `contract.kicked_off`.

### `PUT /api/contracts/:id` 🔒 admin

### `POST /api/contracts/:id/status` 🔒 admin
Body: `{ new_status }`. Transiciones:
- `planned → active | cancelled`
- `active → paused | completed | cancelled`
- `paused → active | completed | cancelled`
- terminales: `completed`, `cancelled`.

`completed` y `cancelled` cierran assignments y requests asociadas.

### `DELETE /api/contracts/:id` 🔒 admin
Soft delete. 409 si tiene assignments activas.

---

## Resource Requests

### `GET /api/resource-requests`
Filtros: `contract_id`, `area_id`, `level`, `priority`, `status`, `search`. Status `effective` calculado por código.

### `GET /api/resource-requests/:id`

### `GET /api/resource-requests/:id/candidates`
Query: `area_only=true|false`. Devuelve top 25 candidatos rankeados con `candidate_matcher.js`.

### `POST /api/resource-requests` 🔒 admin
Body: `{ contract_id*, role_title*, area_id*, level*, start_date*, country?, weekly_hours?, end_date?, quantity?, priority?, required_skills?, nice_to_have_skills? }`.

### `PUT /api/resource-requests/:id` 🔒 admin

### `POST /api/resource-requests/:id/cancel` 🔒 admin
Cierra el request y todas sus assignments activas (transition).

### `DELETE /api/resource-requests/:id` 🔒 admin
Soft delete. 409 si tiene assignments activas.

---

## Assignments

### `GET /api/assignments`
Filtros: `employee_id`, `contract_id`, `resource_request_id`, `status`.

### `GET /api/assignments/export.csv`

### `GET /api/assignments/validate`
Query: `employee_id*, request_id*, weekly_hours?, start_date?, end_date?, ignore_assignment_id?`.
Devuelve `{ valid, can_override, requires_justification, checks: [...], summary, context }`. Dry-run.

### `GET /api/assignments/:id`

### `POST /api/assignments` 🔒 admin
Body: `{ resource_request_id*, employee_id*, contract_id*, weekly_hours*, start_date*, end_date?, role_title?, force?, override_reason? }`.
- 409 con `code:'overbooking'` si supera capacidad × 1.10. Re-enviar con `force:true` + `override_reason` ≥ 10 chars.
- 400 si validation hard-fails (área incompatible, level fuera de rango).

### `PUT /api/assignments/:id` 🔒 admin
Body: `{ weekly_hours?, start_date?, end_date?, role_title?, notes?, force?, override_reason? }`.

### `POST /api/assignments/:id/status` 🔒 admin
Body: `{ new_status }`. Transiciones: `planned → active → ended`, `* → cancelled`.

### `DELETE /api/assignments/:id` 🔒 admin
Hard delete si no hay time_entries; soft + status='cancelled' si las hay.

---

## Capacity Planner

### `GET /api/capacity/planner`
Query: `start (YYYY-MM-DD)`, `weeks (default 8)`, `contract_id?`, `area_id?`, `level_min?`, `level_max?`, `search?`. Devuelve estructura para timeline + métricas globales.

---

## Time Entries

### `GET /api/time-entries`
Filtros: `employee_id`, `assignment_id`, `status`, `from`, `to`. Non-admin sin employee_id se scope a sí mismo automáticamente.

### `POST /api/time-entries`
Body: `{ employee_id, assignment_id, work_date, hours, description? }`.

### `PUT /api/time-entries/:id`

### `POST /api/time-entries/:id/status`
Body: `{ new_status, rejection_reason? }`. `rejected` requiere reason.

### `POST /api/time-entries/copy-week`
Body: `{ employee_id, source_week_start, target_week_start }`.

### `DELETE /api/time-entries/:id`

---

## Time Allocations

### `GET /api/time-allocations?week_start=YYYY-MM-DD[&employee_id=X]`
- Member: scope a sí mismo. Si no tiene `employees` row → 404.
- Lead/admin sin employees row → 200 con `requires_employee_pick: true` + `available_employees` (lead: sus reportes; admin: todos).
- Lead con employee_id de otro: sólo si es su reporte directo.

Devuelve `{ week_start_date, week_end_date, employee, active_assignments, allocations, summary: { total_pct, bench_pct } }`.

### `PUT /api/time-allocations/bulk`
Body: `{ week_start_date*, employee_id?, allocations: [{ assignment_id*, pct*, notes? }] }`.
- Atómico: borra previas + reinserta.
- 400 con `code:'pct_sum_exceeds_100'` si suma > 100.
- Warning soft `code:'bench'` si suma < 100.

---

## Employees + Skills

### `GET /api/employees`
Filtros: `search`, `area_id`, `level`, `status`, `squad_id`, `country`.

### `GET /api/employees/:id`
Devuelve employee + counts.

### `POST /api/employees` 🔒 admin
Body: `{ first_name*, last_name*, country*, area_id*, level*, start_date*, ... }`.

### `PUT /api/employees/:id` 🔒 admin
Soporta `manager_user_id` para asignar líder directo.

### `POST /api/employees/:id/status` 🔒 admin
Transiciones: `active ↔ on_leave ↔ bench → terminated`.

### `DELETE /api/employees/:id` 🔒 admin
Soft delete. 409 si tiene assignments activas.

### `GET /api/employees/:id/skills`
### `POST /api/employees/:id/skills` 🔒 admin
Body: `{ skill_id, proficiency, years_experience?, notes? }`.

### `PUT /api/employees/:id/skills/:skillId` 🔒 admin
### `DELETE /api/employees/:id/skills/:skillId` 🔒 admin

---

## Areas

### `GET /api/areas`
Devuelve catalogo. Query: `?include_inactive=true`.

### `GET /api/areas/:id`
### `POST /api/areas` 🔒 admin
### `PUT /api/areas/:id` 🔒 admin
### `POST /api/areas/:id/activate` 🔒 admin
### `POST /api/areas/:id/deactivate` 🔒 admin
409 si hay employees activos.

---

## Skills

### `GET /api/skills`
Filtros: `category`, `active`, `search`.

### `GET /api/skills/:id`
### `POST /api/skills` 🔒 admin
### `PUT /api/skills/:id` 🔒 admin
### `POST /api/skills/:id/activate` 🔒 admin
### `POST /api/skills/:id/deactivate` 🔒 admin
409 si hay assignments en empleados.

---

## Reports

Todos requieren auth. Algunos hacen scoping automático por rol.

### `GET /api/reports/utilization`
Filtros: `area_id?`. Devuelve utilización por empleado.

### `GET /api/reports/bench`
Query: `threshold` (default 0.30). Empleados bajo el umbral.

### `GET /api/reports/pending-requests`

### `GET /api/reports/hiring-needs`
Aggregate por (area, level, country) de slots abiertos.

### `GET /api/reports/coverage`
Cobertura de horas asignadas vs requeridas por contrato.

### `GET /api/reports/time-compliance`
Query: `from?`, `to?` (default últimos 28 días).

### `GET /api/reports/plan-vs-real` 🔍 scoped
Query: `week_start? (YYYY-MM-DD)`, `employee_id?`, `manager_id?`.
**Auto-scoping:** lead → forzado a `manager_user_id = caller`; member → forzado a su employee.
Devuelve filas por empleado con líneas por (asignación) y status (`on_plan | over | under | missing | unplanned | no_data`) con tolerancia ±10pp.

### `GET /api/reports/my-dashboard`
Rollup minimal del usuario actual (su employee + active assignments + week hours).

---

## Dashboard

### `GET /api/dashboard/overview`
Rollup ejecutivo (KPIs).

---

## Revenue + Exchange Rates

### `GET /api/revenue/:contract_id/plan`
Devuelve revenue_periods del contrato.

### `PUT /api/revenue/:contract_id/plan`
Body: `{ entries: [{ yyyymm, projected_usd?, projected_pct?, notes? }] }`.

### `PUT /api/revenue/:contract_id/:yyyymm`
Body: `{ projected_usd?, projected_pct?, real_usd?, real_pct?, notes? }`.

### `POST /api/revenue/:contract_id/:yyyymm/close` 🔒 admin
Cierra el período. Marca `status='closed'` + `closed_at/by`.

### `GET /api/admin/exchange-rates`
Query: `from`, `to`, `currency?`.

### `PUT /api/admin/exchange-rates/:yyyymm/:currency` 🔒 admin
Body: `{ usd_rate, notes? }`.

### `DELETE /api/admin/exchange-rates/:yyyymm/:currency` 🔒 admin

---

## Notifications

### `GET /api/notifications`
Filtros: `?unread_only=true&limit=`.

### `GET /api/notifications/unread-count`

### `POST /api/notifications/:id/read`
### `POST /api/notifications/read-all`

---

## Bulk Import

### `GET /api/bulk-import/entities`
Devuelve catálogo de entidades soportadas + templates.

### `GET /api/bulk-import/templates/:entity`
Devuelve CSV template. Validación de `entity` contra whitelist.

### `POST /api/bulk-import/:entity/preview`
Body: `{ rows: [...] }`. Dry-run, devuelve resultado sin escribir.

### `POST /api/bulk-import/:entity/commit`
Body: `{ rows: [...] }`. Aplica.

Limit: 5000 rows por request.

---

## Search

### `GET /api/search?q=...`
Search global cross-entity (clients, opportunities, contracts, employees) usado por el Command Palette.

---

## Parameters

### `GET /api/parameters`
Devuelve agrupado por category.

### `PUT /api/parameters/:id` 🔒 admin
Body: `{ value?, label?, note? }`. Emite `parameter.updated` con before/after.

---

## AI Interactions

### `GET /api/ai-interactions` 🔒 admin
Filtros: `agent_name`, `prompt_template`, `user_id`, `entity_type`, `entity_id`, `human_decision` (incluyendo `pending`), `from`, `to`.

### `GET /api/ai-interactions/:id` 🔒 admin
Detalle con payloads completos.

### `POST /api/ai-interactions/:id/decision`
Body: `{ decision: 'accepted'|'rejected'|'modified'|'ignored', feedback? }`. Owner del registro O admin.
- 409 con `code:'already_decided'` si ya tiene decisión.

---

## Health

### `GET /api/health` 🌐 público
Devuelve `{ ok, version, git_sha, db: 'up'|'down' }`. Loguea warning si la DB probe falla.

---

## Eventos emitidos

Cada mutation relevante emite a `events` table con `event_type`. Los más comunes:

- `*.created`, `*.updated`, `*.deleted`, `*.status_changed`
- `assignment.overbooked`, `assignment.override`
- `contract.kicked_off`, `contract.created_from_quotation`, `contract.completed`, `contract.cancelled`
- `opportunity.won`, `opportunity.lost`, `opportunity.cancelled`, `opportunity.stage_changed`
- `quotation.duplicated`, `quotation.exported`
- `parameter.updated`
- `employee.status_changed`, `employee.leave_started`, `employee.leave_ended`
- `area.created/updated/activated/deactivated`
- `skill.created/updated/activated/deactivated`

Inspeccionar via SQL (no hay UI todavía):

```sql
SELECT created_at, event_type, entity_type, entity_id, payload
  FROM events
 WHERE created_at > NOW() - INTERVAL '24 hours'
 ORDER BY created_at DESC LIMIT 100;
```

---

*Si agregás un endpoint, **debes** agregarlo aquí en el mismo PR. Si esto no se mantiene actualizado, deja de tener valor en 3 meses.*
