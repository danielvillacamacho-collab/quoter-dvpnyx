/**
 * Idempotent DDL migration for DVPNYX Cotizador.
 *
 * V1 schema + V2 schema coexist. Running this on a V1 production DB creates
 * all V2 tables and alters V1 tables additively. Running it multiple times
 * is safe (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, ON CONFLICT).
 *
 * After DDL completes, run `migrate_v2_data.js` for the one-time data
 * migration (creating default squad, legacy clients/opportunities, etc).
 */
const { Pool } = require('pg');
require('dotenv').config();
const useSsl = ['true', '1', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

/* ==================================================================
 * V1 CORE SCHEMA (unchanged from original)
 * ================================================================== */
const V1_SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    active BOOLEAN DEFAULT true,
    must_change_password BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS parameters (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    key VARCHAR(100) NOT NULL,
    value NUMERIC NOT NULL,
    label VARCHAR(255),
    note TEXT,
    sort_order INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by UUID REFERENCES users(id),
    UNIQUE(category, key)
  );

  CREATE TABLE IF NOT EXISTS quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('staff_aug', 'fixed_scope')),
    version INT DEFAULT 1,
    parent_id UUID REFERENCES quotations(id),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'expired')),
    project_name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    commercial_name VARCHAR(255),
    preventa_name VARCHAR(255),
    validity_days INT DEFAULT 30,
    discount_pct NUMERIC DEFAULT 0,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS quotation_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE NOT NULL,
    sort_order INT DEFAULT 0,
    specialty VARCHAR(100),
    role_title VARCHAR(255),
    level INT CHECK (level BETWEEN 1 AND 11),
    country VARCHAR(100),
    bilingual BOOLEAN DEFAULT false,
    tools VARCHAR(50),
    stack VARCHAR(100),
    modality VARCHAR(50),
    quantity INT DEFAULT 1,
    duration_months INT DEFAULT 6,
    hours_per_week NUMERIC,
    phase VARCHAR(100),
    cost_hour NUMERIC,
    rate_hour NUMERIC,
    rate_month NUMERIC,
    total NUMERIC
  );

  CREATE TABLE IF NOT EXISTS quotation_phases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE NOT NULL,
    sort_order INT DEFAULT 0,
    name VARCHAR(255) NOT NULL,
    weeks INT DEFAULT 0,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS quotation_epics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE NOT NULL,
    sort_order INT DEFAULT 0,
    name VARCHAR(255) NOT NULL,
    priority VARCHAR(10) DEFAULT 'Media',
    hours_by_profile JSONB DEFAULT '{}',
    total_hours NUMERIC DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quotation_milestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE NOT NULL,
    sort_order INT DEFAULT 0,
    name VARCHAR(255) NOT NULL,
    phase VARCHAR(255),
    percentage NUMERIC DEFAULT 0,
    amount NUMERIC DEFAULT 0,
    expected_date DATE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity VARCHAR(50),
    entity_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_quotations_created_by ON quotations(created_by);
  CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
  CREATE INDEX IF NOT EXISTS idx_quotation_lines_quotation ON quotation_lines(quotation_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
`;

/* ==================================================================
 * V2 SCHEMA — new tables
 * ================================================================== */
const V2_NEW_TABLES = `
  -- Squads — simple organizational grouping
  CREATE TABLE IF NOT EXISTS squads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS squads_name_unique
    ON squads(LOWER(name)) WHERE deleted_at IS NULL;

  -- Clients
  CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(200) NULL,
    country VARCHAR(100) NULL,
    industry VARCHAR(100) NULL,
    tier VARCHAR(50) NULL CHECK (tier IN ('enterprise','mid_market','smb') OR tier IS NULL),
    preferred_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    notes TEXT NULL,
    tags TEXT[] NULL,
    external_crm_id VARCHAR(100) NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    deleted_at TIMESTAMPTZ NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS clients_name_unique
    ON clients(LOWER(name)) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS clients_country_idx ON clients(country) WHERE deleted_at IS NULL;

  -- Opportunities (note: winning_quotation_id FK added later after quotations is known to exist)
  CREATE TABLE IF NOT EXISTS opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id),
    name VARCHAR(200) NOT NULL,
    description TEXT NULL,
    account_owner_id UUID NOT NULL REFERENCES users(id),
    presales_lead_id UUID NULL REFERENCES users(id),
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
    external_crm_id VARCHAR(100) NULL,
    deleted_at TIMESTAMPTZ NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS opportunities_client_idx ON opportunities(client_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS opportunities_owner_idx ON opportunities(account_owner_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS opportunities_status_idx ON opportunities(status) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS opportunities_squad_idx ON opportunities(squad_id) WHERE deleted_at IS NULL;

  -- Areas (lookup)
  CREATE TABLE IF NOT EXISTS areas (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Skills (lookup)
  CREATE TABLE IF NOT EXISTS skills (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NULL,
    description TEXT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS skills_name_unique ON skills(LOWER(name));

  -- Employees (distinct from users)
  CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NULL UNIQUE REFERENCES users(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    personal_email VARCHAR(200) NULL,
    corporate_email VARCHAR(200) NULL,
    country VARCHAR(100) NOT NULL,
    city VARCHAR(100) NULL,
    area_id INT NOT NULL REFERENCES areas(id),
    level VARCHAR(5) NOT NULL CHECK (level IN ('L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11')),
    seniority_label VARCHAR(50) NULL,
    employment_type VARCHAR(20) NOT NULL DEFAULT 'fulltime'
      CHECK (employment_type IN ('fulltime','parttime','contractor')),
    weekly_capacity_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00,
    languages JSONB NOT NULL DEFAULT '[]'::jsonb,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','on_leave','bench','terminated')),
    squad_id UUID NULL REFERENCES squads(id),
    manager_user_id UUID NULL REFERENCES users(id),
    notes TEXT NULL,
    tags TEXT[] NULL,
    -- cost hooks reserved for future (V2 keeps NULL)
    company_monthly_cost NUMERIC(14,2) NULL,
    hourly_cost NUMERIC(10,2) NULL,
    cost_currency VARCHAR(3) NULL DEFAULT 'USD',
    cost_updated_at TIMESTAMPTZ NULL,
    cost_updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS employees_area_idx    ON employees(area_id)    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS employees_status_idx  ON employees(status)     WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS employees_level_idx   ON employees(level)      WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS employees_country_idx ON employees(country)    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS employees_user_idx    ON employees(user_id)    WHERE deleted_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS employees_corporate_email_unique
    ON employees(LOWER(corporate_email)) WHERE deleted_at IS NULL AND corporate_email IS NOT NULL;

  CREATE TABLE IF NOT EXISTS employee_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

  CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    delivery_manager_id UUID NULL REFERENCES users(id),
    capacity_manager_id UUID NULL REFERENCES users(id),
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
  CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts(status)    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS contracts_type_idx   ON contracts(type)      WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS contracts_squad_idx  ON contracts(squad_id)  WHERE deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS resource_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    role_title VARCHAR(150) NOT NULL,
    area_id INT NOT NULL REFERENCES areas(id),
    level VARCHAR(5) NOT NULL CHECK (level IN ('L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11')),
    country VARCHAR(100) NULL,
    language_requirements JSONB NULL,
    required_skills INT[] NULL,
    nice_to_have_skills INT[] NULL,
    weekly_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    quantity INT NOT NULL DEFAULT 1,
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
  CREATE INDEX IF NOT EXISTS resource_requests_status_idx   ON resource_requests(status)      WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS resource_requests_area_level_idx
    ON resource_requests(area_id, level) WHERE deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_request_id UUID NOT NULL REFERENCES resource_requests(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    weekly_hours NUMERIC(5,2) NOT NULL CHECK (weekly_hours > 0 AND weekly_hours <= 80),
    start_date DATE NOT NULL,
    end_date DATE NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'planned'
      CHECK (status IN ('planned','active','ended','cancelled')),
    role_title VARCHAR(150) NULL,
    notes TEXT NULL,
    approval_required BOOLEAN NOT NULL DEFAULT false,
    approved_at TIMESTAMPTZ NULL,
    approved_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS assignments_employee_idx ON assignments(employee_id)         WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS assignments_contract_idx ON assignments(contract_id)         WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS assignments_request_idx  ON assignments(resource_request_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS assignments_status_idx   ON assignments(status)              WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS assignments_dates_idx    ON assignments(start_date, end_date) WHERE deleted_at IS NULL;
  -- PERF-003: composite index for the reports/utilization + bench queries that filter
  -- by (employee_id, status='active') with deleted_at IS NULL. Single index lookup
  -- replaces a bitmap-or of two single-column indexes plus a recheck on each row.
  CREATE INDEX IF NOT EXISTS assignments_employee_active_idx
    ON assignments(employee_id) WHERE deleted_at IS NULL AND status = 'active';

  CREATE TABLE IF NOT EXISTS time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    assignment_id UUID NOT NULL REFERENCES assignments(id),
    work_date DATE NOT NULL,
    hours NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
    description TEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted'
      CHECK (status IN ('draft','submitted','approved','rejected')),
    approved_at TIMESTAMPTZ NULL,
    approved_by UUID NULL REFERENCES users(id),
    rejection_reason TEXT NULL,
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

  -- Events — structured audit log (replaces audit_log over time)
  CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    actor_user_id UUID NULL REFERENCES users(id),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET NULL,
    user_agent VARCHAR(500) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS events_entity_idx ON events(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS events_actor_idx  ON events(actor_user_id);
  CREATE INDEX IF NOT EXISTS events_type_idx   ON events(event_type);
  CREATE INDEX IF NOT EXISTS events_date_idx   ON events(created_at);

  CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NULL,
    link VARCHAR(500) NULL,
    entity_type VARCHAR(50) NULL,
    entity_id UUID NULL,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON notifications(user_id) WHERE read_at IS NULL;

  -- Quotation allocations promoted from metadata JSONB to real table
  CREATE TABLE IF NOT EXISTS quotation_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    line_sort_order INT NOT NULL,
    phase_id UUID NOT NULL REFERENCES quotation_phases(id) ON DELETE CASCADE,
    weekly_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS quotation_allocations_unique
    ON quotation_allocations(quotation_id, line_sort_order, phase_id);
  CREATE INDEX IF NOT EXISTS quotation_allocations_quotation_idx
    ON quotation_allocations(quotation_id);
`;

/* ==================================================================
 * V2 ALTERS to V1 tables
 * ================================================================== */
const V2_ALTERS = `
  -- users: add function, squad_id, deleted_at. Loosen role CHECK.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS function VARCHAR(50) NULL;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS squad_id UUID NULL REFERENCES squads(id);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

  -- Phase 10 UI refresh: per-user UI preferences (scheme, accent hue, density, …).
  -- JSONB so we can add more keys later without another migration.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

  -- Drop old role CHECK (was superadmin/admin/preventa) and add the V2 one.
  -- We keep 'preventa' valid during migration so V1 data doesn't break; data
  -- migration script will convert 'preventa' → 'member' with function='preventa'.
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND conname = 'users_role_check'
    ) THEN
      ALTER TABLE users DROP CONSTRAINT users_role_check;
    END IF;
  END $$;
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('superadmin','admin','lead','member','viewer','preventa'));

  -- users.function CHECK (nullable during backfill)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND conname = 'users_function_check'
    ) THEN
      ALTER TABLE users ADD CONSTRAINT users_function_check
        CHECK (function IS NULL OR function IN (
          'comercial','preventa','capacity_manager','delivery_manager',
          'project_manager','fte_tecnico','people','finance','pmo','admin'
        ));
    END IF;
  END $$;

  -- quotations: link to client/opportunity, currency, snapshot, sent_at, soft delete
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS client_id            UUID NULL REFERENCES clients(id);
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS opportunity_id       UUID NULL REFERENCES opportunities(id);
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS squad_id             UUID NULL REFERENCES squads(id);
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS currency             VARCHAR(3) NOT NULL DEFAULT 'USD';
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS parameters_snapshot  JSONB NULL;
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS sent_at              TIMESTAMPTZ NULL;
  ALTER TABLE quotations ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ NULL;

  ALTER TABLE quotation_milestones ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

  -- Assignment validation override audit (US-VAL-2 / US-VAL-4).
  -- Stores the free-text justification whenever an admin explicitly
  -- overrides an overridable validation failure (area mismatch, level
  -- gap, capacity partial/exceeded, partial date overlap). Nullable
  -- because the vast majority of assignments don't need it — only those
  -- where the user consciously bypassed a check. Also records the
  -- structured checks JSON so AI/analytics can learn from past overrides.
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS override_reason    TEXT  NULL;
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS override_checks    JSONB NULL;
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS override_author_id UUID  NULL REFERENCES users(id);
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS override_at        TIMESTAMPTZ NULL;

  CREATE INDEX IF NOT EXISTS idx_quotations_client      ON quotations(client_id)      WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_quotations_opportunity ON quotations(opportunity_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_quotations_squad       ON quotations(squad_id)       WHERE deleted_at IS NULL;

  -- ==================================================================
  -- CRM-MVP-00.1 (Abril 27 2026) — Pipeline Kanban sobre opportunities
  -- ==================================================================
  -- Decisión (Daniel + CPO interim): construir CRM evolutivo sobre el
  -- stack actual sin entrar en migración fundacional (TS, monorepo, RLS,
  -- multi-tenant, Zod). Estas columnas son aditivas, los 7 valores de
  -- status legacy se mantienen y se mapean a stages del pipeline en
  -- código (server/utils/pipeline.js + client/src/utils/pipeline.js).
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS booking_amount_usd  NUMERIC(18,2) NOT NULL DEFAULT 0;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS probability         NUMERIC(5,2)  NOT NULL DEFAULT 5;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS weighted_amount_usd NUMERIC(18,2) NOT NULL DEFAULT 0;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS last_stage_change_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS next_step           TEXT NULL;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS next_step_due_date  DATE NULL;

  -- Trigger: cuando cambia status o booking_amount_usd, recalcular
  -- probability + weighted + last_stage_change_at. Probability mapping
  -- está hardcoded acá (mismos valores que en utils/pipeline.js).
  CREATE OR REPLACE FUNCTION opp_pipeline_recalc()
  RETURNS TRIGGER AS $$
  BEGIN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.probability := CASE NEW.status
        WHEN 'open'        THEN 5
        WHEN 'qualified'   THEN 20
        WHEN 'proposal'    THEN 50
        WHEN 'negotiation' THEN 75
        WHEN 'won'         THEN 100
        WHEN 'lost'        THEN 0
        WHEN 'cancelled'   THEN 0
        ELSE 5
      END;
      IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.last_stage_change_at := NOW();
      END IF;
    END IF;
    NEW.weighted_amount_usd := COALESCE(NEW.booking_amount_usd, 0) * COALESCE(NEW.probability, 0) / 100.0;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_opp_pipeline_recalc ON opportunities;
  CREATE TRIGGER trg_opp_pipeline_recalc
    BEFORE INSERT OR UPDATE ON opportunities
    FOR EACH ROW
    EXECUTE FUNCTION opp_pipeline_recalc();

  -- Backfill probability + weighted para opportunities pre-CRM-MVP.
  -- last_stage_change_at queda en updated_at (mejor aproximación disponible).
  UPDATE opportunities SET
    probability = CASE status
      WHEN 'open'        THEN 5
      WHEN 'qualified'   THEN 20
      WHEN 'proposal'    THEN 50
      WHEN 'negotiation' THEN 75
      WHEN 'won'         THEN 100
      ELSE 0
    END,
    last_stage_change_at = COALESCE(closed_at, updated_at, created_at, NOW())
  WHERE probability = 5 AND status <> 'open';

  -- Recalc weighted (en caso de que booking_amount_usd haya quedado en 0
  -- el weighted también, lo que es correcto; este UPDATE solo es defensivo).
  UPDATE opportunities SET weighted_amount_usd = COALESCE(booking_amount_usd, 0) * COALESCE(probability, 0) / 100.0
    WHERE weighted_amount_usd = 0 AND booking_amount_usd > 0;

  CREATE INDEX IF NOT EXISTS idx_opportunities_status_close ON opportunities(status, expected_close_date) WHERE deleted_at IS NULL;

  -- ==================================================================
  -- RR-MVP-00.1 (Abril 27 2026) — Revenue recognition mínimo
  -- ==================================================================
  -- Decisión CTO+CPO: trabajo funcional placeholder. Reemplaza el Excel
  -- mensual de revenue para que DMs/CFO puedan operar sin esa hoja.
  -- TODO eng team: este módulo está intencionalmente simple. Cuando entren
  -- a refactorizar, ver SPEC-RR-00 para el modelo NIIF 15-friendly real
  -- (immutability triggers, plan_frozen_at, service_period_history append-
  -- only, multi-currency, atomic worker async, 4 motores polimórficos).
  -- Aquí sólo: 1 columna en contracts + 1 tabla revenue_periods + 1
  -- motor monthly_projection plano. Sin triggers DB. Sin multi-currency.
  ALTER TABLE contracts ADD COLUMN IF NOT EXISTS total_value_usd  NUMERIC(18,2) NOT NULL DEFAULT 0;
  ALTER TABLE contracts ADD COLUMN IF NOT EXISTS original_currency VARCHAR(3)  NOT NULL DEFAULT 'USD';

  CREATE TABLE IF NOT EXISTS revenue_periods (
    contract_id    UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    yyyymm         CHAR(6) NOT NULL CHECK (yyyymm ~ '^[0-9]{6}$'),
    projected_usd  NUMERIC(18,2) NOT NULL DEFAULT 0,
    -- projected_pct: porcentaje de avance del proyecto (0..1) para
    -- contratos type='project'. Para los demás tipos queda NULL y se
    -- ignora — esos llevan el monto USD directo en projected_usd. El
    -- valor visible PROY = projected_pct * contracts.total_value_usd.
    projected_pct  NUMERIC(7,4) NULL CHECK (projected_pct IS NULL OR (projected_pct >= 0 AND projected_pct <= 1)),
    real_usd       NUMERIC(18,2) NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','closed')),
    notes          TEXT NULL,
    closed_at      TIMESTAMPTZ NULL,
    closed_by      UUID NULL REFERENCES users(id),
    created_by     UUID NULL REFERENCES users(id),
    updated_by     UUID NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contract_id, yyyymm)
  );
  ALTER TABLE revenue_periods ADD COLUMN IF NOT EXISTS projected_pct NUMERIC(7,4) NULL;
  -- RR-MVP-00.5: para contratos type='project' el REAL también se captura
  -- en % (0..1) y real_usd se deriva de real_pct × contracts.total_value_usd.
  -- Para los demás tipos queda NULL (real_usd se ingresa directo).
  ALTER TABLE revenue_periods ADD COLUMN IF NOT EXISTS real_pct NUMERIC(7,4) NULL;
  CREATE INDEX IF NOT EXISTS idx_revenue_periods_yyyymm ON revenue_periods(yyyymm);
  CREATE INDEX IF NOT EXISTS idx_revenue_periods_status ON revenue_periods(status);

  -- RR-MVP-00.6 (Abril 2026): tasas de cambio mensuales tipo "USDCOP".
  -- Convención: usd_rate = N tal que 1 USD = N <currency>. USD propio NO
  -- vive en esta tabla — código asume rate=1.0 implícito.
  -- Para convertir A → B usando rates del mes Y:
  --     amount_in_USD = amount_in_A / usd_rate(Y, A)   (o = amount_in_A si A=USD)
  --     amount_in_B   = amount_in_USD × usd_rate(Y, B) (o = amount_in_USD si B=USD)
  -- Si no hay rate para el período, fallback al último rate disponible para
  -- esa moneda (LATERAL JOIN en query). El admin gestiona estos rates desde
  -- /admin/exchange-rates (mismo formato que el Excel).
  CREATE TABLE IF NOT EXISTS exchange_rates (
    yyyymm     CHAR(6) NOT NULL CHECK (yyyymm ~ '^[0-9]{6}$'),
    currency   VARCHAR(3) NOT NULL,
    usd_rate   NUMERIC(18,8) NOT NULL CHECK (usd_rate > 0),
    notes      TEXT NULL,
    updated_by UUID NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (yyyymm, currency)
  );
  CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency ON exchange_rates(currency, yyyymm);

  -- ==================================================================
  -- Time-MVP-00.1 (Abril 2026) — Weekly time allocations en %.
  -- ==================================================================
  -- Cada empleado registra cuánto % de su semana dedicó a cada
  -- asignación activa. Bench se calcula como 100 - SUM(pct) (no se
  -- persiste). Coexiste con time_entries (horas diarias) — modelos
  -- distintos, eng team va a consolidar.
  CREATE TABLE IF NOT EXISTS weekly_time_allocations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id     UUID NOT NULL REFERENCES employees(id),
    week_start_date DATE NOT NULL,
    assignment_id   UUID NOT NULL REFERENCES assignments(id),
    pct             NUMERIC(5,2) NOT NULL CHECK (pct >= 0 AND pct <= 100),
    notes           TEXT NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    updated_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, week_start_date, assignment_id)
  );
  CREATE INDEX IF NOT EXISTS wta_employee_week_idx ON weekly_time_allocations(employee_id, week_start_date);
  CREATE INDEX IF NOT EXISTS wta_assignment_idx ON weekly_time_allocations(assignment_id);

  -- ==================================================================
  -- SUBTYPE-CONTRATO (Abril 2026) — clasificación dentro del Tipo.
  -- ==================================================================
  -- Operaciones necesita distinguir el modelo de trabajo dentro de cada
  -- type ('capacity' / 'project'). Hoy esa distinción vive en notes con
  -- valores inconsistentes ("T&M", "Tiempo y materiales", "TyM"). Sin
  -- estructura no se puede filtrar/reportar y bloquea Módulo 3 (billing).
  --
  -- Aditivo: NULL en contratos existentes (mostrar "Sin especificar"
  -- en UI). Validación enforced server-side y UI.
  --
  -- Mapeo válido:
  --   capacity → staff_augmentation | mission_driven_squad | managed_service | time_and_materials
  --   project  → fixed_scope | hour_pool
  --   resell   → NULL siempre (sin subtipos por ahora)
  ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_subtype VARCHAR(50) NULL;

  -- CHECK constraint con los 6 valores válidos (NULL siempre permitido).
  -- La coherencia subtype↔type se valida en el server (depende de otra columna,
  -- expresable con CHECK pero más legible en código).
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'contracts'::regclass AND conname = 'contracts_subtype_check'
    ) THEN
      ALTER TABLE contracts ADD CONSTRAINT contracts_subtype_check
        CHECK (
          contract_subtype IS NULL OR contract_subtype IN (
            'staff_augmentation','mission_driven_squad','managed_service','time_and_materials',
            'fixed_scope','hour_pool'
          )
        );
    END IF;
  END $$;

  CREATE INDEX IF NOT EXISTS contracts_subtype_idx
    ON contracts(contract_subtype) WHERE deleted_at IS NULL AND contract_subtype IS NOT NULL;

  COMMENT ON COLUMN contracts.contract_subtype IS
    'Clasificación dentro del type. capacity → staff_augmentation|mission_driven_squad|managed_service|time_and_materials. project → fixed_scope|hour_pool. resell → NULL. Coherencia type↔subtype validada en server/routes/contracts.js.';

  -- ==================================================================
  -- EMPLOYEE-COSTS-MVP-00.1 (Abril 28 2026) — Costo empresa mensual
  -- ==================================================================
  -- Spec: spec_costos_empleado.docx (operaciones, prioridad ALTA).
  --
  -- Una row por (empleado, mes). Captura el costo empresa REAL en moneda
  -- original + conversión a USD usando exchange_rates del mismo período.
  -- Histórica e inmutable cuando locked=true (cierre contable).
  --
  -- Decisiones técnicas tomadas (ver docs/DECISIONS.md :: EMPLOYEE-COSTS):
  --   - period CHAR(6) 'YYYYMM' (alineado con exchange_rates y revenue_periods).
  --   - ON DELETE RESTRICT en employee_id — soft-delete del empleado NO toca
  --     historial financiero. Para borrar un empleado con costos, primero hay
  --     que purgar/archivar su historial (decisión consciente de superadmin).
  --   - exchange_rate_used capturada al momento del cálculo (auditoría).
  --     Si la tasa cambia después y el row no está locked, finanzas decide
  --     vía endpoint de recálculo (no auto-recálculo silencioso).
  --   - Costos PII: sin encryption at rest por ahora (depende de infra).
  --     Acceso restringido a admin/superadmin a nivel route.
  CREATE TABLE IF NOT EXISTS employee_costs (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id          UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    period               CHAR(6) NOT NULL CHECK (period ~ '^[0-9]{6}$'),
    currency             VARCHAR(3) NOT NULL,
    gross_cost           NUMERIC(14,2) NOT NULL CHECK (gross_cost >= 0),
    cost_usd             NUMERIC(14,2) NULL CHECK (cost_usd IS NULL OR cost_usd >= 0),
    exchange_rate_used   NUMERIC(18,8) NULL CHECK (exchange_rate_used IS NULL OR exchange_rate_used > 0),
    locked               BOOLEAN NOT NULL DEFAULT false,
    locked_at            TIMESTAMPTZ NULL,
    locked_by            UUID NULL REFERENCES users(id),
    source               VARCHAR(20) NOT NULL DEFAULT 'manual'
      CHECK (source IN ('manual', 'payroll_sync', 'csv_import', 'copy_from_prev', 'projected')),
    notes                TEXT NULL,
    created_by           UUID NOT NULL REFERENCES users(id),
    updated_by           UUID NULL REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, period)
  );

  -- CHECK currency contra catálogo expandible. Si se agrega una moneda nueva:
  -- 1) ALTER aquí, 2) seed exchange_rate, 3) actualizar client/utils/cost.js.
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'employee_costs_currency_check'
    ) THEN
      ALTER TABLE employee_costs ADD CONSTRAINT employee_costs_currency_check
        CHECK (currency IN ('USD', 'COP', 'MXN', 'GTQ', 'EUR'));
    END IF;
  END $$;

  CREATE INDEX IF NOT EXISTS employee_costs_period_idx     ON employee_costs(period);
  CREATE INDEX IF NOT EXISTS employee_costs_employee_idx   ON employee_costs(employee_id);
  CREATE INDEX IF NOT EXISTS employee_costs_locked_idx     ON employee_costs(locked) WHERE locked = false;
  CREATE INDEX IF NOT EXISTS employee_costs_period_locked_idx
    ON employee_costs(period, locked);

  COMMENT ON TABLE  employee_costs IS
    'Costo empresa mensual por empleado (PII: salarial). Una row por (employee_id, period). Multi-currency con conversión a USD vía exchange_rates. locked=true marca período cerrado (solo superadmin edita). Acceso restringido a admin/superadmin.';
  COMMENT ON COLUMN employee_costs.period IS
    'YYYYMM. Mismo formato que exchange_rates.yyyymm y revenue_periods.yyyymm.';
  COMMENT ON COLUMN employee_costs.gross_cost IS
    'PII:high — costo empresa total en moneda original (incluye salario + carga prestacional + beneficios). Acceso solo admin/superadmin.';
  COMMENT ON COLUMN employee_costs.cost_usd IS
    'PII:high — gross_cost convertido a USD usando exchange_rate_used. Para currency=USD se setea igual a gross_cost.';
  COMMENT ON COLUMN employee_costs.exchange_rate_used IS
    'Snapshot de la tasa al momento del cálculo. Si exchange_rates cambia después, este valor NO se actualiza automáticamente — finanzas decide vía POST /api/employee-costs/recalculate-usd/:period.';
  COMMENT ON COLUMN employee_costs.locked IS
    'true = período cerrado contablemente. Solo superadmin puede editar/deslockar. Audit log obligatorio en cada lock/unlock.';
  COMMENT ON COLUMN employee_costs.source IS
    'Cómo se cargó el dato: manual (form), csv_import (bulk preview/commit), copy_from_prev (acción "Copiar mes anterior"), projected (proyección automática hacia el futuro), payroll_sync (futura integración Giitic).';

  -- Idempotente: en DBs creadas con la versión inicial del CHECK (sin
  -- 'projected'), reescribimos la constraint. Postgres no tiene "ALTER
  -- CHECK", así que dropeamos y recreamos.
  DO $$
  DECLARE
    cdef text;
  BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO cdef
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'employee_costs' AND c.conname = 'employee_costs_source_check';
    IF cdef IS NOT NULL AND cdef NOT LIKE '%projected%' THEN
      ALTER TABLE employee_costs DROP CONSTRAINT employee_costs_source_check;
    END IF;
    -- Recrear si fue dropeada o no existe.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'employee_costs_source_check'
    ) THEN
      ALTER TABLE employee_costs ADD CONSTRAINT employee_costs_source_check
        CHECK (source IN ('manual','payroll_sync','csv_import','copy_from_prev','projected'));
    END IF;
  END $$;

  -- Deprecación de columnas en employees (no se borran — preserva schema
  -- existente, pero quedan NULL forever para nuevos empleados; la fuente
  -- de verdad es employee_costs).
  COMMENT ON COLUMN employees.company_monthly_cost IS
    'DEPRECATED 2026-04: usar employee_costs.gross_cost. Esta columna queda NULL para nuevos empleados. Se mantiene en schema sólo por compatibilidad con datos legacy.';
  COMMENT ON COLUMN employees.hourly_cost IS
    'DEPRECATED 2026-04: usar employee_costs (cost_usd / horas_mes_estimadas) para derivar hourly. Esta columna queda NULL.';
  COMMENT ON COLUMN employees.cost_currency IS
    'DEPRECATED 2026-04: la moneda vive en employee_costs.currency por mes (puede variar).';
  COMMENT ON COLUMN employees.cost_updated_at IS
    'DEPRECATED 2026-04: usar employee_costs.updated_at del último período.';
  COMMENT ON COLUMN employees.cost_updated_by IS
    'DEPRECATED 2026-04: usar employee_costs.updated_by del último período.';
`;

/* ==================================================================
 * AI-READINESS LAYER (Mayo 2026)
 * ==================================================================
 *
 * Cambios aditivos. NINGUNO altera comportamiento existente.
 *
 * 1) ai_interactions: log estructurado de cada llamada a un agente IA
 *    (modelo, prompt template, input redacted, output, decisión humana,
 *    costo, latencia). Sin esta tabla, cualquier agente que conectemos
 *    es ciego.
 *
 * 2) ai_prompt_templates: versionado de prompts. Reproducibilidad +
 *    A/B testing.
 *
 * 3) delivery_facts: tabla denormalizada por (fact_date, employee_id)
 *    con métricas planas para forecasting y reportes pesados. Refresca
 *    nocturno via función `refresh_delivery_facts(date_from, date_to)`.
 *
 * 4) Embeddings (pgvector): columnas vector(1536) en skills, employees,
 *    resource_requests, opportunities, contracts, quotations.
 *    Activadas SOLO si la extensión vector está disponible. Sin
 *    pgvector, las columnas no se crean — el resto sigue funcionando.
 *
 * 5) Slugs: identificadores URL-friendly en clients, opportunities,
 *    contracts, employees. Más legibles para LLMs y humanos que UUID.
 *
 * 6) Narrative fields: campos descriptivos enriquecidos en areas y
 *    skills para que RAG tenga contexto real, no sólo el nombre.
 *
 * 7) CHECK constraints adicionales: weekly_capacity_hours <= 80,
 *    hours_per_week en quotation_lines, etc. Antes la validación
 *    vivía sólo en código.
 */
const AI_READINESS_SQL = `
  -- 1) AI interactions log
  CREATE TABLE IF NOT EXISTS ai_interactions (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_name        VARCHAR(100) NOT NULL,
    agent_version     VARCHAR(50)  NOT NULL,
    prompt_template   VARCHAR(100) NOT NULL,
    prompt_template_version INT    NOT NULL DEFAULT 1,
    user_id           UUID NULL REFERENCES users(id),
    entity_type       VARCHAR(50) NULL,
    entity_id         UUID NULL,
    input_payload     JSONB NOT NULL,
    output_payload    JSONB NOT NULL,
    confidence        NUMERIC(4,3) NULL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    human_decision    VARCHAR(20) NULL CHECK (
      human_decision IS NULL OR human_decision IN ('accepted','rejected','modified','ignored','pending')
    ),
    human_feedback    TEXT NULL,
    cost_usd          NUMERIC(10,6) NULL,
    input_tokens      INT NULL,
    output_tokens     INT NULL,
    latency_ms        INT NULL,
    error             TEXT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at        TIMESTAMPTZ NULL
  );
  CREATE INDEX IF NOT EXISTS ai_int_user_idx     ON ai_interactions(user_id);
  CREATE INDEX IF NOT EXISTS ai_int_entity_idx   ON ai_interactions(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS ai_int_template_idx ON ai_interactions(prompt_template, prompt_template_version);
  CREATE INDEX IF NOT EXISTS ai_int_created_idx  ON ai_interactions(created_at DESC);

  -- 2) Prompt templates versioned
  CREATE TABLE IF NOT EXISTS ai_prompt_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    version     INT NOT NULL,
    description TEXT NULL,
    body        TEXT NOT NULL,
    output_schema JSONB NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (name, version)
  );
  CREATE INDEX IF NOT EXISTS ai_prompts_active_idx ON ai_prompt_templates(name) WHERE active = true;

  -- 3) Delivery facts (denormalized, daily granularity)
  CREATE TABLE IF NOT EXISTS delivery_facts (
    fact_date         DATE NOT NULL,
    employee_id       UUID NOT NULL REFERENCES employees(id),
    capacity_hours    NUMERIC(5,2) NOT NULL,
    planned_hours     NUMERIC(6,2) NOT NULL DEFAULT 0,
    planned_pct       NUMERIC(5,2) NOT NULL DEFAULT 0,
    actual_pct        NUMERIC(5,2) NULL,
    bench_pct         NUMERIC(5,2) NULL,
    utilization       NUMERIC(5,4) NULL,
    is_overbooked     BOOLEAN NOT NULL DEFAULT false,
    -- dimensiones snapshotted (datos desnormalizados para que el reporte
    -- no requiera join — escala mejor para forecasting ML).
    area_id           INT NULL,
    area_name         VARCHAR(100) NULL,
    squad_id          UUID NULL,
    level             VARCHAR(5) NULL,
    country           VARCHAR(100) NULL,
    refreshed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (fact_date, employee_id)
  );
  CREATE INDEX IF NOT EXISTS delivery_facts_date_idx ON delivery_facts(fact_date);
  CREATE INDEX IF NOT EXISTS delivery_facts_emp_idx  ON delivery_facts(employee_id);
  CREATE INDEX IF NOT EXISTS delivery_facts_area_idx ON delivery_facts(area_id, fact_date);

  -- 5) Slugs en entidades clave (URL-friendly + legible para LLMs)
  ALTER TABLE clients       ADD COLUMN IF NOT EXISTS slug VARCHAR(120) NULL;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS slug VARCHAR(160) NULL;
  ALTER TABLE contracts     ADD COLUMN IF NOT EXISTS slug VARCHAR(160) NULL;
  ALTER TABLE employees     ADD COLUMN IF NOT EXISTS slug VARCHAR(160) NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS clients_slug_unique       ON clients(slug)       WHERE slug IS NOT NULL AND deleted_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS opportunities_slug_unique ON opportunities(slug) WHERE slug IS NOT NULL AND deleted_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS contracts_slug_unique     ON contracts(slug)     WHERE slug IS NOT NULL AND deleted_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS employees_slug_unique     ON employees(slug)     WHERE slug IS NOT NULL AND deleted_at IS NULL;

  -- 6) Narrative descriptions enriquecidas para RAG
  ALTER TABLE areas  ADD COLUMN IF NOT EXISTS narrative TEXT NULL;
  ALTER TABLE skills ADD COLUMN IF NOT EXISTS narrative TEXT NULL;

  -- 7) CHECK constraints adicionales (sanity bounds)
  -- employees.weekly_capacity_hours razonable (0..80)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_capacity_bounds_check') THEN
      ALTER TABLE employees ADD CONSTRAINT employees_capacity_bounds_check
        CHECK (weekly_capacity_hours >= 0 AND weekly_capacity_hours <= 80);
    END IF;
  END $$;
  -- quotation_lines.hours_per_week razonable (0..168)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_lines_hpw_bounds_check') THEN
      ALTER TABLE quotation_lines ADD CONSTRAINT quotation_lines_hpw_bounds_check
        CHECK (hours_per_week IS NULL OR (hours_per_week >= 0 AND hours_per_week <= 168));
    END IF;
  END $$;
  -- quotation_lines.duration_months razonable (0..120, 10 años)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_lines_duration_bounds_check') THEN
      ALTER TABLE quotation_lines ADD CONSTRAINT quotation_lines_duration_bounds_check
        CHECK (duration_months IS NULL OR (duration_months >= 0 AND duration_months <= 120));
    END IF;
  END $$;
  -- quotation_lines.quantity razonable (>=1)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_lines_quantity_check') THEN
      ALTER TABLE quotation_lines ADD CONSTRAINT quotation_lines_quantity_check
        CHECK (quantity IS NULL OR quantity >= 1);
    END IF;
  END $$;
  -- resource_requests.quantity razonable (>=1)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_requests_quantity_check') THEN
      ALTER TABLE resource_requests ADD CONSTRAINT resource_requests_quantity_check
        CHECK (quantity >= 1);
    END IF;
  END $$;
  -- resource_requests.weekly_hours bounds
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_requests_hours_check') THEN
      ALTER TABLE resource_requests ADD CONSTRAINT resource_requests_hours_check
        CHECK (weekly_hours > 0 AND weekly_hours <= 80);
    END IF;
  END $$;
  -- date sanity: end >= start cuando ambos están
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_date_order_check') THEN
      ALTER TABLE assignments ADD CONSTRAINT assignments_date_order_check
        CHECK (end_date IS NULL OR end_date >= start_date);
    END IF;
  END $$;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_date_order_check') THEN
      ALTER TABLE contracts ADD CONSTRAINT contracts_date_order_check
        CHECK (end_date IS NULL OR end_date >= start_date);
    END IF;
  END $$;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_requests_date_order_check') THEN
      ALTER TABLE resource_requests ADD CONSTRAINT resource_requests_date_order_check
        CHECK (end_date IS NULL OR end_date >= start_date);
    END IF;
  END $$;

  -- 8) Materialized view: plan-vs-real semanal por (employee, week, assignment).
  -- Refrescar con: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_plan_vs_real_weekly;
  -- Necesita un UNIQUE INDEX para REFRESH CONCURRENTLY.
  DROP MATERIALIZED VIEW IF EXISTS mv_plan_vs_real_weekly;
  CREATE MATERIALIZED VIEW mv_plan_vs_real_weekly AS
    SELECT
      a.employee_id,
      e.weekly_capacity_hours,
      date_trunc('week', wta.week_start_date)::date AS week_start_date,
      a.id AS assignment_id,
      a.contract_id,
      c.name AS contract_name,
      a.role_title,
      a.weekly_hours AS planned_hours,
      CASE WHEN e.weekly_capacity_hours > 0
           THEN ROUND((a.weekly_hours / e.weekly_capacity_hours) * 100.0, 1)
           ELSE 0 END AS planned_pct,
      ROUND(wta.pct, 1) AS actual_pct,
      ROUND(wta.pct - CASE WHEN e.weekly_capacity_hours > 0
                           THEN (a.weekly_hours / e.weekly_capacity_hours) * 100.0
                           ELSE 0 END, 1) AS diff_pct,
      wta.notes,
      wta.updated_at
    FROM weekly_time_allocations wta
    JOIN assignments a ON a.id = wta.assignment_id
    JOIN employees   e ON e.id = a.employee_id
    LEFT JOIN contracts c ON c.id = a.contract_id
    WHERE a.deleted_at IS NULL
      AND e.deleted_at IS NULL
  WITH NO DATA;
  CREATE UNIQUE INDEX IF NOT EXISTS mv_pvr_weekly_pk
    ON mv_plan_vs_real_weekly (employee_id, week_start_date, assignment_id);

  -- 9) Function para refrescar delivery_facts en una ventana de fechas.
  -- Idempotente: borra+inserta el rango. Llamar via cron job nocturno
  -- (no se ejecuta automáticamente desde DDL).
  CREATE OR REPLACE FUNCTION refresh_delivery_facts(p_from DATE, p_to DATE)
  RETURNS INT AS $$
  DECLARE
    v_count INT;
  BEGIN
    DELETE FROM delivery_facts WHERE fact_date BETWEEN p_from AND p_to;

    -- Por cada (día, empleado), calcular planned_hours sumando assignments
    -- activos cuyo rango cubre el día. Capacidad y demás dimensiones se
    -- snapshottean del estado actual del empleado.
    INSERT INTO delivery_facts
      (fact_date, employee_id, capacity_hours, planned_hours, planned_pct,
       area_id, area_name, squad_id, level, country, refreshed_at)
    SELECT
      d.day,
      e.id,
      e.weekly_capacity_hours,
      COALESCE(SUM(a.weekly_hours) FILTER (
        WHERE a.deleted_at IS NULL
          AND a.status IN ('planned','active')
          AND a.start_date <= d.day
          AND (a.end_date IS NULL OR a.end_date >= d.day)
      ), 0) AS planned_hours,
      CASE WHEN e.weekly_capacity_hours > 0 THEN
        ROUND(
          (COALESCE(SUM(a.weekly_hours) FILTER (
            WHERE a.deleted_at IS NULL
              AND a.status IN ('planned','active')
              AND a.start_date <= d.day
              AND (a.end_date IS NULL OR a.end_date >= d.day)
          ), 0) / e.weekly_capacity_hours) * 100.0,
          1
        )
      ELSE 0 END AS planned_pct,
      e.area_id,
      ar.name AS area_name,
      e.squad_id,
      e.level,
      e.country,
      NOW()
    FROM generate_series(p_from, p_to, interval '1 day') AS d(day)
    CROSS JOIN employees e
    LEFT JOIN areas ar ON ar.id = e.area_id
    LEFT JOIN assignments a ON a.employee_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.status IN ('active','on_leave','bench')
    GROUP BY d.day, e.id, e.weekly_capacity_hours, e.area_id, ar.name, e.squad_id, e.level, e.country;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    -- Calcular utilization derivado en el mismo paso (ya tenemos los datos).
    UPDATE delivery_facts
       SET utilization = CASE WHEN capacity_hours > 0 THEN planned_hours / capacity_hours ELSE 0 END,
           is_overbooked = (capacity_hours > 0 AND planned_hours > capacity_hours * 1.10)
     WHERE fact_date BETWEEN p_from AND p_to;

    RETURN v_count;
  END;
  $$ LANGUAGE plpgsql;

  -- 10) Documentación a nivel de DB (COMMENT ON). Sólo lo más útil — un
  -- agente que abre la DB ahora puede leer la intención de cada tabla.
  COMMENT ON TABLE  ai_interactions       IS 'Log estructurado de cada llamada a un agente IA (modelo, prompt, input/output, decisión humana, costo).';
  COMMENT ON TABLE  ai_prompt_templates   IS 'Versiones de prompts. ai_interactions referencia (name, version) para reproducibilidad y A/B testing.';
  COMMENT ON TABLE  delivery_facts        IS 'Tabla denormalizada por (fact_date, employee_id) para forecasting y reportes pesados. Refrescar con SELECT refresh_delivery_facts(from, to).';
  COMMENT ON TABLE  events                IS 'Audit log estructurado V2. Append-only. Reemplaza audit_log gradualmente.';
  COMMENT ON TABLE  weekly_time_allocations IS 'Time tracking por % semanal (Time-MVP-00.1). Coexiste con time_entries (horas diarias). Eng team consolidará.';
  COMMENT ON TABLE  time_entries          IS 'Time tracking por horas diarias (V2 ET-*). Coexiste con weekly_time_allocations.';
  COMMENT ON TABLE  audit_log             IS 'Audit log V1 legacy. Para escrituras nuevas usar events. No agregar features nuevos aquí.';

  COMMENT ON COLUMN employees.user_id     IS 'NULL si el empleado no tiene cuenta de login. La distinción User vs Employee es por diseño.';
  COMMENT ON COLUMN employees.slug        IS 'URL-friendly identifier, generado por server/utils/slug.js. Útil para LLMs y URLs legibles.';
  COMMENT ON COLUMN contracts.metadata    IS 'JSONB libre. Convención: kick_off_date, kicked_off_at, kicked_off_by se persisten aquí. Validación pendiente.';
  COMMENT ON COLUMN assignments.override_reason IS 'Justificación del admin cuando bypassea una validación. Capturado para que la IA aprenda de overrides.';
  COMMENT ON COLUMN ai_interactions.input_payload  IS 'Prompt + contexto (REDACTED — sin PII directa). JSON.';
  COMMENT ON COLUMN ai_interactions.output_payload IS 'Respuesta del modelo. JSON.';
  COMMENT ON COLUMN ai_interactions.human_decision IS 'Si el humano aceptó/rechazó/modificó la sugerencia. Pending hasta que el usuario decida. Esencial para feedback loop.';
`;

/* ==================================================================
 * pgvector — extensión opcional. Si está disponible, agregamos columnas
 * de embedding. Si no, las saltamos sin romper el resto del schema.
 * ================================================================== */
const PGVECTOR_SQL = `
  ALTER TABLE skills            ADD COLUMN IF NOT EXISTS name_embedding         vector(1536);
  ALTER TABLE areas             ADD COLUMN IF NOT EXISTS narrative_embedding    vector(1536);
  ALTER TABLE employees         ADD COLUMN IF NOT EXISTS skill_profile_embedding vector(1536);
  ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS requirements_embedding  vector(1536);
  ALTER TABLE opportunities     ADD COLUMN IF NOT EXISTS description_embedding   vector(1536);
  ALTER TABLE contracts         ADD COLUMN IF NOT EXISTS context_embedding       vector(1536);
  ALTER TABLE quotations        ADD COLUMN IF NOT EXISTS summary_embedding       vector(1536);

  -- HNSW indexes para búsqueda semántica O(log n).
  -- Sólo se crean si la columna existe Y tiene datos NO NULL en al menos
  -- una row (postgres permite el index vacío, pero para ahorrar I/O en
  -- entornos donde nadie ha generado embeddings todavía, los marcamos
  -- como índices "lazy" — se construyen instantly porque están vacíos).
  CREATE INDEX IF NOT EXISTS skills_name_embed_idx
    ON skills USING hnsw (name_embedding vector_cosine_ops);
  CREATE INDEX IF NOT EXISTS employees_skill_profile_embed_idx
    ON employees USING hnsw (skill_profile_embedding vector_cosine_ops)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS resource_requests_req_embed_idx
    ON resource_requests USING hnsw (requirements_embedding vector_cosine_ops)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS opportunities_desc_embed_idx
    ON opportunities USING hnsw (description_embedding vector_cosine_ops)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS contracts_context_embed_idx
    ON contracts USING hnsw (context_embedding vector_cosine_ops)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS quotations_summary_embed_idx
    ON quotations USING hnsw (summary_embedding vector_cosine_ops)
    WHERE deleted_at IS NULL;
`;

/* ==================================================================
 * Seeds — idempotent catalogues and parameters
 * ================================================================== */
const V2_SEEDS_SQL = `
  -- Areas — 9 canonical DVPNYX specialties
  INSERT INTO areas (key, name, sort_order) VALUES
    ('development',           'Desarrollo',            1),
    ('infra_security',        'Infra & Seguridad',     2),
    ('testing',               'Testing',               3),
    ('product_management',    'Product Management',    4),
    ('project_management',    'Project Management',    5),
    ('data_ai',               'Data & AI',             6),
    ('ux_ui',                 'UX/UI',                 7),
    ('functional_analysis',   'Análisis Funcional',    8),
    ('devops_sre',            'DevOps/SRE',            9)
  ON CONFLICT (key) DO NOTHING;

  -- Skills — starter catalogue (~60 entries across 8 categories)
  INSERT INTO skills (name, category) VALUES
    -- languages
    ('JavaScript','language'),('TypeScript','language'),('Python','language'),
    ('Java','language'),('C#','language'),('Go','language'),('PHP','language'),
    ('Ruby','language'),('Kotlin','language'),('Swift','language'),
    -- frameworks
    ('React','framework'),('Angular','framework'),('Vue','framework'),
    ('Node.js','framework'),('Express','framework'),('NestJS','framework'),
    ('Spring Boot','framework'),('.NET','framework'),('Django','framework'),
    ('Flask','framework'),('Rails','framework'),('Laravel','framework'),
    ('Next.js','framework'),
    -- cloud
    ('AWS','cloud'),('GCP','cloud'),('Azure','cloud'),('Firebase','cloud'),
    -- data
    ('PostgreSQL','data'),('MySQL','data'),('MongoDB','data'),('Redis','data'),
    ('Elasticsearch','data'),('Kafka','data'),('Spark','data'),
    ('Snowflake','data'),('Airflow','data'),('dbt','data'),
    -- ai
    ('TensorFlow','ai'),('PyTorch','ai'),('LangChain','ai'),
    ('OpenAI API','ai'),('Hugging Face','ai'),('Anthropic','ai'),
    -- tools
    ('Git','tool'),('Docker','tool'),('Kubernetes','tool'),('Terraform','tool'),
    ('Jenkins','tool'),('GitLab CI','tool'),('GitHub Actions','tool'),
    -- methodology
    ('Scrum','methodology'),('Kanban','methodology'),('SAFe','methodology'),
    ('Design Thinking','methodology'),('DevOps','methodology'),
    -- soft
    ('Inglés','soft'),('Liderazgo','soft'),
    ('Comunicación cliente','soft'),('Mentoría','soft')
  ON CONFLICT (LOWER(name)) DO NOTHING;

  -- New parameter categories: time_tracking and reports
  INSERT INTO parameters (category, key, value, label, note, sort_order) VALUES
    ('time_tracking','backfill_window_days',       30,'Días retroactivos máx','Ventana para registrar horas hacia atrás',1),
    ('time_tracking','edit_window_days',           30,'Días de edición','Ventana durante la cual un entry es editable sin admin',2),
    ('time_tracking','max_daily_hours',            16,'Máx horas/día','Tope de horas sumadas por empleado por día',3),
    ('time_tracking','min_weekly_hours_reminder',  32,'Umbral recordatorio semanal','Horas bajo las cuales se notifica',4),
    ('time_tracking','default_entry_category',      0,'Categoría default','Ver constantes en código (0 = delivery)',5),

    ('reports','bench_threshold_pct',              60,'Umbral bench %','Utilización bajo la cual se considera bench',1),
    ('reports','overbooking_threshold_pct',       100,'Umbral sobrecarga %','Utilización sobre la cual se considera overbooking',2),
    ('reports','hiring_needs_window_days',          90,'Ventana necesidades','Días hacia adelante para necesidades de contratación',3),
    ('reports','materialized_view_refresh_minutes', 15,'Refresh MV','Frecuencia de refresh de vistas materializadas',4),
    ('reports','default_report_period_days',        30,'Período default','Período default para reportes',5),

    ('utilization','bench_threshold',            0.50,'Umbral bench','Utilización ≤ este valor → bench',1),
    ('utilization','overallocation_threshold',   1.00,'Umbral sobrecarga','Utilización > este valor → sobrecargado',2)
  ON CONFLICT (category, key) DO NOTHING;
`;

/* ==================================================================
 * SPEC-II-00 — Internal Initiatives, Novelties & Idle Time
 * ==================================================================
 *
 * Adds three coupled modules and one infra catalogue:
 *   1. Internal initiatives (paralelo a contracts; presupuesto USD)
 *   2. Novedades (vacaciones, incapacidades, capacitaciones, etc.)
 *   3. Idle Time engine (snapshots mensuales, inmutables al finalizar)
 *   + country_holidays como infraestructura compartida.
 *
 * Adaptaciones vs spec original:
 *   - Sin tenant_id (single-tenant operativo, igual que el resto del repo).
 *   - Las nuevas tablas usan employee_id + weekly_hours (no user_id +
 *     allocation_pct) para coherencia con assignments existente.
 *   - assignments y resource_requests NO se refactorizan a XOR. Las
 *     asignaciones internas viven exclusivamente en
 *     internal_initiative_assignments. El idle engine suma ambas.
 *   - hourly_rate_usd se deriva del último employee_costs.cost_usd con
 *     valor / horas mensuales estimadas (weekly_capacity_hours × 52/12).
 *     Si falta → idle_cost_usd = 0 con flag missing_rate.
 *   - country_id ISO-2 se backfill-ea desde employees.country (nombre
 *     en español) mediante CASE WHEN.
 *   - S3 attachments en novedades quedan como URL externa (Drive/SP) en
 *     attachment_url; sin presigned upload en MVP.
 * ================================================================== */
const SPEC_II_00_SQL = `
  /* ----- Catálogos ------------------------------------------------ */
  CREATE TABLE IF NOT EXISTS business_areas (
    id          TEXT PRIMARY KEY,
    label_es    TEXT NOT NULL,
    label_en    TEXT NOT NULL,
    sort_order  INTEGER NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO business_areas (id, label_es, label_en, sort_order) VALUES
    ('product',     'Producto',    'Product',    1),
    ('operations',  'Operaciones', 'Operations', 2),
    ('hr',          'RRHH',        'HR',         3),
    ('finance',     'Finanzas',    'Finance',    4),
    ('commercial',  'Comercial',   'Commercial', 5),
    ('technology', 'Tecnología',   'Technology', 6)
  ON CONFLICT (id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS novelty_types (
    id                              TEXT PRIMARY KEY,
    label_es                        TEXT NOT NULL,
    label_en                        TEXT NOT NULL,
    is_paid_time                    BOOLEAN NOT NULL DEFAULT true,
    requires_attachment_recommended BOOLEAN NOT NULL DEFAULT false,
    -- counts_in_capacity = true  → las horas se cuentan como asignadas (training).
    -- counts_in_capacity = false → las horas se restan del available (vacación, etc).
    counts_in_capacity              BOOLEAN NOT NULL DEFAULT false,
    sort_order                      INTEGER NOT NULL,
    is_active                       BOOLEAN NOT NULL DEFAULT true,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO novelty_types (id, label_es, label_en, is_paid_time, requires_attachment_recommended, counts_in_capacity, sort_order) VALUES
    ('vacation',          'Vacaciones',                 'Vacation',                  true,  false, false, 1),
    ('sick_leave',        'Incapacidad médica',         'Sick Leave',                true,  true,  false, 2),
    ('parental_leave',    'Licencia maternidad/pat.',   'Parental Leave',            true,  true,  false, 3),
    ('unpaid_leave',      'Permiso sin goce',           'Unpaid Leave',              false, false, false, 4),
    ('bereavement',       'Calamidad doméstica',        'Bereavement',               true,  false, false, 5),
    ('legal_leave',       'Licencia de ley',            'Legal Leave',               true,  false, false, 6),
    ('corporate_training','Capacitación corporativa',   'Corporate Training',        true,  false, true,  7),
    ('unavailable_other', 'No disponible (otro)',       'Unavailable (Other)',       true,  false, false, 8)
  ON CONFLICT (id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS countries (
    id                          TEXT PRIMARY KEY CHECK (length(id) = 2),
    label_es                    TEXT NOT NULL,
    label_en                    TEXT NOT NULL,
    standard_workday_hours      INTEGER NOT NULL DEFAULT 8,
    standard_workdays_per_week  INTEGER NOT NULL DEFAULT 5,
    is_active                   BOOLEAN NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO countries (id, label_es, label_en, standard_workday_hours, standard_workdays_per_week) VALUES
    ('CO','Colombia','Colombia',8,5),
    ('MX','México','Mexico',8,5),
    ('GT','Guatemala','Guatemala',8,5),
    ('EC','Ecuador','Ecuador',8,5),
    ('PA','Panamá','Panama',8,5),
    ('PE','Perú','Peru',8,5),
    ('US','EE.UU.','USA',8,5)
  ON CONFLICT (id) DO NOTHING;

  /* ----- employees.country_id (ISO-2) backfill -------------------- */
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS country_id TEXT NULL REFERENCES countries(id);

  -- Backfill best-effort. La columna 'country' legacy es VARCHAR(100) con
  -- el nombre en español/inglés según vino de RRHH; mapeamos los nombres
  -- conocidos. Si no matchea ningún país, queda NULL y el idle engine usa
  -- 'CO' como fallback (la mayoría del staff es colombiano). Nuevos
  -- empleados deben setear country_id explícitamente desde la UI.
  UPDATE employees SET country_id = CASE
    WHEN country ILIKE 'colombia%'                                           THEN 'CO'
    WHEN country ILIKE 'm%xico%' OR country ILIKE 'mexico%'                  THEN 'MX'
    WHEN country ILIKE 'guatemala%'                                          THEN 'GT'
    WHEN country ILIKE 'ecuador%'                                            THEN 'EC'
    WHEN country ILIKE 'panam%' OR country ILIKE 'panama%'                   THEN 'PA'
    WHEN country ILIKE 'per%' OR country ILIKE 'peru%'                       THEN 'PE'
    WHEN country ILIKE 'estados unidos%' OR country ILIKE 'usa%'
      OR country ILIKE 'us%' OR country ILIKE 'united states%'               THEN 'US'
    ELSE country_id
  END WHERE country_id IS NULL;

  CREATE INDEX IF NOT EXISTS employees_country_id_idx ON employees(country_id) WHERE deleted_at IS NULL;

  /* ----- country_holidays ---------------------------------------- */
  CREATE TABLE IF NOT EXISTS country_holidays (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country_id    TEXT NOT NULL REFERENCES countries(id),
    holiday_date  DATE NOT NULL,
    label         TEXT NOT NULL,
    holiday_type  TEXT NOT NULL DEFAULT 'national'
                  CHECK (holiday_type IN ('national','regional','optional','company')),
    year          INTEGER NOT NULL,
    notes         TEXT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    UUID NULL REFERENCES users(id),
    UNIQUE (country_id, holiday_date)
  );
  CREATE INDEX IF NOT EXISTS holidays_country_year_idx ON country_holidays(country_id, year);
  CREATE INDEX IF NOT EXISTS holidays_date_idx         ON country_holidays(holiday_date);

  /* ----- internal_initiatives ------------------------------------ */
  CREATE TABLE IF NOT EXISTS internal_initiatives (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    initiative_code     TEXT NOT NULL UNIQUE,  -- II-{AREA}-{YYYY}-{SEQ5}
    name                TEXT NOT NULL CHECK (length(name) >= 5 AND length(name) <= 255),
    description         TEXT NULL,
    business_area_id    TEXT NOT NULL REFERENCES business_areas(id),
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','completed','cancelled','paused')),
    budget_usd          NUMERIC(18,2) NOT NULL CHECK (budget_usd >= 0),
    hours_estimated     NUMERIC(10,2) NOT NULL DEFAULT 0,
    start_date          DATE NOT NULL,
    target_end_date     DATE NULL,
    actual_end_date     DATE NULL,
    operations_owner_id UUID NOT NULL REFERENCES users(id),
    source_system       TEXT NOT NULL DEFAULT 'ui'
                        CHECK (source_system IN ('ui','api','migration','ai_suggestion')),
    deleted_at          TIMESTAMPTZ NULL,
    deletion_reason     TEXT NULL,
    created_by          UUID NOT NULL REFERENCES users(id),
    updated_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS ii_status_idx ON internal_initiatives(status) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS ii_area_idx   ON internal_initiatives(business_area_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS ii_owner_idx  ON internal_initiatives(operations_owner_id) WHERE deleted_at IS NULL;

  /* ----- internal_initiative_assignments ------------------------- */
  -- Convención: employee_id + weekly_hours (NO user_id + allocation_pct),
  -- coherente con la tabla 'assignments' existente. Si en el futuro hay
  -- que homologar reportería entre ambas, se hace via VIEW.
  CREATE TABLE IF NOT EXISTS internal_initiative_assignments (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    internal_initiative_id   UUID NOT NULL REFERENCES internal_initiatives(id) ON DELETE RESTRICT,
    employee_id              UUID NOT NULL REFERENCES employees(id),
    start_date               DATE NOT NULL,
    end_date                 DATE NULL,
    weekly_hours             NUMERIC(5,2) NOT NULL CHECK (weekly_hours > 0 AND weekly_hours <= 80),
    -- Snapshot de la tarifa interna del empleado al momento de asignar.
    -- Evita que cambios futuros de costo afecten cálculos retroactivos.
    -- Puede ser NULL si el empleado no tenía employee_cost al asignar:
    -- el idle_engine lo verá como missing_rate y costeará en 0.
    hourly_rate_usd          NUMERIC(18,4) NULL,
    status                   TEXT NOT NULL DEFAULT 'planned'
                             CHECK (status IN ('planned','active','ended','cancelled')),
    role_description         TEXT NULL,
    notes                    TEXT NULL,
    deleted_at               TIMESTAMPTZ NULL,
    created_by               UUID NOT NULL REFERENCES users(id),
    updated_by               UUID NULL REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date IS NULL OR end_date >= start_date)
  );
  CREATE INDEX IF NOT EXISTS iia_initiative_idx ON internal_initiative_assignments(internal_initiative_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS iia_employee_dates_idx ON internal_initiative_assignments(employee_id, start_date, end_date) WHERE deleted_at IS NULL AND status IN ('planned','active');
  CREATE INDEX IF NOT EXISTS iia_status_idx ON internal_initiative_assignments(status) WHERE deleted_at IS NULL;

  /* ----- employee_novelties -------------------------------------- */
  CREATE TABLE IF NOT EXISTS employee_novelties (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id              UUID NOT NULL REFERENCES employees(id),
    novelty_type_id          TEXT NOT NULL REFERENCES novelty_types(id),
    start_date               DATE NOT NULL,
    end_date                 DATE NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'approved'
                             CHECK (status IN ('approved','cancelled')),
    reason                   TEXT NULL,
    -- Adjuntos: en MVP guardamos URL externa (Drive/SP) + nota; sin S3.
    attachment_url           TEXT NULL,
    attachment_note          TEXT NULL,
    -- En MVP approved_at/by = created_at/by (sin workflow).
    approved_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by              UUID NOT NULL REFERENCES users(id),
    cancelled_at             TIMESTAMPTZ NULL,
    cancelled_by             UUID NULL REFERENCES users(id),
    cancellation_reason      TEXT NULL,
    created_by               UUID NOT NULL REFERENCES users(id),
    updated_by               UUID NULL REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date),
    CHECK (cancelled_at IS NULL OR status = 'cancelled')
  );
  CREATE INDEX IF NOT EXISTS novelties_employee_dates_idx ON employee_novelties(employee_id, start_date, end_date) WHERE status = 'approved';
  CREATE INDEX IF NOT EXISTS novelties_period_idx ON employee_novelties(start_date, end_date);
  CREATE INDEX IF NOT EXISTS novelties_type_idx ON employee_novelties(novelty_type_id);

  -- Trigger: prevenir overlap de novedades aprobadas para el mismo empleado.
  -- Usamos daterange + && (overlap operator) — funciona con cualquier postgres
  -- moderno sin necesidad de btree_gist.
  CREATE OR REPLACE FUNCTION prevent_novelty_overlap()
  RETURNS TRIGGER AS $$
  DECLARE
    overlap_count INTEGER;
  BEGIN
    IF NEW.status <> 'approved' THEN
      RETURN NEW;
    END IF;
    SELECT COUNT(*) INTO overlap_count
      FROM employee_novelties
     WHERE employee_id = NEW.employee_id
       AND status = 'approved'
       AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND daterange(start_date, end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]');
    IF overlap_count > 0 THEN
      RAISE EXCEPTION 'novelty_overlap: employee % ya tiene novedad aprobada en el rango %..%',
        NEW.employee_id, NEW.start_date, NEW.end_date
        USING HINT = 'Cancelar la novedad existente antes de crear otra que se solape.',
              ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_novelty_no_overlap ON employee_novelties;
  CREATE TRIGGER trg_novelty_no_overlap
    BEFORE INSERT OR UPDATE ON employee_novelties
    FOR EACH ROW
    EXECUTE FUNCTION prevent_novelty_overlap();

  /* ----- idle_time_calculations ---------------------------------- */
  -- Snapshots inmutables al pasar a 'final'. Recalcular un mes 'final'
  -- requiere endpoint admin que crea un audit_log explícito.
  CREATE TABLE IF NOT EXISTS idle_time_calculations (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id               UUID NOT NULL REFERENCES employees(id),
    period_yyyymm             CHAR(7) NOT NULL CHECK (period_yyyymm ~ '^[0-9]{4}-[0-9]{2}$'),
    total_capacity_hours      NUMERIC(10,2) NOT NULL,
    holiday_hours             NUMERIC(10,2) NOT NULL DEFAULT 0,
    novelty_hours             NUMERIC(10,2) NOT NULL DEFAULT 0,
    available_hours           NUMERIC(10,2) NOT NULL,
    assigned_hours_contract   NUMERIC(10,2) NOT NULL DEFAULT 0,
    assigned_hours_internal   NUMERIC(10,2) NOT NULL DEFAULT 0,
    assigned_hours_total      NUMERIC(10,2) NOT NULL DEFAULT 0,
    idle_hours                NUMERIC(10,2) NOT NULL,
    idle_pct                  NUMERIC(7,4) NOT NULL CHECK (idle_pct >= 0 AND idle_pct <= 1),
    hourly_rate_usd_at_calc   NUMERIC(18,4) NULL,  -- NULL = missing_rate
    idle_cost_usd             NUMERIC(18,2) NOT NULL DEFAULT 0,
    calculation_status        TEXT NOT NULL DEFAULT 'preliminary'
                              CHECK (calculation_status IN ('preliminary','final')),
    breakdown                 JSONB NULL,  -- holidays_used / novelties_used / contract_assignments / internal_assignments / flags
    calculated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    calculated_by             UUID NULL REFERENCES users(id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, period_yyyymm)
  );
  CREATE INDEX IF NOT EXISTS itc_period_idx ON idle_time_calculations(period_yyyymm);
  CREATE INDEX IF NOT EXISTS itc_employee_idx ON idle_time_calculations(employee_id);
  CREATE INDEX IF NOT EXISTS itc_status_idx ON idle_time_calculations(calculation_status);

  -- Inmutabilidad: una vez calculation_status='final', ningún campo numérico
  -- ni el status puede cambiar. UPDATE silenciosos al breakdown sí permitidos
  -- (para enriquecer metadata). Cambios reales requieren admin endpoint que
  -- crea un nuevo row con status='preliminary' para el siguiente período.
  CREATE OR REPLACE FUNCTION enforce_idle_time_immutability()
  RETURNS TRIGGER AS $$
  BEGIN
    IF OLD.calculation_status = 'final' THEN
      IF (
        NEW.total_capacity_hours    IS DISTINCT FROM OLD.total_capacity_hours OR
        NEW.holiday_hours           IS DISTINCT FROM OLD.holiday_hours        OR
        NEW.novelty_hours           IS DISTINCT FROM OLD.novelty_hours        OR
        NEW.available_hours         IS DISTINCT FROM OLD.available_hours      OR
        NEW.assigned_hours_contract IS DISTINCT FROM OLD.assigned_hours_contract OR
        NEW.assigned_hours_internal IS DISTINCT FROM OLD.assigned_hours_internal OR
        NEW.assigned_hours_total    IS DISTINCT FROM OLD.assigned_hours_total    OR
        NEW.idle_hours              IS DISTINCT FROM OLD.idle_hours              OR
        NEW.idle_pct                IS DISTINCT FROM OLD.idle_pct                OR
        NEW.idle_cost_usd           IS DISTINCT FROM OLD.idle_cost_usd           OR
        NEW.calculation_status      IS DISTINCT FROM OLD.calculation_status
      ) THEN
        RAISE EXCEPTION 'idle_time_calculation % es final e inmutable', NEW.id
          USING HINT = 'Para correcciones, usa el endpoint admin POST /api/idle-time/recalculate.',
                ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_itc_immutability ON idle_time_calculations;
  CREATE TRIGGER trg_itc_immutability
    BEFORE UPDATE ON idle_time_calculations
    FOR EACH ROW
    EXECUTE FUNCTION enforce_idle_time_immutability();
`;

/* ==================================================================
 * SPEC-II-00 — Holiday seed (Colombia / México / Guatemala / Ecuador
 * / Panamá / Perú / EE.UU., 2026 + 2027). Idempotente vía ON CONFLICT.
 *
 * Fuente: leyes laborales vigentes a abril 2026. Festivos trasladables
 * de Colombia ya están aplicados al lunes correspondiente. Para 2027
 * los trasladables se recalcularán cuando se publique el calendario
 * oficial; los aquí cargados son una proyección razonable.
 * ================================================================== */
const SPEC_II_00_HOLIDAY_SEED_SQL = `
  INSERT INTO country_holidays (country_id, holiday_date, label, holiday_type, year) VALUES
    -- COLOMBIA 2026 (18 festivos, trasladables al lunes)
    ('CO','2026-01-01','Año Nuevo','national',2026),
    ('CO','2026-01-12','Día de los Reyes Magos','national',2026),
    ('CO','2026-03-23','Día de San José','national',2026),
    ('CO','2026-04-02','Jueves Santo','national',2026),
    ('CO','2026-04-03','Viernes Santo','national',2026),
    ('CO','2026-05-01','Día del Trabajo','national',2026),
    ('CO','2026-05-18','Día de la Ascensión','national',2026),
    ('CO','2026-06-08','Corpus Christi','national',2026),
    ('CO','2026-06-15','Sagrado Corazón','national',2026),
    ('CO','2026-06-29','San Pedro y San Pablo','national',2026),
    ('CO','2026-07-20','Día de la Independencia','national',2026),
    ('CO','2026-08-07','Batalla de Boyacá','national',2026),
    ('CO','2026-08-17','Asunción de la Virgen','national',2026),
    ('CO','2026-10-12','Día de la Raza','national',2026),
    ('CO','2026-11-02','Todos los Santos','national',2026),
    ('CO','2026-11-16','Independencia de Cartagena','national',2026),
    ('CO','2026-12-08','Inmaculada Concepción','national',2026),
    ('CO','2026-12-25','Navidad','national',2026),
    -- COLOMBIA 2027
    ('CO','2027-01-01','Año Nuevo','national',2027),
    ('CO','2027-01-11','Día de los Reyes Magos','national',2027),
    ('CO','2027-03-22','Día de San José','national',2027),
    ('CO','2027-03-25','Jueves Santo','national',2027),
    ('CO','2027-03-26','Viernes Santo','national',2027),
    ('CO','2027-05-01','Día del Trabajo','national',2027),
    ('CO','2027-05-10','Día de la Ascensión','national',2027),
    ('CO','2027-05-31','Corpus Christi','national',2027),
    ('CO','2027-06-07','Sagrado Corazón','national',2027),
    ('CO','2027-07-05','San Pedro y San Pablo','national',2027),
    ('CO','2027-07-20','Día de la Independencia','national',2027),
    ('CO','2027-08-07','Batalla de Boyacá','national',2027),
    ('CO','2027-08-16','Asunción de la Virgen','national',2027),
    ('CO','2027-10-18','Día de la Raza','national',2027),
    ('CO','2027-11-01','Todos los Santos','national',2027),
    ('CO','2027-11-15','Independencia de Cartagena','national',2027),
    ('CO','2027-12-08','Inmaculada Concepción','national',2027),
    ('CO','2027-12-25','Navidad','national',2027),

    -- MÉXICO 2026 (festivos oficiales LFT art. 74)
    ('MX','2026-01-01','Año Nuevo','national',2026),
    ('MX','2026-02-02','Día de la Constitución','national',2026),
    ('MX','2026-03-16','Natalicio de Benito Juárez','national',2026),
    ('MX','2026-05-01','Día del Trabajo','national',2026),
    ('MX','2026-09-16','Día de la Independencia','national',2026),
    ('MX','2026-11-02','Día de los Muertos','national',2026),
    ('MX','2026-11-16','Día de la Revolución','national',2026),
    ('MX','2026-12-25','Navidad','national',2026),
    -- MÉXICO 2027
    ('MX','2027-01-01','Año Nuevo','national',2027),
    ('MX','2027-02-01','Día de la Constitución','national',2027),
    ('MX','2027-03-15','Natalicio de Benito Juárez','national',2027),
    ('MX','2027-05-01','Día del Trabajo','national',2027),
    ('MX','2027-09-16','Día de la Independencia','national',2027),
    ('MX','2027-11-02','Día de los Muertos','national',2027),
    ('MX','2027-11-15','Día de la Revolución','national',2027),
    ('MX','2027-12-25','Navidad','national',2027),

    -- GUATEMALA 2026
    ('GT','2026-01-01','Año Nuevo','national',2026),
    ('GT','2026-04-02','Jueves Santo','national',2026),
    ('GT','2026-04-03','Viernes Santo','national',2026),
    ('GT','2026-04-04','Sábado de Gloria','national',2026),
    ('GT','2026-05-01','Día del Trabajo','national',2026),
    ('GT','2026-06-30','Día del Ejército','national',2026),
    ('GT','2026-09-15','Día de la Independencia','national',2026),
    ('GT','2026-10-20','Revolución de 1944','national',2026),
    ('GT','2026-11-01','Día de Todos los Santos','national',2026),
    ('GT','2026-12-24','Nochebuena','national',2026),
    ('GT','2026-12-25','Navidad','national',2026),
    ('GT','2026-12-31','Fin de Año','national',2026),
    -- GUATEMALA 2027
    ('GT','2027-01-01','Año Nuevo','national',2027),
    ('GT','2027-03-25','Jueves Santo','national',2027),
    ('GT','2027-03-26','Viernes Santo','national',2027),
    ('GT','2027-03-27','Sábado de Gloria','national',2027),
    ('GT','2027-05-01','Día del Trabajo','national',2027),
    ('GT','2027-06-30','Día del Ejército','national',2027),
    ('GT','2027-09-15','Día de la Independencia','national',2027),
    ('GT','2027-10-20','Revolución de 1944','national',2027),
    ('GT','2027-11-01','Día de Todos los Santos','national',2027),
    ('GT','2027-12-24','Nochebuena','national',2027),
    ('GT','2027-12-25','Navidad','national',2027),
    ('GT','2027-12-31','Fin de Año','national',2027),

    -- ECUADOR 2026
    ('EC','2026-01-01','Año Nuevo','national',2026),
    ('EC','2026-02-16','Carnaval','national',2026),
    ('EC','2026-02-17','Carnaval','national',2026),
    ('EC','2026-04-03','Viernes Santo','national',2026),
    ('EC','2026-05-01','Día del Trabajo','national',2026),
    ('EC','2026-05-24','Batalla de Pichincha','national',2026),
    ('EC','2026-08-10','Primer Grito de Independencia','national',2026),
    ('EC','2026-10-09','Independencia de Guayaquil','national',2026),
    ('EC','2026-11-02','Día de los Difuntos','national',2026),
    ('EC','2026-11-03','Independencia de Cuenca','national',2026),
    ('EC','2026-12-25','Navidad','national',2026),
    -- ECUADOR 2027
    ('EC','2027-01-01','Año Nuevo','national',2027),
    ('EC','2027-02-08','Carnaval','national',2027),
    ('EC','2027-02-09','Carnaval','national',2027),
    ('EC','2027-03-26','Viernes Santo','national',2027),
    ('EC','2027-05-01','Día del Trabajo','national',2027),
    ('EC','2027-05-24','Batalla de Pichincha','national',2027),
    ('EC','2027-08-10','Primer Grito de Independencia','national',2027),
    ('EC','2027-10-09','Independencia de Guayaquil','national',2027),
    ('EC','2027-11-02','Día de los Difuntos','national',2027),
    ('EC','2027-11-03','Independencia de Cuenca','national',2027),
    ('EC','2027-12-25','Navidad','national',2027),

    -- PANAMÁ 2026
    ('PA','2026-01-01','Año Nuevo','national',2026),
    ('PA','2026-01-09','Día de los Mártires','national',2026),
    ('PA','2026-02-17','Carnaval','national',2026),
    ('PA','2026-04-03','Viernes Santo','national',2026),
    ('PA','2026-05-01','Día del Trabajo','national',2026),
    ('PA','2026-11-03','Separación de Colombia','national',2026),
    ('PA','2026-11-04','Día de los Símbolos Patrios','national',2026),
    ('PA','2026-11-05','Día de Colón','national',2026),
    ('PA','2026-11-10','Primer Grito de Independencia','national',2026),
    ('PA','2026-11-28','Independencia de España','national',2026),
    ('PA','2026-12-08','Día de las Madres','national',2026),
    ('PA','2026-12-25','Navidad','national',2026),
    -- PANAMÁ 2027
    ('PA','2027-01-01','Año Nuevo','national',2027),
    ('PA','2027-01-09','Día de los Mártires','national',2027),
    ('PA','2027-02-09','Carnaval','national',2027),
    ('PA','2027-03-26','Viernes Santo','national',2027),
    ('PA','2027-05-01','Día del Trabajo','national',2027),
    ('PA','2027-11-03','Separación de Colombia','national',2027),
    ('PA','2027-11-04','Día de los Símbolos Patrios','national',2027),
    ('PA','2027-11-05','Día de Colón','national',2027),
    ('PA','2027-11-10','Primer Grito de Independencia','national',2027),
    ('PA','2027-11-28','Independencia de España','national',2027),
    ('PA','2027-12-08','Día de las Madres','national',2027),
    ('PA','2027-12-25','Navidad','national',2027),

    -- PERÚ 2026
    ('PE','2026-01-01','Año Nuevo','national',2026),
    ('PE','2026-04-02','Jueves Santo','national',2026),
    ('PE','2026-04-03','Viernes Santo','national',2026),
    ('PE','2026-05-01','Día del Trabajo','national',2026),
    ('PE','2026-06-29','San Pedro y San Pablo','national',2026),
    ('PE','2026-07-23','Batalla de Junín','national',2026),
    ('PE','2026-07-28','Día de la Independencia','national',2026),
    ('PE','2026-07-29','Día de la Independencia','national',2026),
    ('PE','2026-08-06','Batalla de Ayacucho','national',2026),
    ('PE','2026-08-30','Santa Rosa de Lima','national',2026),
    ('PE','2026-10-08','Combate de Angamos','national',2026),
    ('PE','2026-11-01','Día de Todos los Santos','national',2026),
    ('PE','2026-12-08','Inmaculada Concepción','national',2026),
    ('PE','2026-12-09','Batalla de Ayacucho','national',2026),
    ('PE','2026-12-25','Navidad','national',2026),
    -- PERÚ 2027
    ('PE','2027-01-01','Año Nuevo','national',2027),
    ('PE','2027-03-25','Jueves Santo','national',2027),
    ('PE','2027-03-26','Viernes Santo','national',2027),
    ('PE','2027-05-01','Día del Trabajo','national',2027),
    ('PE','2027-06-29','San Pedro y San Pablo','national',2027),
    ('PE','2027-07-23','Batalla de Junín','national',2027),
    ('PE','2027-07-28','Día de la Independencia','national',2027),
    ('PE','2027-07-29','Día de la Independencia','national',2027),
    ('PE','2027-08-06','Batalla de Ayacucho','national',2027),
    ('PE','2027-08-30','Santa Rosa de Lima','national',2027),
    ('PE','2027-10-08','Combate de Angamos','national',2027),
    ('PE','2027-11-01','Día de Todos los Santos','national',2027),
    ('PE','2027-12-08','Inmaculada Concepción','national',2027),
    ('PE','2027-12-09','Batalla de Ayacucho','national',2027),
    ('PE','2027-12-25','Navidad','national',2027),

    -- USA 2026 (federal)
    ('US','2026-01-01','New Year''s Day','national',2026),
    ('US','2026-01-19','MLK Day','national',2026),
    ('US','2026-02-16','Presidents'' Day','national',2026),
    ('US','2026-05-25','Memorial Day','national',2026),
    ('US','2026-06-19','Juneteenth','national',2026),
    ('US','2026-07-03','Independence Day (observed)','national',2026),
    ('US','2026-09-07','Labor Day','national',2026),
    ('US','2026-10-12','Columbus Day','national',2026),
    ('US','2026-11-11','Veterans Day','national',2026),
    ('US','2026-11-26','Thanksgiving','national',2026),
    ('US','2026-12-25','Christmas Day','national',2026),
    -- USA 2027
    ('US','2027-01-01','New Year''s Day','national',2027),
    ('US','2027-01-18','MLK Day','national',2027),
    ('US','2027-02-15','Presidents'' Day','national',2027),
    ('US','2027-05-31','Memorial Day','national',2027),
    ('US','2027-06-18','Juneteenth (observed)','national',2027),
    ('US','2027-07-05','Independence Day (observed)','national',2027),
    ('US','2027-09-06','Labor Day','national',2027),
    ('US','2027-10-11','Columbus Day','national',2027),
    ('US','2027-11-11','Veterans Day','national',2027),
    ('US','2027-11-25','Thanksgiving','national',2027),
    ('US','2027-12-24','Christmas Day (observed)','national',2027)
  ON CONFLICT (country_id, holiday_date) DO NOTHING;
`;

/**
 * Intenta crear la extensión pgvector. Si no está disponible (no instalada
 * en la imagen postgres, o falta privilegio), captura el error y devuelve
 * false. El schema base sigue funcionando sin pgvector — sólo se pierde
 * la capa de embeddings hasta que alguien instale la extensión.
 *
 * Importante: esto se ejecuta FUERA de la transacción principal porque
 * CREATE EXTENSION puede requerir lock que no convive bien con BEGIN
 * abierto en algunas configuraciones (RDS).
 */
async function ensurePgVector(client) {
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    const { rows } = await client.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'vector'`
    );
    return rows.length > 0;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[migrate] pgvector NO disponible (',
      err && err.message ? err.message : err,
      '). Schema continuará sin columnas de embeddings.'
    );
    return false;
  }
}

const migrate = async () => {
  let client;
  try {
    client = await pool.connect();

    // pgvector primero (fuera de transacción) — best effort.
    const hasPgVector = await ensurePgVector(client);

    await client.query('BEGIN');
    await client.query(V1_SCHEMA);
    await client.query(V2_NEW_TABLES);
    await client.query(V2_ALTERS);
    await client.query(AI_READINESS_SQL);
    await client.query(V2_SEEDS_SQL);
    await client.query(SPEC_II_00_SQL);
    await client.query(SPEC_II_00_HOLIDAY_SEED_SQL);

    // Normalizar nombres de empleados a Title Case (primera letra de cada
    // palabra en mayúscula, resto en minúscula). Idempotente: initcap(lower())
    // sobre un nombre ya en Title Case produce el mismo resultado.
    await client.query(`
      UPDATE employees
         SET first_name = initcap(lower(first_name)),
             last_name  = initcap(lower(last_name))
       WHERE first_name <> initcap(lower(first_name))
          OR last_name  <> initcap(lower(last_name))
    `);

    await client.query('COMMIT');

    // Embeddings se aplican fuera de la transacción principal: si fallan
    // no debe abortar el resto de la migración.
    if (hasPgVector) {
      try {
        await client.query(PGVECTOR_SQL);
        // eslint-disable-next-line no-console
        console.log('[migrate] pgvector columns + HNSW indexes ready.');
      } catch (vecErr) {
        // eslint-disable-next-line no-console
        console.warn('[migrate] pgvector schema failed:', vecErr.message);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`Migration completed successfully (V1 + V2 + AI-readiness + SPEC-II-00${hasPgVector ? ' + pgvector' : ''}).`);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('Migration failed:', err);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
};

if (require.main === module) {
  migrate().catch(() => process.exit(1));
}

module.exports = { migrate };
