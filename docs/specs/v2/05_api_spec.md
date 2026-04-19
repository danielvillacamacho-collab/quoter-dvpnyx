# 05 — API Spec

Spec de la API REST de V2. Todos los endpoints son JSON, autenticados con JWT (Bearer token) salvo los de auth.

## Convenciones

- **Base path:** `/api`
- **Autenticación:** `Authorization: Bearer <jwt>` en todo request autenticado.
- **Content-Type:** `application/json` en requests con body.
- **IDs:** UUIDs (`string`) en todos los payloads.
- **Fechas:** `YYYY-MM-DD` (dates) o ISO 8601 con TZ (`2026-04-18T12:00:00Z`) para timestamps.
- **Paginación:** `?page=1&limit=25`. Respuesta incluye `{ data, pagination: { page, limit, total, pages } }`.
- **Filtros:** query params nombrados explícitos; multi-value con coma (`?status=open,partial`).
- **Ordenamiento:** `?sort=field` o `?sort=-field` (desc).
- **Errores:** HTTP status + body `{ error: { code, message, details? } }`.
- **Codes comunes:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `500 INTERNAL`.

---

## Auth

### `POST /api/auth/login`
Body: `{ email, password }`
200: `{ token, user: { id, email, name, role, function, squad_id, must_change_password } }`
401: credenciales inválidas
423: cuenta desactivada

### `POST /api/auth/change-password`
Auth requerida.
Body: `{ current_password, new_password }`
200: `{ ok: true }`
400: contraseña actual incorrecta / new demasiado débil

### `POST /api/auth/reset-password` (admin+)
Body: `{ user_id }`
200: `{ temporary_password: "000000" }`
Resetea contraseña al default y setea `must_change_password=true`.

### `GET /api/auth/me`
200: `{ user, permissions: [...capability_keys] }`

### `POST /api/auth/logout`
200: `{ ok: true }` (blacklist del token o no-op si stateless)

---

## Users

### `GET /api/users`
Query: `page, limit, search, role, function, squad_id, active, sort`
200: `{ data: User[], pagination }`

### `GET /api/users/:id`
200: `{ ...user, employee: Employee | null }`

### `POST /api/users` (admin+)
Body: `{ email, name, password?, role, function, squad_id, active }`
201: `User`

### `PUT /api/users/:id` (admin+)
Body: campos editables.
200: `User`

### `POST /api/users/:id/deactivate` (admin+) / `activate`
200: `User`

### `DELETE /api/users/:id` (superadmin)
409 si tiene cotizaciones/oportunidades/contratos/asignaciones/time entries.

### `POST /api/users/:id/change-role` (superadmin)
Body: `{ new_role }`
200: `User`

---

## Clients

### `GET /api/clients`
Query: `page, limit, search, country, industry, tier, active, sort`
200: `{ data: Client[], pagination }`

### `GET /api/clients/:id`
200: `{ ...client, opportunities_count, active_contracts_count }`

### `POST /api/clients`
Body: `{ name, legal_name?, country?, industry?, tier?, preferred_currency?, notes?, tags? }`
201: `Client`
409 si duplicate name.

### `PUT /api/clients/:id`
200: `Client`

### `DELETE /api/clients/:id` (admin+)
Soft delete.
409 si hay opps/contratos.

---

## Opportunities

### `GET /api/opportunities`
Query: `page, limit, client_id, status, owner_id, squad_id, from_expected_close, to_expected_close, search, sort`
200: `{ data: Opportunity[], pagination }`

### `GET /api/opportunities/:id`
200: `{ ...opportunity, quotations: Quotation[], client: Client }`

### `POST /api/opportunities`
Body: `{ client_id, name, description?, account_owner_id, presales_lead_id?, squad_id?, expected_close_date?, tags? }`
201: `Opportunity`

### `PUT /api/opportunities/:id`
200: `Opportunity`

### `POST /api/opportunities/:id/status`
Body: `{ new_status, winning_quotation_id?, outcome_reason?, outcome_notes? }`
Validation: transición válida; si `won` exige `winning_quotation_id`; si `lost|cancelled` exige `outcome_reason`.
200: `Opportunity`

### `DELETE /api/opportunities/:id`
Soft delete. 409 si tiene cotizaciones.

---

## Quotations (existente V1, evoluciona)

### `GET /api/quotations`
Query: `page, limit, search, status, type, client_id, opportunity_id, owner_id, squad_id, sort`
200: `{ data: Quotation[], pagination }`

### `GET /api/quotations/:id`
200: `{ ...quotation, lines, phases?, allocations?, epics?, milestones?, events_count }`

### `POST /api/quotations`
Body: `{ client_id, opportunity_id, type, project_name, validity_days?, ... }`
201: `Quotation`
400 si falta `client_id` u `opportunity_id`.
409 si `opportunity_id` y `client_id` no coinciden.

### `PUT /api/quotations/:id`
Body: inputs (no outputs).
Servidor recalcula y persiste outputs.
200: `Quotation` con outputs calculados.
Dispara `quotation.calc_drift` si difiere del cliente.

### `POST /api/quotations/:id/status`
Body: `{ new_status }`
200: `Quotation`
Si transiciona a `sent` o `approved` por primera vez: captura `parameters_snapshot`.

### `POST /api/quotations/:id/mark-winning`
Efecto: opp → won con `winning_quotation_id=:id`; cotización → approved.
200: `{ opportunity, quotation }`

### `GET /api/quotations/:id/events`
Historial filtrado de la tabla events.
200: `{ data: Event[] }`

### `DELETE /api/quotations/:id`
Soft delete (respeta reglas V1).

---

## Parameters

### `GET /api/parameters`
Query: `category`
200: `{ data: Parameter[] }`

### `PUT /api/parameters/:id` (admin+)
Body: `{ value }`
200: `Parameter`

### `POST /api/parameters` (admin+)
200: `Parameter`

---

## Areas

### `GET /api/areas` 200: lista
### `POST /api/areas` (admin+) 201
### `PUT /api/areas/:id` (admin+) 200
### `POST /api/areas/:id/deactivate` (admin+) — 409 si hay empleados activos.

---

## Skills

### `GET /api/skills`
Query: `search, category, active`
200: `{ data: Skill[] }`

### `POST /api/skills` (admin+)
Body: `{ name, category?, description?, active? }`
201: `Skill` — 409 si duplicate (case-insensitive).

### `PUT /api/skills/:id` (admin+)
200

### `POST /api/skills/:id/deactivate` (admin+)
200

---

## Employees

### `GET /api/employees`
Query: `page, limit, search, area_id, level, country, status, squad_id, skill_ids (multi), sort`
200: `{ data: Employee[], pagination }`

### `GET /api/employees/:id`
200: `{ ...employee, area, skills, current_utilization, active_assignments_count }`

### `POST /api/employees` (admin+)
Body: `{ first_name, last_name, corporate_email?, country?, area_id, level, seniority_label?, employment_type?, weekly_capacity_hours?, start_date, status?, squad_id?, manager_user_id?, user_id?, notes?, tags?, languages? }`
201: `Employee`

### `PUT /api/employees/:id` (admin+)
200: `Employee`

### `POST /api/employees/:id/status` (admin+)
Body: `{ new_status, effective_date?, reason? }`
200: `Employee`
Side effects: terminar asignaciones si `terminated`; alertar si `on_leave`.

### `DELETE /api/employees/:id` (admin+)
Soft delete. 409 con reglas descritas.

### `POST /api/employees/:id/create-user` (admin+)
Body: `{ role, function, password? }`
200: `{ user }` (vincula employees.user_id).

### `GET /api/employees/:id/skills`
200: `{ data: EmployeeSkill[] }`

### `POST /api/employees/:id/skills` (admin+)
Body: `{ skill_id, proficiency, years_experience?, notes? }`
201: `EmployeeSkill`

### `PUT /api/employees/:id/skills/:skill_id` (admin+)
200: `EmployeeSkill`

### `DELETE /api/employees/:id/skills/:skill_id` (admin+)
200: `{ ok: true }`

### `GET /api/employees/:id/assignments`
Query: `status, from_date, to_date`
200: `{ data: Assignment[] }`

### `GET /api/employees/:id/time-summary`
Query: `period=week|month, week_of=..., month_of=...`
200: `{ hours_logged, hours_expected, compliance_pct, entries_by_day: {date: hours} }`

### `POST /api/employees/bulk-import` (admin+)
Body: multipart CSV
200: `{ created: N, skipped: M, errors: [{row, reason}] }`

### `GET /api/employees/:id/candidates-for-request/:request_id`
Para compatibilidad: devuelve score de match.
200: `{ match_score, matched_skills, missing_skills, country_match, utilization }`

---

## Contracts

### `GET /api/contracts`
Query: `page, limit, search, status, type, client_id, squad_id, from_start_date, to_start_date, sort`
200: `{ data: Contract[], pagination }`

### `GET /api/contracts/:id`
200: `{ ...contract, client, resource_requests, active_assignments_count, weekly_hours_requested, weekly_hours_assigned }`

### `POST /api/contracts`
Body: `{ name, client_id, opportunity_id?, source_quotation_id?, type, start_date, end_date?, pm_user_id?, delivery_manager_id?, squad_id?, description?, notes?, tags? }`
201: `Contract`

### `PUT /api/contracts/:id`
200: `Contract`

### `POST /api/contracts/:id/status`
Body: `{ new_status, reason? }`
200: `Contract`
Side effects descritos en módulo.

### `DELETE /api/contracts/:id`
409 con reglas.

### `POST /api/contracts/:id/generate-requests-from-quotation`
Body: `{ selections: [line_idx or phase_id], override_fields? }`
201: `{ created: ResourceRequest[] }`

### `GET /api/contracts/:id/time-entries`
Query: `from_date, to_date, group_by=week|employee`
200: agregado.

---

## Resource Requests

### `GET /api/resource-requests`
Query: `page, limit, contract_id, status, area_id, level, country, from_start_date, to_start_date, sort`
200: `{ data: ResourceRequest[], pagination }`

### `GET /api/resource-requests/:id`
200: `{ ...request, contract, assignments, coverage }`

### `POST /api/contracts/:id/resource-requests`
Body: `{ profile_title, area_id, level, country_preference?, language_requirement?, required_skills?, weekly_hours, start_date, end_date?, required_count?, modality?, priority?, notes?, external_reason? }`
201: `ResourceRequest`

### `PUT /api/resource-requests/:id`
200: `ResourceRequest`

### `POST /api/resource-requests/:id/close` (admin+)
200: `ResourceRequest`

### `POST /api/resource-requests/:id/cancel`
Body: `{ reason? }`
200: `ResourceRequest`

### `GET /api/resource-requests/:id/candidates`
200: `{ data: [{ employee, match_score, utilization, missing_skills, country_match }] }`

---

## Assignments

### `GET /api/assignments`
Query: `page, limit, employee_id, contract_id, request_id, status, from_date, to_date, squad_id, sort`
200: `{ data: Assignment[], pagination }`

### `GET /api/assignments/:id`
200: `{ ...assignment, employee, request, contract, time_entries_summary }`

### `POST /api/resource-requests/:id/assignments`
Body: `{ employee_id, start_date, end_date?, weekly_hours, role_title?, notes? }`
201: `Assignment`
400/409 con validaciones descritas (overbooking con confirm flag `override_overbooking: true`).

### `PUT /api/assignments/:id`
200: `Assignment`

### `POST /api/assignments/:id/end-early`
Body: `{ end_date, reason? }`
200: `Assignment`

### `POST /api/assignments/:id/split`
Body: `{ split_date, new_weekly_hours }`
200: `{ original: Assignment, new: Assignment }`

### `POST /api/assignments/:id/cancel`
Body: `{ reason? }`
200: `Assignment`

### `DELETE /api/assignments/:id` (admin+)
409 si tiene time entries → sugerir cancel.

---

## Time Entries

### `GET /api/time-entries`
Query: `employee_id, assignment_id, contract_id, from_date, to_date, category`
200: `{ data: TimeEntry[] }`

### `POST /api/time-entries`
Body: `{ employee_id, assignment_id, entry_date, hours, description?, category?, is_billable? }`
201: `TimeEntry`
409 si ya existe entry en (employee_id, assignment_id, entry_date).

### `POST /api/time-entries/bulk`
Body: `{ entries: [...] }`
201: `{ created: TimeEntry[], errors: [{index, reason}] }`

### `POST /api/time-entries/copy-week`
Body: `{ employee_id, source_week_start, target_week_start, only_assignments? }`
201: `{ created: TimeEntry[] }`

### `PUT /api/time-entries/:id`
200: `TimeEntry`

### `DELETE /api/time-entries/:id`
200

### `GET /api/time-entries/compliance`
Query: `scope=me|team|org, period_days, squad_id?, area_id?`
200: `{ compliance_pct, hours_logged, hours_expected, by_employee?: [...] }`

---

## Reports

Todos los reportes aceptan export como `?format=csv` o `?format=xlsx`.

### `GET /api/reports/utilization`
Query: `from_date, to_date, squad_ids, area_ids, levels, country, active_only`
200: `{ data: [...], aggregates: {...} }`

### `GET /api/reports/bench`
Query: `threshold_pct, squad_id, area_id, level, country`
200: `{ data: [...], aggregates }`

### `GET /api/reports/open-requests`
Query: `status, from_start_date, to_start_date, client_id, squad_id, area_id, priority`
200: `{ data, aggregates }`

### `GET /api/reports/hiring-needs`
Query: `window_days, squad_id`
200: `{ data (groupby area+level+country), aggregates }`

### `GET /api/reports/contract-coverage`
Query: `status, client_id, squad_id`
200

### `GET /api/reports/time-compliance`
Query: `period_days, squad_id, area_id, manager_id`
200

### `GET /api/reports/hours-by-contract`
Query: `from_date, to_date, client_id, contract_id, squad_id`
200

### `GET /api/reports/pipeline`
Query: `squad_id, owner_id, from_expected_close, to_expected_close`
200

### `GET /api/reports/quotations`
Query: `status, type, from_date, to_date, client_id, owner_id, squad_id`
200

### `GET /api/reports/win-rate`
Query: `period, squad_id, owner_id, type`
200

### `GET /api/reports/skills-distribution`
Query: `area_id`
200

### `GET /api/reports/overbooking`
Query: `from_date, to_date, threshold_pct, squad_id, area_id`
200

### `GET /api/reports/data-quality`
200: `{ employees_without_skills: N, employees_without_squad: N, orphan_requests: N, ...links }`

---

## Squads

### `GET /api/squads` 200
### `POST /api/squads` (admin+) 201
### `PUT /api/squads/:id` (admin+) 200
### `POST /api/squads/:id/move-users` (admin+) — mover N usuarios a otro squad
Body: `{ user_ids: [...], new_squad_id }`
200

---

## Events

### `GET /api/events`
Query: `entity_type, entity_id, event_type, actor_user_id, from_date, to_date, page, limit`
Admin+ only.
200: `{ data: Event[], pagination }`

---

## Notifications

### `GET /api/notifications`
Del usuario autenticado.
Query: `unread_only, page, limit`
200: `{ data: Notification[], pagination, unread_count }`

### `POST /api/notifications/:id/read`
200

### `POST /api/notifications/read-all`
200

---

## Dashboard helpers

### `GET /api/dashboard/me` — datos del dashboard personal según función del usuario.
### `GET /api/dashboard/commercial|presales|capacity|delivery|people|pmo|general` — widgets por función.

Responden con estructura por widget:
```
{
  widgets: [
    { id, type, title, data, meta }
  ]
}
```

---

## Health

### `GET /api/health` — health check no autenticado. 200 `{ ok: true, version, git_sha }`

---

## Notas

- Rate limit: 100 req/min por IP para endpoints no autenticados, 600 req/min para autenticados.
- CORS: permitir dominio del frontend configurado vía env.
- Tamaño de payload: max 2 MB (ajustado a 10 MB para bulk imports).
- Idempotencia: endpoints POST críticos aceptan header `Idempotency-Key` (futuro, opcional en V2).
