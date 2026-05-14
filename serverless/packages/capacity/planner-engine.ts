import type {
  UtilizationBucket, WeekAssignment, EmployeeWeek,
  EmployeePlannerRow, PlannerResult, RawAssignmentRow, RawEmployeeRow,
} from './types';

export function toBucket(pct: number): UtilizationBucket {
  if (!isFinite(pct) || pct <= 0) return 'idle';
  if (pct <= 75) return 'light';
  if (pct <= 100) return 'healthy';
  return 'overbooked';
}

export function generateWeeks(dateFrom: string, dateTo: string): string[] {
  const weeks: string[] = [];
  const start = new Date(dateFrom + 'T00:00:00Z');
  const end = new Date(dateTo + 'T00:00:00Z');

  const dow = start.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  start.setUTCDate(start.getUTCDate() + diff);

  const current = new Date(start);
  while (current <= end) {
    weeks.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 7);
  }

  return weeks;
}

function parseDateUTC(s: string | null | undefined): Date | null {
  if (s == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isFinite(d.getTime()) ? d : null;
}

/**
 * Count business days (Mon–Fri) where the assignment [aStart, aEnd]
 * overlaps the week window [wStart, wEnd]. Returns 0–5.
 */
function businessDaysInOverlap(
  aStart: string,
  aEnd: string | null,
  wStart: string,
  wEnd: string,
): number {
  const as = parseDateUTC(aStart);
  const ws = parseDateUTC(wStart);
  if (!as || !ws) return 0;
  const ae = aEnd ? parseDateUTC(aEnd) : null;
  const we = parseDateUTC(wEnd);
  if (!we) return 0;

  const overlapStart = as > ws ? as : ws;
  const overlapEnd = ae ? (ae < we ? ae : we) : we;
  if (overlapEnd < overlapStart) return 0;

  let count = 0;
  const cur = new Date(overlapStart.getTime());
  while (cur <= overlapEnd) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

export function buildPlannerGrid(
  employees: RawEmployeeRow[],
  assignments: RawAssignmentRow[],
  weeks: string[],
): PlannerResult {
  const assignmentsByEmployee = new Map<string, RawAssignmentRow[]>();
  for (const asg of assignments) {
    const list = assignmentsByEmployee.get(asg.employee_id) || [];
    list.push(asg);
    assignmentsByEmployee.set(asg.employee_id, list);
  }

  const BDAYS = 5;
  const employeeRows: EmployeePlannerRow[] = [];

  for (const emp of employees) {
    const empAssignments = assignmentsByEmployee.get(emp.employee_id) || [];
    const capacity = Number(emp.weekly_capacity_hours) || 40;

    // Pre-compute week end dates
    const weekWindows = weeks.map((ws, index) => {
      const we = new Date(ws + 'T00:00:00Z');
      we.setUTCDate(we.getUTCDate() + 6);
      return { index, start: ws, end: we.toISOString().slice(0, 10) };
    });

    const weekData: EmployeeWeek[] = weekWindows.map(({ index, start, end }) => {
      const weekAssignments: WeekAssignment[] = [];
      let totalHours = 0;

      for (const asg of empAssignments) {
        if (asg.status === 'cancelled') continue;
        const hrs = Number(asg.weekly_hours) || 0;
        if (hrs <= 0) continue;

        const activeDays = businessDaysInOverlap(asg.start_date, asg.end_date, start, end);
        if (activeDays > 0) {
          const prorated = Math.round((hrs * activeDays / BDAYS) * 10) / 10;
          totalHours += prorated;
          weekAssignments.push({
            assignment_id: asg.assignment_id,
            contract_id: asg.contract_id,
            contract_name: asg.contract_name,
            client_name: asg.client_name,
            role_title: asg.role_title,
            weekly_hours: asg.weekly_hours,
            status: asg.status,
            resource_request_id: asg.resource_request_id ?? null,
          });
        }
      }

      totalHours = Math.round(totalHours * 10) / 10;
      const pct = capacity > 0 ? (totalHours / capacity) * 100 : 0;
      const utilizationPct = Math.round(pct * 10) / 10;

      return {
        week_index: index,
        week_start: start,
        assignments: weekAssignments,
        total_hours: totalHours,
        capacity_hours: capacity,
        utilization_pct: utilizationPct,
        bucket: toBucket(pct),
      };
    });

    const hasOverbookedWeek = weekData.some(w => w.utilization_pct > 100);
    const weeksWithLoad = weekData.filter(w => w.utilization_pct > 0);
    const avgUtil = weeksWithLoad.length > 0
      ? Math.round(weeksWithLoad.reduce((s, w) => s + w.utilization_pct, 0) / weeksWithLoad.length * 10) / 10
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
      has_overbooked_week: hasOverbookedWeek,
    });
  }

  let idleCount = 0, lightCount = 0, healthyCount = 0, overbookedCount = 0;
  for (const row of employeeRows) {
    switch (row.avg_bucket) {
      case 'idle': idleCount++; break;
      case 'light': lightCount++; break;
      case 'healthy': healthyCount++; break;
      case 'overbooked': overbookedCount++; break;
    }
  }

  // Global avg: flat average of utilization_pct across all (employee, week) pairs with hours > 0
  let utilSum = 0, utilCount = 0;
  for (const row of employeeRows) {
    for (const w of row.weeks) {
      if (w.total_hours > 0) {
        utilSum += w.utilization_pct;
        utilCount++;
      }
    }
  }
  const avgUtilization = utilCount > 0 ? Math.round((utilSum / utilCount) * 10) / 10 : 0;

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
