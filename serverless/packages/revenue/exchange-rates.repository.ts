import type { Pool } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type { ExchangeRate } from './types';
import { EXCHANGE_RATE_SORTABLE } from './types';

export interface ExchangeRateRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: { from?: string; to?: string; currency?: string };
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<ExchangeRate>>;

  findByPeriod(yyyymm: string): Promise<ExchangeRate[]>;

  upsert(data: { yyyymm: string; currency: string; usd_rate: number; notes?: string }, userId: string): Promise<ExchangeRate>;

  remove(yyyymm: string, currency: string): Promise<ExchangeRate | null>;
}

const YYYYMM_RE = /^[0-9]{6}$/;

export function createExchangeRateRepository(db: Pool): ExchangeRateRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres: string[] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.from && YYYYMM_RE.test(filters.from))       wheres.push(`er.yyyymm >= ${add(filters.from)}`);
      if (filters.to && YYYYMM_RE.test(filters.to))           wheres.push(`er.yyyymm <= ${add(filters.to)}`);
      if (filters.currency) wheres.push(`er.currency = ${add(filters.currency.toUpperCase())}`);

      const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM exchange_rates er ${where}`, countParams),
        db.query(
          `SELECT er.* FROM exchange_rates er
           ${where}
           ORDER BY ${sort.orderBy || 'er.yyyymm DESC, er.currency ASC'}
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

    async findByPeriod(yyyymm) {
      const { rows } = await db.query(
        `SELECT er.* FROM exchange_rates er WHERE er.yyyymm = $1 ORDER BY er.currency ASC`,
        [yyyymm],
      );
      return rows;
    },

    async upsert(data, userId) {
      const { rows } = await db.query(
        `INSERT INTO exchange_rates (yyyymm, currency, usd_rate, notes, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (yyyymm, currency) DO UPDATE SET
           usd_rate   = $3,
           notes      = COALESCE($4, exchange_rates.notes),
           updated_by = $5,
           updated_at = NOW()
         RETURNING *`,
        [data.yyyymm, data.currency.toUpperCase(), data.usd_rate, data.notes ?? null, userId],
      );
      return rows[0];
    },

    async remove(yyyymm, currency) {
      const { rows } = await db.query(
        `DELETE FROM exchange_rates WHERE yyyymm = $1 AND currency = $2 RETURNING *`,
        [yyyymm, currency.toUpperCase()],
      );
      return rows[0] ?? null;
    },
  };
}
