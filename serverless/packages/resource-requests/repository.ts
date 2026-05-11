import type { Pool } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type { ResourceRequest, ResourceRequestFilters, Candidate } from './types';
import { SORTABLE } from './types';

export interface ResourceRequestRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: ResourceRequestFilters;
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<ResourceRequest>>;
  findById(id: string): Promise<ResourceRequest | null>;
  create(data: Record<string, unknown>, createdBy: string): Promise<ResourceRequest>;
  update(id: string, data: Record<string, unknown>): Promise<ResourceRequest | null>;
  softDelete(id: string): Promise<ResourceRequest | null>;
  countAssignments(id: string): Promise<number>;
  updateStatus(id: string, status: string): Promise<ResourceRequest | null>;
  findCandidates(requestId: string): Promise<Candidate[]>;
}

export function createResourceRequestRepository(db: Pool): ResourceRequestRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres = ['rr.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.search) {
        wheres.push(`LOWER(rr.role_title) LIKE LOWER(${add('%' + filters.search + '%')})`);
      }
      if (filters.contract_id) wheres.push(`rr.contract_id = ${add(filters.contract_id)}`);
      if (filters.area_id) wheres.push(`rr.area_id = ${add(Number(filters.area_id))}`);
      if (filters.level) wheres.push(`rr.level = ${add(filters.level)}`);
      if (filters.status) wheres.push(`rr.status = ${add(filters.status)}`);
      if (filters.priority) wheres.push(`rr.priority = ${add(filters.priority)}`);

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM resource_requests rr ${where}`, countParams),
        db.query(
          `SELECT rr.*,
             a.name AS area_name,
             c.name AS contract_name,
             cl.name AS client_name,
             (SELECT COUNT(*)::int FROM assignments asg
              WHERE asg.resource_request_id = rr.id
                AND asg.deleted_at IS NULL
                AND asg.status IN ('planned','active')) AS assignments_count
           FROM resource_requests rr
           LEFT JOIN areas a ON a.id = rr.area_id
           LEFT JOIN contracts c ON c.id = rr.contract_id
           LEFT JOIN clients cl ON cl.id = c.client_id
           ${where}
           ORDER BY ${sort.orderBy || 'rr.created_at DESC'}
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
        `SELECT rr.*,
           a.name AS area_name,
           c.name AS contract_name,
           cl.name AS client_name,
           (SELECT COUNT(*)::int FROM assignments asg
            WHERE asg.resource_request_id = rr.id
              AND asg.deleted_at IS NULL
              AND asg.status IN ('planned','active')) AS assignments_count
         FROM resource_requests rr
         LEFT JOIN areas a ON a.id = rr.area_id
         LEFT JOIN contracts c ON c.id = rr.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE rr.id = $1 AND rr.deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async create(data, createdBy) {
      const { rows } = await db.query(
        `INSERT INTO resource_requests
           (contract_id, role_title, area_id, level, country,
            language_requirements, required_skills, nice_to_have_skills,
            weekly_hours, start_date, end_date, quantity, priority, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,COALESCE($12,1),COALESCE($13,'medium'),$14,$15)
         RETURNING *`,
        [
          data.contract_id, data.role_title, data.area_id, data.level,
          data.country || null,
          data.language_requirements ? JSON.stringify(data.language_requirements) : null,
          data.required_skills || null,
          data.nice_to_have_skills || null,
          data.weekly_hours ?? 40,
          data.start_date, data.end_date || null,
          data.quantity, data.priority,
          data.notes || null, createdBy,
        ],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE resource_requests SET
            role_title             = COALESCE($1, role_title),
            area_id                = COALESCE($2, area_id),
            level                  = COALESCE($3, level),
            country                = COALESCE($4, country),
            language_requirements  = COALESCE($5::jsonb, language_requirements),
            required_skills        = COALESCE($6, required_skills),
            nice_to_have_skills    = COALESCE($7, nice_to_have_skills),
            weekly_hours           = COALESCE($8, weekly_hours),
            start_date             = COALESCE($9, start_date),
            end_date               = COALESCE($10, end_date),
            quantity               = COALESCE($11, quantity),
            priority               = COALESCE($12, priority),
            notes                  = COALESCE($13, notes),
            updated_at             = NOW()
          WHERE id = $14 AND deleted_at IS NULL
          RETURNING *`,
        [
          data.role_title || null, data.area_id ?? null, data.level || null,
          data.country ?? null,
          data.language_requirements ? JSON.stringify(data.language_requirements) : null,
          data.required_skills ?? null, data.nice_to_have_skills ?? null,
          data.weekly_hours ?? null, data.start_date || null, data.end_date ?? null,
          data.quantity ?? null, data.priority || null, data.notes ?? null, id,
        ],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE resource_requests SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    async countAssignments(id) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS count FROM assignments
         WHERE resource_request_id = $1 AND deleted_at IS NULL AND status IN ('planned','active')`,
        [id],
      );
      return rows[0].count;
    },

    async updateStatus(id, status) {
      const { rows } = await db.query(
        `UPDATE resource_requests SET status = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
        [status, id],
      );
      return rows[0] ?? null;
    },

    async findCandidates(requestId) {
      // Fetch the request details + all active employees with their current allocation
      const { rows } = await db.query(
        `WITH request AS (
           SELECT * FROM resource_requests WHERE id = $1 AND deleted_at IS NULL
         ),
         employee_alloc AS (
           SELECT
             asg.employee_id,
             COALESCE(SUM(asg.weekly_hours), 0)::numeric AS current_allocated_hours
           FROM assignments asg
           WHERE asg.deleted_at IS NULL
             AND asg.status IN ('planned','active')
           GROUP BY asg.employee_id
         )
         SELECT
           e.id AS employee_id,
           e.first_name,
           e.last_name,
           e.area_id,
           a.name AS area_name,
           e.level,
           e.country,
           e.weekly_capacity_hours,
           COALESCE(ea.current_allocated_hours, 0) AS current_allocated_hours,
           (e.weekly_capacity_hours - COALESCE(ea.current_allocated_hours, 0)) AS available_hours,
           e.status,
           COALESCE(
             (SELECT ARRAY_AGG(es.skill_id) FROM employee_skills es WHERE es.employee_id = e.id),
             ARRAY[]::int[]
           ) AS employee_skills
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         LEFT JOIN employee_alloc ea ON ea.employee_id = e.id
         WHERE e.deleted_at IS NULL
           AND e.status = 'active'
         ORDER BY e.first_name, e.last_name`,
        [requestId],
      );
      // Return raw candidate data; scoring is done in candidate-matcher.ts
      return rows;
    },
  };
}
