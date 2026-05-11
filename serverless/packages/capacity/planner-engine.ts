import type {
  UtilizationBucket, WeekAssignment, EmployeeWeek,
  EmployeePlannerRow, PlannerResult, RawAssignmentRow, RawEmployeeRow,
} from './types';

/**
 * Determines the utilization bucket for a given utilization percentage.
 * - idle:       0%
 * - light:      1% - 59%
 * - healthy:    60% - 100%
 * - overbooked: > 100%
 */
export function toBucket(utilizationPct: number): UtilizationBucket {
  if (utilizationPct <= 0) return 'idle';
  if (utilizationPct < 60) return 'light';
  if (utilizationPct <= 100) return 'healthy';
  return 'overbooked';
}

/**
 * Generates an array of Monday dates (ISO strings) for the given date range.
 */
export function generateWeeks(dateFrom: string, dateTo: string): string[] {
  const weeks: string[] = [];
  const start = new Date(dateFrom);
  const end = new Date(dateTo);

  // Align to Monday
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);

  const current = new Date(start);
  while (current <= end) {
    weeks.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

/**
 * Checks if an assignment overlaps with a given week.
 * A week spans from weekStart (Monday) to weekStart + 6 days (Sunday).
 */
function assignmentOverlapsWeek(
  asg: RawAssignmentRow,
  weekStart: string,
): boolean {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  if (asg.start_date > weekEndStr) return false;
  if (asg.end_date && asg.end_date < weekStart) return false;
  return true;
}

/**
 * Builds the full planner grid: employees x weeks with utilization data.
 * Pure function - no DB access.
 */
export function buildPlannerGrid(
  employees: RawEmployeeRow[],
  assignments: RawAssignmentRow[],
  weeks: string[],
): PlannerResult {
  // Index assignments by employee
  const assignmentsByEmployee = new Map<string, RawAssignmentRow[]>();
  for (const asg of assignments) {
    const list = assignmentsByEmployee.get(asg.employee_id) || [];
    list.push(asg);
    assignmentsByEmployee.set(asg.employee_id, list);
  }

  const employeeRows: EmployeePlannerRow[] = [];

  for (const emp of employees) {
    const empAssignments = assignmentsByEmployee.get(emp.employee_id) || [];
    const capacity = Number(emp.weekly_capacity_hours) || 40;
    const weekData: EmployeeWeek[] = [];

    for (const weekStart of weeks) {
      const weekAssignments: WeekAssignment[] = [];

      for (const asg of empAssignments) {
        if (assignmentOverlapsWeek(asg, weekStart)) {
          weekAssignments.push({
            assignment_id: asg.assignment_id,
            contract_id: asg.contract_id,
            contract_name: asg.contract_name,
            client_name: asg.client_name,
            role_title: asg.role_title,
            weekly_hours: Number(asg.weekly_hours),
            status: asg.status,
          });
        }
      }

      const totalHours = weekAssignments.reduce((s, a) => s + a.weekly_hours, 0);
      const utilizationPct = capacity > 0 ? Math.round((totalHours / capacity) * 100) : 0;

      weekData.push({
        week_start: weekStart,
        assignments: weekAssignments,
        total_hours: totalHours,
        capacity_hours: capacity,
        utilization_pct: utilizationPct,
        bucket: toBucket(utilizationPct),
      });
    }

    const avgUtil = weekData.length > 0
      ? Math.round(weekData.reduce((s, w) => s + w.utilization_pct, 0) / weekData.length)
      : 0;

    employeeRows.push({
      employee_id: emp.employee_id,
      first_name: emp.first_name,
      last_name: emp.last_name,
      area_id: emp.area_id,
      area_name: emp.area_name,
      level: emp.level,
      country: emp.country,
      status: emp.status,
      weekly_capacity_hours: capacity,
      weeks: weekData,
      avg_utilization_pct: avgUtil,
      avg_bucket: toBucket(avgUtil),
    });
  }

  // Summary
  let idleCount = 0, lightCount = 0, healthyCount = 0, overbookedCount = 0;
  for (const row of employeeRows) {
    switch (row.avg_bucket) {
      case 'idle': idleCount++; break;
      case 'light': lightCount++; break;
      case 'healthy': healthyCount++; break;
      case 'overbooked': overbookedCount++; break;
    }
  }

  const avgUtilization = employeeRows.length > 0
    ? Math.round(employeeRows.reduce((s, r) => s + r.avg_utilization_pct, 0) / employeeRows.length)
    : 0;

  return {
    employees: employeeRows,
    weeks,
    summary: {
      total_employees: employeeRows.length,
      idle_count: idleCount,
      light_count: lightCount,
      healthy_count: healthyCount,
      overbooked_count: overbookedCount,
      avg_utilization_pct: avgUtilization,
    },
  };
}
