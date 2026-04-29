import {
  VALID_CURRENCIES, formatPeriod, normalizePeriod, currentPeriod,
  previousPeriod, nextPeriod, recentPeriods, formatMoney,
  defaultCurrencyForCountry, deltaZoneColor, deltaZoneLabel,
} from './cost';

describe('VALID_CURRENCIES', () => {
  it('incluye las 5 monedas canónicas', () => {
    expect(VALID_CURRENCIES.sort()).toEqual(['COP', 'EUR', 'GTQ', 'MXN', 'USD']);
  });
});

describe('formatPeriod', () => {
  it('YYYYMM → YYYY-MM', () => {
    expect(formatPeriod('202604')).toBe('2026-04');
    expect(formatPeriod('202612')).toBe('2026-12');
  });
  it('"—" para vacío', () => {
    expect(formatPeriod(null)).toBe('—');
    expect(formatPeriod('')).toBe('—');
  });
  it('passthrough para forma no canónica', () => {
    expect(formatPeriod('foo')).toBe('foo');
  });
});

describe('normalizePeriod', () => {
  it('YYYYMM → YYYYMM', () => {
    expect(normalizePeriod('202604')).toBe('202604');
  });
  it('YYYY-MM → YYYYMM', () => {
    expect(normalizePeriod('2026-04')).toBe('202604');
  });
  it('null para inválido', () => {
    expect(normalizePeriod('foo')).toBeNull();
    expect(normalizePeriod('')).toBeNull();
    expect(normalizePeriod(null)).toBeNull();
  });
});

describe('previousPeriod / nextPeriod', () => {
  it('rolling normal', () => {
    expect(previousPeriod('202604')).toBe('202603');
    expect(nextPeriod('202604')).toBe('202605');
  });
  it('rollover de año', () => {
    expect(previousPeriod('202601')).toBe('202512');
    expect(nextPeriod('202612')).toBe('202701');
  });
  it('null para inválido', () => {
    expect(previousPeriod('foo')).toBeNull();
    expect(nextPeriod('foo')).toBeNull();
  });
});

describe('recentPeriods', () => {
  it('genera N períodos descendentes desde el actual', () => {
    const list = recentPeriods(3);
    expect(list).toHaveLength(3);
    expect(list[0]).toBe(currentPeriod());
    expect(list[1]).toBe(previousPeriod(list[0]));
  });
});

describe('formatMoney', () => {
  it('USD con 2 decimales por default', () => {
    expect(formatMoney(1234.56, 'USD')).toMatch(/1.234.56|1,234\.56/);
  });
  it('COP grandes sin decimales', () => {
    const out = formatMoney(12500000, 'COP');
    expect(out).toMatch(/12.500.000|12,500,000/);
  });
  it('"—" para null/NaN', () => {
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney('foo', 'USD')).toBe('—');
  });
  it('honors decimals override (sin dígitos decimales)', () => {
    // En es-CO el separador de miles es '.' — no podemos usar /\.\d/.
    // Valid: el número 1000.00 con decimals:0 debe terminar en algo
    // distinto a '.00' o ',00'.
    const out = formatMoney(1000, 'USD', { decimals: 0 });
    expect(out).not.toMatch(/[.,]00\b/);
    expect(out).not.toMatch(/[.,]0$/);
  });
});

describe('defaultCurrencyForCountry', () => {
  it('Colombia → COP', () => {
    expect(defaultCurrencyForCountry('Colombia')).toBe('COP');
    expect(defaultCurrencyForCountry('CO')).toBe('COP');
  });
  it('México → MXN', () => {
    expect(defaultCurrencyForCountry('México')).toBe('MXN');
    expect(defaultCurrencyForCountry('Mexico')).toBe('MXN');
  });
  it('Guatemala → GTQ', () => {
    expect(defaultCurrencyForCountry('Guatemala')).toBe('GTQ');
  });
  it('España → EUR', () => {
    expect(defaultCurrencyForCountry('España')).toBe('EUR');
  });
  it('default USD', () => {
    expect(defaultCurrencyForCountry(null)).toBe('USD');
    expect(defaultCurrencyForCountry('Argentina')).toBe('USD');
  });
});

describe('deltaZone helpers', () => {
  it('colores semánticos por zone', () => {
    expect(deltaZoneColor('on_target')).toMatch(/16a34a/);
    expect(deltaZoneColor('warn')).toMatch(/ca8a04/);
    expect(deltaZoneColor('alert')).toMatch(/dc2626/);
    expect(deltaZoneColor('no_baseline')).toMatch(/6b7280/);
  });
  it('labels legibles', () => {
    expect(deltaZoneLabel('on_target')).toMatch(/En rango/);
    expect(deltaZoneLabel('alert')).toMatch(/Desviación/);
  });
});
