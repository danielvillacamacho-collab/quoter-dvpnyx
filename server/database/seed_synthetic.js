/**
 * Synthetic data seeder for the develop environment.
 *
 * Generates realistic LATAM consulting firm data covering all major
 * entities so every UI view, dashboard, and report has content.
 *
 * Safety:  Refuses to run when NODE_ENV=production or DB_NAME contains 'prod'.
 * Idempotent: Uses deterministic UUIDs + ON CONFLICT DO NOTHING (catch-all).
 * Standalone: `node server/database/seed_synthetic.js`
 */
const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// ── Safety gate ──────────────────────────────────────────────────────
const env = (process.env.NODE_ENV || '').toLowerCase();
const dbName = (process.env.DB_NAME || '').toLowerCase();
if (env === 'production' || dbName.includes('prod')) {
  console.error('ABORT: seed_synthetic.js must NOT run in production.');
  process.exit(1);
}

const useSsl = ['true', '1', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase());
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

// ── Helpers ──────────────────────────────────────────────────────────
function uid(seed) {
  const h = crypto.createHash('md5').update(`dvpnyx-syn:${seed}`).digest('hex');
  return [
    h.slice(0, 8), h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

function d(offsetDays) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

function monday(offsetWeeks) {
  const dt = new Date();
  dt.setDate(dt.getDate() - dt.getDay() + 1 + offsetWeeks * 7);
  return dt.toISOString().slice(0, 10);
}

function yyyymm(offsetMonths) {
  const dt = new Date();
  dt.setMonth(dt.getMonth() + offsetMonths);
  return dt.toISOString().slice(0, 7).replace('-', '');
}

// ── Data definitions ─────────────────────────────────────────────────
const ADMIN_ID = uid('user-admin');

const USERS = [
  { id: ADMIN_ID,       email: 'admin.synth@dvpnyx.com',    name: 'Admin Sintético',     role: 'admin',    fn: 'admin' },
  { id: uid('user-1'),  email: 'catalina.rios@dvpnyx.com',  name: 'Catalina Ríos',       role: 'lead',     fn: 'comercial' },
  { id: uid('user-2'),  email: 'andres.moreno@dvpnyx.com',  name: 'Andrés Moreno',       role: 'member',   fn: 'preventa' },
  { id: uid('user-3'),  email: 'laura.gutierrez@dvpnyx.com',name: 'Laura Gutiérrez',     role: 'lead',     fn: 'delivery_manager' },
  { id: uid('user-4'),  email: 'santiago.reyes@dvpnyx.com', name: 'Santiago Reyes',       role: 'member',   fn: 'capacity_manager' },
  { id: uid('user-5'),  email: 'mariana.lopez@dvpnyx.com',  name: 'Mariana López',       role: 'director', fn: 'pmo' },
  { id: uid('user-6'),  email: 'carlos.duran@dvpnyx.com',   name: 'Carlos Durán',        role: 'member',   fn: 'fte_tecnico' },
  { id: uid('user-7'),  email: 'valeria.castro@dvpnyx.com', name: 'Valeria Castro',      role: 'member',   fn: 'people' },
];

const SQUADS = [
  { id: uid('squad-1'), name: 'Colombia Digital' },
  { id: uid('squad-2'), name: 'México Norte' },
  { id: uid('squad-3'), name: 'LATAM Cloud' },
  { id: uid('squad-4'), name: 'US Enterprise' },
];

const CLIENTS = [
  { id: uid('cli-1'),  name: 'Bancolombia',        country: 'Colombia',    industry: 'Banca',          tier: 'enterprise',  currency: 'COP' },
  { id: uid('cli-2'),  name: 'Rappi',              country: 'Colombia',    industry: 'Tecnología',     tier: 'enterprise',  currency: 'USD' },
  { id: uid('cli-3'),  name: 'Grupo Éxito',        country: 'Colombia',    industry: 'Retail',         tier: 'enterprise',  currency: 'COP' },
  { id: uid('cli-4'),  name: 'Kavak México',       country: 'México',      industry: 'Automotriz',     tier: 'mid_market',  currency: 'USD' },
  { id: uid('cli-5'),  name: 'Mercado Libre CO',   country: 'Colombia',    industry: 'E-commerce',     tier: 'enterprise',  currency: 'USD' },
  { id: uid('cli-6'),  name: 'Tigo Guatemala',     country: 'Guatemala',   industry: 'Telecomunicaciones', tier: 'enterprise', currency: 'USD' },
  { id: uid('cli-7'),  name: 'Copa Airlines',      country: 'Panamá',      industry: 'Aviación',       tier: 'enterprise',  currency: 'USD' },
  { id: uid('cli-8'),  name: 'Finaktiva',          country: 'Colombia',    industry: 'Fintech',        tier: 'smb',         currency: 'COP' },
  { id: uid('cli-9'),  name: 'Kushki',             country: 'Ecuador',     industry: 'Pagos',          tier: 'mid_market',  currency: 'USD' },
  { id: uid('cli-10'), name: 'Globant',            country: 'Colombia',    industry: 'Tecnología',     tier: 'enterprise',  currency: 'USD' },
  { id: uid('cli-11'), name: 'TechCo Austin',      country: 'Estados Unidos', industry: 'SaaS',        tier: 'mid_market',  currency: 'USD' },
  { id: uid('cli-12'), name: 'Carvajal Tecnología',country: 'Colombia',    industry: 'Tecnología',     tier: 'mid_market',  currency: 'COP' },
];

const EMPLOYEES = [
  { id: uid('emp-1'),  fn: 'Juan',     ln: 'Pérez Gómez',       country: 'Colombia', city: 'Medellín',   area: 'development',        level: 'L7', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-2'),  fn: 'María',    ln: 'Torres Cardona',    country: 'Colombia', city: 'Bogotá',     area: 'development',        level: 'L5', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-3'),  fn: 'Sebastián',ln: 'Ramírez Londoño',   country: 'Colombia', city: 'Cali',       area: 'testing',            level: 'L4', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-4'),  fn: 'Alejandra',ln: 'Vargas Ospina',     country: 'Colombia', city: 'Medellín',   area: 'ux_ui',              level: 'L6', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-5'),  fn: 'Diego',    ln: 'Hernández Muñoz',   country: 'Colombia', city: 'Bogotá',     area: 'data_ai',            level: 'L8', status: 'active',  cap: 40, squad: 2 },
  { id: uid('emp-6'),  fn: 'Camila',   ln: 'Salazar Ríos',      country: 'Colombia', city: 'Pereira',    area: 'development',        level: 'L3', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-7'),  fn: 'Felipe',   ln: 'Mejía Ochoa',       country: 'Colombia', city: 'Medellín',   area: 'infra_security',     level: 'L6', status: 'active',  cap: 40, squad: 2 },
  { id: uid('emp-8'),  fn: 'Valentina',ln: 'Castaño Ruiz',      country: 'Colombia', city: 'Bogotá',     area: 'project_management', level: 'L7', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-9'),  fn: 'Andrés',   ln: 'Zapata Cárdenas',   country: 'Colombia', city: 'Medellín',   area: 'development',        level: 'L9', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-10'), fn: 'Carolina', ln: 'Díaz Patiño',       country: 'México',   city: 'CDMX',       area: 'development',        level: 'L5', status: 'active',  cap: 40, squad: 1 },
  { id: uid('emp-11'), fn: 'Roberto',  ln: 'García Luna',       country: 'México',   city: 'Guadalajara', area: 'devops_sre',        level: 'L6', status: 'active',  cap: 40, squad: 1 },
  { id: uid('emp-12'), fn: 'Paola',    ln: 'Montoya Arias',     country: 'Colombia', city: 'Medellín',   area: 'functional_analysis',level: 'L5', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-13'), fn: 'Daniel',   ln: 'Osorio Betancur',   country: 'Colombia', city: 'Medellín',   area: 'development',        level: 'L4', status: 'bench',   cap: 40, squad: 0 },
  { id: uid('emp-14'), fn: 'Isabella', ln: 'Restrepo Vélez',    country: 'Colombia', city: 'Bogotá',     area: 'product_management', level: 'L7', status: 'active',  cap: 40, squad: 2 },
  { id: uid('emp-15'), fn: 'Mateo',    ln: 'Cardona Serna',     country: 'Guatemala', city: 'Ciudad de Guatemala', area: 'development', level: 'L3', status: 'active', cap: 40, squad: 0 },
  { id: uid('emp-16'), fn: 'Sofía',    ln: 'Arias Bedoya',      country: 'Colombia', city: 'Medellín',   area: 'testing',            level: 'L6', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-17'), fn: 'Tomás',    ln: 'Gutiérrez Rojas',   country: 'Panamá',   city: 'Ciudad de Panamá', area: 'development',  level: 'L5', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-18'), fn: 'Luciana',  ln: 'Martínez Correa',   country: 'Colombia', city: 'Bogotá',     area: 'data_ai',            level: 'L4', status: 'active',  cap: 40, squad: 2 },
  { id: uid('emp-19'), fn: 'Samuel',   ln: 'Jaramillo López',   country: 'Colombia', city: 'Medellín',   area: 'development',        level: 'L6', status: 'on_leave',cap: 40, squad: 0 },
  { id: uid('emp-20'), fn: 'Ana',      ln: 'Correa Álvarez',    country: 'Colombia', city: 'Bucaramanga',area: 'development',        level: 'L2', status: 'bench',   cap: 40, squad: 0 },
  { id: uid('emp-21'), fn: 'Esteban',  ln: 'Posada Giraldo',    country: 'Ecuador',  city: 'Quito',      area: 'infra_security',     level: 'L5', status: 'active',  cap: 40, squad: 2 },
  { id: uid('emp-22'), fn: 'Gabriela', ln: 'Henao Marín',       country: 'Colombia', city: 'Medellín',   area: 'ux_ui',              level: 'L4', status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-23'), fn: 'James',    ln: 'Smith',             country: 'Estados Unidos', city: 'Austin', area: 'development',     level: 'L8', status: 'active',  cap: 40, squad: 3 },
  { id: uid('emp-24'), fn: 'Natalia',  ln: 'Bustamante Soto',   country: 'Colombia', city: 'Bogotá',     area: 'development',        level: 'L10',status: 'active',  cap: 40, squad: 0 },
  { id: uid('emp-25'), fn: 'Miguel',   ln: 'Orozco Toro',       country: 'Colombia', city: 'Medellín',   area: 'devops_sre',         level: 'L7', status: 'terminated', cap: 0, squad: null },
];

const OPP_STATUSES = ['lead','qualified','solution_design','proposal_validated','negotiation','verbal_commit','closed_won','closed_lost','postponed'];

const OPPORTUNITIES = [
  { id: uid('opp-1'),  cli: 0,  name: 'Migración cloud Bancolombia',          status: 'closed_won',        rev: 'recurring', mrr: 45000,  months: 12, deal: 'new_business',     owner: 1, onum: 'OPP-COLO-2026-00001' },
  { id: uid('opp-2'),  cli: 1,  name: 'App delivery Rappi 2.0',               status: 'negotiation',       rev: 'one_time',  ota: 180000, deal: 'new_business',               owner: 1, onum: 'OPP-COLO-2026-00002' },
  { id: uid('opp-3'),  cli: 2,  name: 'Portal e-commerce Éxito',              status: 'proposal_validated',rev: 'one_time',  ota: 95000,  deal: 'upsell_cross_sell',           owner: 1, onum: 'OPP-COLO-2026-00003' },
  { id: uid('opp-4'),  cli: 3,  name: 'Staff aug backend Kavak',              status: 'closed_won',        rev: 'recurring', mrr: 28000,  months: 6,  deal: 'new_business',     owner: 1, onum: 'OPP-MEXI-2026-00001' },
  { id: uid('opp-5'),  cli: 4,  name: 'Microservicios MeLi Colombia',         status: 'verbal_commit',     rev: 'recurring', mrr: 60000,  months: 12, deal: 'new_business',     owner: 5, onum: 'OPP-COLO-2026-00004' },
  { id: uid('opp-6'),  cli: 5,  name: 'Modernización core Tigo',              status: 'solution_design',   rev: 'one_time',  ota: 250000, deal: 'new_business',               owner: 1, onum: 'OPP-GUAT-2026-00001' },
  { id: uid('opp-7'),  cli: 6,  name: 'Sistema de reservas Copa',             status: 'qualified',         rev: 'mixed',     ota: 50000, mrr: 15000, months: 12, deal: 'new_business', owner: 5, onum: 'OPP-PANA-2026-00001' },
  { id: uid('opp-8'),  cli: 7,  name: 'Scoring crediticio Finaktiva',         status: 'closed_won',        rev: 'one_time',  ota: 45000,  deal: 'new_business',               owner: 1, onum: 'OPP-COLO-2026-00005' },
  { id: uid('opp-9'),  cli: 8,  name: 'Integración PSP Kushki',              status: 'lead',              rev: 'one_time',  ota: 30000,  deal: 'new_business',               owner: 5, onum: 'OPP-ECUA-2026-00001' },
  { id: uid('opp-10'), cli: 9,  name: 'Staff aug frontend Globant',           status: 'closed_lost',       rev: 'recurring', mrr: 35000,  months: 6,  deal: 'new_business',     owner: 1, onum: 'OPP-COLO-2026-00006' },
  { id: uid('opp-11'), cli: 10, name: 'Data pipeline TechCo',                 status: 'negotiation',       rev: 'one_time',  ota: 120000, deal: 'new_business',               owner: 5, onum: 'OPP-ESTA-2026-00001' },
  { id: uid('opp-12'), cli: 0,  name: 'Fase 2 — analytics Bancolombia',       status: 'qualified',         rev: 'one_time',  ota: 80000,  deal: 'upsell_cross_sell',           owner: 1, onum: 'OPP-COLO-2026-00007' },
  { id: uid('opp-13'), cli: 11, name: 'Modernización Carvajal',               status: 'lead',              rev: 'one_time',  ota: 55000,  deal: 'new_business',               owner: 1, onum: 'OPP-COLO-2026-00008' },
  { id: uid('opp-14'), cli: 4,  name: 'Soporte continuo MeLi',                status: 'postponed',         rev: 'recurring', mrr: 20000,  months: 12, deal: 'renewal',          owner: 5, onum: 'OPP-COLO-2026-00009', postponed: d(30) },
  { id: uid('opp-15'), cli: 1,  name: 'QA automation Rappi',                  status: 'solution_design',   rev: 'one_time',  ota: 65000,  deal: 'upsell_cross_sell',           owner: 1, onum: 'OPP-COLO-2026-00010' },
];

const CONTRACTS = [
  { id: uid('ctr-1'), cli: 0,  opp: 0,  name: 'Bancolombia — Cloud Migration 2026',   type: 'capacity', subtype: 'staff_augmentation', status: 'active',    start: d(-90), end: d(270), val: 540000, squad: 0 },
  { id: uid('ctr-2'), cli: 3,  opp: 3,  name: 'Kavak MX — Backend Staff',             type: 'capacity', subtype: 'time_and_materials',  status: 'active',    start: d(-60), end: d(120), val: 168000, squad: 1 },
  { id: uid('ctr-3'), cli: 7,  opp: 7,  name: 'Finaktiva — Scoring AI',               type: 'project',  subtype: 'fixed_scope',         status: 'active',    start: d(-45), end: d(45),  val: 45000,  squad: 0 },
  { id: uid('ctr-4'), cli: 1,  opp: null,name: 'Rappi — Mantenimiento 2025',          type: 'capacity', subtype: 'managed_service',     status: 'completed', start: d(-365),end: d(-30), val: 220000, squad: 0 },
  { id: uid('ctr-5'), cli: 4,  opp: 4,  name: 'MeLi CO — Microservicios Phase 1',     type: 'project',  subtype: 'hour_pool',           status: 'planned',   start: d(15),  end: d(195), val: 360000, squad: 2 },
  { id: uid('ctr-6'), cli: 10, opp: null,name: 'TechCo Austin — Data Eng retainer',   type: 'capacity', subtype: 'staff_augmentation',  status: 'active',    start: d(-120),end: d(240), val: 480000, squad: 3 },
  { id: uid('ctr-7'), cli: 2,  opp: null,name: 'Éxito — Soporte e-commerce',          type: 'capacity', subtype: 'time_and_materials',  status: 'active',    start: d(-30), end: d(150), val: 95000,  squad: 0 },
  { id: uid('ctr-8'), cli: 9,  opp: null,name: 'Globant — Design System',             type: 'project',  subtype: 'fixed_scope',         status: 'cancelled', start: d(-90), end: d(-30), val: 40000,  squad: 0 },
];

const RESOURCE_REQUESTS = [
  { id: uid('rr-1'),  ctr: 0, role: 'Senior Backend Engineer',   area: 'development',     level: 'L7', hrs: 40, status: 'filled',      prio: 'high' },
  { id: uid('rr-2'),  ctr: 0, role: 'Mid Frontend Developer',    area: 'development',     level: 'L5', hrs: 40, status: 'filled',      prio: 'medium' },
  { id: uid('rr-3'),  ctr: 0, role: 'QA Analyst',                area: 'testing',         level: 'L4', hrs: 20, status: 'filled',      prio: 'medium' },
  { id: uid('rr-4'),  ctr: 1, role: 'Backend Developer',         area: 'development',     level: 'L5', hrs: 40, status: 'filled',      prio: 'high' },
  { id: uid('rr-5'),  ctr: 1, role: 'DevOps Engineer',           area: 'devops_sre',      level: 'L6', hrs: 20, status: 'filled',      prio: 'medium' },
  { id: uid('rr-6'),  ctr: 2, role: 'Data Scientist',            area: 'data_ai',         level: 'L8', hrs: 40, status: 'filled',      prio: 'critical' },
  { id: uid('rr-7'),  ctr: 2, role: 'ML Engineer',               area: 'data_ai',         level: 'L4', hrs: 40, status: 'filled',      prio: 'high' },
  { id: uid('rr-8'),  ctr: 5, role: 'Lead Architect',            area: 'development',     level: 'L8', hrs: 40, status: 'filled',      prio: 'critical' },
  { id: uid('rr-9'),  ctr: 5, role: 'Data Engineer',             area: 'data_ai',         level: 'L8', hrs: 20, status: 'open',        prio: 'high' },
  { id: uid('rr-10'), ctr: 6, role: 'PM',                        area: 'project_management', level: 'L7', hrs: 20, status: 'filled',  prio: 'medium' },
  { id: uid('rr-11'), ctr: 6, role: 'UX Designer',               area: 'ux_ui',           level: 'L6', hrs: 40, status: 'open',        prio: 'medium' },
  { id: uid('rr-12'), ctr: 6, role: 'Frontend Developer',        area: 'development',     level: 'L3', hrs: 40, status: 'filled',      prio: 'low' },
  { id: uid('rr-13'), ctr: 4, role: 'Senior React Developer',    area: 'development',     level: 'L6', hrs: 40, status: 'partially_filled', prio: 'high' },
];

const ASSIGNMENTS = [
  { id: uid('asg-1'),  rr: 0,  emp: 0,  ctr: 0, hrs: 40, status: 'active',  role: 'Senior Backend Engineer' },
  { id: uid('asg-2'),  rr: 1,  emp: 1,  ctr: 0, hrs: 40, status: 'active',  role: 'Mid Frontend Developer' },
  { id: uid('asg-3'),  rr: 2,  emp: 2,  ctr: 0, hrs: 20, status: 'active',  role: 'QA Analyst' },
  { id: uid('asg-4'),  rr: 3,  emp: 9,  ctr: 1, hrs: 40, status: 'active',  role: 'Backend Developer' },
  { id: uid('asg-5'),  rr: 4,  emp: 10, ctr: 1, hrs: 20, status: 'active',  role: 'DevOps Engineer' },
  { id: uid('asg-6'),  rr: 5,  emp: 4,  ctr: 2, hrs: 40, status: 'active',  role: 'Data Scientist' },
  { id: uid('asg-7'),  rr: 6,  emp: 17, ctr: 2, hrs: 40, status: 'active',  role: 'ML Engineer' },
  { id: uid('asg-8'),  rr: 7,  emp: 22, ctr: 5, hrs: 40, status: 'active',  role: 'Lead Architect' },
  { id: uid('asg-9'),  rr: 9,  emp: 7,  ctr: 6, hrs: 20, status: 'active',  role: 'PM' },
  { id: uid('asg-10'), rr: 11, emp: 14, ctr: 6, hrs: 40, status: 'active',  role: 'Frontend Developer' },
  { id: uid('asg-11'), rr: 12, emp: 5,  ctr: 4, hrs: 40, status: 'planned', role: 'React Developer' },
  { id: uid('asg-12'), rr: 2,  emp: 15, ctr: 0, hrs: 20, status: 'active',  role: 'QA Automation' },
  { id: uid('asg-13'), rr: 0,  emp: 8,  ctr: 0, hrs: 20, status: 'active',  role: 'Tech Lead (parcial)' },
  { id: uid('asg-14'), rr: 3,  emp: 16, ctr: 1, hrs: 20, status: 'active',  role: 'Backend Support' },
];

const CONTACTS = [
  { id: uid('con-1'),  cli: 0,  fn: 'Ricardo',  ln: 'Gómez',     title: 'VP Tecnología',        email: 'rgomez@bancolombia.com',     seniority: 'vp' },
  { id: uid('con-2'),  cli: 0,  fn: 'Ana María', ln: 'Peña',     title: 'Gerente de Proyectos',  email: 'ampena@bancolombia.com',     seniority: 'manager' },
  { id: uid('con-3'),  cli: 1,  fn: 'Simón',    ln: 'Borrero',   title: 'CTO',                   email: 'sborrero@rappi.com',         seniority: 'c_level' },
  { id: uid('con-4'),  cli: 2,  fn: 'Patricia',  ln: 'Velasco',  title: 'Directora Digital',     email: 'pvelasco@exito.com',         seniority: 'director' },
  { id: uid('con-5'),  cli: 3,  fn: 'Alejandro', ln: 'Herrera',  title: 'Engineering Manager',   email: 'aherrera@kavak.com',         seniority: 'manager' },
  { id: uid('con-6'),  cli: 4,  fn: 'Julián',    ln: 'Rincón',   title: 'Tech Lead',             email: 'jrincon@mercadolibre.com',   seniority: 'senior' },
  { id: uid('con-7'),  cli: 5,  fn: 'Carlos',    ln: 'Méndez',   title: 'Director TI',           email: 'cmendez@tigo.com.gt',        seniority: 'director' },
  { id: uid('con-8'),  cli: 6,  fn: 'Mónica',    ln: 'Arias',    title: 'VP Digital',            email: 'marias@copaair.com',         seniority: 'vp' },
  { id: uid('con-9'),  cli: 7,  fn: 'Esteban',   ln: 'Cruz',     title: 'CEO',                   email: 'ecruz@finaktiva.com',        seniority: 'c_level' },
  { id: uid('con-10'), cli: 8,  fn: 'Aron',      ln: 'Schwarzkopf', title: 'CTO',                email: 'aron@kushki.com',            seniority: 'c_level' },
  { id: uid('con-11'), cli: 10, fn: 'Mike',      ln: 'Johnson',   title: 'VP Engineering',       email: 'mjohnson@techco.com',        seniority: 'vp' },
  { id: uid('con-12'), cli: 11, fn: 'Fernando',  ln: 'López',     title: 'Gerente TI',           email: 'flopez@carvajal.com',        seniority: 'manager' },
];

const ACTIVITIES = [
  { id: uid('act-1'),  opp: 0,  cli: 0,  con: 0,  user: 1, type: 'meeting',        subject: 'Kick-off migración cloud' },
  { id: uid('act-2'),  opp: 0,  cli: 0,  con: 1,  user: 3, type: 'call',           subject: 'Revisión avance sprint 3' },
  { id: uid('act-3'),  opp: 1,  cli: 1,  con: 2,  user: 1, type: 'proposal_sent',  subject: 'Propuesta App delivery v2' },
  { id: uid('act-4'),  opp: 1,  cli: 1,  con: 2,  user: 2, type: 'demo',           subject: 'Demo prototipo UI' },
  { id: uid('act-5'),  opp: 2,  cli: 2,  con: 3,  user: 1, type: 'meeting',        subject: 'Workshop requisitos e-commerce' },
  { id: uid('act-6'),  opp: 3,  cli: 3,  con: 4,  user: 5, type: 'call',           subject: 'Revisión contract terms' },
  { id: uid('act-7'),  opp: 4,  cli: 4,  con: 5,  user: 5, type: 'meeting',        subject: 'Arquitectura microservicios' },
  { id: uid('act-8'),  opp: 5,  cli: 5,  con: 6,  user: 1, type: 'email',          subject: 'Seguimiento propuesta Tigo' },
  { id: uid('act-9'),  opp: 6,  cli: 6,  con: 7,  user: 5, type: 'meeting',        subject: 'Discovery session reservas' },
  { id: uid('act-10'), opp: 7,  cli: 7,  con: 8,  user: 1, type: 'note',           subject: 'Notas cierre exitoso scoring' },
  { id: uid('act-11'), opp: 10, cli: 10, con: 10, user: 5, type: 'call',           subject: 'Intro call data pipeline' },
  { id: uid('act-12'), opp: 11, cli: 0,  con: 0,  user: 1, type: 'follow_up',      subject: 'Seguimiento fase 2 analytics' },
  { id: uid('act-13'), opp: 14, cli: 1,  con: 2,  user: 2, type: 'meeting',        subject: 'Workshop QA automation' },
  { id: uid('act-14'), opp: null,cli: 9, con: null,user: 1, type: 'email',          subject: 'Primer contacto Globant' },
  { id: uid('act-15'), opp: null,cli: 11,con: 11, user: 1, type: 'call',           subject: 'Intro Carvajal modernización' },
];

const INTERNAL_INITIATIVES = [
  { id: uid('ii-1'), code: 'II-TECH-2026-00001', name: 'Migración a TypeScript del Quoter', area: 'technology', budget: 15000, hrs: 200, status: 'active' },
  { id: uid('ii-2'), code: 'II-PROD-2026-00001', name: 'Diseño del Design System v2',       area: 'product',    budget: 8000,  hrs: 120, status: 'active' },
  { id: uid('ii-3'), code: 'II-HR-2026-00001',   name: 'Programa de mentoría técnica',      area: 'hr',         budget: 5000,  hrs: 80,  status: 'paused' },
];

const QUOTATIONS = [
  { id: uid('qt-1'), type: 'staff_aug',   project: 'Staff Aug — Backend Kavak MX',     client: 'Kavak México',       status: 'approved', cli: 3,  opp: 3 },
  { id: uid('qt-2'), type: 'fixed_scope', project: 'Scoring crediticio ML — Finaktiva', client: 'Finaktiva',          status: 'approved', cli: 7,  opp: 7 },
  { id: uid('qt-3'), type: 'staff_aug',   project: 'Frontend MeLi CO',                 client: 'Mercado Libre CO',   status: 'sent',     cli: 4,  opp: 4 },
  { id: uid('qt-4'), type: 'fixed_scope', project: 'Portal e-commerce Éxito',          client: 'Grupo Éxito',        status: 'draft',    cli: 2,  opp: 2 },
  { id: uid('qt-5'), type: 'staff_aug',   project: 'Data Eng TechCo Austin',           client: 'TechCo Austin',      status: 'sent',     cli: 10, opp: 10 },
  { id: uid('qt-6'), type: 'fixed_scope', project: 'QA Automation Rappi',              client: 'Rappi',              status: 'draft',    cli: 1,  opp: 14 },
];

const BUDGETS = [
  { id: uid('bud-1'), year: 2026, quarter: 1, country: 'Colombia',       target: 500000,  status: 'closed' },
  { id: uid('bud-2'), year: 2026, quarter: 2, country: 'Colombia',       target: 650000,  status: 'active' },
  { id: uid('bud-3'), year: 2026, quarter: 2, country: 'México',         target: 200000,  status: 'active' },
  { id: uid('bud-4'), year: 2026, quarter: 2, country: 'Estados Unidos', target: 350000,  status: 'active' },
  { id: uid('bud-5'), year: 2026, quarter: 3, country: null,             target: 900000,  status: 'draft' },
];

// ── Main seed function ───────────────────────────────────────────────
async function seed() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const hash = await bcrypt.hash('123456', 10);

    // 1. Users
    for (const u of USERS) {
      await client.query(`
        INSERT INTO users (id, email, password_hash, name, role, function, must_change_password, active)
        VALUES ($1,$2,$3,$4,$5,$6,false,true)
        ON CONFLICT DO NOTHING
      `, [u.id, u.email, hash, u.name, u.role, u.fn]);
    }

    // 2. Squads
    for (const s of SQUADS) {
      await client.query(`
        INSERT INTO squads (id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING
      `, [s.id, s.name]);
    }

    // 3. Clients
    for (const c of CLIENTS) {
      await client.query(`
        INSERT INTO clients (id, name, country, industry, tier, preferred_currency, active, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,true,$7)
        ON CONFLICT DO NOTHING
      `, [c.id, c.name, c.country, c.industry, c.tier, c.currency, ADMIN_ID]);
    }

    // 4. Employees — look up area IDs dynamically
    const areaRows = await client.query('SELECT id, key FROM areas');
    const areaMap = {};
    for (const r of areaRows.rows) areaMap[r.key] = r.id;

    for (const e of EMPLOYEES) {
      await client.query(`
        INSERT INTO employees (id, first_name, last_name, country, city, area_id, level, status,
          weekly_capacity_hours, employment_type, start_date, squad_id, created_by, languages)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'fulltime',$10,$11,$12,'["español"]'::jsonb)
        ON CONFLICT DO NOTHING
      `, [e.id, e.fn, e.ln, e.country, e.city, areaMap[e.area], e.level, e.status,
          e.cap, d(-365 - Math.floor(Math.random() * 400)),
          e.squad !== null ? SQUADS[e.squad]?.id || null : null, ADMIN_ID]);
    }

    // 5. Employee skills — assign 2–4 skills to each active employee
    const skillRows = await client.query('SELECT id, name, category FROM skills ORDER BY id');
    const skills = skillRows.rows;
    const proficiencies = ['beginner', 'intermediate', 'advanced', 'expert'];
    for (let i = 0; i < EMPLOYEES.length; i++) {
      const e = EMPLOYEES[i];
      if (e.status === 'terminated') continue;
      const count = 2 + (i % 3);
      for (let j = 0; j < count && j < skills.length; j++) {
        const sk = skills[(i * 7 + j * 3) % skills.length];
        await client.query(`
          INSERT INTO employee_skills (id, employee_id, skill_id, proficiency, years_experience)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT DO NOTHING
        `, [uid(`es-${i}-${j}`), e.id, sk.id, proficiencies[(i + j) % 4], 1 + (i % 8)]);
      }
    }

    // 6. Opportunities
    for (let i = 0; i < OPPORTUNITIES.length; i++) {
      const o = OPPORTUNITIES[i];
      const cliId = CLIENTS[o.cli].id;
      const ownerId = USERS[o.owner].id;
      const presalesId = USERS[2].id;
      const squadId = SQUADS[i % SQUADS.length].id;
      await client.query(`
        INSERT INTO opportunities (id, client_id, name, account_owner_id, presales_lead_id,
          squad_id, status, revenue_type, one_time_amount_usd, mrr_usd, contract_length_months,
          booking_amount_usd, deal_type, funding_source, opportunity_number,
          expected_close_date, country, postponed_until_date, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($9::numeric,0),$12,'client_direct',$13,$14,
          (SELECT country FROM clients WHERE id=$2),$15,$4)
        ON CONFLICT DO NOTHING
      `, [o.id, cliId, o.name, ownerId, presalesId, squadId, o.status,
          o.rev, o.ota || null, o.mrr || null, o.months || null,
          o.deal, o.onum, d(30 + i * 15), o.postponed || null]);
    }

    // 7. Contacts
    for (const c of CONTACTS) {
      await client.query(`
        INSERT INTO contacts (id, client_id, first_name, last_name, job_title, email_primary, seniority, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING
      `, [c.id, CLIENTS[c.cli].id, c.fn, c.ln, c.title, c.email, c.seniority, ADMIN_ID]);
    }

    // 8. Opportunity contacts
    for (let i = 0; i < Math.min(OPPORTUNITIES.length, CONTACTS.length); i++) {
      const roles = ['champion', 'economic_buyer', 'decision_maker', 'technical_evaluator', 'influencer'];
      await client.query(`
        INSERT INTO opportunity_contacts (id, opportunity_id, contact_id, deal_role)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING
      `, [uid(`oc-${i}`), OPPORTUNITIES[i].id, CONTACTS[i % CONTACTS.length].id, roles[i % roles.length]]);
    }

    // 9. Activities
    for (let i = 0; i < ACTIVITIES.length; i++) {
      const a = ACTIVITIES[i];
      await client.query(`
        INSERT INTO activities (id, opportunity_id, client_id, contact_id, user_id, activity_type,
          subject, activity_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING
      `, [a.id,
          a.opp !== null ? OPPORTUNITIES[a.opp].id : null,
          CLIENTS[a.cli].id,
          a.con !== null ? CONTACTS[a.con].id : null,
          USERS[a.user].id,
          a.type, a.subject,
          new Date(Date.now() - (ACTIVITIES.length - i) * 86400000 * 2).toISOString()]);
    }

    // 10. Contracts
    for (let i = 0; i < CONTRACTS.length; i++) {
      const c = CONTRACTS[i];
      const oppId = c.opp !== null ? OPPORTUNITIES[c.opp].id : null;
      await client.query(`
        INSERT INTO contracts (id, name, client_id, opportunity_id, type, contract_subtype, status,
          start_date, end_date, total_value_usd, account_owner_id, delivery_manager_id,
          squad_id, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT DO NOTHING
      `, [c.id, c.name, CLIENTS[c.cli].id, oppId, c.type, c.subtype, c.status,
          c.start, c.end, c.val, USERS[1].id, USERS[3].id,
          SQUADS[c.squad].id, ADMIN_ID]);
    }

    // 11. Resource requests
    for (const r of RESOURCE_REQUESTS) {
      await client.query(`
        INSERT INTO resource_requests (id, contract_id, role_title, area_id, level,
          weekly_hours, start_date, end_date, priority, status, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING
      `, [r.id, CONTRACTS[r.ctr].id, r.role, areaMap[r.area], r.level,
          r.hrs, CONTRACTS[r.ctr].start, CONTRACTS[r.ctr].end,
          r.prio, r.status, ADMIN_ID]);
    }

    // 12. Assignments
    for (const a of ASSIGNMENTS) {
      await client.query(`
        INSERT INTO assignments (id, resource_request_id, employee_id, contract_id,
          weekly_hours, start_date, end_date, status, role_title, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT DO NOTHING
      `, [a.id, RESOURCE_REQUESTS[a.rr].id, EMPLOYEES[a.emp].id, CONTRACTS[a.ctr].id,
          a.hrs, CONTRACTS[a.ctr].start, CONTRACTS[a.ctr].end,
          a.status, a.role, ADMIN_ID]);
    }

    // 13. Weekly time allocations — last 4 weeks for active assignments
    const activeAssignments = ASSIGNMENTS.filter(a => a.status === 'active');
    for (let w = -3; w <= 0; w++) {
      const weekStart = monday(w);
      for (const a of activeAssignments) {
        const pct = Math.min(100, Math.round((a.hrs / 40) * 100 + (Math.random() * 10 - 5)));
        await client.query(`
          INSERT INTO weekly_time_allocations (id, employee_id, week_start_date, assignment_id,
            pct, created_by, updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$6)
          ON CONFLICT DO NOTHING
        `, [uid(`wta-${a.id}-${w}`), EMPLOYEES[a.emp].id, weekStart, a.id,
            Math.max(0, Math.min(100, pct)), ADMIN_ID]);
      }
    }

    // 14. Revenue periods — 3 months for active contracts
    for (let m = -2; m <= 0; m++) {
      const period = yyyymm(m);
      for (const c of CONTRACTS.filter(x => x.status === 'active')) {
        const monthly = Math.round(c.val / 6);
        await client.query(`
          INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, status, created_by)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT DO NOTHING
        `, [c.id, period, monthly, m < 0 ? 'closed' : 'open', ADMIN_ID]);
      }
    }

    // 15. Exchange rates — COP, MXN, GTQ for last 3 months
    const rates = { COP: 4150, MXN: 17.2, GTQ: 7.8, EUR: 0.92 };
    for (let m = -2; m <= 0; m++) {
      const period = yyyymm(m);
      for (const [cur, base] of Object.entries(rates)) {
        const jitter = base * (1 + (m * 0.005));
        await client.query(`
          INSERT INTO exchange_rates (yyyymm, currency, usd_rate, updated_by)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT DO NOTHING
        `, [period, cur, Math.round(jitter * 100) / 100, ADMIN_ID]);
      }
    }

    // 16. Employee costs — last 2 months for active employees
    const activeEmps = EMPLOYEES.filter(e => e.status !== 'terminated');
    const costByLevel = { L1: 863, L2: 1207, L3: 1797, L4: 2388, L5: 3148, L6: 3907, L7: 4666, L8: 5426, L9: 6185, L10: 7071, L11: 7957 };
    for (let m = -1; m <= 0; m++) {
      const period = yyyymm(m);
      for (const e of activeEmps) {
        const cost = costByLevel[e.level] || 3000;
        const cur = (e.country === 'Colombia') ? 'COP' : 'USD';
        const gross = cur === 'COP' ? cost * 4150 : cost;
        await client.query(`
          INSERT INTO employee_costs (id, employee_id, period, currency, gross_cost, cost_usd,
            exchange_rate_used, source, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8)
          ON CONFLICT DO NOTHING
        `, [uid(`ec-${e.id}-${m}`), e.id, period, cur, Math.round(gross), cost,
            cur === 'COP' ? 4150 : 1, ADMIN_ID]);
      }
    }

    // 17. Internal initiatives
    for (const ii of INTERNAL_INITIATIVES) {
      await client.query(`
        INSERT INTO internal_initiatives (id, initiative_code, name, business_area_id, budget_usd,
          hours_estimated, status, start_date, operations_owner_id, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
        ON CONFLICT DO NOTHING
      `, [ii.id, ii.code, ii.name, ii.area, ii.budget, ii.hrs, ii.status,
          d(-60), USERS[5].id, ADMIN_ID]);
    }

    // 18. Internal initiative assignments
    const iiAssignments = [
      { ii: 0, emp: 8,  hrs: 10, status: 'active' },
      { ii: 0, emp: 23, hrs: 8,  status: 'active' },
      { ii: 1, emp: 3,  hrs: 12, status: 'active' },
      { ii: 1, emp: 21, hrs: 8,  status: 'active' },
      { ii: 2, emp: 13, hrs: 5,  status: 'planned' },
    ];
    for (let i = 0; i < iiAssignments.length; i++) {
      const a = iiAssignments[i];
      await client.query(`
        INSERT INTO internal_initiative_assignments (id, internal_initiative_id, employee_id,
          start_date, weekly_hours, status, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT DO NOTHING
      `, [uid(`iia-${i}`), INTERNAL_INITIATIVES[a.ii].id, EMPLOYEES[a.emp].id,
          d(-30), a.hrs, a.status, ADMIN_ID]);
    }

    // 19. Novelties
    const novelties = [
      { emp: 18, type: 'vacation',          start: d(-5),   end: d(5)   },
      { emp: 6,  type: 'sick_leave',        start: d(-3),   end: d(-1)  },
      { emp: 11, type: 'corporate_training',start: d(7),    end: d(9)   },
      { emp: 1,  type: 'vacation',          start: d(20),   end: d(30)  },
      { emp: 3,  type: 'legal_leave',       start: d(-10),  end: d(-8)  },
    ];
    for (let i = 0; i < novelties.length; i++) {
      const n = novelties[i];
      await client.query(`
        INSERT INTO employee_novelties (id, employee_id, novelty_type_id, start_date, end_date,
          status, approved_by, created_by)
        VALUES ($1,$2,$3,$4,$5,'approved',$6,$6)
        ON CONFLICT DO NOTHING
      `, [uid(`nov-${i}`), EMPLOYEES[n.emp].id, n.type, n.start, n.end, ADMIN_ID]);
    }

    // 20. Quotations + lines
    for (const q of QUOTATIONS) {
      await client.query(`
        INSERT INTO quotations (id, type, status, project_name, client_name, client_id,
          opportunity_id, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING
      `, [q.id, q.type, q.status, q.project, q.client,
          CLIENTS[q.cli].id, OPPORTUNITIES[q.opp].id, USERS[2].id]);
    }

    const lineTemplates = [
      { spec: 'Backend',  role: 'Backend Developer',  lvl: 5, hrs: 40, dur: 6, costH: 20, rateH: 55, rateM: 8800, qty: 2 },
      { spec: 'Frontend', role: 'Frontend Developer', lvl: 5, hrs: 40, dur: 6, costH: 20, rateH: 50, rateM: 8000, qty: 1 },
      { spec: 'QA',       role: 'QA Engineer',        lvl: 4, hrs: 20, dur: 6, costH: 15, rateH: 40, rateM: 3200, qty: 1 },
      { spec: 'Data',     role: 'Data Engineer',      lvl: 7, hrs: 40, dur: 4, costH: 35, rateH: 85, rateM: 13600,qty: 1 },
      { spec: 'DevOps',   role: 'DevOps Engineer',    lvl: 6, hrs: 20, dur: 6, costH: 25, rateH: 65, rateM: 5200, qty: 1 },
      { spec: 'PM',       role: 'Project Manager',    lvl: 7, hrs: 20, dur: 6, costH: 30, rateH: 70, rateM: 5600, qty: 1 },
    ];
    for (let qi = 0; qi < QUOTATIONS.length; qi++) {
      const numLines = 2 + (qi % 3);
      for (let li = 0; li < numLines; li++) {
        const t = lineTemplates[(qi + li) % lineTemplates.length];
        await client.query(`
          INSERT INTO quotation_lines (id, quotation_id, sort_order, specialty, role_title,
            level, quantity, duration_months, hours_per_week, cost_hour, rate_hour, rate_month, total)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT DO NOTHING
        `, [uid(`ql-${qi}-${li}`), QUOTATIONS[qi].id, li, t.spec, t.role,
            t.lvl, t.qty, t.dur, t.hrs, t.costH, t.rateH, t.rateM,
            t.rateM * t.dur * t.qty]);
      }
    }

    // 21. Budgets
    for (const b of BUDGETS) {
      await client.query(`
        INSERT INTO budgets (id, period_year, period_quarter, country, target_usd, status, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT DO NOTHING
      `, [b.id, b.year, b.quarter, b.country, b.target, b.status, ADMIN_ID]);
    }

    await client.query('COMMIT');

    // Summary
    const counts = await client.query(`
      SELECT
        (SELECT count(*) FROM users)       AS users,
        (SELECT count(*) FROM clients)     AS clients,
        (SELECT count(*) FROM employees)   AS employees,
        (SELECT count(*) FROM opportunities) AS opportunities,
        (SELECT count(*) FROM contracts)   AS contracts,
        (SELECT count(*) FROM assignments) AS assignments,
        (SELECT count(*) FROM contacts)    AS contacts,
        (SELECT count(*) FROM activities)  AS activities,
        (SELECT count(*) FROM quotations)  AS quotations
    `);
    console.log('Synthetic seed completed. Row counts:', counts.rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('Synthetic seed FAILED:', err);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
