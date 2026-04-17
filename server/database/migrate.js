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

const migrate = async () => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('superadmin', 'admin', 'preventa')),
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
    `);
    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
};

migrate().catch(() => process.exit(1));
