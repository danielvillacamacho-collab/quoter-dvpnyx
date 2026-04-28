const {
  levelIntToString, levelStringToInt, normalizeLevel, levelDistance,
  VALID_INT_LEVELS, VALID_STRING_LEVELS,
} = require('./level');

describe('levelIntToString', () => {
  it('convierte INT válidos a Lx', () => {
    expect(levelIntToString(1)).toBe('L1');
    expect(levelIntToString(11)).toBe('L11');
    expect(levelIntToString(5)).toBe('L5');
  });
  it('acepta strings numéricos', () => {
    expect(levelIntToString('7')).toBe('L7');
  });
  it('trunca decimales antes de mapear', () => {
    expect(levelIntToString(3.7)).toBe('L3');
  });
  it('rechaza out-of-range', () => {
    expect(levelIntToString(0)).toBeNull();
    expect(levelIntToString(12)).toBeNull();
    expect(levelIntToString(-1)).toBeNull();
  });
  it('rechaza basura', () => {
    expect(levelIntToString(null)).toBeNull();
    expect(levelIntToString('foo')).toBeNull();
    expect(levelIntToString(undefined)).toBeNull();
    expect(levelIntToString(NaN)).toBeNull();
  });
});

describe('levelStringToInt', () => {
  it('convierte Lx a INT', () => {
    expect(levelStringToInt('L1')).toBe(1);
    expect(levelStringToInt('L11')).toBe(11);
  });
  it('rechaza no-Lx', () => {
    expect(levelStringToInt('1')).toBeNull();
    expect(levelStringToInt('L0')).toBeNull();
    expect(levelStringToInt('L12')).toBeNull();
    expect(levelStringToInt('lL5')).toBeNull();
    expect(levelStringToInt(null)).toBeNull();
    expect(levelStringToInt(5)).toBeNull();
  });
});

describe('normalizeLevel', () => {
  it('normaliza desde formatos mixtos a Lx', () => {
    expect(normalizeLevel(5)).toBe('L5');
    expect(normalizeLevel('5')).toBe('L5');
    expect(normalizeLevel('L5')).toBe('L5');
  });
  it('null para inválido', () => {
    expect(normalizeLevel('foo')).toBeNull();
    expect(normalizeLevel(99)).toBeNull();
  });
});

describe('levelDistance', () => {
  it('calcula distancia entre niveles', () => {
    expect(levelDistance(3, 5)).toBe(2);
    expect(levelDistance('L3', 'L5')).toBe(2);
    expect(levelDistance('L8', 1)).toBe(7);
    expect(levelDistance(5, 5)).toBe(0);
  });
  it('null si alguno inválido', () => {
    expect(levelDistance('foo', 5)).toBeNull();
    expect(levelDistance(5, null)).toBeNull();
  });
});

describe('catálogos', () => {
  it('VALID_INT_LEVELS y VALID_STRING_LEVELS coinciden 1:1', () => {
    expect(VALID_INT_LEVELS).toHaveLength(11);
    expect(VALID_STRING_LEVELS).toHaveLength(11);
    VALID_INT_LEVELS.forEach((n, i) => expect(VALID_STRING_LEVELS[i]).toBe(`L${n}`));
  });
});
