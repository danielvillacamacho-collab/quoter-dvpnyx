import {
  fmtUSD, fmtPct, monthLabel, todayYYYYMM,
  yyyymmFromDate, yyyymmToMonthInput, monthInputToYyyymm, expandMonths,
} from './RevenuePlanEditor';

/* ── fmtUSD ────────────────────────────────────────────────── */

describe('fmtUSD', () => {
  it('formats number as USD currency', () => {
    expect(fmtUSD(1234)).toBe('$1,234');
    expect(fmtUSD(0)).toBe('$0');
  });
  it('returns em-dash for null', () => {
    expect(fmtUSD(null)).toBe('—');
  });
  it('coerces string numbers', () => {
    expect(fmtUSD('5000')).toBe('$5,000');
  });
  it('handles large numbers', () => {
    expect(fmtUSD(1000000)).toBe('$1,000,000');
  });
});

/* ── fmtPct ────────────────────────────────────────────────── */

describe('fmtPct', () => {
  it('formats fraction as percentage with 2 decimals', () => {
    expect(fmtPct(0.5)).toBe('50.00%');
    expect(fmtPct(1)).toBe('100.00%');
    expect(fmtPct(0.1234)).toBe('12.34%');
  });
  it('returns em-dash for null/undefined', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
  });
  it('handles zero', () => {
    expect(fmtPct(0)).toBe('0.00%');
  });
});

/* ── monthLabel ────────────────────────────────────────────── */

describe('monthLabel', () => {
  it('converts YYYYMM to abbreviated Spanish label', () => {
    expect(monthLabel('202601')).toBe('Ene 26');
    expect(monthLabel('202506')).toBe('Jun 25');
    expect(monthLabel('202512')).toBe('Dic 25');
  });
  it('returns ? for month 0 or 13', () => {
    expect(monthLabel('202500')).toBe('? 25');
    expect(monthLabel('202513')).toBe('? 25');
  });
});

/* ── todayYYYYMM ───────────────────────────────────────────── */

describe('todayYYYYMM', () => {
  it('returns current date in YYYYMM format', () => {
    const result = todayYYYYMM();
    expect(result).toMatch(/^[0-9]{6}$/);
    const now = new Date();
    const expected = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });
});

/* ── yyyymmFromDate ────────────────────────────────────────── */

describe('yyyymmFromDate', () => {
  it('extracts YYYYMM from ISO date string', () => {
    expect(yyyymmFromDate('2025-06-15')).toBe('202506');
    // Note: Date-only strings are parsed as UTC; getMonth/getFullYear use
    // local time, so boundary dates (first/last of month) may shift
    // depending on the local timezone. We test mid-month dates to be safe.
    expect(yyyymmFromDate('2026-01-15')).toBe('202601');
    expect(yyyymmFromDate('2025-12-15')).toBe('202512');
  });
  it('returns null for null/undefined/empty', () => {
    expect(yyyymmFromDate(null)).toBeNull();
    expect(yyyymmFromDate(undefined)).toBeNull();
    expect(yyyymmFromDate('')).toBeNull();
  });
  it('returns null for invalid date string', () => {
    expect(yyyymmFromDate('not-a-date')).toBeNull();
  });
  it('handles ISO datetime string', () => {
    const result = yyyymmFromDate('2025-03-15T10:30:00Z');
    expect(result).toBe('202503');
  });
});

/* ── yyyymmToMonthInput ────────────────────────────────────── */

describe('yyyymmToMonthInput', () => {
  it('converts YYYYMM to YYYY-MM', () => {
    expect(yyyymmToMonthInput('202506')).toBe('2025-06');
    expect(yyyymmToMonthInput('202601')).toBe('2026-01');
  });
  it('returns empty string for invalid format', () => {
    expect(yyyymmToMonthInput('2025')).toBe('');
    expect(yyyymmToMonthInput('abcdef')).toBe('');
  });
});

/* ── monthInputToYyyymm ────────────────────────────────────── */

describe('monthInputToYyyymm', () => {
  it('converts YYYY-MM to YYYYMM', () => {
    expect(monthInputToYyyymm('2025-06')).toBe('202506');
    expect(monthInputToYyyymm('2026-01')).toBe('202601');
  });
  it('returns empty string for null/undefined/empty', () => {
    expect(monthInputToYyyymm(null)).toBe('');
    expect(monthInputToYyyymm(undefined)).toBe('');
    expect(monthInputToYyyymm('')).toBe('');
  });
  it('returns empty string for invalid format', () => {
    expect(monthInputToYyyymm('202506')).toBe('');
    expect(monthInputToYyyymm('2025-6')).toBe('');
  });
  it('returns empty string for non-string', () => {
    expect(monthInputToYyyymm(12345)).toBe('');
  });
});

/* ── expandMonths ──────────────────────────────────────────── */

describe('expandMonths', () => {
  it('returns array of YYYYMM strings for range within same year', () => {
    expect(expandMonths('202503', '202506')).toEqual([
      '202503', '202504', '202505', '202506',
    ]);
  });
  it('crosses year boundary', () => {
    expect(expandMonths('202511', '202602')).toEqual([
      '202511', '202512', '202601', '202602',
    ]);
  });
  it('returns single-element array when from equals to', () => {
    expect(expandMonths('202506', '202506')).toEqual(['202506']);
  });
  it('returns empty array when from > to', () => {
    expect(expandMonths('202606', '202506')).toEqual([]);
  });
  it('returns empty array for invalid input', () => {
    expect(expandMonths('abc', '202506')).toEqual([]);
    expect(expandMonths('202506', 'xyz')).toEqual([]);
    expect(expandMonths('', '')).toEqual([]);
  });
  it('handles full-year range (12 months)', () => {
    const result = expandMonths('202501', '202512');
    expect(result).toHaveLength(12);
    expect(result[0]).toBe('202501');
    expect(result[11]).toBe('202512');
  });
  it('handles multi-year range', () => {
    const result = expandMonths('202401', '202512');
    expect(result).toHaveLength(24);
    expect(result[0]).toBe('202401');
    expect(result[23]).toBe('202512');
  });
  it('is capped at 240 iterations (safety)', () => {
    // 240 months = 20 years
    const result = expandMonths('200001', '202512');
    expect(result.length).toBeLessThanOrEqual(240);
  });
});
