import {
  fmtPct, cumplimientoPct, cumplimientoColor, fmtCumplPct,
  fmtMoney, fmtUSD, monthLabel, todayYYYYMM, offsetMonth,
  yyyymmToMonthInput, monthInputToYyyymm, formatPctForInput,
} from './Revenue';

/* ── fmtPct ────────────────────────────────────────────────── */

describe('fmtPct', () => {
  it('formats fraction as percentage with 1 decimal', () => {
    expect(fmtPct(0.5)).toBe('50.0%');
    expect(fmtPct(1)).toBe('100.0%');
    expect(fmtPct(0.123)).toBe('12.3%');
  });
  it('returns em-dash for null/undefined', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
  });
  it('coerces string numbers', () => {
    expect(fmtPct('0.25')).toBe('25.0%');
  });
  it('handles zero', () => {
    expect(fmtPct(0)).toBe('0.0%');
  });
});

/* ── cumplimientoPct ───────────────────────────────────────── */

describe('cumplimientoPct', () => {
  it('returns ratio when both values are valid', () => {
    expect(cumplimientoPct(80, 100)).toBe(0.8);
    expect(cumplimientoPct(100, 100)).toBe(1);
    expect(cumplimientoPct(120, 100)).toBe(1.2);
  });
  it('returns null when plan is 0', () => {
    expect(cumplimientoPct(50, 0)).toBeNull();
  });
  it('returns null when real is null', () => {
    expect(cumplimientoPct(null, 100)).toBeNull();
  });
  it('returns null when plan is null', () => {
    expect(cumplimientoPct(50, null)).toBeNull();
  });
  it('returns null when both are null', () => {
    expect(cumplimientoPct(null, null)).toBeNull();
  });
});

/* ── cumplimientoColor ─────────────────────────────────────── */

describe('cumplimientoColor', () => {
  it('returns success color for ratio >= 1', () => {
    expect(cumplimientoColor(1)).toBe('var(--success)');
    expect(cumplimientoColor(1.5)).toBe('var(--success)');
  });
  it('returns warning color for 0.8 <= ratio < 1', () => {
    expect(cumplimientoColor(0.8)).toBe('var(--warning)');
    expect(cumplimientoColor(0.99)).toBe('var(--warning)');
  });
  it('returns danger color for ratio < 0.8', () => {
    expect(cumplimientoColor(0.5)).toBe('var(--danger)');
    expect(cumplimientoColor(0.79)).toBe('var(--danger)');
    expect(cumplimientoColor(0)).toBe('var(--danger)');
  });
  it('returns text-light for null', () => {
    expect(cumplimientoColor(null)).toBe('var(--text-light)');
  });
});

/* ── fmtCumplPct ───────────────────────────────────────────── */

describe('fmtCumplPct', () => {
  it('formats ratio as integer percentage', () => {
    expect(fmtCumplPct(1)).toBe('100%');
    expect(fmtCumplPct(0.856)).toBe('86%');
    expect(fmtCumplPct(1.2)).toBe('120%');
  });
  it('returns em-dash for null', () => {
    expect(fmtCumplPct(null)).toBe('—');
  });
});

/* ── fmtMoney ──────────────────────────────────────────────── */

describe('fmtMoney', () => {
  it('formats as USD when no currency given', () => {
    expect(fmtMoney(1234)).toBe('$1,234');
  });
  it('formats with explicit currency code', () => {
    // EUR uses different symbol depending on locale, but Intl with en-US gives €
    const result = fmtMoney(1000, 'EUR');
    expect(result).toContain('1,000');
  });
  it('formats USD explicitly', () => {
    expect(fmtMoney(9999, 'USD')).toBe('$9,999');
  });
  it('returns em-dash for null', () => {
    expect(fmtMoney(null)).toBe('—');
    expect(fmtMoney(null, 'EUR')).toBe('—');
  });
  it('falls back gracefully for invalid currency code', () => {
    const result = fmtMoney(500, 'INVALID');
    // Should not throw; returns a fallback string
    expect(result).toBeTruthy();
    expect(result).toContain('500');
  });
  it('handles zero', () => {
    expect(fmtMoney(0)).toBe('$0');
  });
  it('coerces string numbers', () => {
    expect(fmtMoney('2500', 'USD')).toBe('$2,500');
  });
});

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
  it('handles negative numbers', () => {
    expect(fmtUSD(-1500)).toBe('-$1,500');
  });
});

/* ── monthLabel ────────────────────────────────────────────── */

describe('monthLabel', () => {
  it('converts YYYYMM to abbreviated Spanish label', () => {
    expect(monthLabel('202601')).toBe('Ene 26');
    expect(monthLabel('202506')).toBe('Jun 25');
    expect(monthLabel('202512')).toBe('Dic 25');
  });
  it('returns ? for invalid month numbers', () => {
    expect(monthLabel('202500')).toBe('? 25');
    expect(monthLabel('202513')).toBe('? 25');
  });
});

/* ── todayYYYYMM ───────────────────────────────────────────── */

describe('todayYYYYMM', () => {
  it('returns current date in YYYYMM format', () => {
    const result = todayYYYYMM();
    expect(result).toMatch(/^[0-9]{6}$/);
    // Should match current year
    const now = new Date();
    const expected = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });
});

/* ── offsetMonth ───────────────────────────────────────────── */

describe('offsetMonth', () => {
  it('adds months within same year', () => {
    expect(offsetMonth('202503', 2)).toBe('202505');
  });
  it('crosses year boundary forward', () => {
    expect(offsetMonth('202511', 3)).toBe('202602');
  });
  it('subtracts months within same year', () => {
    expect(offsetMonth('202506', -3)).toBe('202503');
  });
  it('crosses year boundary backward', () => {
    expect(offsetMonth('202502', -3)).toBe('202411');
  });
  it('handles zero delta', () => {
    expect(offsetMonth('202506', 0)).toBe('202506');
  });
  it('handles large positive delta', () => {
    expect(offsetMonth('202501', 24)).toBe('202701');
  });
  it('handles large negative delta', () => {
    expect(offsetMonth('202501', -24)).toBe('202301');
  });
  it('handles delta of exactly 12', () => {
    expect(offsetMonth('202506', 12)).toBe('202606');
  });
});

/* ── yyyymmToMonthInput ────────────────────────────────────── */

describe('yyyymmToMonthInput', () => {
  it('converts YYYYMM to YYYY-MM', () => {
    expect(yyyymmToMonthInput('202506')).toBe('2025-06');
    expect(yyyymmToMonthInput('202512')).toBe('2025-12');
    expect(yyyymmToMonthInput('202601')).toBe('2026-01');
  });
  it('returns empty string for invalid format', () => {
    expect(yyyymmToMonthInput('2025')).toBe('');
    expect(yyyymmToMonthInput('20251')).toBe('');
    expect(yyyymmToMonthInput('2025123')).toBe('');
    expect(yyyymmToMonthInput('abcdef')).toBe('');
  });
});

/* ── monthInputToYyyymm ────────────────────────────────────── */

describe('monthInputToYyyymm', () => {
  it('converts YYYY-MM to YYYYMM', () => {
    expect(monthInputToYyyymm('2025-06')).toBe('202506');
    expect(monthInputToYyyymm('2026-01')).toBe('202601');
  });
  it('returns empty string for null/undefined', () => {
    expect(monthInputToYyyymm(null)).toBe('');
    expect(monthInputToYyyymm(undefined)).toBe('');
  });
  it('returns empty string for invalid format', () => {
    expect(monthInputToYyyymm('')).toBe('');
    expect(monthInputToYyyymm('202506')).toBe('');
    expect(monthInputToYyyymm('2025-6')).toBe('');
    expect(monthInputToYyyymm('not-a-date')).toBe('');
  });
  it('returns empty string for non-string input', () => {
    expect(monthInputToYyyymm(12345)).toBe('');
  });
});

/* ── formatPctForInput ─────────────────────────────────────── */

describe('formatPctForInput', () => {
  it('converts fraction to clean percentage string for inputs', () => {
    expect(formatPctForInput(0.3)).toBe('30');
    expect(formatPctForInput(1)).toBe('100');
    expect(formatPctForInput(0.5)).toBe('50');
  });
  it('returns empty string for null/undefined', () => {
    expect(formatPctForInput(null)).toBe('');
    expect(formatPctForInput(undefined)).toBe('');
  });
  it('handles floating point edge cases without extra decimals', () => {
    // 0.30000000000000004 * 100 = 30.000000000000004 — should round cleanly
    expect(formatPctForInput(0.30000000000000004)).toBe('30');
  });
  it('preserves meaningful decimals up to 2 places', () => {
    expect(formatPctForInput(0.125)).toBe('12.5');
    expect(formatPctForInput(0.3333)).toBe('33.33');
  });
  it('coerces string numbers', () => {
    expect(formatPctForInput('0.25')).toBe('25');
  });
  it('handles zero', () => {
    expect(formatPctForInput(0)).toBe('0');
  });
});
