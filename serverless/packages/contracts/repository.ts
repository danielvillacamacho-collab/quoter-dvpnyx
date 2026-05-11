import type { Pool, PoolClient } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type { Contract, ContractFilters } from './types';
import { SORTABLE, ALL_SUBTYPES, normalizeStatus } from './types';

export interface ContractRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: ContractFilters;
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<Contract>>;

  findById(id: string): Promise<Contract | null>;

  create(data: Record<string, unknown>, createdBy: string): Promise<Contract>;

  update(id: string, data: Record<string, unknown>): Promise<Contract | null>;

  updateStatus(id: string, status: string, conn?: PoolClient): Promise<Contract | null>;

  softDelete(id: string): Promise<Contract | null>;

  getWinningQuotation(quotationId: string): Promise<Record<string, unknown> | null>;

  countDependencies(id: string): Promise<{ active_assignments: number; open_requests: number }>;

  findAllForExport(filters: ContractFilters): Promise<Record<string, unknown>[]>;
}

export function createContractRepository(db: Pool): ContractRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres = ['c.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.search) {
        wheres.push(`(LOWER(c.name) LIKE LOWER(${add('%' + filters.search + '%')}))`);
      }
      if (filters.client_id) wheres.push(`c.client_id = ${add(filters.client_id)}`);
      if (filters.status) wheres.push(`c.status = ${add(normalizeStatus(filters.status))}`);
      if (filters.type) wheres.push(`c.type = ${add(filters.type)}`);
      if (filters.squad_id) wheres.push(`c.squad_id = ${add(filters.squad_id)}`);
      if (filters.subtype) {
        if (filters.subtype === 'none') {
          wheres.push(`c.contract_subtype IS NULL`);
        } else if (ALL_SUBTYPES.has(filters.subtype)) {
          wheres.push(`c.contract_subtype = ${add(filters.subtype)}`);
        } else {
          throw Object.assign(new Error('subtype inválido'), { statusCode: 400 });
        }
      }

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM contracts c ${where}`, countParams),
        db.query(
          `SELECT c.*,
             cl.name AS client_name,
             (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests_count,
             (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND status='active' AND deleted_at IS NULL) AS active_assignments_count
           FROM contracts c
           LEFT JOIN clients cl ON cl.id = c.client_id
           ${where}
           ORDER BY ${sort.orderBy || 'c.updated_at DESC'}
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
        `SELECT c.*,
           cl.name AS client_name, cl.country AS client_country, cl.tier AS client_tier,
           o.name  AS opportunity_name, o.status AS opportunity_status,
           q.project_name AS winning_quotation_name, q.type AS winning_quotation_type,
           uao.name  AS account_owner_name,    uao.email  AS account_owner_email,
           udm.name  AS delivery_manager_name, udm.email  AS delivery_manager_email,
           ucm.name  AS capacity_manager_name, ucm.email  AS capacity_manager_email,
           (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND deleted_at IS NULL) AS requests_count,
           (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=c.id AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests_count,
           (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND deleted_at IS NULL) AS assignments_count,
           (SELECT COUNT(*)::int FROM assignments WHERE contract_id=c.id AND status='active' AND deleted_at IS NULL) AS active_assignments_count
         FROM contracts c
         LEFT JOIN clients        cl  ON cl.id = c.client_id
         LEFT JOIN opportunities  o   ON o.id = c.opportunity_id
         LEFT JOIN quotations     q   ON q.id = c.winning_quotation_id
         LEFT JOIN users          uao ON uao.id = c.account_owner_id
         LEFT JOIN users          udm ON udm.id = c.delivery_manager_id
         LEFT JOIN users          ucm ON ucm.id = c.capacity_manager_id
        WHERE c.id = $1 AND c.deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async create(data, createdBy) {
      const { rows } = await db.query(
        `INSERT INTO contracts
           (name, client_id, opportunity_id, winning_quotation_id, type, contract_subtype,
            start_date, end_date, total_value_usd, original_currency,
            account_owner_id, delivery_manager_id, capacity_manager_id,
            squad_id, notes, tags, metadata, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          data.name, data.client_id, data.opportunity_id || null,
          data.winning_quotation_id || null, data.type, data.contract_subtype ?? null,
          data.start_date, data.end_date || null,
          data.total_value_usd !== undefined ? Number(data.total_value_usd) : null,
          data.original_currency || null,
          data.account_owner_id || null, data.delivery_manager_id || null,
          data.capacity_manager_id || null, data.squad_id,
          data.notes || null, data.tags || null,
          data.metadata ? JSON.stringify(data.metadata) : null, createdBy,
        ],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE contracts SET
            name                 = COALESCE($1, name),
            type                 = COALESCE($2, type),
            contract_subtype     = $3,
            opportunity_id       = COALESCE($4, opportunity_id),
            winning_quotation_id = COALESCE($5, winning_quotation_id),
            start_date           = COALESCE($6, start_date),
            end_date             = COALESCE($7, end_date),
            account_owner_id     = COALESCE($8, account_owner_id),
            delivery_manager_id  = COALESCE($9, delivery_manager_id),
            capacity_manager_id  = COALESCE($10, capacity_manager_id),
            squad_id             = COALESCE($11, squad_id),
            notes                = COALESCE($12, notes),
            tags                 = COALESCE($13, tags),
            metadata             = COALESCE($14::jsonb, metadata),
            total_value_usd      = COALESCE($15, total_value_usd),
            original_currency    = COALESCE($16, original_currency),
            updated_at           = NOW()
          WHERE id=$17 AND deleted_at IS NULL
          RETURNING *`,
        [
          data.name || null,
          data.type ?? null,
          data.contract_subtype,
          data.opportunity_id ?? null,
          data.winning_quotation_id ?? null,
          data.start_date ?? null,
          data.end_date ?? null,
          data.account_owner_id ?? null,
          data.delivery_manager_id ?? null,
          data.capacity_manager_id ?? null,
          data.squad_id ?? null,
          data.notes ?? null,
          data.tags ?? null,
          data.metadata ? JSON.stringify(data.metadata) : null,
          data.total_value_usd !== undefined ? Number(data.total_value_usd) : null,
          data.original_currency ?? null,
          id,
        ],
      );
      return rows[0] ?? null;
    },

    async updateStatus(id, status, conn) {
      const target = conn || db;
      const { rows } = await target.query(
        `UPDATE contracts SET status=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *`,
        [status, id],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE contracts SET deleted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    async getWinningQuotation(quotationId) {
      const { rows } = await db.query(
        `SELECT q.id, q.type, q.project_name, q.client_id, q.opportunity_id,
                q.client_name, o.client_id AS opp_client_id
           FROM quotations q
           LEFT JOIN opportunities o ON o.id = q.opportunity_id
          WHERE q.id = $1 AND (q.deleted_at IS NULL)`,
        [quotationId],
      );
      return rows[0] ?? null;
    },

    async countDependencies(id) {
      const { rows } = await db.query(
        `SELECT
           (SELECT COUNT(*)::int FROM assignments WHERE contract_id=$1 AND status='active' AND deleted_at IS NULL) AS active_assignments,
           (SELECT COUNT(*)::int FROM resource_requests WHERE contract_id=$1 AND status IN ('open','partially_filled') AND deleted_at IS NULL) AS open_requests`,
        [id],
      );
      return rows[0];
    },

    async findAllForExport(filters) {
      const wheres = ['c.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.search) {
        wheres.push(`(LOWER(c.name) LIKE LOWER(${add('%' + filters.search + '%')}))`);
      }
      if (filters.client_id) wheres.push(`c.client_id = ${add(filters.client_id)}`);
      if (filters.status) wheres.push(`c.status = ${add(normalizeStatus(filters.status))}`);
      if (filters.type) wheres.push(`c.type = ${add(filters.type)}`);
      if (filters.subtype) {
        if (filters.subtype === 'none') {
          wheres.push(`c.contract_subtype IS NULL`);
        } else if (ALL_SUBTYPES.has(filters.subtype)) {
          wheres.push(`c.contract_subtype = ${add(filters.subtype)}`);
        }
      }

      const where = 'WHERE ' + wheres.join(' AND ');
      const { rows } = await db.query(
        `SELECT c.id, c.name, c.type, c.contract_subtype, c.status, c.start_date, c.end_date,
                c.notes, c.created_at,
                cl.name AS client_name
           FROM contracts c
           LEFT JOIN clients cl ON cl.id = c.client_id
           ${where}
           ORDER BY c.updated_at DESC
           LIMIT 10000`,
        params,
      );
      return rows;
    },
  };
}
