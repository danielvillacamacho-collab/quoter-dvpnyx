const { convert, buildRatesMap, resolveRate } = require('./fx');

describe('fx.buildRatesMap', () => {
  it('handles empty rows', () => {
    const m = buildRatesMap([]);
    expect(m.size).toBe(0);
  });
  it('indexes by yyyymm|currency and builds fallback list', () => {
    const m = buildRatesMap([
      { yyyymm: '202601', currency: 'COP', usd_rate: '3950' },
      { yyyymm: '202602', currency: 'COP', usd_rate: '4000' },
      { yyyymm: '202602', currency: 'MXN', usd_rate: '17' },
    ]);
    expect(m.get('202601|COP')).toBe(3950);
    expect(m.get('202602|MXN')).toBe(17);
    expect(m._fallback.COP.length).toBe(2);
  });
});

describe('fx.resolveRate', () => {
  const m = buildRatesMap([
    { yyyymm: '202601', currency: 'COP', usd_rate: '3950' },
    { yyyymm: '202603', currency: 'COP', usd_rate: '4100' },
  ]);
  it('USD has implicit rate 1', () => {
    expect(resolveRate(m, '202601', 'USD')).toBe(1);
  });
  it('returns direct hit', () => {
    expect(resolveRate(m, '202601', 'COP')).toBe(3950);
  });
  it('falls back to most recent <= yyyymm', () => {
    expect(resolveRate(m, '202602', 'COP')).toBe(3950);
    expect(resolveRate(m, '202604', 'COP')).toBe(4100);
  });
  it('returns null if no rate found', () => {
    expect(resolveRate(m, '202605', 'EUR')).toBeNull();
  });
});

describe('fx.convert', () => {
  const m = buildRatesMap([
    { yyyymm: '202602', currency: 'COP', usd_rate: '4000' },
    { yyyymm: '202602', currency: 'MXN', usd_rate: '17' },
  ]);
  it('returns same amount when currencies match', () => {
    expect(convert(100, 'USD', 'USD', '202602', m).amount).toBe(100);
    expect(convert(100, 'COP', 'COP', '202602', m).amount).toBe(100);
  });
  it('USD → COP', () => {
    expect(convert(10, 'USD', 'COP', '202602', m).amount).toBe(40000);
  });
  it('COP → USD', () => {
    expect(convert(40000, 'COP', 'USD', '202602', m).amount).toBe(10);
  });
  it('COP → MXN: 40000 COP = 10 USD = 170 MXN', () => {
    const r = convert(40000, 'COP', 'MXN', '202602', m);
    expect(r.amount).toBe(170);
  });
  it('returns null amount when rate missing', () => {
    const r = convert(100, 'EUR', 'USD', '202602', m);
    expect(r.amount).toBeNull();
  });
  it('returns null when amount is null', () => {
    expect(convert(null, 'USD', 'COP', '202602', m).amount).toBeNull();
  });
});
