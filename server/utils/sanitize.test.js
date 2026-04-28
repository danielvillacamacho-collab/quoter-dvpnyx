const {
  parsePagination, parseFiniteInt, parseFiniteNumber,
  isValidUUID, isValidISODate, mondayOf,
} = require('./sanitize');

describe('parsePagination', () => {
  it('aplica defaults cuando no hay query', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 25, offset: 0 });
  });
  it('respeta page y limit válidos', () => {
    expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, offset: 20 });
  });
  it('clampa limit superior al máximo', () => {
    expect(parsePagination({ limit: '500' }, { maxLimit: 100 })).toEqual({ page: 1, limit: 100, offset: 0 });
  });
  it('clampa page mínimo a 1 cuando llega 0 o negativo', () => {
    expect(parsePagination({ page: '0' }).page).toBe(1);
    expect(parsePagination({ page: '-5' }).page).toBe(1);
  });
  it('cae al default si page/limit son strings basura', () => {
    expect(parsePagination({ page: 'foo', limit: 'bar' })).toEqual({ page: 1, limit: 25, offset: 0 });
  });
  it('respeta defaultLimit/maxLimit custom', () => {
    expect(parsePagination({}, { defaultLimit: 50, maxLimit: 500 })).toEqual({ page: 1, limit: 50, offset: 0 });
  });
});

describe('parseFiniteInt / parseFiniteNumber', () => {
  it('devuelve int trunc para números válidos', () => {
    expect(parseFiniteInt('5')).toBe(5);
    expect(parseFiniteInt('5.7')).toBe(5);
    expect(parseFiniteInt(10)).toBe(10);
  });
  it('cae al fallback para basura/null/empty', () => {
    expect(parseFiniteInt('foo', 99)).toBe(99);
    expect(parseFiniteInt(null, 99)).toBe(99);
    expect(parseFiniteInt('', 99)).toBe(99);
    expect(parseFiniteInt(NaN, 99)).toBe(99);
    expect(parseFiniteInt(Infinity, 99)).toBe(99);
  });
  it('parseFiniteNumber preserva decimales', () => {
    expect(parseFiniteNumber('5.5')).toBeCloseTo(5.5);
    expect(parseFiniteNumber('foo', 1)).toBe(1);
  });
});

describe('isValidUUID', () => {
  it('acepta UUIDs canónicos', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });
  it('rechaza no-UUIDs', () => {
    expect(isValidUUID('foo')).toBe(false);
    expect(isValidUUID('')).toBe(false);
    expect(isValidUUID(null)).toBe(false);
    expect(isValidUUID(123)).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
  });
});

describe('isValidISODate', () => {
  it('acepta fechas ISO calendarialmente válidas', () => {
    expect(isValidISODate('2026-04-27')).toBe(true);
    expect(isValidISODate('2024-02-29')).toBe(true); // bisiesto
  });
  it('rechaza fechas mal formadas o inexistentes', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026/04/27')).toBe(false);
    expect(isValidISODate('foo')).toBe(false);
    expect(isValidISODate(null)).toBe(false);
  });
});

describe('mondayOf', () => {
  it('snap martes a lunes', () => {
    expect(mondayOf('2026-04-28')).toBe('2026-04-27');
  });
  it('snap domingo al lunes anterior', () => {
    expect(mondayOf('2026-05-03')).toBe('2026-04-27');
  });
  it('lunes queda como lunes', () => {
    expect(mondayOf('2026-04-27')).toBe('2026-04-27');
  });
  it('null para inválido', () => {
    expect(mondayOf('foo')).toBeNull();
    expect(mondayOf('2026-13-01')).toBeNull();
  });
});
