# CLAUDE.md — AI Agent Onboarding Guide

> **Last updated:** 2026-05-08.
> **What is this:** The single-source-of-truth for any AI agent (Claude, Copilot, etc.) working on this codebase. Read this FIRST before touching anything.

---

## What is DVPNYX Quoter?

Internal product for DVPNYX that integrates the full **quote → contract → staff → time tracking → EVM → revenue recognition** cycle. Single-tenant, ~30 employees, deployed on EC2.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + CRA 5 + react-router-dom 6 |
| Backend | Node 20 + Express 4 + `pg` (raw SQL, no ORM) |
| Database | PostgreSQL 16 (uuid-ossp, optional pgvector) |
| Deploy | Docker → EC2 via GitHub Actions. Traefik for TLS. |
| Tests | Jest + supertest (server: 1079 tests), Jest + RTL (client: 695 tests) |

## Project Structure

```
client/
  src/
    App.js              — Routes + Layout
    AuthContext.js       — JWT auth + user preferences
    theme.css           — Design tokens (--ds-* variables, OKLCH)
    modules/            — One file per screen (~71 modules)
    shell/              — Reusable components (SearchableSelect, StatusBadge, Sidebar, etc.)
    utils/
      api.js            — Legacy fetch client (quotations only)
      apiV2.js          — Modern client (apiGet/Post/Put/Delete) — USE THIS
      calc.js           — Quotation calculation engine
      countries.js      — Shared LATAM country list
server/
  index.js              — Express mount + middleware + routes
  middleware/auth.js     — JWT verify, RBAC (superadmin > admin > lead > member > viewer)
  routes/<entity>.js    — One file per domain (~37 route files)
  utils/
    http.js             — serverError(), safeRollback()
    events.js           — emitEvent() for audit trail
    evm.js              — Pure EVM calculation engine (PV, EV, AC, KPIs)
    fx.js               — FX conversion (1 USD = N <ccy> convention)
    sanitize.js         — parsePagination, input validators
    calc.js             — Quotation calc (same as client)
  database/
    migrate.js          — Idempotent DDL (~2728 lines, runs every deploy)
    pool.js             — pg pool config
    seed.js             — Demo data (not used in prod)
```

## Critical Conventions

### Backend
- **All SQL parameterized** ($1, $2...). Never interpolate req values.
- **`WHERE deleted_at IS NULL`** on every SELECT (soft delete pattern).
- **`serverError(res, where, err)`** in every catch block.
- **`safeRollback(conn)` + `finally { conn.release() }`** for transactions.
- **`emitEvent(pool, ...)`** after every mutation.
- **Idempotent migrations**: `IF NOT EXISTS`, `DO $$ BEGIN ... END $$` guards. Never destructive.

### Frontend
- **Styles via DS tokens**: `var(--ds-surface)`, `var(--ds-border)`, `var(--ds-accent)`, etc.
- **CSS convention**: CTO mandated migration to CSS classes. New code should use CSS Modules + tokens from theme.css. Legacy inline styles exist but don't add more.
- **`useAuth() || {}`** — defensive, works in tests without provider.
- **`apiGet/apiPost/apiPut/apiDelete`** from `utils/apiV2.js` for all new code.
- **SearchableSelect / FilterableSelect** — the standard dropdown component. Uses `position: fixed` for dropdown to escape overflow containers.

## Core Business Flows

### 1. Quote → Contract → Staff
```
Client → Opportunity → Quotation (staff_aug | fixed_scope)
  → Mark opportunity "won" → Auto-creates Contract
  → Kick-off → Auto-creates Resource Requests from quotation lines
  → Capacity Manager assigns employees via Capacity Planner
```

### 2. EVM (Project Health) — Fixed Scope Projects Only
```
Contract (fixed_scope + winning_quotation + total_value_usd set)
  → Create Baseline:
      BAC Revenue = contract.total_value_usd (manual field)
      BAC Cost = SUM(quotation_lines: cost_hour × hours_per_week × 4.333 × duration_months × quantity)
      WBS = quotation phases with weight proportional to weeks
  → Status Reports (monthly, by PM):
      Per-phase % complete → computes PV, EV, AC, SPI, CPI, EAC, VAC
      AC = time_entries hours × employee_costs hourly rate
      Global progress (EV/BAC) auto-syncs to revenue_periods.real_pct
  → Cost Forecast:
      EAC(staffing) = AC(past) + projected cost of active assignments(future)
```

### 3. Revenue Recognition
```
Project contracts:
  - Plan: projected_pct (cumulative 0..1) entered manually per month
  - Real: AUTO-DRIVEN by EVM status reports (global progress → real_pct)
  - real_usd = (real_pct[month] - real_pct[prev_month]) × total_value_usd

Capacity contracts:
  - Real: AUTO-COMPUTED from assignment rates × daily proration
  - Handles multi-currency via exchange_rates table

Resell contracts:
  - Manual: projected_usd and real_usd entered directly
```

### 4. Time Tracking
```
Employees → weekly_time_allocations (% per assignment per week)
         → time_entries (daily hours, for EVM AC calculation)
Plan-vs-Real report compares planned vs actual with ±10pp tolerance
```

## Key Tables (Simplified)

| Table | Purpose |
|---|---|
| `users` | Auth + roles (superadmin/admin/lead/member/viewer) |
| `employees` | Staff profiles, linked to users |
| `clients` | Customer companies |
| `opportunities` | Sales pipeline (9 stages + postponed) |
| `quotations` | Proposals (staff_aug or fixed_scope type) |
| `quotation_lines` | Team composition per quotation |
| `quotation_phases` | Project phases with weeks |
| `quotation_allocations` | Hours per profile per phase |
| `contracts` | Won opportunities → contracts (capacity/project/resell) |
| `resource_requests` | Staffing needs from contracts |
| `assignments` | Employee ↔ contract staffing |
| `assignment_rate_history` | Client rate changes over time |
| `time_entries` | Daily hours (for EVM AC) |
| `weekly_time_allocations` | Weekly % (for plan-vs-real) |
| `employee_costs` | Monthly cost per employee (YYYYMM, cost_usd) |
| `exchange_rates` | Monthly FX rates (1 USD = N <ccy>) |
| `revenue_periods` | Monthly revenue (projected_usd/pct, real_usd/pct, status) |
| `project_baselines` | EVM baselines (bac_cost, bac_revenue, planned dates) |
| `wbs_packages` | WBS structure tied to baseline (phase/epic/milestone) |
| `wbs_progress` | Per-package progress per status report |
| `project_status_reports` | EVM snapshots (computed_kpis JSONB) |
| `events` | Structured audit log (every mutation) |
| `notifications` | User notifications (polled every 60s) |

## API Patterns

```
GET    /api/<entity>              — List with pagination (?page=&limit=&sort=&dir=)
GET    /api/<entity>/:id          — Detail
POST   /api/<entity>              — Create (admin+)
PUT    /api/<entity>/:id          — Update (admin+)
DELETE /api/<entity>/:id          — Soft delete (admin+)
GET    /api/<entity>/lookup       — Lightweight list for dropdowns
GET    /api/<entity>/export.csv   — CSV export
```

## EVM Endpoints (Project Health)

```
POST /api/projects/:contract_id/baseline              — Create baseline
GET  /api/projects/:contract_id/baseline               — Get active baseline + WBS
POST /api/projects/:contract_id/baseline/rebase        — Re-baseline (admin)
POST /api/projects/:contract_id/status-reports         — Submit status report (auto-syncs revenue)
GET  /api/projects/:contract_id/status-reports         — List reports
GET  /api/projects/:contract_id/health                 — KPIs + health badge
GET  /api/projects/:contract_id/cost-forecast          — AC + future cost from assignments
GET  /api/projects/portfolio-health                    — Portfolio view
POST /api/projects/:contract_id/backfill-revenue       — Sync historical status reports → revenue
POST /api/projects/:contract_id/backfill-bac-cost      — Recalculate BAC cost from quotation
POST /api/projects/:contract_id/closeout               — Close project
```

## Known Issues & Tech Debt

1. **ResourceRequests.test.js** — 8 tests failing (pre-existing, `getByLabelText('Contrato')` mismatch after initiative support WIP).
2. **Inline styles** — Legacy modules use inline styles with hardcoded values. New code should use CSS tokens.
3. **console.error/log** — ~97 instances in server without structured logging. Sentry + pino recommended.
4. **Dual-write quotations** — Both `quotation_lines` (V1) and `quotation_allocations` (V2) maintained simultaneously.
5. **No MFA** — Passwords only. SSO + MFA planned.
6. **No telemetry** — No PostHog/Mixpanel. Unknown which of 71 modules are actually used.
7. **Events table grows** — No retention policy or consumer. INSERT only.
8. **`squad_id`** — Auto-provisioned "DVPNYX Global", not exposed in UI. Schema debt.

## Testing

```bash
# Server (from /server)
npx jest --ci                          # All 1079 tests
npx jest --testPathPattern="revenue"   # Specific suite

# Client (from /client)
npx react-scripts test --watchAll=false --ci    # All 695 tests
npx react-scripts test --testPathPattern="SearchableSelect"  # Specific

# Build check
cd client && npx react-scripts build   # Must pass (eslint errors = build failure)
```

Node binary location: `/Users/danielvillacamacho/.local-node/node-v20.18.1-darwin-arm64/bin/`

## Git Workflow

- **`main`** — production branch, auto-deploys via GitHub Actions
- **`develop`** — integration branch, synced with main as of 2026-05-08
- Feature branches: `feat/`, `fix/`, `chore/`
- PRs merge to develop → develop merges to main for release
- Migrations are idempotent — safe to run on every deploy

## Deployment

```bash
# Local dev
docker compose -f docker-compose.dev.yml up --build

# Production
# GitHub Actions auto-deploys main to quoter.doublevpartners.com
# Traefik handles TLS (Let's Encrypt)
# Auto-rollback on health check failure
```

## Currency & FX Convention

- `exchange_rates` table: `1 USD = N <currency>` (e.g., USDCOP = 4200 means 1 USD = 4200 COP)
- `fx.convert(amount, fromCcy, toCcy, yyyymm, rates)` — converts via USD intermediary
- Contracts have `total_value_usd` (amount) + `original_currency` (the actual currency)
- Field name `total_value_usd` is misleading — it stores the amount in `original_currency`

## Files You'll Touch Most

| What | File |
|---|---|
| Add a route | `server/routes/<entity>.js` + mount in `server/index.js` |
| Add a screen | `client/src/modules/<Entity>.js` + register in `App.js` + `Sidebar.js` |
| DB migration | Append to end of `server/database/migrate.js` (idempotent block) |
| Shared dropdown component | `client/src/shell/SearchableSelect.js` (or `FilterableSelect.js` wrapper) |
| EVM calculations | `server/utils/evm.js` (pure functions, no DB) |
| Revenue logic | `server/routes/revenue.js` |
| FX conversion | `server/utils/fx.js` |
| Auth/RBAC | `server/middleware/auth.js` |
