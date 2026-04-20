# 03 — Modelo de Datos

Este documento es la fuente de verdad del esquema de PostgreSQL 16. Las migraciones en `server/database/migrate.js` deben implementar exactamente lo descrito aquí. Todas las tablas usan `CREATE TABLE IF NOT EXISTS` para idempotencia.

## Convenciones

- **IDs:** `UUID DEFAULT uuid_generate_v4() PRIMARY KEY`, salvo tablas de lookup muy simples donde `SERIAL` es aceptable.
- **Timestamps:** `TIMESTAMPTZ NOT NULL DEFAULT NOW()` para `created_at`. `updated_at` se actualiza por trigger o por aplicación.
- **Soft delete:** `deleted_at TIMESTAMPTZ NULL`.
- **Foreign keys:** `ON DELETE RESTRICT` por defecto. `ON DELETE CASCADE` sólo donde se explicite.
- **Unique con soft delete:** UNIQUE constraints usan índices parciales `WHERE deleted_at IS NULL` cuando aplica.
- **Extensions requeridas:** `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`

---

## Tablas existentes (V1) — evolución

### users

```sql
-- Existe. Añadir columnas:
ALTER TABLE users ADD COLUMN IF NOT EXISTS function VARCHAR(50) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS squad_id UUID NULL REFERENCES squads(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Validar role CHECK:
-- Antes: ('superadmin','admin','preventa')
-- Ahora: ('superadmin','admin','lead','member','viewer')
-- Para no perder data: migrar 'preventa' → 'member' con function='preventa'.

-- Validar function CHECK (nullable):
-- ('comercial','preventa','capacity_manager','delivery_manager',
--  'project_manager','fte_tecnico','people','finance','pmo','admin')
```

### parameters

Mantener sin cambios estructurales. Se mantienen las categorías existentes: `level, geo, bilingual, tools, stack, modality, margin, project`.

### quotations

```sql
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES clients(id);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS opportunity_id UUID NULL REFERENCES opportunities(id);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS squad_id UUID NULL REFERENCES squads(id);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD';
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS parameters_snapshot JSONB NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Post-migración data:
-- 1. Crear un client "Legacy — " por cada client_name distinto y linkar
-- 2. Crear una opportunity por cada quotation sin opp (1:1 para no perder data)
-- 3. Asignar squad_id = squad default
```

### quotation_lines, quotation_phases, quotation_epics, quotation_milestones

Mantener sin cambios estructurales. Agregar `deleted_at` a quotation_milestones.

### audit_log

Se mantiene como tabla legacy para V1. En V2 la auditoría nueva va a la tabla `events` (abajo). Se puede dejar de escribir en `audit_log` gradualmente — V2 escribe sólo en `events`.

---

## Tablas nuevas en V2

### squads

```sql
CREATE TABLE IF NOT EXISTS squads (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS squads_name_unique
  ON squads(LOWER(name)) WHERE deleted_at IS NULL;
```

### clients

```sql
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  legal_name VARCHAR(200) NULL,
  country VARCHAR(100) NULL,
  industry VARCHAR(100) NULL,
  tier VARCHAR(50) NULL CHECK (tier IN ('enterprise','mid_market','smb') OR tier IS NULL),
  preferred_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  notes TEXT NULL,
  tags TEXT[] NULL,
  external_crm_id VARCHAR(100) NULL,   -- hook Giitic
  active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS clients_name_unique
  ON clients(LOWER(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clients_country_idx ON clients(country) WHERE deleted_at IS NULL;
```

### opportunities

```sql
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  account_owner_id UUID NOT NULL REFERENCES users(id),  -- comercial dueño
  presales_lead_id UUID NULL REFERENCES users(id),       -- preventa líder
  squad_id UUID NOT NULL REFERENCES squads(id),
  status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','qualified','proposal','negotiation','won','lost','cancelled')),
  outcome VARCHAR(20) NULL
    CHECK (outcome IN ('won','lost','cancelled','abandoned') OR outcome IS NULL),
  outcome_reason VARCHAR(50) NULL
    CHECK (outcome_reason IN ('price','timing','competition','technical_fit','client_internal','other') OR outcome_reason IS NULL),
  outcome_notes TEXT NULL,
  expected_close_date DATE NULL,
  closed_at TIMESTAMPTZ NULL,
  winning_quotation_id UUID NULL REFERENCES quotations(id),
  tags TEXT[] NULL,
  external_crm_id VARCHAR(100) NULL,  -- hook Giitic
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS opportunities_client_idx ON opportunities(client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS opportunities_owner_idx ON opportunities(account_owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS opportunities_status_idx ON opportunities(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS opportunities_squad_idx ON opportunities(squad_id) WHERE deleted_at IS NULL;
```

### areas

```sql
CREATE TABLE IF NOT EXISTS areas (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) NOT NULL UNIQUE,  -- 'development', 'infra_security', etc
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed:
INSERT INTO areas (key, name, sort_order) VALUES
  ('development','Desarrollo',1),
  ('infra_security','Infra & Seguridad',2),
  ('testing','Testing',3),
  ('product_management','Product Management',4),
  ('project_management','Project Management',5),
  ('data_ai','Data & AI',6),
  ('ux_ui','UX/UI',7),
  ('functional_analysis','Análisis Funcional',8),
  ('devops_sre','DevOps/SRE',9)
ON CONFLICT (key) DO NOTHING;
```

### skills

```sql
CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NULL,  -- 'language', 'framework', 'cloud', 'tool', 'methodology', 'soft'
  description TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS skills_name_unique ON skills(LOWER(name));

-- Seed inicial (~50 skills comunes):
-- languages: JavaScript, TypeScript, Python, Java, Go, Rust, C#, Ruby, PHP, Swift, Kotlin
-- frameworks: React, Angular, Vue, Node.js, Express, NestJS, Django, Flask, Spring, Rails, Next.js
-- cloud: AWS, Azure, GCP, Kubernetes, Docker, Terraform
-- data: PostgreSQL, MySQL, MongoDB, Redis, Snowflake, Databricks, Spark, Airflow
-- ai: TensorFlow, PyTorch, LangChain, OpenAI API
-- tools: Git, Jira, Figma, Postman
-- methodology: Scrum, Kanban, SAFe, PMP, Prince2
-- soft: Leadership, Communication, Negotiation
```

### employees

```sql
CREATE TABLE IF NOT EXISTS employees (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NULL UNIQUE REFERENCES users(id),  -- un empleado puede no ser usuario del sistema
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  personal_email VARCHAR(200) NULL,
  corporate_email VARCHAR(200) NULL,
  country VARCHAR(100) NOT NULL,
  city VARCHAR(100) NULL,
  area_id INT NOT NULL REFERENCES areas(id),
  level VARCHAR(5) NOT NULL CHECK (level IN ('L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11')),
  seniority_label VARCHAR(50) NULL,  -- 'Junior','Semi Senior','Senior','Lead','Principal'
  employment_type VARCHAR(20) NOT NULL DEFAULT 'fulltime'
    CHECK (employment_type IN ('fulltime','parttime','contractor')),
  weekly_capacity_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Ejemplo: [{"language":"es","level":"native"},{"language":"en","level":"c1"}]
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','on_leave','bench','terminated')),
  squad_id UUID NULL REFERENCES squads(id),
  manager_user_id UUID NULL REFERENCES users(id),  -- CM o Head, típicamente
  notes TEXT NULL,
  tags TEXT[] NULL,
  -- HOOKS PARA COSTOS (no usar en V2, activar en versión futura):
  company_monthly_cost NUMERIC(14,2) NULL,
  hourly_cost NUMERIC(10,2) NULL,
  cost_currency VARCHAR(3) NULL DEFAULT 'USD',
  cost_updated_at TIMESTAMPTZ NULL,
  cost_updated_by UUID NULL REFERENCES users(id),
  --
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employees_area_idx ON employees(area_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_status_idx ON employees(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_level_idx ON employees(level) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_country_idx ON employees(country) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_user_idx ON employees(user_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_corporate_email_unique
  ON employees(LOWER(corporate_email)) WHERE deleted_at IS NULL AND corporate_email IS NOT NULL;
```

### employee_skills

```sql
CREATE TABLE IF NOT EXISTS employee_skills (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id),
  proficiency VARCHAR(20) NOT NULL DEFAULT 'intermediate'
    CHECK (proficiency IN ('beginner','intermediate','advanced','expert')),
  years_experience NUMERIC(4,1) NULL,
  notes VARCHAR(200) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_skill_unique
  ON employee_skills(employee_id, skill_id);
```

### contracts

```sql
CREATE TABLE IF NOT EXISTS contracts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id),
  opportunity_id UUID NULL REFERENCES opportunities(id),
  winning_quotation_id UUID NULL REFERENCES quotations(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('capacity','project','resell')),
  status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','paused','completed','cancelled')),
  start_date DATE NOT NULL,
  end_date DATE NULL,
  account_owner_id UUID NOT NULL REFERENCES users(id),
  delivery_manager_id UUID NULL REFERENCES users(id),  -- DM (para proyectos)
  capacity_manager_id UUID NULL REFERENCES users(id),  -- CM (para capacity)
  squad_id UUID NOT NULL REFERENCES squads(id),
  notes TEXT NULL,
  tags TEXT[] NULL,
  metadata JSONB NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contracts_client_idx ON contracts(client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contracts_type_idx ON contracts(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contracts_squad_idx ON contracts(squad_id) WHERE deleted_at IS NULL;
```

### resource_requests

```sql
CREATE TABLE IF NOT EXISTS resource_requests (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  role_title VARCHAR(150) NOT NULL,
  area_id INT NOT NULL REFERENCES areas(id),
  level VARCHAR(5) NOT NULL CHECK (level IN ('L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11')),
  country VARCHAR(100) NULL,                 -- país preferido, nullable si no aplica
  language_requirements JSONB NULL,          -- [{"language":"en","min_level":"b2"}]
  required_skills INT[] NULL,                 -- array de skill_id
  nice_to_have_skills INT[] NULL,             -- array de skill_id
  weekly_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  quantity INT NOT NULL DEFAULT 1,           -- cuántas personas se necesitan con este perfil
  priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','partially_filled','filled','cancelled')),
  notes TEXT NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resource_requests_contract_idx ON resource_requests(contract_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS resource_requests_status_idx ON resource_requests(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS resource_requests_area_level_idx ON resource_requests(area_id, level) WHERE deleted_at IS NULL;
```

### assignments

```sql
CREATE TABLE IF NOT EXISTS assignments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  resource_request_id UUID NOT NULL REFERENCES resource_requests(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  contract_id UUID NOT NULL REFERENCES contracts(id),  -- desnormalizado para queries rápidas
  weekly_hours NUMERIC(5,2) NOT NULL CHECK (weekly_hours > 0 AND weekly_hours <= 80),
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','ended','cancelled')),
  role_title VARCHAR(150) NULL,  -- opcional override del role title de la request
  notes TEXT NULL,
  -- APROBACIÓN (reservado para V3, no se usa en V2):
  approval_required BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ NULL,
  approved_by UUID NULL REFERENCES users(id),
  --
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assignments_employee_idx ON assignments(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assignments_contract_idx ON assignments(contract_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assignments_request_idx ON assignments(resource_request_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assignments_status_idx ON assignments(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assignments_dates_idx ON assignments(start_date, end_date) WHERE deleted_at IS NULL;
```

**Regla de negocio:** un empleado no puede tener asignaciones activas que sumen más de su `weekly_capacity_hours`. La validación se hace en aplicación (ver módulo 04).

### time_entries

```sql
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  assignment_id UUID NOT NULL REFERENCES assignments(id),
  work_date DATE NOT NULL,
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  description TEXT NULL,
  -- APROBACIÓN (reservado para V3, no se usa en V2):
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft','submitted','approved','rejected')),
  approved_at TIMESTAMPTZ NULL,
  approved_by UUID NULL REFERENCES users(id),
  rejection_reason TEXT NULL,
  --
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_entries_employee_date_idx
  ON time_entries(employee_id, work_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS time_entries_assignment_idx
  ON time_entries(assignment_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS time_entries_date_idx
  ON time_entries(work_date) WHERE deleted_at IS NULL;
```

**Regla de negocio:** la suma de `hours` para un `(employee_id, work_date)` no puede exceder 24. Validar en aplicación.

### events (event log estructurado — reemplaza audit_log progresivamente)

```sql
CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
    -- Ej: 'quotation.created', 'employee.updated', 'assignment.created', 'time_entry.submitted'
  entity_type VARCHAR(50) NOT NULL,
    -- Ej: 'quotation', 'employee', 'assignment'
  entity_id UUID NOT NULL,
  actor_user_id UUID NULL REFERENCES users(id),  -- nullable para eventos de sistema
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- before, after, cambios, metadata relevante
  ip_address INET NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_entity_idx ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS events_actor_idx ON events(actor_user_id);
CREATE INDEX IF NOT EXISTS events_type_idx ON events(event_type);
CREATE INDEX IF NOT EXISTS events_date_idx ON events(created_at);
```

**Reglas:**
- Toda mutación (create, update, delete, status change) de entidades principales escribe un evento.
- Entidades principales: quotation, opportunity, client, employee, assignment, contract, resource_request, time_entry, user.
- Para `update` el payload debe incluir `{before: {...}, after: {...}, changed_fields: [...]}`.

### notifications

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
    -- 'assignment.created', 'request.pending', 'time_entry.reminder', etc
  title VARCHAR(200) NOT NULL,
  body TEXT NULL,
  link VARCHAR(500) NULL,  -- ruta interna a la que llevar al usuario al hacer click
  entity_type VARCHAR(50) NULL,
  entity_id UUID NULL,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id) WHERE read_at IS NULL;
```

### quotation_allocations (extraer matriz del JSONB metadata)

```sql
CREATE TABLE IF NOT EXISTS quotation_allocations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_sort_order INT NOT NULL,   -- referencia al perfil en quotation_lines
  phase_id UUID NOT NULL REFERENCES quotation_phases(id) ON DELETE CASCADE,
  weekly_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS quotation_allocations_unique
  ON quotation_allocations(quotation_id, line_sort_order, phase_id);
CREATE INDEX IF NOT EXISTS quotation_allocations_quotation_idx
  ON quotation_allocations(quotation_id);
```

Durante migración: leer `quotations.metadata->'allocation'` y popular esta tabla.

---

## Restricciones de Integridad de Negocio (a validar en aplicación)

1. **Asignación sin overbooking:** para un empleado activo, la suma de `weekly_hours` de sus asignaciones activas (`status IN ('planned','active')`, fechas vigentes al día de hoy) no debe superar `weekly_capacity_hours`. Si una nueva asignación violaría esto, devolver 409 con mensaje claro.

2. **Time entry dentro de ventana retroactiva:** por default 30 días hacia atrás. Configurable vía parámetro `time_tracking.max_retroactive_days`. Rechazar entries fuera de esa ventana con 400.

3. **Time entry no futuro:** `work_date <= CURRENT_DATE`. 400 si lo viola.

4. **Time entry contra asignación válida:** la fecha del entry debe caer dentro de las fechas de la asignación. 400 si lo viola.

5. **Suma horas/día:** la suma de `hours` del mismo `(employee_id, work_date)` no puede exceder 24. 409 si lo viola.

6. **Contract sin asignaciones activas no bloquea eliminación:** pero si tiene asignaciones activas, devolver 409.

7. **Empleado con asignaciones activas no se elimina:** 409 sugerir cambiar status a `terminated`.

8. **Oportunidad ganada requiere winning_quotation_id:** al marcar `outcome='won'`, se debe especificar cuál cotización ganó. 400 si no se pasa.

9. **Winning quotation pertenece a la oportunidad:** validar que `winning_quotation_id` apunte a una cotización cuyo `opportunity_id` sea el de la oportunidad.

---

## Parámetros nuevos para V2

Agregar al seed:

```sql
-- Categoría 'time_tracking':
INSERT INTO parameters (category, key, value, label, note, sort_order) VALUES
  ('time_tracking','max_retroactive_days',30,'Días retroactivos máx','Ventana máxima para registrar horas hacia atrás',1),
  ('time_tracking','daily_reminder_hour',17,'Hora recordatorio','Hora (24h) en la que se genera el recordatorio diario',2),
  ('time_tracking','weekly_digest_day',5,'Día digest semanal','Día de la semana (1=lun) para el digest de compliance',3)
ON CONFLICT (category, key) DO NOTHING;

-- Categoría 'utilization':
INSERT INTO parameters (category, key, value, label, note, sort_order) VALUES
  ('utilization','bench_threshold',0.50,'Umbral bench','Utilización ≤ este valor = empleado en bench',1),
  ('utilization','overallocation_threshold',1.00,'Umbral sobrecarga','Utilización > este valor = sobrecargado',2)
ON CONFLICT (category, key) DO NOTHING;
```

---

## Resumen de relaciones

```
clients
  ↓
opportunities ──→ quotations ──→ quotation_lines
                       ↓              ↓
                       │         quotation_allocations
                       ↓              ↓
                    contracts ←─ quotation_phases, epics, milestones
                       ↓
                  resource_requests
                       ↓
                  assignments ←─ employees ← employee_skills ← skills
                       ↓              ↑
                   time_entries       │
                                      areas

users ←─ squads
  ↑
events (polymorphic)
  ↑
notifications
```
