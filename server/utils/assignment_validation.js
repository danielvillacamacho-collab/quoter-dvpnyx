/**
 * Assignment Validation Engine
 * ────────────────────────────
 * Pure, side-effect-free checks that evaluate whether a proposed
 * assignment of an employee to a resource request is compatible across
 * four dimensions: area, seniority level, weekly capacity, and date
 * overlap. Route handlers load the necessary rows and then call
 * `runAllChecks()` — the engine itself does NOT touch the database,
 * which keeps it trivially unit-testable and lets downstream consumers
 * (UI modal, AI recommender, capacity planner) reuse the same rules.
 *
 * Design notes
 * ────────────
 *  - Every check returns the same envelope: { check, status, message,
 *    detail?, overridable? }. `status` is one of pass|warn|fail|info.
 *    `overridable` is only present on `fail` (and means the caller can
 *    bypass with an explicit justification).
 *  - `runAllChecks()` aggregates per-check results into an overall
 *    decision (`valid`, `can_override`, `requires_justification`) plus
 *    a lightweight summary. Consumers should prefer the aggregate over
 *    re-deriving decisions from `checks`.
 *  - Level strings ('L1'..'L11') and numeric codes (1..11) are both
 *    accepted — the engine normalizes via `levelToNum()`. When we add
 *    AI-assisted matching, scores can use the integer gap directly.
 *  - No i18n layer yet: messages are Spanish, consistent with the rest
 *    of the product. If/when i18n lands, messages become keys.
 */

'use strict';

/* ── Constants ──────────────────────────────────────────────────── */

const CHECK_KEYS = Object.freeze({
  AREA:     'area_match',
  LEVEL:    'level_match',
  CAPACITY: 'capacity',
  DATES:    'date_conflict',
});

const STATUS = Object.freeze({
  PASS: 'pass',   // compatible, proceed
  WARN: 'warn',   // proceed with caution (advisory)
  FAIL: 'fail',   // incompatible — block unless overridden (if overridable)
  INFO: 'info',   // informational nuance (e.g. overqualified)
});

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * Convert a level string ('L1'..'L11') or integer (1..11) to a number
 * in [1,11], or null if the input is not recognizable. Case-insensitive.
 */
function levelToNum(level) {
  if (level == null) return null;
  if (typeof level === 'number' && Number.isFinite(level)) {
    const n = Math.trunc(level);
    return n >= 1 && n <= 11 ? n : null;
  }
  if (typeof level !== 'string') return null;
  const m = /^L(\d+)$/i.exec(level.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 11 ? n : null;
}

/** Parse an ISO date string (YYYY-MM-DD or full ISO) to epoch ms, TZ-safe. */
function parseDateUTC(input) {
  if (!input) return null;
  const s = typeof input === 'string' ? input : String(input);
  // Accept a plain YYYY-MM-DD and force UTC midnight to avoid DST drift.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (match) {
    const [, y, mo, d] = match;
    const t = Date.UTC(Number(y), Number(mo) - 1, Number(d));
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/* ── Individual checks ──────────────────────────────────────────── */

/**
 * Area match: does the employee belong to the same area as the role
 * requested? Mismatch is overridable (sometimes people cross-train).
 */
function checkArea({ employeeArea, requestArea } = {}) {
  if (!requestArea || requestArea.id == null) {
    return {
      check: CHECK_KEYS.AREA,
      status: STATUS.WARN,
      message: 'La solicitud no tiene área definida — no se pudo validar compatibilidad.',
      overridable: true,
    };
  }
  if (!employeeArea || employeeArea.id == null) {
    return {
      check: CHECK_KEYS.AREA,
      status: STATUS.WARN,
      message: 'El empleado no tiene área asignada — no se pudo validar compatibilidad.',
      overridable: true,
    };
  }
  if (Number(employeeArea.id) === Number(requestArea.id)) {
    return {
      check: CHECK_KEYS.AREA,
      status: STATUS.PASS,
      message: `Áreas coinciden: ${employeeArea.name || `área ${employeeArea.id}`}.`,
      detail: { employee_area_id: employeeArea.id, request_area_id: requestArea.id },
    };
  }
  return {
    check: CHECK_KEYS.AREA,
    status: STATUS.FAIL,
    message: `El empleado pertenece a "${employeeArea.name || 'sin nombre'}" pero la solicitud es para "${requestArea.name || 'sin nombre'}".`,
    detail: {
      employee_area_id: employeeArea.id, employee_area_name: employeeArea.name,
      request_area_id:  requestArea.id,  request_area_name:  requestArea.name,
    },
    overridable: true,
  };
}

/**
 * Seniority level match. Gaps:
 *   gap = 0           → pass (exact)
 *   gap > 0           → info (overqualified; cost impact caller-decided)
 *   gap = -1          → warn (one below — evaluate experience)
 *   gap ≤ -2          → fail overridable (requires justification)
 */
function checkLevel({ employeeLevel, requestLevel } = {}) {
  const emp = levelToNum(employeeLevel);
  const req = levelToNum(requestLevel);
  if (req == null) {
    return { check: CHECK_KEYS.LEVEL, status: STATUS.WARN, message: 'La solicitud no tiene level válido.', overridable: true };
  }
  if (emp == null) {
    return { check: CHECK_KEYS.LEVEL, status: STATUS.WARN, message: 'El empleado no tiene level válido.', overridable: true };
  }
  const gap = emp - req;
  const detail = { requested: req, actual: emp, gap };
  if (gap === 0) {
    return { check: CHECK_KEYS.LEVEL, status: STATUS.PASS, message: `Level exacto: L${emp}.`, detail };
  }
  if (gap > 0) {
    return {
      check: CHECK_KEYS.LEVEL, status: STATUS.INFO,
      message: `Sobre-calificado: empleado L${emp}, solicitud L${req}. Puede implicar mayor costo que el presupuestado.`,
      detail,
    };
  }
  if (gap === -1) {
    return {
      check: CHECK_KEYS.LEVEL, status: STATUS.WARN,
      message: `Empleado L${emp}, solicitud L${req} — un nivel por debajo. Evalúa si la experiencia compensa.`,
      detail,
    };
  }
  return {
    check: CHECK_KEYS.LEVEL, status: STATUS.FAIL,
    message: `Gap de ${Math.abs(gap)} niveles: empleado L${emp}, solicitud L${req}. Requiere justificación.`,
    detail,
    overridable: true,
  };
}

/**
 * Weekly capacity check. Compares requested hours against what remains
 * of the employee's weekly capacity after accounting for their current
 * committed (overlapping, non-terminal) assignments.
 *
 *   available >= requested          → pass
 *   0 < available < requested       → warn overridable (partial)
 *   available <= 0 (fully saturated) → fail overridable
 *
 * The threshold is the employee's nominal `weekly_capacity_hours`.
 * Legacy POST /api/assignments tolerates up to capacity × 1.10 before
 * rejecting as "overbooked" — that's an additional safeguard applied
 * by the route, not by this engine.
 */
function checkCapacity({ weeklyCapacity, committedHours, requestedHours } = {}) {
  const cap = Number(weeklyCapacity);
  const committed = Number(committedHours || 0);
  const requested = Number(requestedHours || 0);
  if (!Number.isFinite(cap) || cap <= 0) {
    return {
      check: CHECK_KEYS.CAPACITY, status: STATUS.WARN,
      message: 'El empleado no tiene capacidad semanal definida.',
      detail: { capacity: cap || 0, committed, requested, available: 0 },
      overridable: true,
    };
  }
  const available = cap - committed;
  const utilizationAfter = cap > 0 ? ((committed + requested) / cap) * 100 : 0;
  const detail = {
    capacity: round2(cap),
    committed: round2(committed),
    requested: round2(requested),
    available: round2(available),
    utilization_after_pct: round2(utilizationAfter),
  };
  if (available >= requested) {
    return {
      check: CHECK_KEYS.CAPACITY, status: STATUS.PASS,
      message: `Capacidad OK: ${round2(requested)}h solicitadas, ${round2(available)}h disponibles.`,
      detail,
    };
  }
  if (available > 0) {
    return {
      check: CHECK_KEYS.CAPACITY, status: STATUS.WARN,
      message: `Capacidad parcial: solicitadas ${round2(requested)}h, disponibles ${round2(available)}h. Quedarán ${round2(requested - available)}h sin cubrir.`,
      detail,
      overridable: true,
    };
  }
  return {
    check: CHECK_KEYS.CAPACITY, status: STATUS.FAIL,
    message: `Sin capacidad: el empleado ya está en ${round2(committed)}h/semana sobre ${round2(cap)}h (${round2((committed / cap) * 100)}% de utilización).`,
    detail,
    overridable: true,
  };
}

/**
 * Date overlap check. An assignment should live inside (or at least
 * overlap with) the request's active window. Inverted dates are a
 * non-overridable fail — they're always a bug.
 *
 *   fully_contained_in_request  → pass
 *   partial_overlap             → warn overridable
 *   no_overlap                  → fail non-overridable
 *   inverted assignment dates   → fail non-overridable
 *   missing request.start_date  → warn overridable (can't evaluate)
 */
function checkDates({ assignmentStart, assignmentEnd, requestStart, requestEnd } = {}) {
  const aStart = parseDateUTC(assignmentStart);
  if (aStart == null) {
    return { check: CHECK_KEYS.DATES, status: STATUS.FAIL, message: 'Fecha de inicio de la asignación inválida.', overridable: false };
  }
  const aEndRaw = parseDateUTC(assignmentEnd);
  const aEnd = aEndRaw != null ? aEndRaw : Number.POSITIVE_INFINITY;
  if (assignmentEnd && aEndRaw == null) {
    return { check: CHECK_KEYS.DATES, status: STATUS.FAIL, message: 'Fecha de fin de la asignación inválida.', overridable: false };
  }
  if (aEnd < aStart) {
    return {
      check: CHECK_KEYS.DATES, status: STATUS.FAIL,
      message: 'La fecha de fin es anterior a la de inicio.',
      overridable: false,
    };
  }
  const rStart = parseDateUTC(requestStart);
  if (rStart == null) {
    return {
      check: CHECK_KEYS.DATES, status: STATUS.WARN,
      message: 'La solicitud no tiene fecha de inicio — no se pudo validar overlap.',
      overridable: true,
    };
  }
  const rEndRaw = parseDateUTC(requestEnd);
  const rEnd = rEndRaw != null ? rEndRaw : Number.POSITIVE_INFINITY;

  const overlapStart = Math.max(aStart, rStart);
  const overlapEnd   = Math.min(aEnd, rEnd);
  if (overlapStart > overlapEnd) {
    return {
      check: CHECK_KEYS.DATES, status: STATUS.FAIL,
      message: 'La asignación no se solapa con el periodo de la solicitud.',
      overridable: false,
      detail: {
        assignment_start: assignmentStart, assignment_end: assignmentEnd || null,
        request_start: requestStart, request_end: requestEnd || null,
      },
    };
  }
  const fullyContained = aStart >= rStart && aEnd <= rEnd;
  if (fullyContained) {
    return {
      check: CHECK_KEYS.DATES, status: STATUS.PASS,
      message: 'Las fechas están dentro del periodo de la solicitud.',
    };
  }
  return {
    check: CHECK_KEYS.DATES, status: STATUS.WARN,
    message: 'Las fechas de la asignación se solapan parcialmente con la solicitud.',
    overridable: true,
    detail: {
      assignment_start: assignmentStart, assignment_end: assignmentEnd || null,
      request_start: requestStart, request_end: requestEnd || null,
    },
  };
}

/* ── Aggregator ─────────────────────────────────────────────────── */

/**
 * Run all four checks and aggregate. Inputs mirror the row shapes used
 * by the existing routes, with one addition: `employee.committed_hours`
 * — the sum of the employee's overlapping non-terminal weekly_hours,
 * which the caller computes via a single SQL query.
 *
 * Shape:
 *   employee:  { area_id, area_name, level, weekly_capacity_hours, committed_hours }
 *   request:   { area_id, area_name, level, start_date, end_date }
 *   proposed:  { weekly_hours, start_date, end_date }
 */
function runAllChecks({ employee = {}, request = {}, proposed = {} } = {}) {
  const checks = [
    checkArea({
      employeeArea: employee.area_id != null ? { id: employee.area_id, name: employee.area_name } : null,
      requestArea:  request.area_id  != null ? { id: request.area_id,  name: request.area_name  } : null,
    }),
    checkLevel({ employeeLevel: employee.level, requestLevel: request.level }),
    checkCapacity({
      weeklyCapacity:  employee.weekly_capacity_hours,
      committedHours:  employee.committed_hours,
      requestedHours:  proposed.weekly_hours,
    }),
    checkDates({
      assignmentStart: proposed.start_date,
      assignmentEnd:   proposed.end_date,
      requestStart:    request.start_date,
      requestEnd:      request.end_date,
    }),
  ];

  const fails = checks.filter((c) => c.status === STATUS.FAIL);
  const nonOverridableFails = fails.filter((c) => c.overridable !== true);
  const overridableFails    = fails.filter((c) => c.overridable === true);

  return {
    valid: fails.length === 0,
    can_override: fails.length > 0 && nonOverridableFails.length === 0,
    requires_justification: overridableFails.length > 0,
    checks,
    summary: {
      pass: checks.filter((c) => c.status === STATUS.PASS).length,
      warn: checks.filter((c) => c.status === STATUS.WARN).length,
      info: checks.filter((c) => c.status === STATUS.INFO).length,
      fail: fails.length,
      non_overridable_fails: nonOverridableFails.length,
      overridable_fails: overridableFails.length,
    },
  };
}

module.exports = {
  CHECK_KEYS,
  STATUS,
  levelToNum,
  checkArea,
  checkLevel,
  checkCapacity,
  checkDates,
  runAllChecks,
};
