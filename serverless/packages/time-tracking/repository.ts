import type { Pool, PoolClient } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type {
  TimeEntry, TimeEntryFilters,
  WeeklyTimeAllocation, AllocationFilters, BulkAllocationItem,
} from './types';
import { ENTRY_SORTABLE } from './types';

// ─── Time Entries Repository ───

export interface TimeEntryRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: TimeEntryFilters;
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<TimeEntry>>;
  findById(id: string): Promise<TimeEntry | null>;
  create(data: Record<string, unknown>, createdBy: string): Promise<TimeEntry>;
  update(id: string, data: Record<string, unknown>): Promise<TimeEntry | null>;
  softDelete(id: string): Promise<TimeEntry | null>;
  findByEmployeeAndWeek(employeeId: string, weekStart: string): Promise<TimeEntry[]>;
  bulkCreate(entries: Array<Record<string, unknown>>, createdBy: string, client: PoolClient): Promise<TimeEntry[]>;
}

export function createTimeEntryRepository(db: Pool): TimeEntryRepository {
  const SELECT_FIELDS = `te.*,
    CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
    asg.role_title AS assignment_role_title,
    c.name AS contract_name,
    cl.name AS client_name`;

  const JOIN_CLAUSE = `FROM time_entries te
    LEFT JOIN employees e ON e.id = te.employee_id
    LEFT JOIN assignments asg ON asg.id = te.assignment_id
    LEFT JOIN contracts c ON c.id = asg.contract_id
    LEFT JOIN clients cl ON cl.id = c.client_id`;

  function buildWhere(filters: TimeEntryFilters) {
    const wheres = ['te.deleted_at IS NULL'];
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (filters.employee_id) wheres.push(`te.employee_id = ${add(filters.employee_id)}`);
    if (filters.assignment_id) wheres.push(`te.assignment_id = ${add(filters.assignment_id)}`);
    if (filters.date_from) wheres.push(`te.work_date >= ${add(filters.date_from)}`);
    if (filters.date_to) wheres.push(`te.work_date <= ${add(filters.date_to)}`);
    if (filters.status) wheres.push(`te.status = ${add(filters.status)}`);

    return { where: 'WHERE ' + wheres.join(' AND '), params };
  }

  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const { where, params } = buildWhere(filters);
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM time_entries te ${where}`, countParams),
        db.query(
          `SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE}
           ${where}
           ORDER BY ${sort.orderBy || 'te.work_date DESC'}
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
         WHERE te.id = $1 AND te.deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async create(data, createdBy) {
      const { rows } = await db.query(
        `INSERT INTO time_entries
           (employee_id, assignment_id, work_date, hours, description, status, created_by)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'draft'), $7)
         RETURNING *`,
        [
          data.employee_id, data.assignment_id, data.work_date,
          data.hours, data.description || null, data.status || null, createdBy,
        ],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE time_entries SET
            hours            = COALESCE($1, hours),
            description      = COALESCE($2, description),
            status           = COALESCE($3, status),
            rejection_reason = COALESCE($4, rejection_reason),
            approved_at      = CASE WHEN $3 = 'approved' THEN NOW() ELSE approved_at END,
            approved_by      = CASE WHEN $3 = 'approved' THEN $5 ELSE approved_by END,
            updated_at       = NOW()
          WHERE id = $6 AND deleted_at IS NULL
          RETURNING *`,
        [
          data.hours ?? null, data.description ?? null,
          data.status || null, data.rejection_reason ?? null,
          data.approved_by || null, id,
        ],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE time_entries SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    async findByEmployeeAndWeek(employeeId, weekStart) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekEndStr = weekEnd.toISOString().slice(0, 10);

      const { rows } = await db.query(
        `SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE}
         WHERE te.employee_id = $1
           AND te.work_date >= $2
           AND te.work_date <= $3
           AND te.deleted_at IS NULL
         ORDER BY te.work_date, te.assignment_id`,
        [employeeId, weekStart, weekEndStr],
      );
      return rows;
    },

    async bulkCreate(entries, createdBy, client) {
      const created: TimeEntry[] = [];
      for (const entry of entries) {
        const { rows } = await client.query(
          `INSERT INTO time_entries
             (employee_id, assignment_id, work_date, hours, description, status, created_by)
           VALUES ($1, $2, $3, $4, $5, 'draft', $6)
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [
            entry.employee_id, entry.assignment_id, entry.work_date,
            entry.hours, entry.description || null, createdBy,
          ],
        );
        if (rows[0]) created.push(rows[0]);
      }
      return created;
    },
  };
}

// ─── Weekly Time Allocations Repository ───

export interface AllocationRepository {
  findAll(filters: AllocationFilters): Promise<WeeklyTimeAllocation[]>;
  bulkUpsert(
    employeeId: string,
    allocations: BulkAllocationItem[],
    userId: string,
    client: PoolClient,
  ): Promise<WeeklyTimeAllocation[]>;
}

export function createAllocationRepository(db: Pool): AllocationRepository {
  return {
    async findAll(filters) {
      const wheres: string[] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.employee_id) wheres.push(`wta.employee_id = ${add(filters.employee_id)}`);
      if (filters.assignment_id) wheres.push(`wta.assignment_id = ${add(filters.assignment_id)}`);
      if (filters.week_start_date) wheres.push(`wta.week_start_date = ${add(filters.week_start_date)}`);
      if (filters.date_from) wheres.push(`wta.week_start_date >= ${add(filters.date_from)}`);
      if (filters.date_to) wheres.push(`wta.week_start_date <= ${add(filters.date_to)}`);

      const where = wheres.length > 0 ? 'WHERE ' + wheres.join(' AND ') : '';

      const { rows } = await db.query(
        `SELECT wta.*,
           asg.role_title AS assignment_role_title,
           c.name AS contract_name,
           cl.name AS client_name
         FROM weekly_time_allocations wta
         LEFT JOIN assignments asg ON asg.id = wta.assignment_id
         LEFT JOIN contracts c ON c.id = asg.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         ${where}
         ORDER BY wta.week_start_date, wta.assignment_id`,
        params,
      );
      return rows;
    },

    async bulkUpsert(employeeId, allocations, userId, client) {
      const results: WeeklyTimeAllocation[] = [];
      for (const alloc of allocations) {
        const { rows } = await client.query(
          `INSERT INTO weekly_time_allocations
             (employee_id, week_start_date, assignment_id, pct, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (employee_id, week_start_date, assignment_id)
           DO UPDATE SET
             pct = EXCLUDED.pct,
             notes = COALESCE(EXCLUDED.notes, weekly_time_allocations.notes),
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
           RETURNING *`,
          [
            employeeId, alloc.week_start_date, alloc.assignment_id,
            alloc.pct, alloc.notes || null, userId,
          ],
        );
        if (rows[0]) results.push(rows[0]);
      }
      return results;
    },
  };
}
