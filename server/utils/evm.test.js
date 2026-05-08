/**
 * Tests for server/utils/evm.js — EVM engine (SPEC-PRJ-HEALTH-01).
 *
 * Fixture based on Appendix A example:
 *   BAC = 180,000 USD
 *   3 phases (Discovery 15%, Build 65%, Stabilisation 20%)
 *   Project: 2025-03-01 → 2025-08-31  (184 days inclusive)
 *   Cutoff:  2025-04-08
 *
 *   Discovery: 2025-03-01 → 2025-03-27 (27 days)
 *   Build:     2025-03-28 → 2025-07-12 (107 days)
 *   Stab:      2025-07-13 → 2025-08-31 (50 days)
 */
const evm = require('./evm');

/* ═════════ Shared fixture ═════════ */

const BAC = 180000;
const PROJECT_START = '2025-03-01';
const PROJECT_END   = '2025-08-31';
const CUTOFF        = '2025-04-08';

const packages = [
  { weight_pct: 0.15, planned_start: '2025-03-01', planned_end: '2025-03-27', percent_complete: 1.0 },
  { weight_pct: 0.65, planned_start: '2025-03-28', planned_end: '2025-07-12', percent_complete: 0.05 },
  { weight_pct: 0.20, planned_start: '2025-07-13', planned_end: '2025-08-31', percent_complete: 0.0 },
];

/* ═════════ round helpers ═════════ */

describe('round helpers', () => {
  test('round2 handles normal numbers', () => {
    expect(evm.round2(3.1415)).toBe(3.14);
    expect(evm.round2(100)).toBe(100);
  });
  test('round2 returns null for null/undefined/NaN', () => {
    expect(evm.round2(null)).toBeNull();
    expect(evm.round2(undefined)).toBeNull();
    expect(evm.round2('abc')).toBeNull();
  });
  test('round3', () => {
    expect(evm.round3(0.91907)).toBe(0.919);
    expect(evm.round3(null)).toBeNull();
  });
  test('round4', () => {
    expect(evm.round4(0.66667)).toBe(0.6667);
  });
});

/* ═════════ diffDays ═════════ */

describe('diffDays', () => {
  test('same day = 0', () => {
    expect(evm.diffDays('2025-04-08', '2025-04-08')).toBe(0);
  });
  test('positive difference', () => {
    expect(evm.diffDays('2025-03-01', '2025-03-27')).toBe(26);
  });
  test('negative difference', () => {
    expect(evm.diffDays('2025-03-27', '2025-03-01')).toBe(-26);
  });
});

/* ═════════ computePV ═════════ */

describe('computePV', () => {
  test('fixture: PV at cutoff (2025-04-08)', () => {
    const pv = evm.computePV(packages, BAC, CUTOFF);
    // Discovery: fully elapsed -> 0.15 * 180000 = 27000
    // Build: (2025-03-28 to 2025-04-08) = 12 days elapsed (inclusive)
    //        total = 107 days; fraction = 12/107 = 0.11215
    //        PV contribution = 0.65 * 180000 * 0.11215 = 13,121.50
    // Stab: not started -> 0
    // Total ≈ 40,121.50
    expect(pv).toBeGreaterThan(39000);
    expect(pv).toBeLessThan(42000);
  });

  test('at project start = 0 or tiny fraction', () => {
    const pv = evm.computePV(packages, BAC, '2025-02-28');
    expect(pv).toBe(0); // before any package starts
  });

  test('at project end = BAC', () => {
    const pv = evm.computePV(packages, BAC, PROJECT_END);
    expect(pv).toBe(BAC);
  });

  test('empty packages => 0', () => {
    expect(evm.computePV([], BAC, CUTOFF)).toBe(0);
  });
});

/* ═════════ computeEV ═════════ */

describe('computeEV', () => {
  test('fixture: EV from progress', () => {
    const ev = evm.computeEV(packages, BAC);
    // Discovery: 1.0 * 0.15 * 180000 = 27000
    // Build:     0.05 * 0.65 * 180000 = 5850
    // Stab:      0.0 * 0.20 * 180000 = 0
    // Total = 32850
    expect(ev).toBe(32850);
  });

  test('zero progress => 0', () => {
    const pkgs = packages.map(p => ({ ...p, percent_complete: 0 }));
    expect(evm.computeEV(pkgs, BAC)).toBe(0);
  });

  test('all complete => BAC', () => {
    const pkgs = packages.map(p => ({ ...p, percent_complete: 1.0 }));
    expect(evm.computeEV(pkgs, BAC)).toBe(BAC);
  });
});

/* ═════════ computeAC ═════════ */

describe('computeAC', () => {
  test('fixture: AC from time entries', () => {
    const entries = [
      { employee_id: 'emp1', hours: 160 },
      { employee_id: 'emp2', hours: 80  },
      { employee_id: 'emp3', hours: 40  },
    ];
    const costMap = new Map([
      ['emp1', 150],    // 160 * 150 = 24000
      ['emp2', 100],    // 80 * 100 = 8000
      ['emp3', 112.5],  // 40 * 112.5 = 4500
    ]);
    const result = evm.computeAC(entries, costMap);
    expect(result.ac).toBe(36500);
    expect(result.warnings).toHaveLength(0);
    expect(result.coverage_pct).toBe(100);
  });

  test('missing cost data produces warnings', () => {
    const entries = [
      { employee_id: 'emp1', hours: 100 },
      { employee_id: 'emp_missing', hours: 50 },
    ];
    const costMap = new Map([['emp1', 100]]);
    const result = evm.computeAC(entries, costMap);
    expect(result.ac).toBe(10000); // only emp1 counted
    expect(result.warnings).toHaveLength(1);
    expect(result.coverage_pct).toBeCloseTo(66.67, 1);
  });

  test('empty entries => 0', () => {
    const result = evm.computeAC([], new Map());
    expect(result.ac).toBe(0);
  });
});

/* ═════════ computeKpis ═════════ */

describe('computeKpis', () => {
  const pv = 40121.50;
  const ev = 32850;
  const ac = 36500;

  test('fixture: SPI and CPI', () => {
    const kpis = evm.computeKpis({ pv, ev, ac, bac: BAC });
    // SPI = 32850 / 40121.50 ≈ 0.819
    expect(kpis.spi).toBeGreaterThan(0.8);
    expect(kpis.spi).toBeLessThan(0.83);
    // CPI = 32850 / 36500 ≈ 0.900
    expect(kpis.cpi).toBeCloseTo(0.900, 2);
  });

  test('fixture: variances', () => {
    const kpis = evm.computeKpis({ pv, ev, ac, bac: BAC });
    expect(kpis.sv).toBeLessThan(0);  // behind schedule
    expect(kpis.cv).toBeLessThan(0);  // over budget
  });

  test('fixture: EAC typical', () => {
    const kpis = evm.computeKpis({ pv, ev, ac, bac: BAC });
    // EAC_typical = BAC / CPI = 180000 / 0.900 = 200000
    expect(kpis.eac_typical).toBeCloseTo(200000, -2);
  });

  test('fixture: EAC atypical', () => {
    const kpis = evm.computeKpis({ pv, ev, ac, bac: BAC });
    // EAC_atypical = AC + (BAC - EV) = 36500 + 147150 = 183650
    expect(kpis.eac_atypical).toBe(183650);
  });

  test('zero AC => CPI null', () => {
    const kpis = evm.computeKpis({ pv: 100, ev: 50, ac: 0, bac: 1000 });
    expect(kpis.cpi).toBeNull();
  });

  test('zero PV => SPI null', () => {
    const kpis = evm.computeKpis({ pv: 0, ev: 0, ac: 0, bac: 1000 });
    expect(kpis.spi).toBeNull();
  });
});

/* ═════════ buildPvCurve ═════════ */

describe('buildPvCurve', () => {
  test('curve length matches project duration', () => {
    const curve = evm.buildPvCurve(packages, BAC, PROJECT_START, PROJECT_END);
    const expectedDays = evm.diffDays(PROJECT_START, PROJECT_END) + 1;
    expect(curve).toHaveLength(expectedDays);
  });

  test('first day PV > 0 (day 1 of discovery)', () => {
    const curve = evm.buildPvCurve(packages, BAC, PROJECT_START, PROJECT_END);
    expect(curve[0].pv_cumulative).toBeGreaterThan(0);
  });

  test('last day PV = BAC', () => {
    const curve = evm.buildPvCurve(packages, BAC, PROJECT_START, PROJECT_END);
    expect(curve[curve.length - 1].pv_cumulative).toBe(BAC);
  });

  test('curve is monotonically non-decreasing', () => {
    const curve = evm.buildPvCurve(packages, BAC, PROJECT_START, PROJECT_END);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].pv_cumulative).toBeGreaterThanOrEqual(curve[i - 1].pv_cumulative);
    }
  });

  test('empty packages => empty curve', () => {
    expect(evm.buildPvCurve([], BAC, PROJECT_START, PROJECT_END)).toHaveLength(0);
  });
});

/* ═════════ computeEarnedSchedule ═════════ */

describe('computeEarnedSchedule', () => {
  test('fixture: ES behind schedule', () => {
    const curve = evm.buildPvCurve(packages, BAC, PROJECT_START, PROJECT_END);
    const ev = 32850;
    const atDays = evm.diffDays(PROJECT_START, CUTOFF); // 38
    const es = evm.computeEarnedSchedule(curve, ev, atDays);
    // EV=32850 was planned to be reached before day 38 → ES < AT → SPI(t) < 1
    expect(es.es_days).toBeLessThan(atDays);
    expect(es.spi_t).toBeLessThan(1);
    expect(es.sv_t_days).toBeLessThan(0);
  });

  test('EV=0 => ES=0', () => {
    const curve = evm.buildPvCurve(packages, BAC, PROJECT_START, PROJECT_END);
    const es = evm.computeEarnedSchedule(curve, 0, 10);
    expect(es.es_days).toBe(0);
  });

  test('EV >= BAC => ES = last day', () => {
    const curve = evm.buildPvCurve(packages, BAC, PROJECT_START, PROJECT_END);
    const es = evm.computeEarnedSchedule(curve, BAC, 100);
    expect(es.es_days).toBe(curve.length - 1);
  });

  test('null/empty curve => nulls', () => {
    const es = evm.computeEarnedSchedule([], 100, 10);
    expect(es.es_days).toBeNull();
    expect(es.spi_t).toBeNull();
  });
});

/* ═════════ computeHealth ═════════ */

describe('computeHealth', () => {
  test('green: both >= 0.95', () => {
    const h = evm.computeHealth({ cpi: 1.02, spi: 0.98 }, BAC);
    expect(h.overall).toBe('green');
  });

  test('yellow: between 0.85 and 0.95', () => {
    const h = evm.computeHealth({ cpi: 0.90, spi: 0.92 }, BAC);
    expect(h.overall).toBe('yellow');
  });

  test('red: below 0.85', () => {
    const h = evm.computeHealth({ cpi: 0.80, spi: 0.90 }, BAC);
    expect(h.overall).toBe('red');
    expect(h.drivers.length).toBeGreaterThan(0);
  });

  test('red: SPI < 0.85', () => {
    const h = evm.computeHealth({ cpi: 0.95, spi: 0.80 }, BAC);
    expect(h.overall).toBe('red');
  });

  test('fixture: CPI=0.900 SPI≈0.819 => red', () => {
    const h = evm.computeHealth({ cpi: 0.900, spi: 0.819 }, BAC);
    expect(h.overall).toBe('red');
  });

  test('no data => green default', () => {
    const h = evm.computeHealth({}, BAC);
    expect(h.overall).toBe('green');
  });
});
