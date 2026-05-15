import type { Pool } from 'pg';
import type { PaginatedResult, SortParams } from '@shared/types';
import type { Contact } from './types';

export interface ContactRepository {
  findAll(params: { page: number; limit: number; offset: number; filters: Record<string, string | undefined>; sort: SortParams }): Promise<PaginatedResult<Contact>>;
  findById(id: string): Promise<Contact | null>;
  findByClient(clientId: string): Promise<Contact[]>;
  findByOpportunity(opportunityId: string): Promise<(Contact & { link_id: string; deal_role: string; link_notes: string | null })[]>;
  create(data: Record<string, unknown>, createdBy: string): Promise<Contact>;
  update(id: string, data: Record<string, unknown>): Promise<Contact | null>;
  softDelete(id: string): Promise<Contact | null>;
  linkOpportunity(data: { opportunity_id: string; contact_id: string; deal_role: string; notes?: string | null }): Promise<Record<string, unknown>>;
  unlinkOpportunity(id: string): Promise<boolean>;
}

export function createContactRepository(db: Pool): ContactRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres = ['co.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.search) {
        wheres.push(`(LOWER(co.first_name) LIKE LOWER(${add('%' + filters.search + '%')}) OR LOWER(co.last_name) LIKE LOWER(${add('%' + filters.search + '%')}) OR LOWER(co.email_primary) LIKE LOWER(${add('%' + filters.search + '%')}))`);
      }
      if (filters.client_id) wheres.push(`co.client_id = ${add(filters.client_id)}`);
      if (filters.seniority) wheres.push(`co.seniority = ${add(filters.seniority)}`);

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM contacts co ${where}`, countParams),
        db.query(
          `SELECT co.*, cl.name AS client_name
           FROM contacts co JOIN clients cl ON cl.id = co.client_id
           ${where}
           ORDER BY ${sort.orderBy || 'co.last_name ASC'}
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...params, limit, offset],
        ),
      ]);
      const total = countRes.rows[0].total;
      return { data: rowsRes.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
    },

    async findById(id) {
      const { rows } = await db.query(
        `SELECT co.*, cl.name AS client_name FROM contacts co JOIN clients cl ON cl.id = co.client_id WHERE co.id = $1 AND co.deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async findByClient(clientId) {
      const { rows } = await db.query(
        `SELECT co.*, cl.name AS client_name FROM contacts co JOIN clients cl ON cl.id = co.client_id WHERE co.client_id = $1 AND co.deleted_at IS NULL ORDER BY co.last_name ASC, co.first_name ASC LIMIT 200`,
        [clientId],
      );
      return rows;
    },

    async findByOpportunity(opportunityId) {
      const { rows } = await db.query(
        `SELECT co.*, oc.id AS link_id, oc.deal_role, oc.notes AS link_notes, cl.name AS client_name
         FROM opportunity_contacts oc
         JOIN contacts co ON co.id = oc.contact_id
         JOIN clients cl ON cl.id = co.client_id
         WHERE oc.opportunity_id = $1 AND co.deleted_at IS NULL
         ORDER BY co.last_name ASC, co.first_name ASC`,
        [opportunityId],
      );
      return rows;
    },

    async create(data, createdBy) {
      const { rows } = await db.query(
        `INSERT INTO contacts (first_name, last_name, client_id, job_title, email_primary, phone_mobile, seniority, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [data.first_name, data.last_name, data.client_id, data.job_title || null, data.email_primary || null, data.phone_mobile || null, data.seniority || null, data.notes || null, createdBy],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE contacts SET
            first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name),
            job_title = COALESCE($3, job_title), email_primary = COALESCE($4, email_primary),
            phone_mobile = COALESCE($5, phone_mobile), seniority = COALESCE($6, seniority),
            notes = COALESCE($7, notes), client_id = COALESCE($8, client_id), updated_at = NOW()
          WHERE id=$9 AND deleted_at IS NULL RETURNING *`,
        [data.first_name || null, data.last_name || null, data.job_title ?? null, data.email_primary ?? null, data.phone_mobile ?? null, data.seniority ?? null, data.notes ?? null, data.client_id ?? null, id],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE contacts SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    async linkOpportunity(data) {
      const { rows } = await db.query(
        `INSERT INTO opportunity_contacts (opportunity_id, contact_id, deal_role, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (opportunity_id, contact_id)
         DO UPDATE SET deal_role = EXCLUDED.deal_role, notes = EXCLUDED.notes
         RETURNING *`,
        [data.opportunity_id, data.contact_id, data.deal_role, data.notes || null],
      );
      return rows[0];
    },

    async unlinkOpportunity(id) {
      const { rows } = await db.query(`DELETE FROM opportunity_contacts WHERE id = $1 RETURNING *`, [id]);
      return rows.length > 0;
    },
  };
}
