import type { Pool } from 'pg';
import type { PlannerFilters, RawAssignmentRow, RawEmployeeRow } from './types';

export interface CapacityRepository {
  findEmployees(filters: PlannerFilters): Promise<RawEmployeeRow[]>;
  findAssignments(employeeIds: string[], dateFrom: string, dateTo: string): Promise<RawAssignmentRow[]>;
  countAllActive(): Promise<number>;
}

export function createCapacityRepository(db: Pool): CapacityRepository {
  return {
    async findEmployees(filters) {
      const wheres = ['e.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.area_id) wheres.push(`e.area_id = ${add(Number(filters.area_id))}`);

      if (filters.level) {
        wheres.push(`e.level = ${add(filters.level)}`);
      } else {
        if (filters.level_min) {
          const numMin = Number(String(filters.level_min).replace(/[^0-9]/g, ''));
          if (!isNaN(numMin) && numMin > 0) {
            wheres.push(`NULLIF(regexp_replace(e.level, '[^0-9]', '', 'g'), '')::integer >= ${add(numMin)}`);
          }
        }
        if (filters.level_max) {
          const numMax = Number(String(filters.level_max).replace(/[^0-9]/g, ''));
          if (!isNaN(numMax) && numMax > 0) {
            wheres.push(`NULLIF(regexp_replace(e.level, '[^0-9]', '', 'g'), '')::integer <= ${add(numMax)}`);
          }
        }
      }

      if (filters.status) {
        wheres.push(`e.status = ${add(filters.status)}`);
      } else {
        wheres.push(`e.status IN ('active','on_leave','bench')`);
      }

      if (filters.employee_id) wheres.push(`e.id = ${add(filters.employee_id)}`);
      if (filters.country) wheres.push(`e.country = ${add(filters.country)}`);

      if (filters.search) {
        const term = filters.search.replace(/%/g, '\\%').replace(/_/g, '\\_');
        wheres.push(`(e.first_name || ' ' || e.last_name) ILIKE ${add('%' + term + '%')}`);
      }

      if (filters.contract_id) {
        const contractParam = add(filters.contract_id);
        if (filters.date_from && filters.date_to) {
          const dateToParam = add(filters.date_to);
          const dateFromParam = add(filters.date_from);
          wheres.push(`EXISTS (
            SELECT 1 FROM assignments asg
            WHERE asg.employee_id = e.id
              AND asg.contract_id = ${contractParam}
              AND asg.deleted_at IS NULL
              AND asg.status IN ('planned','active')
              AND asg.start_date <= ${dateToParam}
              AND (asg.end_date IS NULL OR asg.end_date >= ${dateFromParam})
          )`);
        } else {
          wheres.push(`EXISTS (
            SELECT 1 FROM assignments asg
            WHERE asg.employee_id = e.id
              AND asg.contract_id = ${contractParam}
              AND asg.deleted_at IS NULL
              AND asg.status IN ('planned','active')
          )`);
        }
      }

      const where = 'WHERE ' + wheres.join(' AND ');

      const { rows } = await db.query(
        `SELECT
           e.id AS employee_id,
           e.first_name,
           e.last_name,
           e.area_id,
           a.name AS area_name,
           e.level,
           e.country,
           e.status,
           e.weekly_capacity_hours
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
         ${where}
         ORDER BY e.first_name, e.last_name`,
        params,
      );
      return rows;
    },

    async findAssignments(employeeIds, dateFrom, dateTo) {
      if (employeeIds.length === 0) return [];

      const { rows } = await db.query(
        `SELECT
           asg.id AS assignment_id,
           asg.employee_id,
           asg.contract_id,
           c.name AS contract_name,
           cl.name AS client_name,
           asg.role_title,
           asg.weekly_hours,
           asg.start_date::text,
           asg.end_date::text,
           asg.status,
           asg.resource_request_id
         FROM assignments asg
         LEFT JOIN contracts c ON c.id = asg.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE asg.deleted_at IS NULL
           AND asg.status IN ('planned','active')
           AND asg.employee_id = ANY($1)
           AND asg.start_date <= $2
           AND (asg.end_date IS NULL OR asg.end_date >= $3)
         ORDER BY asg.start_date`,
        [employeeIds, dateTo, dateFrom],
      );
      return rows;
    },

    async countAllActive() {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS cnt
         FROM employees
         WHERE deleted_at IS NULL AND status IN ('active','on_leave','bench')`,
      );
      return Number(rows[0]?.cnt) || 0;
    },
  };
}
