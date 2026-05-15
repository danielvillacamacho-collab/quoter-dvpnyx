import type { Pool } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type { Assignment, AssignmentFilters, EmployeeContext, RequestContext, ExistingAssignment } from './types';
import { SORTABLE } from './types';

export interface AssignmentRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: AssignmentFilters;
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<Assignment>>;
  findById(id: string): Promise<Assignment | null>;
  create(data: Record<string, unknown>, createdBy: string): Promise<Assignment>;
  update(id: string, data: Record<string, unknown>): Promise<Assignment | null>;
  softDelete(id: string): Promise<Assignment | null>;
  getEmployeeContext(employeeId: string): Promise<EmployeeContext | null>;
  getRequestContext(requestId: string): Promise<RequestContext | null>;
  getEmployeeAssignments(employeeId: string): Promise<ExistingAssignment[]>;
  countActiveForRequest(requestId: string): Promise<number>;
  updateRequestStatus(requestId: string, status: string): Promise<void>;
  exportCsv(filters: AssignmentFilters): Promise<string>;
}

const SELECT_FIELDS = `asg.*,
  CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
  e.area_id AS employee_area_id,
  a.name AS employee_area_name,
  e.level AS employee_level,
  c.name AS contract_name,
  cl.name AS client_name,
  rr.role_title AS request_role_title`;

const JOIN_CLAUSE = `FROM assignments asg
  LEFT JOIN employees e ON e.id = asg.employee_id
  LEFT JOIN areas a ON a.id = e.area_id
  LEFT JOIN contracts c ON c.id = asg.contract_id
  LEFT JOIN clients cl ON cl.id = c.client_id
  LEFT JOIN resource_requests rr ON rr.id = asg.resource_request_id`;

export function createAssignmentRepository(db: Pool): AssignmentRepository {
  function buildWhere(filters: AssignmentFilters) {
    const wheres = ['asg.deleted_at IS NULL'];
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (filters.search) {
      wheres.push(`(LOWER(CONCAT(e.first_name, ' ', e.last_name)) LIKE LOWER(${add('%' + filters.search + '%')}) OR LOWER(asg.role_title) LIKE LOWER(${add('%' + filters.search + '%')}))`);
    }
    if (filters.contract_id) wheres.push(`asg.contract_id = ${add(filters.contract_id)}`);
    if (filters.employee_id) wheres.push(`asg.employee_id = ${add(filters.employee_id)}`);
    if (filters.resource_request_id) wheres.push(`asg.resource_request_id = ${add(filters.resource_request_id)}`);
    if (filters.status) {
      const VALID = ['planned', 'active', 'ended', 'cancelled'];
      const statuses = String(filters.status).split(',').map((v) => v.trim()).filter((v) => VALID.includes(v));
      if (statuses.length === 1) {
        wheres.push(`asg.status = ${add(statuses[0])}`);
      } else if (statuses.length > 1) {
        wheres.push(`asg.status IN (${statuses.map((v) => add(v)).join(', ')})`);
      }
    }
    if (filters.date_from) wheres.push(`(asg.end_date IS NULL OR asg.end_date >= ${add(filters.date_from)}::date)`);
    if (filters.date_to)   wheres.push(`asg.start_date <= ${add(filters.date_to)}::date`);

    return { where: 'WHERE ' + wheres.join(' AND '), params };
  }

  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const { where, params } = buildWhere(filters);
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM assignments asg
          LEFT JOIN employees e ON e.id = asg.employee_id
          ${where}`, countParams),
        db.query(
          `SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE}
           ${where}
           ORDER BY ${sort.orderBy || 'asg.created_at DESC'}
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
        `SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE}
         WHERE asg.id = $1 AND asg.deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async create(data, createdBy) {
      const { rows } = await db.query(
        `INSERT INTO assignments
           (resource_request_id, employee_id, contract_id, weekly_hours,
            start_date, end_date, role_title, notes,
            override_reason, override_checks, override_author_id, override_at,
            created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
         RETURNING *`,
        [
          data.resource_request_id, data.employee_id, data.contract_id,
          data.weekly_hours, data.start_date, data.end_date || null,
          data.role_title || null, data.notes || null,
          data.override_reason || null,
          data.override_checks ? JSON.stringify(data.override_checks) : null,
          data.override_author_id || null,
          data.override_at || null,
          createdBy,
        ],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE assignments SET
            weekly_hours = COALESCE($1, weekly_hours),
            start_date   = COALESCE($2, start_date),
            end_date     = COALESCE($3, end_date),
            status       = COALESCE($4, status),
            role_title   = COALESCE($5, role_title),
            notes        = COALESCE($6, notes),
            updated_at   = NOW()
          WHERE id = $7 AND deleted_at IS NULL
          RETURNING *`,
        [
          data.weekly_hours ?? null, data.start_date || null,
          data.end_date ?? null, data.status || null,
          data.role_title ?? null, data.notes ?? null, id,
        ],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE assignments SET deleted_at = NOW(), status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    async getEmployeeContext(employeeId) {
      const { rows } = await db.query(
        `SELECT id, area_id, level, weekly_capacity_hours, status
         FROM employees WHERE id = $1 AND deleted_at IS NULL`,
        [employeeId],
      );
      return rows[0] ?? null;
    },

    async getRequestContext(requestId) {
      const { rows } = await db.query(
        `SELECT id, area_id, level, weekly_hours, start_date::text, end_date::text, quantity, status
         FROM resource_requests WHERE id = $1 AND deleted_at IS NULL`,
        [requestId],
      );
      return rows[0] ?? null;
    },

    async getEmployeeAssignments(employeeId) {
      const { rows } = await db.query(
        `SELECT id, employee_id, weekly_hours, start_date::text, end_date::text, status
         FROM assignments
         WHERE employee_id = $1 AND deleted_at IS NULL AND status IN ('planned','active')`,
        [employeeId],
      );
      return rows;
    },

    async countActiveForRequest(requestId) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS count FROM assignments
         WHERE resource_request_id = $1 AND deleted_at IS NULL AND status IN ('planned','active')`,
        [requestId],
      );
      return rows[0].count;
    },

    async updateRequestStatus(requestId, status) {
      await db.query(
        `UPDATE resource_requests SET status = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL`,
        [status, requestId],
      );
    },

    async exportCsv(filters) {
      const { where, params } = buildWhere(filters);
      const { rows } = await db.query(
        `SELECT
           asg.id,
           CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
           e.level AS employee_level,
           a.name AS area_name,
           c.name AS contract_name,
           cl.name AS client_name,
           asg.role_title,
           asg.weekly_hours,
           asg.start_date,
           asg.end_date,
           asg.status,
           asg.created_at
         ${JOIN_CLAUSE}
         ${where}
         ORDER BY asg.start_date DESC`,
        params,
      );

      const header = 'id,employee_name,employee_level,area_name,contract_name,client_name,role_title,weekly_hours,start_date,end_date,status,created_at';
      const csvRows = rows.map((r) =>
        [
          r.id, csvEscape(r.employee_name), r.employee_level, csvEscape(r.area_name),
          csvEscape(r.contract_name), csvEscape(r.client_name), csvEscape(r.role_title),
          r.weekly_hours, r.start_date, r.end_date || '', r.status, r.created_at,
        ].join(','),
      );
      return [header, ...csvRows].join('\n');
    },
  };
}

function csvEscape(val: string | null): string {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
