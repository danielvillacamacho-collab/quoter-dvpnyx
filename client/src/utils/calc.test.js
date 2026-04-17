import {
  calcCostHour,
  calcRateHour,
  calcToolsCost,
  calcToolsRate,
  calcModalityFactor,
  calcStaffAugLine,
  calcProjectFinancials,
  calcProjectCostHour,
  calcProjectProfile,
  calcAllocation,
  calcProjectSummary,
  formatUSD,
  formatUSD2,
  formatPct,
  DEFAULT_PHASES,
  EMPTY_PROFILE,
} from './calc';

const mockParams = {
  level: [
    { key: 'L1', value: 800 },
    { key: 'L5', value: 4000 },
    { key: 'L10', value: 12000 },
  ],
  geo: [
    { key: 'Colombia', value: 1.0 },
    { key: 'México', value: 1.1 },
    { key: 'USA', value: 1.5 },
  ],
  bilingual: [
    { key: 'Sí', value: 1.2 },
    { key: 'No', value: 1.0 },
  ],
  stack: [
    { key: 'Especializada', value: 1.0 },
    { key: 'Premium', value: 1.3 },
  ],
  tools: [
    { key: 'Básico', value: 0 },
    { key: 'GitHub Copilot', value: 30 },
  ],
  modality: [
    { key: 'Remoto', value: 0.95 },
    { key: 'Híbrido', value: 1.1 },
    { key: 'Presencial', value: 1.2 },
  ],
  margin: [
    { key: 'talent', value: 0.35 },
    { key: 'tools', value: 0.2 },
  ],
  project: [
    { key: 'hours_month', value: 160 },
    { key: 'buffer', value: 0.1 },
    { key: 'warranty', value: 0.05 },
    { key: 'min_margin', value: 0.5 },
  ],
};

/* ===== calcCostHour ===== */
describe('calcCostHour', () => {
  it('returns 0 when params is null', () => {
    expect(calcCostHour(5, 'Colombia', false, 'Especializada', null)).toBe(0);
  });

  it('returns 0 when level is falsy', () => {
    expect(calcCostHour(0, 'Colombia', false, 'Especializada', mockParams)).toBe(0);
  });

  it('returns 0 when level key is not found', () => {
    expect(calcCostHour(99, 'Colombia', false, 'Especializada', mockParams)).toBe(0);
  });

  it('calculates correctly for L5 Colombia non-bilingual', () => {
    // (4000/160) * 1.0 * 1.0 * 1.0 = 25
    expect(calcCostHour(5, 'Colombia', false, 'Especializada', mockParams)).toBeCloseTo(25);
  });

  it('applies bilingual multiplier', () => {
    // (4000/160) * 1.0 * 1.2 * 1.0 = 30
    expect(calcCostHour(5, 'Colombia', true, 'Especializada', mockParams)).toBeCloseTo(30);
  });

  it('applies geo multiplier for Mexico', () => {
    // (4000/160) * 1.1 * 1.0 * 1.0 = 27.5
    expect(calcCostHour(5, 'México', false, 'Especializada', mockParams)).toBeCloseTo(27.5);
  });

  it('applies stack premium multiplier', () => {
    // (4000/160) * 1.0 * 1.0 * 1.3 = 32.5
    expect(calcCostHour(5, 'Colombia', false, 'Premium', mockParams)).toBeCloseTo(32.5);
  });
});

/* ===== calcRateHour ===== */
describe('calcRateHour', () => {
  it('applies talent margin correctly', () => {
    // 25 / (1 - 0.35) = 38.46...
    expect(calcRateHour(25, mockParams)).toBeCloseTo(38.46, 1);
  });

  it('returns 0 for cost 0', () => {
    expect(calcRateHour(0, mockParams)).toBe(0);
  });
});

/* ===== calcToolsCost ===== */
describe('calcToolsCost', () => {
  it('returns 0 for Básico', () => {
    expect(calcToolsCost('Básico', mockParams)).toBe(0);
  });

  it('returns tool cost for GitHub Copilot', () => {
    expect(calcToolsCost('GitHub Copilot', mockParams)).toBe(30);
  });

  it('returns 0 for unknown tool', () => {
    expect(calcToolsCost('Unknown', mockParams)).toBe(0);
  });
});

/* ===== calcToolsRate ===== */
describe('calcToolsRate', () => {
  it('returns 0 for zero cost', () => {
    expect(calcToolsRate(0, mockParams)).toBe(0);
  });

  it('applies tools margin', () => {
    // 30 / (1 - 0.2) = 37.5
    expect(calcToolsRate(30, mockParams)).toBeCloseTo(37.5);
  });

  it('returns cost unchanged when margin >= 1', () => {
    const paramsHighMargin = { ...mockParams, margin: [{ key: 'tools', value: 1 }] };
    expect(calcToolsRate(30, paramsHighMargin)).toBe(30);
  });
});

/* ===== calcModalityFactor ===== */
describe('calcModalityFactor', () => {
  it('returns correct factor for Remoto', () => {
    expect(calcModalityFactor('Remoto', mockParams)).toBe(0.95);
  });

  it('returns correct factor for Presencial', () => {
    expect(calcModalityFactor('Presencial', mockParams)).toBe(1.2);
  });

  it('returns 1 for unknown modality', () => {
    expect(calcModalityFactor('Unknown', mockParams)).toBe(1);
  });
});

/* ===== calcStaffAugLine ===== */
describe('calcStaffAugLine', () => {
  const baseLine = {
    level: 5, country: 'Colombia', bilingual: false, stack: 'Especializada',
    tools: 'Básico', modality: 'Remoto', quantity: 1, duration_months: 1,
  };

  it('returns zeros when level is missing', () => {
    const result = calcStaffAugLine({ ...baseLine, level: null }, mockParams);
    expect(result.cost_hour).toBe(0);
    expect(result.rate_hour).toBe(0);
    expect(result.total).toBe(0);
  });

  it('returns zeros when country is missing', () => {
    const result = calcStaffAugLine({ ...baseLine, country: '' }, mockParams);
    expect(result.cost_hour).toBe(0);
  });

  it('calculates rate_month for 1 resource, 1 month', () => {
    // costHour = 25 * 0.95 = 23.75
    // rateHour = 23.75 / 0.65 ≈ 36.54
    // rateMonth = 36.54 * 160 + 0 ≈ 5846
    const result = calcStaffAugLine(baseLine, mockParams);
    expect(result.cost_hour).toBeCloseTo(23.75);
    expect(result.rate_month).toBeGreaterThan(0);
    expect(result.total).toBeCloseTo(result.rate_month * 1 * 1);
  });

  it('scales total by quantity and duration', () => {
    const line = { ...baseLine, quantity: 3, duration_months: 6 };
    const result = calcStaffAugLine(line, mockParams);
    expect(result.total).toBeCloseTo(result.rate_month * 3 * 6);
  });

  it('includes tools rate in rate_month', () => {
    const withTools = { ...baseLine, tools: 'GitHub Copilot' };
    const withoutTools = { ...baseLine, tools: 'Básico' };
    const r1 = calcStaffAugLine(withTools, mockParams);
    const r2 = calcStaffAugLine(withoutTools, mockParams);
    expect(r1.rate_month).toBeGreaterThan(r2.rate_month);
  });
});

/* ===== calcProjectFinancials ===== */
describe('calcProjectFinancials', () => {
  it('applies buffer, warranty and margin', () => {
    const result = calcProjectFinancials(1000, mockParams);
    expect(result.costWithBuffer).toBeCloseTo(1100);
    expect(result.costProtected).toBeCloseTo(1155);
    expect(result.salePrice).toBeCloseTo(2310);
  });

  it('returns 0 salePrice when margin >= 1', () => {
    const paramsMaxMargin = { ...mockParams, project: [
      { key: 'hours_month', value: 160 },
      { key: 'buffer', value: 0.1 },
      { key: 'warranty', value: 0.05 },
      { key: 'min_margin', value: 1.0 },
    ]};
    const result = calcProjectFinancials(1000, paramsMaxMargin);
    expect(result.salePrice).toBe(0);
  });
});

/* ===== calcProjectCostHour (project — no modality) ===== */
describe('calcProjectCostHour', () => {
  it('returns 0 for empty profile', () => {
    expect(calcProjectCostHour(null, mockParams)).toBe(0);
  });

  it('does NOT apply modality factor (unlike staff aug)', () => {
    // staff aug with Remoto multiplies by 0.95; project must not
    const profile = { level: 5, country: 'Colombia', bilingual: false, stack: 'Especializada' };
    expect(calcProjectCostHour(profile, mockParams)).toBeCloseTo(25);
  });

  it('still applies geo, bilingual and stack multipliers', () => {
    const profile = { level: 5, country: 'México', bilingual: true, stack: 'Premium' };
    // (4000/160) * 1.1 * 1.2 * 1.3 = 42.9
    expect(calcProjectCostHour(profile, mockParams)).toBeCloseTo(42.9);
  });
});

/* ===== calcProjectProfile ===== */
describe('calcProjectProfile', () => {
  it('enriches profile with cost_hour and rate_hour', () => {
    const profile = { level: 5, country: 'Colombia', bilingual: false, stack: 'Especializada' };
    const result = calcProjectProfile(profile, mockParams);
    expect(result.cost_hour).toBeCloseTo(25);
    expect(result.rate_hour).toBeCloseTo(25 / 0.65, 1);
  });

  it('returns 0 cost/rate when level missing', () => {
    const result = calcProjectProfile({ country: 'Colombia' }, mockParams);
    expect(result.cost_hour).toBe(0);
    expect(result.rate_hour).toBe(0);
  });

  it('preserves all original fields', () => {
    const profile = { role_title: 'Senior Dev', specialty: 'Desarrollo', level: 5, country: 'Colombia', bilingual: false, stack: 'Especializada' };
    const result = calcProjectProfile(profile, mockParams);
    expect(result.role_title).toBe('Senior Dev');
    expect(result.specialty).toBe('Desarrollo');
  });
});

/* ===== calcAllocation ===== */
describe('calcAllocation', () => {
  const lines = [
    { role_title: 'Dev', cost_hour: 25 },
    { role_title: 'PM',  cost_hour: 40 },
  ];
  const phases = [
    { name: 'Planning', weeks: 2 },
    { name: 'Dev', weeks: 10 },
    { name: 'QA', weeks: 2 },
  ];

  it('returns zeros when no allocation given', () => {
    const r = calcAllocation(lines, phases, {});
    expect(r.totalHours).toBe(0);
    expect(r.totalCost).toBe(0);
  });

  it('computes totalHours = Σ hoursPerWeek × weeks', () => {
    const allocation = {
      0: { 0: 10, 1: 40, 2: 10 },   // Dev: 20 + 400 + 20 = 440 hrs
      1: { 0: 20, 1: 5,  2: 5 },    // PM:  40 + 50 + 10 = 100 hrs
    };
    const r = calcAllocation(lines, phases, allocation);
    expect(r.totalHours).toBe(540);
  });

  it('computes totalCost = Σ hours × cost_hour', () => {
    const allocation = {
      0: { 0: 10, 1: 40, 2: 10 },   // Dev 440 hrs × $25 = $11,000
      1: { 0: 20, 1: 5,  2: 5 },    // PM  100 hrs × $40 = $4,000
    };
    const r = calcAllocation(lines, phases, allocation);
    expect(r.totalCost).toBe(15000);
  });

  it('tracks per-profile totals', () => {
    const allocation = { 0: { 1: 40 }, 1: { 1: 10 } };  // only phase Dev
    const r = calcAllocation(lines, phases, allocation);
    expect(r.byProfile[0].hours).toBe(400);
    expect(r.byProfile[0].cost).toBe(10000);
    expect(r.byProfile[1].hours).toBe(100);
    expect(r.byProfile[1].cost).toBe(4000);
  });

  it('tracks per-phase totals', () => {
    const allocation = { 0: { 1: 40 }, 1: { 1: 10 } };
    const r = calcAllocation(lines, phases, allocation);
    expect(r.byPhase[1].hrWeek).toBe(50);
    expect(r.byPhase[1].hours).toBe(500);
    expect(r.byPhase[1].cost).toBe(14000);
    expect(r.byPhase[0].hours).toBe(0);
  });

  it('handles empty arrays gracefully', () => {
    expect(calcAllocation([], [], {}).totalHours).toBe(0);
    expect(calcAllocation(null, null, null).totalHours).toBe(0);
  });
});

/* ===== calcProjectSummary ===== */
describe('calcProjectSummary', () => {
  const lines = [{ role_title: 'Dev', cost_hour: 25 }];
  const phases = [{ name: 'Dev', weeks: 10 }];

  it('runs the full cascade through to final price', () => {
    const alloc = { 0: { 0: 40 } };  // 400 hrs × $25 = $10,000 base cost
    const r = calcProjectSummary(lines, phases, alloc, 0, mockParams);
    expect(r.totalCost).toBe(10000);
    expect(r.costWithBuffer).toBeCloseTo(11000);
    expect(r.costProtected).toBeCloseTo(11550);
    expect(r.salePrice).toBeCloseTo(23100);
    expect(r.finalPrice).toBeCloseTo(23100);
  });

  it('applies discount on top of salePrice', () => {
    const alloc = { 0: { 0: 40 } };
    const r = calcProjectSummary(lines, phases, alloc, 0.10, mockParams);
    expect(r.finalPrice).toBeCloseTo(23100 * 0.9);
    expect(r.discount).toBe(0.10);
  });

  it('computes blend rates', () => {
    const alloc = { 0: { 0: 40 } };
    const r = calcProjectSummary(lines, phases, alloc, 0, mockParams);
    // 400 hrs total, salePrice/hrs
    expect(r.blendRateCost).toBeCloseTo(25);
    expect(r.blendRateSale).toBeCloseTo(23100 / 400);
  });

  it('sums totalWeeks', () => {
    const r = calcProjectSummary(lines, [{ weeks: 2 }, { weeks: 10 }, { weeks: 3 }], {}, 0, mockParams);
    expect(r.totalWeeks).toBe(15);
  });

  it('returns 0 blend rates when no hours', () => {
    const r = calcProjectSummary(lines, phases, {}, 0, mockParams);
    expect(r.blendRateCost).toBe(0);
    expect(r.blendRateSale).toBe(0);
  });

  it('computes real margin as (finalPrice - costProtected) / finalPrice', () => {
    const alloc = { 0: { 0: 40 } };
    const r = calcProjectSummary(lines, phases, alloc, 0, mockParams);
    const expected = (23100 - 11550) / 23100;
    expect(r.realMargin).toBeCloseTo(expected);
  });
});

/* ===== DEFAULT_PHASES / EMPTY_PROFILE ===== */
describe('project constants', () => {
  it('ships 5 default phases including Garantía', () => {
    expect(DEFAULT_PHASES).toHaveLength(5);
    expect(DEFAULT_PHASES[4].name).toBe('Garantía');
  });

  it('EMPTY_PROFILE has no modality/tools/quantity by convention', () => {
    // These fields exist (for DB schema compatibility) but default to neutral
    expect(EMPTY_PROFILE.modality).toBe('');
    expect(EMPTY_PROFILE.tools).toBe('');
    expect(EMPTY_PROFILE.quantity).toBe(1);
  });
});

/* ===== formatUSD ===== */
describe('formatUSD', () => {
  it('formats positive number', () => {
    expect(formatUSD(1000)).toBe('$1,000');
  });

  it('returns dash for null', () => {
    expect(formatUSD(null)).toBe('—');
  });

  it('returns dash for NaN', () => {
    expect(formatUSD(NaN)).toBe('—');
  });
});

/* ===== formatUSD2 ===== */
describe('formatUSD2', () => {
  it('formats with 2 decimal places', () => {
    expect(formatUSD2(1000.5)).toBe('$1,000.50');
  });

  it('returns dash for null', () => {
    expect(formatUSD2(null)).toBe('—');
  });
});

/* ===== formatPct ===== */
describe('formatPct', () => {
  it('formats decimal as percentage', () => {
    expect(formatPct(0.35)).toBe('35.0%');
  });

  it('formats 0', () => {
    expect(formatPct(0)).toBe('0.0%');
  });

  it('returns dash for null', () => {
    expect(formatPct(null)).toBe('—');
  });
});
