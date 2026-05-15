import type { PlannerFilters, PlannerResult } from './types';
import type { CapacityRepository } from './repository';
import { generateWeeks, buildPlannerGrid } from './planner-engine';
import { BadRequest } from '@shared/errors';

export interface CapacityService {
  getPlanner(filters: PlannerFilters): Promise<PlannerResult>;
}

export function createCapacityService(repo: CapacityRepository): CapacityService {
  return {
    async getPlanner(filters) {
      const now = new Date();
      const day = now.getDay();
      const mondayDiff = day === 0 ? -6 : 1 - day;
      const thisMonday = new Date(now);
      thisMonday.setDate(now.getDate() + mondayDiff);

      const defaultFrom = thisMonday.toISOString().slice(0, 10);
      const defaultTo = new Date(thisMonday.getTime() + 12 * 7 * 86400000).toISOString().slice(0, 10);

      const dateFrom = filters.date_from || defaultFrom;
      const dateTo = filters.date_to || defaultTo;

      if (dateFrom > dateTo) {
        throw new BadRequest('date_from no puede ser posterior a date_to');
      }

      const diffMs = new Date(dateTo).getTime() - new Date(dateFrom).getTime();
      const diffWeeks = diffMs / (7 * 86400000);
      if (diffWeeks > 52) {
        throw new BadRequest('El rango máximo es 52 semanas');
      }

      const weeks = generateWeeks(dateFrom, dateTo);
      // Pass resolved dates so the repository can use them for the contract_id subquery.
      const employees = await repo.findEmployees({ ...filters, date_from: dateFrom, date_to: dateTo });

      if (employees.length === 0) {
        return {
          employees: [],
          weeks,
          summary: {
            total_employees: 0,
            idle_count: 0,
            light_count: 0,
            healthy_count: 0,
            overbooked_count: 0,
            avg_utilization_pct: 0,
          },
        };
      }

      const employeeIds = employees.map((e) => e.employee_id);
      const assignments = await repo.findAssignments(employeeIds, dateFrom, dateTo);

      return buildPlannerGrid(employees, assignments, weeks);
    },
  };
}
