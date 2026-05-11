import type { Pool } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type { Budget, BudgetFilters, BudgetSummaryRow } from './types';
import { BUDGET_SORTABLE } from './types';

export interface BudgetRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: BudgetFilters;
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<Budget>>;

  findById(id: string): Promise<Budget | null>;

  create(data: Record<string, unknown>, userId: string): Promise<Budget>;

  update(id: string, data: Record<string, unknown>, userId: string): Promise<Budget | null>;

  remove(id: string): Promise<Budget | null>;

  summary(filters: { period_year?: string; period_quarter?: string; country?: string; service_line?: string }): Promise<BudgetSummaryRow[]>;
}

export function createBudgetRepository(db: Pool): BudgetRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres: string[] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.period_year)    wheres.push(`b.period_year = ${add(Number(filters.period_year))}`);
      if (filters.period_quarter) wheres.push(`b.period_quarter = ${add(Number(filters.period_quarter))}`);
      if (filters.country)        wheres.push(`b.country = ${add(filters.country)}`);
      if (filters.owner_id)       wheres.push(`b.owner_id = ${add(filters.owner_id)}`);
      if (filters.service_line)   wheres.push(`b.service_line = ${add(filters.service_line)}`);
      if (filters.status)         wheres.push(`b.status = ${add(filters.status)}`);

      const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM budgets b ${where}`, countParams),
        db.query(
          `SELECT b.*,
                  u.name  AS owner_name,
                  ua.name AS approved_by_name
           FROM budgets b
           LEFT JOIN users u  ON u.id  = b.owner_id
           LEFT JOIN users ua ON ua.id = b.approved_by
           ${where}
           ORDER BY ${sort.orderBy || 'b.period_year DESC, b.period_quarter ASC NULLS LAST, b.created_at DESC'}
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

    async findById(id) {
      const { rows } = await db.query(
        `SELECT b.*,
                u.name  AS owner_name,
                ua.name AS approved_by_name
         FROM budgets b
         LEFT JOIN users u  ON u.id  = b.owner_id
         LEFT JOIN users ua ON ua.id = b.approved_by
         WHERE b.id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },

    async create(data, userId) {
      const { rows } = await db.query(
        `INSERT INTO budgets (period_year, period_quarter, period_month, country, owner_id, service_line, target_usd, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'draft'), $9, $10)
         RETURNING *`,
        [
          data.period_year, data.period_quarter ?? null, data.period_month ?? null,
          data.country ?? null, data.owner_id ?? null, data.service_line ?? null,
          data.target_usd ?? 0, data.status ?? null, data.notes ?? null, userId,
        ],
      );
      return rows[0];
    },

    async update(id, data, userId) {
      const { rows } = await db.query(
        `UPDATE budgets SET
            period_year    = COALESCE($1, period_year),
            period_quarter = COALESCE($2, period_quarter),
            period_month   = COALESCE($3, period_month),
            country        = COALESCE($4, country),
            owner_id       = COALESCE($5, owner_id),
            service_line   = COALESCE($6, service_line),
            target_usd     = COALESCE($7, target_usd),
            status         = COALESCE($8, status),
            notes          = COALESCE($9, notes),
            updated_at     = NOW()
         WHERE id = $10
         RETURNING *`,
        [
          data.period_year ?? null, data.period_quarter ?? null, data.period_month ?? null,
          data.country ?? null, data.owner_id ?? null, data.service_line ?? null,
          data.target_usd ?? null, data.status ?? null, data.notes ?? null, id,
        ],
      );
      return rows[0] ?? null;
    },

    async remove(id) {
      const { rows } = await db.query(`DELETE FROM budgets WHERE id = $1 RETURNING *`, [id]);
      return rows[0] ?? null;
    },

    async summary(filters) {
      const wheres = ["b.status IN ('active','closed')"];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.period_year)    wheres.push(`b.period_year = ${add(Number(filters.period_year))}`);
      if (filters.period_quarter) wheres.push(`b.period_quarter = ${add(Number(filters.period_quarter))}`);
      if (filters.country)        wheres.push(`b.country = ${add(filters.country)}`);
      if (filters.service_line)   wheres.push(`b.service_line = ${add(filters.service_line)}`);

      const where = 'WHERE ' + wheres.join(' AND ');

      /*
       * Actual = sum of closed-won opportunity values for the matching period.
       * The join builds yyyymm from opportunity close_date to compare against
       * the budget period. For quarterly budgets we match the quarter; for
       * monthly budgets we match the exact month.
       */
      const { rows } = await db.query(
        `SELECT
            b.period_year,
            b.period_quarter,
            b.country,
            b.service_line,
            SUM(b.target_usd)::numeric(18,2) AS target_usd,
            COALESCE(SUM(actual.won_usd), 0)::numeric(18,2) AS actual_usd,
            CASE WHEN SUM(b.target_usd) > 0
              THEN ROUND(COALESCE(SUM(actual.won_usd), 0) / SUM(b.target_usd) * 100, 2)
              ELSE 0
            END AS pct
         FROM budgets b
         LEFT JOIN LATERAL (
           SELECT SUM(o.amount_usd)::numeric(18,2) AS won_usd
           FROM opportunities o
           WHERE o.deleted_at IS NULL
             AND o.stage = 'closed_won'
             AND EXTRACT(YEAR FROM o.close_date)::int = b.period_year
             AND (b.period_quarter IS NULL OR CEIL(EXTRACT(MONTH FROM o.close_date) / 3.0)::int = b.period_quarter)
             AND (b.period_month IS NULL OR EXTRACT(MONTH FROM o.close_date)::int = b.period_month)
             AND (b.country IS NULL OR o.country = b.country)
         ) actual ON TRUE
         ${where}
         GROUP BY b.period_year, b.period_quarter, b.country, b.service_line
         ORDER BY b.period_year DESC, b.period_quarter ASC NULLS LAST`,
        params,
      );
      return rows;
    },
  };
}
