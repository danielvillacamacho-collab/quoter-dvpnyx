import type { Pool } from 'pg';
import type { PaginatedResult, SortParams } from '@shared/types';
import type { Activity } from './types';

const JOIN = `LEFT JOIN users u ON u.id = a.user_id LEFT JOIN opportunities o ON o.id = a.opportunity_id LEFT JOIN clients cl ON cl.id = a.client_id LEFT JOIN contacts ct ON ct.id = a.contact_id`;
const FIELDS = `a.*, u.name AS user_name, o.name AS opportunity_name, cl.name AS client_name, ct.first_name || ' ' || ct.last_name AS contact_name`;

export interface ActivityRepository {
  findAll(params: { page: number; limit: number; offset: number; filters: Record<string, string | undefined>; sort: SortParams }): Promise<PaginatedResult<Activity>>;
  findById(id: string): Promise<Activity | null>;
  findByOpportunity(opportunityId: string, params: { page: number; limit: number; offset: number; sort: SortParams }): Promise<PaginatedResult<Activity>>;
  findByClient(clientId: string, params: { page: number; limit: number; offset: number; sort: SortParams }): Promise<PaginatedResult<Activity>>;
  create(data: Record<string, unknown>, userId: string): Promise<Activity>;
  update(id: string, data: Record<string, unknown>): Promise<Activity | null>;
  softDelete(id: string): Promise<boolean>;
  updateClientLastActivity(clientId: string): Promise<void>;
  resolveClientFromOpportunity(opportunityId: string): Promise<string | null>;
}

export function createActivityRepository(db: Pool): ActivityRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres = ['a.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.opportunity_id) wheres.push(`a.opportunity_id = ${add(filters.opportunity_id)}`);
      if (filters.client_id) wheres.push(`a.client_id = ${add(filters.client_id)}`);
      if (filters.contact_id) wheres.push(`a.contact_id = ${add(filters.contact_id)}`);
      if (filters.activity_type) wheres.push(`a.activity_type = ${add(filters.activity_type)}`);
      if (filters.user_id) wheres.push(`a.user_id = ${add(filters.user_id)}`);

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM activities a ${where}`, countParams),
        db.query(
          `SELECT ${FIELDS} FROM activities a ${JOIN} ${where} ORDER BY ${sort.orderBy || 'a.activity_date DESC'} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
      ]);
      const total = countRes.rows[0].total;
      return { data: rowsRes.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
    },

    async findById(id) {
      const { rows } = await db.query(`SELECT ${FIELDS} FROM activities a ${JOIN} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
      return rows[0] ?? null;
    },

    async findByOpportunity(opportunityId, { page, limit, offset, sort }) {
      const where = 'WHERE a.deleted_at IS NULL AND a.opportunity_id = $1';
      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM activities a ${where}`, [opportunityId]),
        db.query(`SELECT ${FIELDS} FROM activities a ${JOIN} ${where} ORDER BY ${sort.orderBy || 'a.activity_date DESC'} LIMIT $2 OFFSET $3`, [opportunityId, limit, offset]),
      ]);
      const total = countRes.rows[0].total;
      return { data: rowsRes.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
    },

    async findByClient(clientId, { page, limit, offset, sort }) {
      const where = `WHERE a.deleted_at IS NULL AND (a.client_id = $1 OR a.opportunity_id IN (SELECT id FROM opportunities WHERE client_id = $1 AND deleted_at IS NULL))`;
      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM activities a ${where}`, [clientId]),
        db.query(`SELECT ${FIELDS} FROM activities a ${JOIN} ${where} ORDER BY ${sort.orderBy || 'a.activity_date DESC'} LIMIT $2 OFFSET $3`, [clientId, limit, offset]),
      ]);
      const total = countRes.rows[0].total;
      return { data: rowsRes.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
    },

    async create(data, userId) {
      const { rows } = await db.query(
        `INSERT INTO activities (opportunity_id, client_id, contact_id, user_id, activity_type, subject, notes, activity_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,NOW())) RETURNING *`,
        [data.opportunity_id || null, data.client_id || null, data.contact_id || null, userId, data.activity_type, data.subject, data.notes || null, data.activity_date || null],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE activities SET
            opportunity_id = COALESCE($1, opportunity_id), client_id = COALESCE($2, client_id),
            contact_id = COALESCE($3, contact_id), activity_type = COALESCE($4, activity_type),
            subject = COALESCE($5, subject), notes = COALESCE($6, notes), activity_date = COALESCE($7, activity_date)
          WHERE id = $8 AND deleted_at IS NULL RETURNING *`,
        [data.opportunity_id ?? null, data.client_id ?? null, data.contact_id ?? null, data.activity_type ?? null, data.subject || null, data.notes ?? null, data.activity_date ?? null, id],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rowCount } = await db.query(`UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [id]);
      return (rowCount ?? 0) > 0;
    },

    async updateClientLastActivity(clientId) {
      await db.query(`UPDATE clients SET last_activity_at = NOW() WHERE id = $1`, [clientId]);
    },

    async resolveClientFromOpportunity(opportunityId) {
      const { rows } = await db.query(`SELECT client_id FROM opportunities WHERE id = $1`, [opportunityId]);
      return rows[0]?.client_id ?? null;
    },
  };
}
