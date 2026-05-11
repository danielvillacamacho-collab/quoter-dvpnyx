import type { Pool } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type { RevenuePeriod, RevenuePeriodWithContract, RevenueFilters } from './types';
import { REVENUE_SORTABLE } from './types';

export interface RevenueRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: RevenueFilters;
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<RevenuePeriodWithContract>>;

  findByContract(contractId: string, from?: string, to?: string): Promise<RevenuePeriod[]>;

  upsert(
    contractId: string,
    yyyymm: string,
    data: { projected_usd?: number; projected_pct?: number | null; real_usd?: number | null; real_pct?: number | null; notes?: string },
    userId: string,
  ): Promise<RevenuePeriod>;

  closePeriod(contractId: string, yyyymm: string, userId: string): Promise<RevenuePeriod | null>;
}

const YYYYMM_RE = /^[0-9]{6}$/;

export function createRevenueRepository(db: Pool): RevenueRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres = ['c.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.from && YYYYMM_RE.test(filters.from)) wheres.push(`rp.yyyymm >= ${add(filters.from)}`);
      if (filters.to && YYYYMM_RE.test(filters.to))     wheres.push(`rp.yyyymm <= ${add(filters.to)}`);
      if (filters.type)     wheres.push(`c.type = ${add(filters.type)}`);
      if (filters.owner_id) wheres.push(`c.account_owner_id = ${add(filters.owner_id)}`);
      if (filters.country)  wheres.push(`cl.country = ${add(filters.country)}`);

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const baseFrom = `
        FROM revenue_periods rp
        JOIN contracts c ON c.id = rp.contract_id
        JOIN clients cl ON cl.id = c.client_id`;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total ${baseFrom} ${where}`, countParams),
        db.query(
          `SELECT rp.*,
                  c.name   AS contract_name,
                  c.type   AS contract_type,
                  c.status AS contract_status,
                  c.total_value_usd,
                  c.original_currency,
                  cl.name  AS client_name,
                  cl.country AS client_country
           ${baseFrom}
           ${where}
           ORDER BY ${sort.orderBy || 'rp.yyyymm DESC, c.name ASC'}
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

    async findByContract(contractId, from, to) {
      const wheres = ['rp.contract_id = $1'];
      const params: unknown[] = [contractId];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (from && YYYYMM_RE.test(from)) wheres.push(`rp.yyyymm >= ${add(from)}`);
      if (to && YYYYMM_RE.test(to))     wheres.push(`rp.yyyymm <= ${add(to)}`);

      const { rows } = await db.query(
        `SELECT rp.* FROM revenue_periods rp WHERE ${wheres.join(' AND ')} ORDER BY rp.yyyymm ASC`,
        params,
      );
      return rows;
    },

    async upsert(contractId, yyyymm, data, userId) {
      const { rows } = await db.query(
        `INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, projected_pct, real_usd, real_pct, notes, created_by, updated_by)
         VALUES ($1, $2, COALESCE($3, 0), $4, $5, $6, $7, $8, $8)
         ON CONFLICT (contract_id, yyyymm) DO UPDATE SET
           projected_usd = COALESCE($3, revenue_periods.projected_usd),
           projected_pct = COALESCE($4, revenue_periods.projected_pct),
           real_usd      = COALESCE($5, revenue_periods.real_usd),
           real_pct      = COALESCE($6, revenue_periods.real_pct),
           notes         = COALESCE($7, revenue_periods.notes),
           updated_by    = $8,
           updated_at    = NOW()
         RETURNING *`,
        [contractId, yyyymm, data.projected_usd ?? null, data.projected_pct ?? null,
         data.real_usd ?? null, data.real_pct ?? null, data.notes ?? null, userId],
      );
      return rows[0];
    },

    async closePeriod(contractId, yyyymm, userId) {
      const { rows } = await db.query(
        `UPDATE revenue_periods
         SET status = 'closed', closed_at = NOW(), closed_by = $3, updated_by = $3, updated_at = NOW()
         WHERE contract_id = $1 AND yyyymm = $2 AND status = 'open'
         RETURNING *`,
        [contractId, yyyymm, userId],
      );
      return rows[0] ?? null;
    },
  };
}
