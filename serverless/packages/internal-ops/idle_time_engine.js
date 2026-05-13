/**
 * Idle Time Engine — SPEC-II-00, sección 7.1.
 *
 * Funciones puras (sin DB) que calculan el snapshot mensual de un
 * empleado: capacity total, restas (festivos/novedades), asignaciones
 * a contratos e iniciativas internas, y el idle resultante con su
 * costo en USD.
 *
 * Diseño:
 *   - Las queries a Postgres viven en `routes/idle_time.js`. Aquí
 *     recibimos arrays plano-objetos que el route ya cargó. Esto hace
 *     que TODA la lógica sea testeable sin pool ni fixtures de DB.
 *   - Trabajamos en horas (NUMERIC) y porcentajes 0..1.
 *   - Días hábiles = lunes-viernes del país (sin festivo, sin novedad).
 *
 * Edge cases cubiertos (ver tests):
 *   - Empleado contratado mid-mes  → capacity proporcional desde hire_date.
 *   - Empleado dado de baja        → capacity hasta end_date inclusive.
 *   - Mes de novedad full          → available_hours = 0, idle_pct = 0.
 *   - Festivo en sábado/domingo    → ignorado (no era día hábil).
 *   - Novedad parcial dentro mes   → solo días hábiles dentro del mes.
 *   - Asignación parcial (weekly)  → proporcional por días hábiles cubiertos.
 *   - Sobre-asignación             → idle_hours = 0 (no negativo) + flag.
 *   - corporate_training           → cuenta como assigned_internal, NO resta.
 *   - Tarifa horaria ausente       → idle_cost_usd = 0 + flag missing_rate.
 */

'use strict';

const DEFAULT_WORKDAY_HOURS = 8;

/* ------------------------------------------------------------------ */
/* Calendario                                                          */
/* ------------------------------------------------------------------ */

/** Parsea 'YYYY-MM' o 'YYYYMM' a {year, month} (1..12). null si inválido. */
function parsePeriod(yyyymm) {
  if (yyyymm == null) return null;
  const s = String(yyyymm).trim().replace('-', '');
  if (!/^[0-9]{6}$/.test(s)) return null;
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10);
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Devuelve 'YYYY-MM-DD' (UTC) para year, month (1..12), day. */
function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Primer día del período. */
function periodStart(yyyymm) {
  const p = parsePeriod(yyyymm);
  if (!p) return null;
  return isoDate(p.year, p.month, 1);
}

/** Último día del período. */
function periodEnd(yyyymm) {
  const p = parsePeriod(yyyymm);
  if (!p) return null;
  // Truco: día 0 del mes siguiente == último del mes actual.
  const d = new Date(Date.UTC(p.year, p.month, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Lista 'YYYY-MM-DD' de días hábiles (L-V) del período, opcionalmente
 * acotado a un sub-rango [from, to]. Las fechas se devuelven como string
 * para evitar líos de TZ.
 */
function workdaysOfPeriod(yyyymm, opts = {}) {
  const p = parsePeriod(yyyymm);
  if (!p) return [];
  const start = opts.from ? new Date(opts.from + 'T00:00:00Z') : new Date(Date.UTC(p.year, p.month - 1, 1));
  const periodLast = new Date(Date.UTC(p.year, p.month, 0));
  const limitTo = opts.to ? new Date(opts.to + 'T00:00:00Z') : periodLast;
  const end = limitTo < periodLast ? limitTo : periodLast;
  const periodFirst = new Date(Date.UTC(p.year, p.month - 1, 1));
  const realStart = start < periodFirst ? periodFirst : start;
  const days = [];
  for (let d = new Date(realStart); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay(); // 0=dom, 6=sáb
    if (dow !== 0 && dow !== 6) {
      days.push(d.toISOString().slice(0, 10));
    }
  }
  return days;
}

/** ¿Una fecha 'YYYY-MM-DD' está dentro del rango inclusivo [start..end]? */
function inRange(dateIso, startIso, endIso) {
  if (!dateIso || !startIso) return false;
  if (dateIso < startIso) return false;
  if (endIso && dateIso > endIso) return false;
  return true;
}

/** Intersección [a..b] ∩ [c..d] como [start, end] o null si no hay solape. */
function intersectRange(a, b, c, d) {
  const start = a > c ? a : c;
  const endA = b || '9999-12-31';
  const endC = d || '9999-12-31';
  const end = endA < endC ? endA : endC;
  if (start > end) return null;
  return [start, end];
}

/* ------------------------------------------------------------------ */
/* Tarifa horaria interna del empleado                                 */
/* ------------------------------------------------------------------ */

/**
 * Deriva la tarifa horaria USD desde un employee_cost mensual.
 *
 *   hourly = cost_usd / (weekly_capacity_hours × 52 / 12)
 *
 * Devuelve null si faltan datos. El idle engine trata null como
 * missing_rate y costea idle en 0 (con flag).
 */
function deriveHourlyRateUsd({ cost_usd, weekly_capacity_hours }) {
  const cost = Number(cost_usd);
  const wch = Number(weekly_capacity_hours);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(wch) || wch <= 0) return null;
  const monthlyHours = (wch * 52) / 12;
  if (monthlyHours <= 0) return null;
  return round4(cost / monthlyHours);
}

/* ------------------------------------------------------------------ */
/* Cálculo principal                                                   */
/* ------------------------------------------------------------------ */

/**
 * Calcula el snapshot de idle time de un empleado en un período.
 *
 * @param {object} input
 *   - period_yyyymm:           'YYYY-MM' (o YYYYMM)
 *   - employee:                { id, weekly_capacity_hours, hire_date, end_date, country_id }
 *   - country:                 { id, standard_workday_hours }    (default 8h)
 *   - holidays:                [{ holiday_date }]                (del país)
 *   - novelties:               [{ start_date, end_date, novelty_type_id, counts_in_capacity }]
 *   - contractAssignments:     [{ start_date, end_date, weekly_hours }]
 *   - internalAssignments:     [{ start_date, end_date, weekly_hours, hourly_rate_usd }]
 *   - hourly_rate_usd:         number|null  (tarifa "actual" del empleado, si no viene en assignment)
 *
 * Output: el row tal cual se persiste en idle_time_calculations + breakdown.
 */
function calculateIdleTime(input) {
  const {
    period_yyyymm,
    employee,
    country = {},
    holidays = [],
    novelties = [],
    contractAssignments = [],
    internalAssignments = [],
    hourly_rate_usd = null,
  } = input;

  const p = parsePeriod(period_yyyymm);
  if (!p) throw new Error(`period_yyyymm inválido: ${period_yyyymm}`);
  if (!employee) throw new Error('employee es requerido');

  const flags = {};
  const workdayHours = Number(country.standard_workday_hours) || DEFAULT_WORKDAY_HOURS;
  const wchEmp = Number(employee.weekly_capacity_hours);
  const standardWorkdayPerEmployee = Number.isFinite(wchEmp) && wchEmp > 0
    ? wchEmp / 5  // distribuye lineal en L-V
    : workdayHours;

  const pStart = periodStart(period_yyyymm);
  const pEnd   = periodEnd(period_yyyymm);

  // 1) Capacity total — acotada por hire_date / end_date del empleado.
  const empStart = employee.hire_date && employee.hire_date > pStart ? employee.hire_date : pStart;
  const empEnd   = employee.end_date && employee.end_date < pEnd ? employee.end_date : pEnd;
  if (empStart > pEnd || (employee.end_date && employee.end_date < pStart)) {
    // Empleado no estuvo activo en el mes
    return zeroSnapshot(period_yyyymm, employee, hourly_rate_usd, { ...flags, not_active: true });
  }
  if (empStart !== pStart) flags.partial_hire = true;
  if (empEnd !== pEnd)     flags.partial_termination = true;

  const allWorkdays = workdaysOfPeriod(period_yyyymm, { from: empStart, to: empEnd });
  const totalCapacityHours = round2(allWorkdays.length * standardWorkdayPerEmployee);

  // 2) Festivos — solo días hábiles dentro del rango activo del empleado.
  const holidaySet = new Set(
    holidays
      .map((h) => (h.holiday_date instanceof Date ? h.holiday_date.toISOString().slice(0, 10) : String(h.holiday_date).slice(0, 10)))
      .filter((d) => inRange(d, empStart, empEnd))
  );
  const holidayWorkdays = allWorkdays.filter((d) => holidaySet.has(d));
  const holidayHours = round2(holidayWorkdays.length * standardWorkdayPerEmployee);
  const holidaysUsed = holidayWorkdays.map((date) => {
    const found = holidays.find((h) => {
      const d = h.holiday_date instanceof Date ? h.holiday_date.toISOString().slice(0, 10) : String(h.holiday_date).slice(0, 10);
      return d === date;
    });
    return { date, label: (found && found.label) || '' };
  });

  // 3) Novedades — sumar días hábiles que se solapan con el período activo
  //    y NO son festivos (los festivos ya están restados).
  let noveltyHours = 0;
  let trainingHours = 0;          // counts_in_capacity=true, suma a assigned_internal
  const noveltiesUsed = [];
  for (const n of novelties) {
    if (n.status && n.status !== 'approved') continue;
    const startN = isoOnly(n.start_date);
    const endN   = isoOnly(n.end_date);
    const inter = intersectRange(startN, endN, empStart, empEnd);
    if (!inter) continue;
    const noveltyWorkdays = workdaysOfPeriod(period_yyyymm, { from: inter[0], to: inter[1] })
      .filter((d) => !holidaySet.has(d));
    const hours = round2(noveltyWorkdays.length * standardWorkdayPerEmployee);
    if (n.counts_in_capacity) {
      trainingHours += hours;
    } else {
      noveltyHours += hours;
    }
    noveltiesUsed.push({
      novelty_type_id: n.novelty_type_id,
      counts_in_capacity: !!n.counts_in_capacity,
      start: inter[0],
      end: inter[1],
      hours,
    });
  }
  noveltyHours = round2(noveltyHours);
  trainingHours = round2(trainingHours);

  const availableHours = round2(Math.max(0, totalCapacityHours - holidayHours - noveltyHours));

  // 4) Asignaciones a contratos — proporcionales por días hábiles cubiertos.
  //    weekly_hours / 5 = horas/día hábil.
  const assignedContractDetail = [];
  let assignedContract = 0;
  for (const a of contractAssignments) {
    const hrs = computeAssignedHours(a, period_yyyymm, holidaySet, empStart, empEnd, novelties);
    if (hrs > 0) {
      assignedContract += hrs;
      assignedContractDetail.push({
        ...stripDates(a),
        hours: hrs,
      });
    }
  }
  assignedContract = round2(assignedContract);

  // 5) Asignaciones a iniciativas internas.
  const assignedInternalDetail = [];
  let assignedInternal = 0;
  for (const a of internalAssignments) {
    const hrs = computeAssignedHours(a, period_yyyymm, holidaySet, empStart, empEnd, novelties);
    if (hrs > 0) {
      assignedInternal += hrs;
      assignedInternalDetail.push({
        ...stripDates(a),
        hours: hrs,
      });
    }
  }
  assignedInternal = round2(assignedInternal);

  // 6) corporate_training cuenta como assigned_internal aunque no sea
  //    una iniciativa interna concreta (es trabajo, solo no asignable).
  if (trainingHours > 0) {
    assignedInternal = round2(assignedInternal + trainingHours);
    assignedInternalDetail.push({
      virtual: true,
      label: 'corporate_training',
      hours: trainingHours,
    });
  }

  const assignedTotal = round2(assignedContract + assignedInternal);

  // 7) Idle.
  let idleHours = round2(availableHours - assignedTotal);
  if (idleHours < 0) {
    flags.over_allocation = true;
    flags.over_allocation_hours = Math.abs(idleHours);
    idleHours = 0;
  }
  const idlePct = availableHours > 0 ? round4(idleHours / availableHours) : 0;

  // 8) Costo USD del idle.
  let rate = Number(hourly_rate_usd);
  if (!Number.isFinite(rate) || rate <= 0) {
    flags.missing_rate = true;
    rate = 0;
  }
  const idleCostUsd = round2(idleHours * rate);

  return {
    period_yyyymm: normalizePeriod(period_yyyymm),
    employee_id: employee.id,
    total_capacity_hours: totalCapacityHours,
    holiday_hours: holidayHours,
    novelty_hours: noveltyHours,
    available_hours: availableHours,
    assigned_hours_contract: assignedContract,
    assigned_hours_internal: assignedInternal,
    assigned_hours_total: assignedTotal,
    idle_hours: idleHours,
    idle_pct: idlePct,
    hourly_rate_usd_at_calc: flags.missing_rate ? null : rate,
    idle_cost_usd: idleCostUsd,
    breakdown: {
      holidays_used: holidaysUsed,
      novelties_used: noveltiesUsed,
      contract_assignments: assignedContractDetail,
      internal_assignments: assignedInternalDetail,
      flags,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Calcula horas asignadas dentro del período, descontando festivos y novedades. */
function computeAssignedHours(assignment, yyyymm, holidaySet, empStart, empEnd, novelties = []) {
  const startA = isoOnly(assignment.start_date);
  const endA   = isoOnly(assignment.end_date);
  const inter = intersectRange(startA, endA, empStart, empEnd);
  if (!inter) return 0;
  const days = workdaysOfPeriod(yyyymm, { from: inter[0], to: inter[1] })
    .filter((d) => !holidaySet.has(d))
    .filter((d) => !isInsideAnyNovelty(d, novelties));
  if (days.length === 0) return 0;
  const wh = Number(assignment.weekly_hours);
  if (!Number.isFinite(wh) || wh <= 0) return 0;
  // weekly_hours / 5 días hábiles = horas/día hábil cubierto.
  return round2(days.length * (wh / 5));
}

function isInsideAnyNovelty(dateIso, novelties) {
  for (const n of novelties) {
    if (n.status && n.status !== 'approved') continue;
    const s = isoOnly(n.start_date);
    const e = isoOnly(n.end_date);
    if (inRange(dateIso, s, e)) return true;
  }
  return false;
}

function zeroSnapshot(period, employee, hourly_rate_usd, flags = {}) {
  const rate = Number(hourly_rate_usd);
  return {
    period_yyyymm: normalizePeriod(period),
    employee_id: employee.id,
    total_capacity_hours: 0,
    holiday_hours: 0,
    novelty_hours: 0,
    available_hours: 0,
    assigned_hours_contract: 0,
    assigned_hours_internal: 0,
    assigned_hours_total: 0,
    idle_hours: 0,
    idle_pct: 0,
    hourly_rate_usd_at_calc: Number.isFinite(rate) && rate > 0 ? round4(rate) : null,
    idle_cost_usd: 0,
    breakdown: {
      holidays_used: [],
      novelties_used: [],
      contract_assignments: [],
      internal_assignments: [],
      flags,
    },
  };
}

function isoOnly(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function stripDates(a) {
  const o = { ...a };
  if (o.start_date instanceof Date) o.start_date = o.start_date.toISOString().slice(0, 10);
  if (o.end_date instanceof Date)   o.end_date   = o.end_date.toISOString().slice(0, 10);
  return o;
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }
function round4(n) { return Math.round(Number(n) * 10000) / 10000; }

function normalizePeriod(p) {
  const s = String(p).replace(/^([0-9]{4})([0-9]{2})$/, '$1-$2');
  return s;
}

module.exports = {
  // Public API
  calculateIdleTime,
  deriveHourlyRateUsd,
  // Calendar utilities (exportadas para tests y reuso)
  parsePeriod,
  periodStart,
  periodEnd,
  workdaysOfPeriod,
  intersectRange,
  inRange,
  // Internals exposed for testing
  _internal: { computeAssignedHours, isInsideAnyNovelty, round2, round4, normalizePeriod },
};
