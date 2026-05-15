/**
 * EVM (Earned Value Management) — Pure calculation engine.
 *
 * PMI-compliant formulas for fixed-scope projects (SPEC-PRJ-HEALTH-01).
 * All functions are stateless/pure — no DB access. IO is handled by the service.
 *
 * Conventions:
 *   - Money values in USD, rounded to 2 decimals.
 *   - Ratios/indices rounded to 3 decimals.
 *   - null returned when the computation is undefined (e.g. CPI when AC=0).
 */

import type { HealthKpis, HealthBadge } from './types';

/* ────────── Rounding helpers ────────── */

export function round2(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

export function round3(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 1000) / 1000;
}

export function round4(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 10000) / 10000;
}

/* ────────── Date helpers ────────── */

/** Signed day difference: (b - a) in calendar days. */
export function diffDays(a: string | Date, b: string | Date): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/* ────────── PV — Planned Value ────────── */

interface PvPackage {
  weight_pct: number;
  planned_start: string;
  planned_end: string;
}

/**
 * Compute cumulative PV at cutoff date, based on fraction elapsed per WBS package.
 *
 * Each package contributes: weight_pct * BAC * fractionElapsed
 * fractionElapsed = clamp((cutoff - pkgStart + 1) / (pkgEnd - pkgStart + 1), 0, 1)
 */
export function computePV(packages: PvPackage[], bac: number, cutoff: string): number {
  if (!packages || !packages.length || bac == null) return 0;
  const bacN = Number(bac);

  let pv = 0;
  for (const pkg of packages) {
    const w = Number(pkg.weight_pct || 0);
    if (w <= 0) continue;

    const start = new Date(pkg.planned_start);
    const end = new Date(pkg.planned_end);
    const totalDays = diffDays(start, end) + 1;
    if (totalDays <= 0) continue;

    const elapsed = diffDays(start, cutoff) + 1;
    const fraction = Math.max(0, Math.min(1, elapsed / totalDays));
    pv += w * bacN * fraction;
  }
  return round2(pv) ?? 0;
}

/* ────────── EV — Earned Value ────────── */

interface EvPackage {
  weight_pct: number;
  percent_complete: number;
}

/**
 * Compute cumulative EV: sum(percent_complete * weight_pct * BAC).
 */
export function computeEV(packages: EvPackage[], bac: number): number {
  if (!packages || !packages.length || bac == null) return 0;
  const bacN = Number(bac);
  let ev = 0;
  for (const pkg of packages) {
    const w = Number(pkg.weight_pct || 0);
    const pct = Number(pkg.percent_complete || 0);
    ev += pct * w * bacN;
  }
  return round2(ev) ?? 0;
}

/* ────────── AC — Actual Cost ────────── */

interface AcEntry {
  employee_id: string;
  hours: number;
}

export interface AcResult {
  ac: number;
  warnings: string[];
  coverage_pct: number;
}

/**
 * Compute Actual Cost from time entries x hourly cost map.
 */
export function computeAC(entries: AcEntry[], costMap: Map<string, number>): AcResult {
  if (!entries || !entries.length) return { ac: 0, warnings: [], coverage_pct: 100 };

  let ac = 0;
  const warnings: string[] = [];
  let covered = 0;
  let total = 0;

  for (const e of entries) {
    const hours = Number(e.hours || 0);
    total += hours;
    const rate = costMap.get(e.employee_id);
    if (rate != null && Number.isFinite(rate)) {
      ac += hours * rate;
      covered += hours;
    } else {
      warnings.push(`Employee ${e.employee_id}: no cost data, ${hours}h excluded from AC`);
    }
  }
  const coverage_pct = total > 0 ? (round2((covered / total) * 100) ?? 100) : 100;
  return { ac: round2(ac) ?? 0, warnings, coverage_pct };
}

/* ────────── KPIs ────────── */

interface KpiInput {
  pv: number;
  ev: number;
  ac: number;
  bac: number;
}

export interface KpiResult {
  sv: number;
  cv: number;
  spi: number | null;
  cpi: number | null;
  eac_typical: number | null;
  eac_atypical: number;
  eac_pressure: number | null;
  etc: number | null;
  vac: number | null;
  tcpi_bac: number | null;
  tcpi_eac: number | null;
}

/**
 * Compute all standard EVM KPIs.
 */
export function computeKpis({ pv, ev, ac, bac }: KpiInput): KpiResult {
  const pvN = Number(pv || 0);
  const evN = Number(ev || 0);
  const acN = Number(ac || 0);
  const bacN = Number(bac || 0);

  const sv = (round2(evN - pvN) ?? 0);
  const cv = (round2(evN - acN) ?? 0);

  const spi = pvN !== 0 ? round3(evN / pvN) : null;
  const cpi = acN !== 0 ? round3(evN / acN) : null;

  const eac_typical = cpi && cpi !== 0 ? round2(bacN / cpi) : null;
  const eac_atypical = (round2(acN + (bacN - evN)) ?? 0);
  const eac_pressure = spi && cpi && (spi * cpi) !== 0
    ? round2(acN + (bacN - evN) / (spi * cpi))
    : null;

  const etc = eac_typical != null ? round2(eac_typical - acN) : null;
  const vac = eac_typical != null ? round2(bacN - eac_typical) : null;

  const tcpi_bac = (bacN - evN) !== 0 && (bacN - acN) !== 0
    ? round3((bacN - evN) / (bacN - acN)) : null;

  const tcpi_eac = eac_typical != null && (eac_typical - acN) !== 0
    ? round3((bacN - evN) / (eac_typical - acN)) : null;

  return { sv, cv, spi, cpi, eac_typical, eac_atypical, eac_pressure, etc, vac, tcpi_bac, tcpi_eac };
}

/* ────────── PV Curve (for S-curve and Earned Schedule) ────────── */

export interface PvCurvePoint {
  date: string;
  pv_cumulative: number;
}

/**
 * Build a daily cumulative PV curve across the entire project timeline.
 */
export function buildPvCurve(
  packages: PvPackage[],
  bac: number,
  projectStart: string,
  projectEnd: string,
): PvCurvePoint[] {
  if (!packages || !packages.length || bac == null) return [];
  const bacN = Number(bac);
  const startD = new Date(projectStart);
  const endD = new Date(projectEnd);
  const totalProjectDays = diffDays(startD, endD) + 1;
  if (totalProjectDays <= 0) return [];

  const curve: PvCurvePoint[] = [];
  for (let d = 0; d < totalProjectDays; d++) {
    const curDate = new Date(startD);
    curDate.setDate(curDate.getDate() + d);
    const dateStr = curDate.toISOString().slice(0, 10);
    const pvVal = computePV(packages, bacN, dateStr);
    curve.push({ date: dateStr, pv_cumulative: pvVal });
  }
  return curve;
}

/* ────────── Earned Schedule ────────── */

export interface EarnedScheduleResult {
  es_days: number | null;
  spi_t: number | null;
  sv_t_days: number | null;
}

/**
 * Compute Earned Schedule (ES) by finding when EV was planned to occur.
 * Linear interpolation on the PV curve.
 */
export function computeEarnedSchedule(
  pvCurve: PvCurvePoint[],
  ev: number,
  atDays: number,
): EarnedScheduleResult {
  if (!pvCurve || !pvCurve.length || ev == null) {
    return { es_days: null, spi_t: null, sv_t_days: null };
  }
  const evN = Number(ev);

  const lastPV = pvCurve[pvCurve.length - 1].pv_cumulative;
  if (evN >= lastPV && lastPV > 0) {
    const esDays = pvCurve.length - 1;
    return {
      es_days: esDays,
      spi_t: atDays > 0 ? round3(esDays / atDays) : null,
      sv_t_days: round2(esDays - atDays),
    };
  }

  let esDays = 0;
  for (let i = 0; i < pvCurve.length; i++) {
    if (pvCurve[i].pv_cumulative >= evN) {
      if (i === 0) {
        esDays = 0;
      } else {
        const pvPrev = pvCurve[i - 1].pv_cumulative;
        const pvCurr = pvCurve[i].pv_cumulative;
        const diff = pvCurr - pvPrev;
        const fraction = diff > 0 ? (evN - pvPrev) / diff : 0;
        esDays = (round3(i - 1 + fraction) ?? 0);
      }
      break;
    }
    if (i === pvCurve.length - 1) {
      esDays = pvCurve.length - 1;
    }
  }

  return {
    es_days: esDays,
    spi_t: atDays > 0 ? round3(esDays / atDays) : null,
    sv_t_days: round2(esDays - atDays),
  };
}

/* ────────── Health (traffic light) ────────── */

/**
 * Compute project health as traffic light: green / yellow / red.
 *
 * Rules (per spec):
 *   - Green:  CPI >= 0.95 AND SPI >= 0.95
 *   - Yellow: CPI >= 0.85 AND SPI >= 0.85 (but not both >= 0.95)
 *   - Red:    CPI < 0.85 OR SPI < 0.85
 */
export function computeHealthBadge(
  spi: number | null,
  cpi: number | null,
): HealthBadge {
  const drivers: string[] = [];
  const cpiN = cpi != null ? Number(cpi) : null;
  const spiN = spi != null ? Number(spi) : null;

  if (cpiN == null && spiN == null) {
    return { overall: 'green', drivers: ['Sin datos suficientes para evaluación'] };
  }

  if ((cpiN != null && cpiN < 0.85) || (spiN != null && spiN < 0.85)) {
    if (cpiN != null && cpiN < 0.85) drivers.push(`CPI=${cpiN} < 0.85 — sobrecostos significativos`);
    if (spiN != null && spiN < 0.85) drivers.push(`SPI=${spiN} < 0.85 — atraso significativo`);
    return { overall: 'red', drivers };
  }

  const cpiOk = cpiN == null || cpiN >= 0.95;
  const spiOk = spiN == null || spiN >= 0.95;
  if (cpiOk && spiOk) {
    return { overall: 'green', drivers: ['Proyecto en curso normal'] };
  }

  if (cpiN != null && cpiN < 0.95) drivers.push(`CPI=${cpiN} < 0.95 — ligero sobrecosto`);
  if (spiN != null && spiN < 0.95) drivers.push(`SPI=${spiN} < 0.95 — ligero atraso`);
  return { overall: 'yellow', drivers };
}
