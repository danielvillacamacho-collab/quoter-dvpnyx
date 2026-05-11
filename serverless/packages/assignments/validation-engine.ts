import type { ValidationCheck, ValidationResult, EmployeeContext, RequestContext, ExistingAssignment } from './types';

const LEVEL_RANK: Record<string, number> = {
  L1: 1, L2: 2, L3: 3, L4: 4, L5: 5, L6: 6,
  L7: 7, L8: 8, L9: 9, L10: 10, L11: 11,
};

/**
 * Check if employee area matches the resource request area.
 */
function checkAreaMatch(employee: EmployeeContext, request: RequestContext): ValidationCheck | null {
  if (employee.area_id !== request.area_id) {
    return {
      code: 'AREA_MISMATCH',
      severity: 'warning',
      message: `El área del empleado (${employee.area_id}) no coincide con el requerimiento (${request.area_id})`,
      details: { employee_area_id: employee.area_id, request_area_id: request.area_id },
    };
  }
  return null;
}

/**
 * Check level gap between employee and request.
 * Gap > 2 levels produces a warning.
 */
function checkLevelGap(employee: EmployeeContext, request: RequestContext): ValidationCheck | null {
  const empRank = LEVEL_RANK[employee.level] ?? 0;
  const reqRank = LEVEL_RANK[request.level] ?? 0;
  const gap = Math.abs(empRank - reqRank);

  if (gap > 2) {
    return {
      code: 'LEVEL_GAP',
      severity: 'warning',
      message: `Gap de nivel = ${gap} (empleado ${employee.level}, requerimiento ${request.level}). Gap > 2 requiere justificación.`,
      details: { employee_level: employee.level, request_level: request.level, gap },
    };
  }
  return null;
}

/**
 * Check if the new assignment would cause capacity overbooking.
 * sum(existing active hours) + new hours > capacity * 1.10 => error
 */
function checkCapacityOverlap(
  employee: EmployeeContext,
  newWeeklyHours: number,
  existingAssignments: ExistingAssignment[],
  newStartDate: string,
  newEndDate: string | null,
): ValidationCheck | null {
  // Sum hours from overlapping active/planned assignments
  const overlapping = existingAssignments.filter((a) => {
    if (a.status !== 'planned' && a.status !== 'active') return false;
    // Check date overlap
    if (newEndDate && a.start_date > newEndDate) return false;
    if (a.end_date && a.end_date < newStartDate) return false;
    return true;
  });

  const currentHours = overlapping.reduce((sum, a) => sum + Number(a.weekly_hours), 0);
  const totalHours = currentHours + newWeeklyHours;
  const threshold = Number(employee.weekly_capacity_hours) * 1.10;

  if (totalHours > threshold) {
    return {
      code: 'CAPACITY_EXCEEDED',
      severity: 'error',
      message: `Sobrecarga: ${totalHours}h/sem excede el 110% de capacidad (${threshold.toFixed(1)}h/sem). Usa force:true + override_reason para forzar.`,
      details: {
        current_hours: currentHours,
        new_hours: newWeeklyHours,
        total_hours: totalHours,
        capacity: Number(employee.weekly_capacity_hours),
        threshold,
      },
    };
  }
  return null;
}

/**
 * Check for date overlap with existing assignments on the same contract + request.
 */
function checkDateOverlap(
  existingAssignments: ExistingAssignment[],
  employeeId: string,
  newStartDate: string,
  newEndDate: string | null,
): ValidationCheck | null {
  for (const a of existingAssignments) {
    if (a.employee_id !== employeeId) continue;
    if (a.status !== 'planned' && a.status !== 'active') continue;

    const overlaps =
      (!newEndDate || a.start_date <= newEndDate) &&
      (!a.end_date || a.end_date >= newStartDate);

    if (overlaps) {
      return {
        code: 'DATE_OVERLAP',
        severity: 'warning',
        message: `El empleado ya tiene una asignación (${a.id}) con fechas superpuestas en el mismo período.`,
        details: {
          existing_assignment_id: a.id,
          existing_start: a.start_date,
          existing_end: a.end_date,
        },
      };
    }
  }
  return null;
}

/**
 * Run all validation checks for a new assignment.
 * Pure function - no DB access.
 */
export function validateAssignment(
  employee: EmployeeContext,
  request: RequestContext,
  newWeeklyHours: number,
  newStartDate: string,
  newEndDate: string | null,
  existingAssignments: ExistingAssignment[],
): ValidationResult {
  const checks: ValidationCheck[] = [];

  // Employee must be active
  if (employee.status !== 'active') {
    checks.push({
      code: 'EMPLOYEE_INACTIVE',
      severity: 'error',
      message: `El empleado no está activo (estado: ${employee.status})`,
      details: { employee_status: employee.status },
    });
  }

  // Request must be open or partially filled
  if (request.status !== 'open' && request.status !== 'partially_filled') {
    checks.push({
      code: 'REQUEST_NOT_OPEN',
      severity: 'error',
      message: `El requerimiento no acepta más asignaciones (estado: ${request.status})`,
      details: { request_status: request.status },
    });
  }

  const areaCheck = checkAreaMatch(employee, request);
  if (areaCheck) checks.push(areaCheck);

  const levelCheck = checkLevelGap(employee, request);
  if (levelCheck) checks.push(levelCheck);

  const capacityCheck = checkCapacityOverlap(
    employee, newWeeklyHours, existingAssignments, newStartDate, newEndDate,
  );
  if (capacityCheck) checks.push(capacityCheck);

  const dateCheck = checkDateOverlap(existingAssignments, employee.id, newStartDate, newEndDate);
  if (dateCheck) checks.push(dateCheck);

  const errors = checks.filter((c) => c.severity === 'error');
  const warnings = checks.filter((c) => c.severity === 'warning');

  return {
    valid: errors.length === 0,
    checks,
    warnings,
    errors,
  };
}
