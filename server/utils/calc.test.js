/**
 * Unit tests for server/utils/calc.js (EX-2 — server is source of truth).
 *
 * These fixtures mirror the shape that /api/parameters returns (category
 * groups). The numbers used as expected outputs were computed by hand
 * from the same formulas the client uses, so that if either side diverges
 * this suite fails — acting as the contract test between client and
 * server calculators.
 */

const {
  calcCostHour,
  calcRateHour,
  calcToolsCost,
  calcStaffAugLine,
  recalcStaffAugLines,
  sumStaffAugTotal,
  detectLineDrift,
  calcProjectFinancials,
} = require('./calc');

const PARAMS = {
  level: [
    { key: 'L1', value: 1000 },
    { key: 'L2', value: 2000 },
    { key: 'L3', value: 3000 },
  ],
  geo: [
    { key: 'Colombia', value: 1.0 },
    { key: 'México', value: 1.15 },
  ],
  bilingual: [
    { key: 'No', value: 1.0 },
    { key: 'Sí', value: 1.20 },
  ],
  stack: [
    { key: 'Común', value: 0.90 },
    { key: 'Especializada', value: 1.0 },
    { key: 'Nicho', value: 1.20 },
  ],
  tools: [
    { key: 'Básico', value: 50 },
    { key: 'Avanzado', value: 150 },
  ],
  modality: [
    { key: 'Remoto', value: 1.0 },
    { key: 'Híbrido', value: 1.1 },
    { key: 'Presencial', value: 1.2 },
  ],
  project: [
    { key: 'hours_month', value: 160 },
    { key: 'buffer', value: 0.10 },
    { key: 'warranty', value: 0.05 },
    { key: 'min_margin', value: 0.50 },
  ],
  margin: [
    { key: 'talent', value: 0.35 },
    { key: 'tools', value: 0 },
  ],
};

describe('calcCostHour', () => {
  it('computes the base hourly cost from level/geo/bilingual/stack', () => {
    // L2 (2000/160) × Colombia(1.0) × No(1.0) × Especializada(1.0) = 12.5
    expect(calcCostHour(2, 'Colombia', false, 'Especializada', PARAMS)).toBeCloseTo(12.5, 5);
  });

  it('multiplies all factors correctly for a premium profile', () => {
    // L3 (3000/160) × México(1.15) × Sí(1.20) × Nicho(1.20)
    // = 18.75 × 1.15 × 1.20 × 1.20 = 31.05
    expect(calcCostHour(3, 'México', true, 'Nicho', PARAMS)).toBeCloseTo(31.05, 4);
  });

  it('returns 0 when a parameter is missing', () => {
    expect(calcCostHour(99, 'Colombia', false, 'Especializada', PARAMS)).toBe(0);
    expect(calcCostHour(2, 'Perú', false, 'Especializada', PARAMS)).toBe(0);
  });
});

describe('calcRateHour', () => {
  it('applies talent margin to cost/hour', () => {
    // 12.5 / (1 - 0.35) = 19.2307...
    expect(calcRateHour(12.5, PARAMS)).toBeCloseTo(19.2308, 3);
  });
});

describe('calcStaffAugLine', () => {
  it('produces zero outputs when required inputs are missing', () => {
    const line = { country: 'Colombia', stack: 'Especializada' }; // no level
    const out = calcStaffAugLine(line, PARAMS);
    expect(out.cost_hour).toBe(0);
    expect(out.total).toBe(0);
  });

  it('produces canonical outputs for a complete line', () => {
    const line = {
      level: 2, country: 'Colombia', bilingual: false, stack: 'Especializada',
      modality: 'Remoto', tools: 'Básico', quantity: 1, duration_months: 6,
    };
    const out = calcStaffAugLine(line, PARAMS);
    // base = 12.5, modality=1.0, cost_hour=12.5
    expect(out.cost_hour).toBeCloseTo(12.5, 4);
    // rate = 12.5 / 0.65 ≈ 19.2307692
    expect(out.rate_hour).toBeCloseTo(19.2308, 3);
    // tools_cost=50, tools_rate=50 (tools margin=0)
    // rate_month = 19.2308 * 160 + 50 = 3126.92
    expect(out.rate_month).toBeCloseTo(3126.923, 2);
    // total = 3126.923 * 1 * 6 = 18761.538
    expect(out.total).toBeCloseTo(18761.538, 2);
  });

  it('applies modality factor to cost/hour', () => {
    const line = {
      level: 2, country: 'Colombia', bilingual: false, stack: 'Especializada',
      modality: 'Presencial', tools: 'Básico', quantity: 1, duration_months: 1,
    };
    const out = calcStaffAugLine(line, PARAMS);
    expect(out.cost_hour).toBeCloseTo(12.5 * 1.2, 4); // 15.0
  });
});

describe('recalcStaffAugLines + sumStaffAugTotal', () => {
  it('recomputes every line from inputs', () => {
    const lines = [
      { level: 2, country: 'Colombia', bilingual: false, stack: 'Especializada',
        modality: 'Remoto', tools: 'Básico', quantity: 1, duration_months: 1 },
      { level: 3, country: 'México', bilingual: true, stack: 'Nicho',
        modality: 'Remoto', tools: 'Avanzado', quantity: 2, duration_months: 3 },
    ];
    const out = recalcStaffAugLines(lines, PARAMS);
    expect(out).toHaveLength(2);
    expect(out[0].total).toBeGreaterThan(0);
    expect(out[1].total).toBeGreaterThan(out[0].total);
    expect(sumStaffAugTotal(out)).toBeCloseTo(out[0].total + out[1].total, 4);
  });

  it('does not mutate input lines', () => {
    const lines = [{
      level: 2, country: 'Colombia', bilingual: false, stack: 'Especializada',
      modality: 'Remoto', tools: 'Básico', quantity: 1, duration_months: 1,
      cost_hour: 999, // stale value — must be overwritten in the output, not in input
    }];
    const out = recalcStaffAugLines(lines, PARAMS);
    expect(lines[0].cost_hour).toBe(999);
    expect(out[0].cost_hour).not.toBe(999);
  });
});

describe('detectLineDrift', () => {
  const baseLine = {
    level: 2, country: 'Colombia', bilingual: false, stack: 'Especializada',
    modality: 'Remoto', tools: 'Básico', quantity: 1, duration_months: 1,
  };

  it('reports no drift when client and server agree', () => {
    const server = recalcStaffAugLines([baseLine], PARAMS);
    const client = server; // identical
    const rep = detectLineDrift(client, server);
    expect(rep.drifted).toBe(false);
    expect(rep.diffs).toHaveLength(0);
  });

  it('reports drift when client sends a different total', () => {
    const server = recalcStaffAugLines([baseLine], PARAMS);
    const client = [{ ...server[0], total: server[0].total + 100 }];
    const rep = detectLineDrift(client, server);
    expect(rep.drifted).toBe(true);
    expect(rep.diffs.some((d) => d.field === 'total')).toBe(true);
  });

  it('ignores sub-cent differences (rounding)', () => {
    const server = recalcStaffAugLines([baseLine], PARAMS);
    const client = [{ ...server[0], total: server[0].total + 0.005 }];
    const rep = detectLineDrift(client, server, 0.01);
    expect(rep.drifted).toBe(false);
  });
});

describe('calcProjectFinancials', () => {
  it('applies buffer + warranty + margin in sequence', () => {
    // cost=1000, buffer=0.10 → 1100, warranty=0.05 → 1155,
    // margin=0.50 → salePrice = 1155 / 0.50 = 2310
    const out = calcProjectFinancials(1000, PARAMS);
    expect(out.costWithBuffer).toBeCloseTo(1100, 4);
    expect(out.costProtected).toBeCloseTo(1155, 4);
    expect(out.salePrice).toBeCloseTo(2310, 4);
  });
});
