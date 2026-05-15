import type { Pool } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type { Client, ClientFilters } from './types';
import { SORTABLE } from './types';

export interface ClientRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: ClientFilters;
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<Client>>;
  findById(id: string): Promise<Client | null>;
  findByName(name: string, excludeId?: string): Promise<{ id: string; name: string } | null>;
  create(data: Record<string, unknown>, createdBy: string): Promise<Client>;
  update(id: string, data: Record<string, unknown>): Promise<Client | null>;
  activate(id: string): Promise<Client | null>;
  deactivate(id: string): Promise<Client | null>;
  softDelete(id: string): Promise<Client | null>;
  countRelations(id: string): Promise<{ opps: number; ctrs: number }>;
}

export function createClientRepository(db: Pool): ClientRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres = ['c.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.search) {
        wheres.push(`(LOWER(c.name) LIKE LOWER(${add('%' + filters.search + '%')}) OR LOWER(c.legal_name) LIKE LOWER(${add('%' + filters.search + '%')}))`);
      }
      if (filters.country) wheres.push(`c.country = ${add(filters.country)}`);
      if (filters.industry) wheres.push(`c.industry = ${add(filters.industry)}`);
      if (filters.tier) wheres.push(`c.tier = ${add(filters.tier)}`);
      if (filters.active !== undefined) {
        wheres.push(`c.active = ${add(filters.active === 'true' || filters.active === '1')}`);
      }

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM clients c ${where}`, countParams),
        db.query(
          `SELECT c.*,
             (SELECT COUNT(*)::int FROM opportunities o WHERE o.client_id=c.id AND o.deleted_at IS NULL) AS opportunities_count,
             (SELECT COUNT(*)::int FROM contracts ct WHERE ct.client_id=c.id AND ct.status='active' AND ct.deleted_at IS NULL) AS active_contracts_count
           FROM clients c
           ${where}
           ORDER BY ${sort.orderBy || 'c.name ASC'}
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
           (SELECT COUNT(*)::int FROM opportunities WHERE client_id=c.id AND deleted_at IS NULL) AS opportunities_count,
           (SELECT COUNT(*)::int FROM contracts WHERE client_id=c.id AND status='active' AND deleted_at IS NULL) AS active_contracts_count
         FROM clients c
         WHERE c.id=$1 AND c.deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async findByName(name, excludeId) {
      const q = excludeId
        ? `SELECT id, name FROM clients WHERE LOWER(name)=LOWER($1) AND deleted_at IS NULL AND id<>$2`
        : `SELECT id, name FROM clients WHERE LOWER(name)=LOWER($1) AND deleted_at IS NULL`;
      const params = excludeId ? [name.trim(), excludeId] : [name.trim()];
      const { rows } = await db.query(q, params);
      return rows[0] ?? null;
    },

    async create(data, createdBy) {
      const { rows } = await db.query(
        `INSERT INTO clients (name, legal_name, country, industry, tier, preferred_currency, notes, tags, external_crm_id, created_by)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'USD'),$7,$8,$9,$10)
         RETURNING *`,
        [
          data.name, data.legal_name || null, data.country || null,
          data.industry || null, data.tier ?? null, data.preferred_currency || null,
          data.notes || null, data.tags || null, data.external_crm_id || null, createdBy,
        ],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE clients SET
            name               = COALESCE($1, name),
            legal_name         = COALESCE($2, legal_name),
            country            = COALESCE($3, country),
            industry           = COALESCE($4, industry),
            tier               = COALESCE($5, tier),
            preferred_currency = COALESCE($6, preferred_currency),
            notes              = COALESCE($7, notes),
            tags               = COALESCE($8, tags),
            external_crm_id    = COALESCE($9, external_crm_id),
            updated_at         = NOW()
          WHERE id=$10 AND deleted_at IS NULL
          RETURNING *`,
        [
          data.name || null, data.legal_name ?? null, data.country ?? null,
          data.industry ?? null, data.tier ?? null, data.preferred_currency ?? null,
          data.notes ?? null, data.tags ?? null, data.external_crm_id ?? null, id,
        ],
      );
      return rows[0] ?? null;
    },

    async activate(id) {
      const { rows } = await db.query(
        `UPDATE clients SET active=true, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    async deactivate(id) {
      const { rows } = await db.query(
        `UPDATE clients SET active=false, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE clients SET deleted_at=NOW(), active=false, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    async countRelations(id) {
      const { rows } = await db.query(
        `SELECT
           (SELECT COUNT(*)::int FROM opportunities WHERE client_id=$1 AND deleted_at IS NULL) AS opps,
           (SELECT COUNT(*)::int FROM contracts WHERE client_id=$1 AND deleted_at IS NULL) AS ctrs`,
        [id],
      );
      return rows[0];
    },
  };
}
