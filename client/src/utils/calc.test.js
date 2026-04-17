import {
  calcCostHour,
  calcRateHour,
  calcToolsCost,
  calcToolsRate,
  calcModalityFactor,
  calcStaffAugLine,
  calcProjectFinancials,
  formatUSD,
  formatUSD2,
  formatPct,
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
