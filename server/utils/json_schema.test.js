const { validate, makeValidator, SCHEMAS } = require('./json_schema');

describe('validate primitives', () => {
  it('string básico', () => {
    expect(validate('hello', { type: 'string' })).toEqual([]);
    expect(validate(123, { type: 'string' })).toEqual(['$: expected string']);
  });
  it('string min/max length', () => {
    expect(validate('hi', { type: 'string', minLength: 3 })).toContain('$: too short');
    expect(validate('hello', { type: 'string', maxLength: 4 })).toContain('$: too long');
  });
  it('string enum', () => {
    expect(validate('a', { type: 'string', enum: ['a', 'b'] })).toEqual([]);
    expect(validate('c', { type: 'string', enum: ['a', 'b'] })).toContain('$: not in enum');
  });
  it('integer min/max', () => {
    expect(validate(5, { type: 'integer', min: 1, max: 10 })).toEqual([]);
    expect(validate(0, { type: 'integer', min: 1 })).toContain('$: < min');
    expect(validate(11, { type: 'integer', max: 10 })).toContain('$: > max');
    expect(validate(5.5, { type: 'integer' })).toContain('$: expected integer');
  });
  it('number rechaza NaN/Infinity', () => {
    expect(validate(NaN, { type: 'number' })).toContain('$: expected number');
    expect(validate(Infinity, { type: 'number' })).toContain('$: expected number');
  });
  it('boolean', () => {
    expect(validate(true, { type: 'boolean' })).toEqual([]);
    expect(validate('true', { type: 'boolean' })).toContain('$: expected boolean');
  });
  it('date ISO', () => {
    expect(validate('2026-04-27', { type: 'date' })).toEqual([]);
    expect(validate('27/04/2026', { type: 'date' })).toContain('$: expected YYYY-MM-DD');
  });
  it('uuid', () => {
    expect(validate('550e8400-e29b-41d4-a716-446655440000', { type: 'uuid' })).toEqual([]);
    expect(validate('not-a-uuid', { type: 'uuid' })).toContain('$: expected UUID');
  });
});

describe('nullable', () => {
  it('acepta null/undefined cuando nullable=true', () => {
    expect(validate(null, { type: 'string', nullable: true })).toEqual([]);
    expect(validate(undefined, { type: 'integer', nullable: true })).toEqual([]);
  });
  it('rechaza null/undefined sin nullable', () => {
    expect(validate(null, { type: 'string' })).toEqual(['$: required']);
    expect(validate(undefined, { type: 'integer' })).toEqual(['$: required']);
  });
});

describe('object', () => {
  it('valida required + properties', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer', min: 0 } },
      required: ['name'],
    };
    expect(validate({ name: 'Ana' }, schema)).toEqual([]);
    expect(validate({ age: 30 }, schema)).toContain('$.name: missing required');
    expect(validate({ name: 'Ana', age: -1 }, schema)).toContain('$.age: < min');
  });
  it('additionalProperties=false rechaza keys extra', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    };
    expect(validate({ a: 'x', b: 'y' }, schema)).toContain('$.b: additional property not allowed');
  });
  it('rechaza arrays como object', () => {
    expect(validate([], { type: 'object' })).toContain('$: expected object');
  });
});

describe('array', () => {
  it('valida items y bounds', () => {
    const schema = { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 3 };
    expect(validate([1, 2], schema)).toEqual([]);
    expect(validate([], schema)).toContain('$: too few items');
    expect(validate([1, 2, 3, 4], schema)).toContain('$: too many items');
    expect(validate([1, 'foo'], schema)).toContain('$[1]: expected integer');
  });
});

describe('oneOf', () => {
  it('match si al menos uno pasa', () => {
    const schema = { oneOf: [{ type: 'string' }, { type: 'integer' }] };
    expect(validate('hi', schema)).toEqual([]);
    expect(validate(5, schema)).toEqual([]);
    expect(validate(true, schema)).toContain('$: no oneOf alternative matched');
  });
});

describe('makeValidator', () => {
  it('retorna función reusable', () => {
    const v = makeValidator({ type: 'string', minLength: 3 });
    expect(v('hello')).toEqual([]);
    expect(v('a')).toContain('$: too short');
  });
});

describe('SCHEMAS predefinidos', () => {
  it('contractMetadata acepta shape conocido', () => {
    const v = makeValidator(SCHEMAS.contractMetadata);
    expect(v({
      kick_off_date: '2026-04-27',
      kicked_off_by: '550e8400-e29b-41d4-a716-446655440000',
      kick_off_seeded_count: 5,
      misc_field: 'permitido',
    })).toEqual([]);
  });
  it('contractMetadata rechaza tipos malos en keys conocidos', () => {
    const v = makeValidator(SCHEMAS.contractMetadata);
    const errs = v({ kick_off_date: '27/04/2026', kick_off_seeded_count: -1 });
    expect(errs.length).toBeGreaterThan(0);
  });
  it('userPreferences valida scheme/accentHue/density bounds', () => {
    const v = makeValidator(SCHEMAS.userPreferences);
    expect(v({ scheme: 'dark', accentHue: 200, density: 1 })).toEqual([]);
    const errs = v({ scheme: 'pink', accentHue: 999, density: 99 });
    expect(errs.length).toBeGreaterThan(0);
  });
  it('resourceRequestLanguageRequirements valida shape de items', () => {
    const v = makeValidator(SCHEMAS.resourceRequestLanguageRequirements);
    expect(v([{ language: 'en', level: 'advanced' }])).toEqual([]);
    expect(v([{ language: 'en' }])).toContain('$[0].level: missing required');
    expect(v([{ language: 'e', level: 'master' }]).length).toBeGreaterThan(0);
    expect(v(null)).toEqual([]); // nullable
  });
});
