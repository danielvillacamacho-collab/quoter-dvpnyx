/**
 * EVM (Earned Value Management) — Pure calculation engine.
 *
 * PMI-compliant formulas for fixed-scope projects (SPEC-PRJ-HEALTH-01).
 * All functions are stateless/pure — no DB access. IO is handled by the route.
 *
 * Conventions:
 *   - Money values in USD, rounded to 2 decimals.
 *   - Ratios/indices rounded to 3 decimals.
 *   - null returned when the computation is undefined (e.g. CPI when AC=0).
 */

/* ────────── Rounding helpers ────────── */

/** Round to 2 decimals (money). Null-safe. */
function round2(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

/** Round to 3 decimals (ratios). Null-safe. */
function round3(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 1000) / 1000;
}

/** Round to 4 decimals (weights). Null-safe. */
function round4(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 10000) / 10000;
}

/* ────────── Date helpers ────────── */

/** Signed day difference: (b - a) in calendar days. */
function diffDays(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((db - da) / 86400000);
}

/* ────────── PV — Planned Value ────────── */

/**
 * Compute cumulative PV at cutoff date, based on fraction elapsed per WBS package.
 *
 * Each package contributes:  weight_pct * BAC * fractionElapsed
 *
 * fractionElapsed = clamp((cutoff - pkgStart + 1) / (pkgEnd - pkgStart + 1), 0, 1)
 *
 * @param {Array} packages — [{ weight_pct, planned_start, planned_end }]
 * @param {number} bac — Budget at Completion (cost)
 * @param {string} cutoff — YYYY-MM-DD cutoff date
 * @returns {number} PV in USD
 */
function computePV(packages, bac, cutoff) {
  if (!packages || !packages.length || bac == null) return 0;
  const bacN = Number(bac);
  const cutDate = new Date(cutoff);

  let pv = 0;
  for (const pkg of packages) {
    const w = Number(pkg.weight_pct || 0);
    if (w <= 0) continue;

    const start = new Date(pkg.planned_start);
    const end = new Date(pkg.planned_end);
    const totalDays = diffDays(start, end) + 1; // inclusive
    if (totalDays <= 0) continue;

    const elapsed = diffDays(start, cutDate) + 1; // inclusive of cutoff day
    const fraction = Math.max(0, Math.min(1, elapsed / totalDays));
    pv += w * bacN * fraction;
  }
  return round2(pv);
}

/* ────────── EV — Earned Value ────────── */

/**
 * Compute cumulative EV: sum(percent_complete * weight_pct * BAC).
 *
 * @param {Array} packages — [{ weight_pct, percent_complete (0..1) }]
 * @param {number} bac
 * @returns {number}
 */
function computeEV(packages, bac) {
  if (!packages || !packages.length || bac == null) return 0;
  const bacN = Number(bac);
  let ev = 0;
  for (const pkg of packages) {
    const w = Number(pkg.weight_pct || 0);
    const pct = Number(pkg.percent_complete || 0);
    ev += pct * w * bacN;
  }
  return round2(ev);
}

/* ────────── AC — Actual Cost ────────── */

/**
 * Compute Actual Cost from time entries × hourly cost map.
 *
 * @param {Array} entries — [{ employee_id, hours }]
 * @param {Map}   costMap — Map<employee_id, hourlyCostUsd>
 * @returns {{ ac: number, warnings: string[], coverage_pct: number }}
 */
function computeAC(entries, costMap) {
  if (!entries || !entries.length) return { ac: 0, warnings: [], coverage_pct: 100 };

  let ac = 0;
  const warnings = [];
  let covered = 0;
  let total = 0;

  for (const e of entries) {
    const hours = Number(e.hours || 0);
    total += hours;
    const rate = costMap instanceof Map ? costMap.get(e.employee_id) : null;
    if (rate != null && Number.isFinite(rate)) {
      ac += hours * rate;
      covered += hours;
    } else {
      warnings.push(`Employee ${e.employee_id}: no cost data, ${hours}h excluded from AC`);
    }
  }
  const coverage_pct = total > 0 ? round2((covered / total) * 100) : 100;
  return { ac: round2(ac), warnings, coverage_pct };
}

/* ────────── KPIs ────────── */

/**
 * Compute all standard EVM KPIs.
 *
 * @param {{ pv, ev, ac, bac, plannedStart, plannedEnd, cutoffDate }} p
 * @returns {object} — sv, cv, spi, cpi, eac_typical, eac_atypical, eac_pressure, etc, vac, tcpi_bac, tcpi_eac
 */
function computeKpis({ pv, ev, ac, bac, plannedStart, plannedEnd, cutoffDate, pvCurve }) {
  const pvN = Number(pv || 0);
  const evN = Number(ev || 0);
  const acN = Number(ac || 0);
  const bacN = Number(bac || 0);

  // Schedule Variance & Cost Variance
  const sv = round2(evN - pvN);
  const cv = round2(evN - acN);

  // Indices (null if denominator is 0)
  const spi = pvN !== 0 ? round3(evN / pvN) : null;
  const cpi = acN !== 0 ? round3(evN / acN) : null;

  // EAC variants
  const eac_typical = cpi && cpi !== 0 ? round2(bacN / cpi) : null;         // BAC / CPI
  const eac_atypical = round2(acN + (bacN - evN));                           // AC + (BAC - EV)
  const eac_pressure = spi && cpi && (spi * cpi) !== 0
    ? round2(acN + (bacN - evN) / (spi * cpi))                              // AC + (BAC-EV) / (SPI*CPI)
    : null;

  // ETC (Estimate to Complete)
  const etc = eac_typical != null ? round2(eac_typical - acN) : null;

  // VAC (Variance at Completion)
  const vac = eac_typical != null ? round2(bacN - eac_typical) : null;

  // TCPI — To Complete Performance Index
  const tcpi_bac = (bacN - evN) !== 0 && (bacN - acN) !== 0
    ? round3((bacN - evN) / (bacN - acN)) : null;

  const tcpi_eac = eac_typical != null && (eac_typical - acN) !== 0
    ? round3((bacN - evN) / (eac_typical - acN)) : null;

  return {
    sv, cv, spi, cpi,
    eac_typical, eac_atypical, eac_pressure,
    etc, vac,
    tcpi_bac, tcpi_eac,
  };
}

/* ────────── PV Curve (for S-curve and Earned Schedule) ────────── */

/**
 * Build a daily cumulative PV curve across the entire project timeline.
 *
 * Returns [{ date: 'YYYY-MM-DD', pv_cumulative }] from planned_start to planned_end.
 *
 * @param {Array} packages — [{ weight_pct, planned_start, planned_end }]
 * @param {number} bac
 * @param {string} projectStart — YYYY-MM-DD
 * @param {string} projectEnd   — YYYY-MM-DD
 * @returns {Array}
 */
function buildPvCurve(packages, bac, projectStart, projectEnd) {
  if (!packages || !packages.length || bac == null) return [];
  const bacN = Number(bac);
  const startD = new Date(projectStart);
  const endD = new Date(projectEnd);
  const totalProjectDays = diffDays(startD, endD) + 1;
  if (totalProjectDays <= 0) return [];

  const curve = [];
  for (let d = 0; d < totalProjectDays; d++) {
    const curDate = new Date(startD);
    curDate.setDate(curDate.getDate() + d);
    const dateStr = curDate.toISOString().slice(0, 10);
    const pv = computePV(packages, bacN, dateStr);
    curve.push({ date: dateStr, pv_cumulative: pv });
  }
  return curve;
}

/* ────────── Earned Schedule ────────── */

/**
 * Compute Earned Schedule (ES) by finding when EV was planned to occur.
 *
 * Linear interpolation on the PV curve to find the fractional day index
 * where PV = EV. Then:
 *   ES = that day index (in project days)
 *   SPI(t) = ES / AT
 *   SV(t)  = ES - AT (in days)
 *
 * @param {Array} pvCurve — [{ date, pv_cumulative }]
 * @param {number} ev
 * @param {number} atDays — actual time elapsed (project days from start to cutoff)
 * @returns {{ es_days, spi_t, sv_t_days }}
 */
function computeEarnedSchedule(pvCurve, ev, atDays) {
  if (!pvCurve || !pvCurve.length || ev == null) {
    return { es_days: null, spi_t: null, sv_t_days: null };
  }
  const evN = Number(ev);

  // If EV >= BAC (project complete by value), ES = total days
  const lastPV = pvCurve[pvCurve.length - 1].pv_cumulative;
  if (evN >= lastPV && lastPV > 0) {
    const esDays = pvCurve.length - 1;
    return {
      es_days: esDays,
      spi_t: atDays > 0 ? round3(esDays / atDays) : null,
      sv_t_days: round2(esDays - atDays),
    };
  }

  // Find the interval [i-1, i] where pvCurve[i-1].pv <= EV < pvCurve[i].pv
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
        esDays = round3(i - 1 + fraction);
      }
      break;
    }
    // If we reach end without finding, ES = length-1
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
 *
 * @param {object} kpis — { cpi, spi, eac_typical, ... }
 * @param {number} bac
 * @returns {{ overall: string, drivers: string[] }}
 */
function computeHealth(kpis, bac) {
  const drivers = [];
  const cpi = kpis.cpi != null ? Number(kpis.cpi) : null;
  const spi = kpis.spi != null ? Number(kpis.spi) : null;

  // Default to green if we have no data yet
  if (cpi == null && spi == null) {
    return { overall: 'green', drivers: ['Sin datos suficientes para evaluación'] };
  }

  // Check for red conditions
  if ((cpi != null && cpi < 0.85) || (spi != null && spi < 0.85)) {
    if (cpi != null && cpi < 0.85) drivers.push(`CPI=${cpi} < 0.85 — sobrecostos significativos`);
    if (spi != null && spi < 0.85) drivers.push(`SPI=${spi} < 0.85 — atraso significativo`);
    return { overall: 'red', drivers };
  }

  // Check for green
  const cpiOk = cpi == null || cpi >= 0.95;
  const spiOk = spi == null || spi >= 0.95;
  if (cpiOk && spiOk) {
    return { overall: 'green', drivers: ['Proyecto en curso normal'] };
  }

  // Yellow
  if (cpi != null && cpi < 0.95) drivers.push(`CPI=${cpi} < 0.95 — ligero sobrecosto`);
  if (spi != null && spi < 0.95) drivers.push(`SPI=${spi} < 0.95 — ligero atraso`);
  return { overall: 'yellow', drivers };
}

/* ────────── Exports ────────── */

module.exports = {
  round2,
  round3,
  round4,
  diffDays,
  computePV,
  computeEV,
  computeAC,
  computeKpis,
  buildPvCurve,
  computeEarnedSchedule,
  computeHealth,
};
