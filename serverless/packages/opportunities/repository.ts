import type { Pool, PoolClient } from 'pg';
import type { PaginatedResult, AuthUser } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import { canSeeAll } from '@shared/auth/rbac';
import type {
  Opportunity, OpportunityFilters, KanbanResult, Stage,
} from './types';
import {
  SORTABLE, PIPELINE_STAGES, KANBAN_PER_COLUMN,
  REVENUE_TYPES, FUNDING_SOURCES, VALID_DEAL_TYPES, VALID_CONTRACT_TYPES,
} from './types';

/* ------------------------------------------------------------------ */
/*  Repository interface                                               */
/* ------------------------------------------------------------------ */

export interface OpportunityRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: OpportunityFilters;
    sort: ReturnType<typeof parseSort>;
    user: AuthUser;
  }): Promise<PaginatedResult<Opportunity>>;

  findById(id: string): Promise<Opportunity | null>;

  create(data: Record<string, unknown>, createdBy: string): Promise<Opportunity>;

  update(id: string, data: Record<string, unknown>): Promise<Opportunity | null>;

  softDelete(id: string): Promise<Opportunity | null>;

  kanban(params: {
    filters: OpportunityFilters;
    user: AuthUser;
  }): Promise<KanbanResult>;

  lookup(params: { search?: string; client_id?: string; user: AuthUser }): Promise<{ id: string; name: string; client_name: string; status: string }[]>;

  updateStatus(id: string, data: Record<string, unknown>, conn: PoolClient): Promise<Opportunity | null>;

  countQuotations(id: string): Promise<number>;

  generateOpportunityNumber(country: string | null): Promise<string>;

  findByIdForUpdate(id: string, conn: PoolClient): Promise<Opportunity | null>;

  findWinningQuotation(quotationId: string, opportunityId: string, conn: PoolClient): Promise<Record<string, unknown> | null>;

  createContract(data: Record<string, unknown>, conn: PoolClient): Promise<Record<string, unknown>>;

  existingContract(opportunityId: string, conn: PoolClient): Promise<{ id: string } | null>;

  rejectSentQuotations(opportunityId: string, conn: PoolClient): Promise<string[]>;

  promoteQuotation(quotationId: string, conn: PoolClient): Promise<void>;

  autoComputeCost(opportunityId: string): Promise<number>;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createOpportunityRepository(db: Pool): OpportunityRepository {

  /** Build RBAC WHERE clauses based on user role */
  function addRbacScope(user: AuthUser, wheres: string[], add: (v: unknown) => string): void {
    if (user.role === 'external') return; // blocked at handler level
    if (canSeeAll(user)) return; // superadmin, admin, director

    if (user.role === 'lead' && user.squad_id) {
      wheres.push(`o.squad_id = ${add(user.squad_id)}`);
    } else {
      wheres.push(`(o.account_owner_id = ${add(user.id)} OR o.presales_lead_id = ${add(user.id)})`);
    }
  }

  /** Build common filter WHERE clauses */
  function addFilterClauses(
    filters: OpportunityFilters,
    wheres: string[],
    add: (v: unknown) => string,
  ): void {
    if (filters.search) {
      const like = '%' + filters.search + '%';
      wheres.push(`(LOWER(o.name) LIKE LOWER(${add(like)}) OR LOWER(o.description) LIKE LOWER(${add(like)}))`);
    }
    if (filters.client_id) wheres.push(`o.client_id = ${add(filters.client_id)}`);
    if (filters.status) wheres.push(`o.status = ${add(filters.status)}`);
    if (filters.stage) wheres.push(`o.status = ${add(filters.stage)}`);
    if (filters.deal_type && (VALID_DEAL_TYPES as readonly string[]).includes(filters.deal_type)) {
      wheres.push(`o.deal_type = ${add(filters.deal_type)}`);
    }
    if (filters.contract_type && (VALID_CONTRACT_TYPES as readonly string[]).includes(filters.contract_type)) {
      wheres.push(`o.contract_type = ${add(filters.contract_type)}`);
    }
    if (filters.account_owner_id) wheres.push(`o.account_owner_id = ${add(filters.account_owner_id)}`);
    if (filters.squad_id) wheres.push(`o.squad_id = ${add(filters.squad_id)}`);
    if (filters.revenue_type && (REVENUE_TYPES as readonly string[]).includes(filters.revenue_type)) {
      wheres.push(`o.revenue_type = ${add(filters.revenue_type)}`);
    }
    if (filters.funding_source && (FUNDING_SOURCES as readonly string[]).includes(filters.funding_source)) {
      wheres.push(`o.funding_source = ${add(filters.funding_source)}`);
    }
    if (filters.from_expected_close) wheres.push(`o.expected_close_date >= ${add(filters.from_expected_close)}`);
    if (filters.to_expected_close) wheres.push(`o.expected_close_date <= ${add(filters.to_expected_close)}`);
    if (filters.has_champion === 'true') wheres.push('o.champion_identified = true');
    if (filters.has_champion === 'false') wheres.push('o.champion_identified = false');
    if (filters.has_economic_buyer === 'true') wheres.push('o.economic_buyer_identified = true');
    if (filters.has_economic_buyer === 'false') wheres.push('o.economic_buyer_identified = false');
  }

  return {
    /* ---- LIST (paginated, filtered, RBAC-scoped) ---- */
    async findAll({ page, limit, offset, filters, sort, user }) {
      const wheres = ['o.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      addFilterClauses(filters, wheres, add);
      addRbacScope(user, wheres, add);

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM opportunities o ${where}`, countParams),
        db.query(
          `SELECT o.*,
             c.name AS client_name,
             co.name AS co_owner_name,
             (SELECT COUNT(*)::int FROM quotations q WHERE q.opportunity_id=o.id) AS quotations_count
           FROM opportunities o
           LEFT JOIN clients c ON c.id = o.client_id
           LEFT JOIN users co ON co.id = o.co_owner_id
           ${where}
           ORDER BY ${sort.orderBy || 'o.created_at DESC'}
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...params, limit, offset],
        ),
      ]);

      const total = countRes.rows[0].total;
      return {
        data: rowsRes.rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      };
    },

    /* ---- GET ONE ---- */
    async findById(id) {
      const { rows } = await db.query(
        `SELECT o.*,
           c.id   AS client__id,
           c.name AS client__name,
           c.country AS client__country,
           c.tier    AS client__tier,
           (SELECT COUNT(*)::int FROM quotations q WHERE q.opportunity_id=o.id) AS quotations_count
         FROM opportunities o
         LEFT JOIN clients c ON c.id = o.client_id
         WHERE o.id=$1 AND o.deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    /* ---- CREATE ---- */
    async create(data, createdBy) {
      const { rows } = await db.query(
        `INSERT INTO opportunities
           (client_id, name, description, account_owner_id, presales_lead_id, squad_id,
            expected_close_date, tags, external_crm_id, created_by,
            country, opportunity_number,
            revenue_type, one_time_amount_usd, mrr_usd, contract_length_months,
            champion_identified, economic_buyer_identified,
            funding_source, funding_amount_usd, drive_url, booking_amount_usd,
            deal_type, co_owner_id, contract_type,
            context_client, context_scope, context_pains, context_requirements, context_politics)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                 $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
                 $26,$27,$28,$29,$30)
         RETURNING *`,
        [
          data.client_id,
          data.name,
          data.description || null,
          data.account_owner_id,
          data.presales_lead_id || null,
          data.squad_id,
          data.expected_close_date || null,
          data.tags || null,
          data.external_crm_id || null,
          createdBy,
          data.country || null,
          data.opportunity_number,
          data.revenue_type,
          data.one_time_amount_usd != null ? Number(data.one_time_amount_usd) : null,
          data.mrr_usd != null ? Number(data.mrr_usd) : null,
          data.contract_length_months != null ? Number(data.contract_length_months) : null,
          Boolean(data.champion_identified),
          Boolean(data.economic_buyer_identified),
          data.funding_source,
          data.funding_amount_usd != null ? Number(data.funding_amount_usd) : null,
          data.drive_url || null,
          data.booking_amount_usd,
          data.deal_type,
          data.co_owner_id || null,
          data.contract_type || null,
          data.context_client || null,
          data.context_scope || null,
          data.context_pains || null,
          data.context_requirements || null,
          data.context_politics || null,
        ],
      );
      return rows[0];
    },

    /* ---- UPDATE ---- */
    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE opportunities SET
            name                      = COALESCE($1, name),
            description               = COALESCE($2, description),
            account_owner_id          = COALESCE($3, account_owner_id),
            presales_lead_id          = COALESCE($4, presales_lead_id),
            squad_id                  = COALESCE($5, squad_id),
            expected_close_date       = COALESCE($6, expected_close_date),
            tags                      = COALESCE($7, tags),
            external_crm_id           = COALESCE($8, external_crm_id),
            revenue_type              = COALESCE($10, revenue_type),
            one_time_amount_usd       = COALESCE($11, one_time_amount_usd),
            mrr_usd                   = COALESCE($12, mrr_usd),
            contract_length_months    = COALESCE($13, contract_length_months),
            champion_identified       = COALESCE($14, champion_identified),
            economic_buyer_identified = COALESCE($15, economic_buyer_identified),
            funding_source            = COALESCE($16, funding_source),
            funding_amount_usd        = COALESCE($17, funding_amount_usd),
            drive_url                 = COALESCE($18, drive_url),
            deal_type                 = COALESCE($19, deal_type),
            co_owner_id               = COALESCE($20, co_owner_id),
            contract_type             = COALESCE($26, contract_type),
            context_client            = COALESCE($21, context_client),
            context_scope             = COALESCE($22, context_scope),
            context_pains             = COALESCE($23, context_pains),
            context_requirements      = COALESCE($24, context_requirements),
            context_politics          = COALESCE($25, context_politics),
            updated_at                = NOW()
          WHERE id=$9 AND deleted_at IS NULL
          RETURNING *`,
        [
          data.name ? String(data.name).trim() : null,
          data.description ?? null,
          data.account_owner_id ?? null,
          data.presales_lead_id ?? null,
          data.squad_id ?? null,
          data.expected_close_date ?? null,
          data.tags ?? null,
          data.external_crm_id ?? null,
          id,
          data.revenue_type ?? null,
          data.one_time_amount_usd != null ? Number(data.one_time_amount_usd) : null,
          data.mrr_usd != null ? Number(data.mrr_usd) : null,
          data.contract_length_months != null ? Number(data.contract_length_months) : null,
          data.champion_identified != null ? Boolean(data.champion_identified) : null,
          data.economic_buyer_identified != null ? Boolean(data.economic_buyer_identified) : null,
          data.funding_source ?? null,
          data.funding_amount_usd != null ? Number(data.funding_amount_usd) : null,
          data.drive_url ?? null,
          data.deal_type ?? null,
          data.co_owner_id ?? null,
          data.context_client ?? null,
          data.context_scope ?? null,
          data.context_pains ?? null,
          data.context_requirements ?? null,
          data.context_politics ?? null,
          data.contract_type ?? null,
        ],
      );
      return rows[0] ?? null;
    },

    /* ---- SOFT DELETE ---- */
    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE opportunities SET deleted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    /* ---- KANBAN ---- */
    async kanban({ filters, user }) {
      const wheres = ['o.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      addFilterClauses(filters, wheres, add);
      addRbacScope(user, wheres, add);

      const where = 'WHERE ' + wheres.join(' AND ');

      const { rows } = await db.query(
        `SELECT o.id, o.name, o.status, o.client_id, o.account_owner_id,
                o.expected_close_date, o.booking_amount_usd, o.weighted_amount_usd,
                o.probability, o.last_stage_change_at, o.next_step, o.next_step_due_date,
                o.created_at,
                o.revenue_type, o.one_time_amount_usd, o.mrr_usd, o.contract_length_months,
                o.champion_identified, o.economic_buyer_identified,
                o.funding_source, o.funding_amount_usd,
                c.name AS client_name,
                u.name AS owner_name, u.email AS owner_email,
                EXTRACT(DAY FROM NOW() - o.last_stage_change_at)::int AS days_in_current_stage,
                (SELECT COUNT(*)::int FROM quotations q WHERE q.opportunity_id=o.id) AS quotations_count
           FROM opportunities o
           LEFT JOIN clients c ON c.id = o.client_id
           LEFT JOIN users u ON u.id = o.account_owner_id
           ${where}
           ORDER BY o.last_stage_change_at DESC`,
        params,
      );

      const byStage: Record<string, { stage: typeof PIPELINE_STAGES[0]; opportunities: Record<string, unknown>[]; count: number; total_usd: number; weighted_usd: number }> = {};
      PIPELINE_STAGES.forEach(s => {
        byStage[s.id] = { stage: s, opportunities: [], count: 0, total_usd: 0, weighted_usd: 0 };
      });

      rows.forEach((r: Record<string, unknown>) => {
        const bucket = byStage[r.status as string] || byStage['lead'];
        bucket.count += 1;
        bucket.total_usd += Number(r.booking_amount_usd || 0);
        bucket.weighted_usd += Number(r.weighted_amount_usd || 0);
        if (bucket.opportunities.length < KANBAN_PER_COLUMN) bucket.opportunities.push(r);
      });

      const stages = PIPELINE_STAGES.map(s => {
        const bucket = byStage[s.id];
        return {
          id: s.id,
          label: s.label,
          prob: s.prob,
          color: s.color,
          terminal: s.terminal,
          sort: s.sort,
          summary: {
            count: bucket.count,
            total_amount_usd: Math.round(bucket.total_usd * 100) / 100,
            weighted_amount_usd: Math.round(bucket.weighted_usd * 100) / 100,
            has_more: bucket.count > bucket.opportunities.length,
          },
          opportunities: bucket.opportunities as Partial<Opportunity>[],
        };
      });

      const global_summary = stages.reduce(
        (acc, s) => {
          acc.total_opportunities += s.summary.count;
          acc.total_amount_usd += s.summary.total_amount_usd;
          acc.weighted_amount_usd += s.summary.weighted_amount_usd;
          return acc;
        },
        { total_opportunities: 0, total_amount_usd: 0, weighted_amount_usd: 0 },
      );
      global_summary.total_amount_usd = Math.round(global_summary.total_amount_usd * 100) / 100;
      global_summary.weighted_amount_usd = Math.round(global_summary.weighted_amount_usd * 100) / 100;

      return { stages, global_summary };
    },

    /* ---- LOOKUP (lightweight for dropdowns) ---- */
    async lookup({ search, client_id, user }) {
      const wheres = ['o.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (search) {
        wheres.push(`LOWER(o.name) LIKE LOWER(${add('%' + search + '%')})`);
      }
      if (client_id) wheres.push(`o.client_id = ${add(client_id)}`);
      addRbacScope(user, wheres, add);

      const where = 'WHERE ' + wheres.join(' AND ');

      const { rows } = await db.query(
        `SELECT o.id, o.name, c.name AS client_name, o.status
         FROM opportunities o
         LEFT JOIN clients c ON c.id = o.client_id
         ${where}
         ORDER BY o.name ASC
         LIMIT 200`,
        params,
      );
      return rows;
    },

    /* ---- UPDATE STATUS (within a transaction) ---- */
    async updateStatus(id, data, conn) {
      const { rows } = await conn.query(
        `UPDATE opportunities SET
            status               = $1,
            outcome              = COALESCE($2, outcome),
            outcome_reason       = COALESCE($3, outcome_reason),
            outcome_notes        = COALESCE($4, outcome_notes),
            winning_quotation_id = COALESCE($5, winning_quotation_id),
            closed_at            = CASE WHEN $6::boolean THEN NOW() ELSE closed_at END,
            postponed_until_date = CASE
                                     WHEN $7::boolean THEN NULL
                                     WHEN $8::date IS NOT NULL THEN $8::date
                                     ELSE postponed_until_date
                                   END,
            postponed_reason     = CASE
                                     WHEN $7::boolean THEN NULL
                                     WHEN $9::text IS NOT NULL THEN $9::text
                                     ELSE postponed_reason
                                   END,
            loss_reason          = COALESCE($11, loss_reason),
            loss_reason_detail   = COALESCE($12, loss_reason_detail),
            updated_at           = NOW()
          WHERE id=$10 AND deleted_at IS NULL RETURNING *`,
        [
          data.new_status,
          data.outcome_value,
          data.outcome_reason || null,
          data.outcome_notes || null,
          data.winning_quotation_id || null,
          data.closing_now,
          data.clear_postponed,
          data.postponed_until_date || null,
          data.postponed_reason || null,
          id,
          data.loss_reason || null,
          data.loss_reason_detail || null,
        ],
      );
      return rows[0] ?? null;
    },

    /* ---- COUNT QUOTATIONS (for delete guard) ---- */
    async countQuotations(id) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS count FROM quotations WHERE opportunity_id=$1`,
        [id],
      );
      return rows[0].count;
    },

    /* ---- GENERATE OPPORTUNITY NUMBER ---- */
    async generateOpportunityNumber(country) {
      const ccRaw = String(country || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
      const cc = ccRaw || 'XX';
      const year = new Date().getUTCFullYear();
      const { rows } = await db.query(
        `SELECT COALESCE(MAX(
            CAST(SUBSTRING(opportunity_number FROM '\\d+$') AS INTEGER)
          ), 0) + 1 AS next_seq
         FROM opportunities
         WHERE opportunity_number LIKE $1`,
        [`OPP-${cc}-${year}-%`],
      );
      const seq = rows[0].next_seq || 1;
      return `OPP-${cc}-${year}-${String(seq).padStart(5, '0')}`;
    },

    /* ---- FIND BY ID FOR UPDATE (with row lock) ---- */
    async findByIdForUpdate(id, conn) {
      const { rows } = await conn.query(
        `SELECT * FROM opportunities WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      return rows[0] ?? null;
    },

    /* ---- FIND WINNING QUOTATION ---- */
    async findWinningQuotation(quotationId, opportunityId, conn) {
      const { rows } = await conn.query(
        `SELECT id, status, type, project_name, currency FROM quotations WHERE id=$1 AND opportunity_id=$2`,
        [quotationId, opportunityId],
      );
      return rows[0] ?? null;
    },

    /* ---- CREATE CONTRACT (side effect of closed_won) ---- */
    async createContract(data, conn) {
      const { rows } = await conn.query(
        `INSERT INTO contracts (
            name, client_id, opportunity_id, winning_quotation_id,
            type, status, start_date, account_owner_id, squad_id,
            total_value_usd, original_currency, created_by, metadata
          ) VALUES ($1,$2,$3,$4,$5,'planned',$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, name, type, total_value_usd, original_currency`,
        [
          data.name, data.client_id, data.opportunity_id, data.winning_quotation_id,
          data.type, data.start_date, data.account_owner_id, data.squad_id,
          data.total_value_usd, data.original_currency, data.created_by,
          JSON.stringify(data.metadata || {}),
        ],
      );
      return rows[0];
    },

    /* ---- EXISTING CONTRACT ---- */
    async existingContract(opportunityId, conn) {
      const { rows } = await conn.query(
        `SELECT id FROM contracts WHERE opportunity_id=$1 AND deleted_at IS NULL`,
        [opportunityId],
      );
      return rows[0] ?? null;
    },

    /* ---- REJECT SENT QUOTATIONS ---- */
    async rejectSentQuotations(opportunityId, conn) {
      const { rows } = await conn.query(
        `UPDATE quotations SET status='rejected', updated_at=NOW()
         WHERE opportunity_id=$1 AND status='sent'
         RETURNING id`,
        [opportunityId],
      );
      return rows.map((r: { id: string }) => r.id);
    },

    /* ---- PROMOTE QUOTATION ---- */
    async promoteQuotation(quotationId, conn) {
      await conn.query(
        `UPDATE quotations SET status='approved', updated_at=NOW() WHERE id=$1`,
        [quotationId],
      );
    },

    /* ---- AUTO-COMPUTE COST FROM QUOTATION LINES ---- */
    async autoComputeCost(opportunityId) {
      const { rows } = await db.query(
        `SELECT COALESCE(SUM(
           CASE
             WHEN ql.rate_hour IS NOT NULL AND ql.rate_hour > 0 AND ql.total IS NOT NULL
               THEN (COALESCE(ql.cost_hour, 0) / ql.rate_hour) * ql.total
             WHEN ql.cost_hour IS NOT NULL
               THEN ql.cost_hour
                    * COALESCE(ql.hours_per_week, 0)
                    * COALESCE(ql.duration_months::numeric, 0) * 4.33
                    * COALESCE(ql.quantity::numeric, 1)
             ELSE 0
           END
         ), 0)::numeric AS estimated_cost_usd
         FROM quotation_lines ql
         JOIN quotations q ON q.id = ql.quotation_id
         WHERE q.opportunity_id = $1`,
        [opportunityId],
      );
      return Number(rows[0].estimated_cost_usd || 0);
    },
  };
}
