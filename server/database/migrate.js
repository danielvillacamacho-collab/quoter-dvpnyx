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

const migrate = async () => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(V1_SCHEMA);
    await client.query(V2_NEW_TABLES);
    await client.query(V2_ALTERS);
    await client.query(V2_SEEDS_SQL);
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log('Migration completed successfully (V1 + V2 DDL).');
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
