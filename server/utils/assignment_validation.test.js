/**
 * Unit tests for the pure assignment validation engine.
 * No mocks, no DB, no fixtures beyond literals — the engine is pure so
 * these tests run in a few milliseconds and are the canonical contract
 * for downstream consumers (route, UI modal, AI recommender).
 */

const {
  CHECK_KEYS,
  STATUS,
  levelToNum,
  checkArea,
  checkLevel,
  checkCapacity,
  checkDates,
  runAllChecks,
} = require('./assignment_validation');

describe('levelToNum', () => {
  it.each([
    ['L1', 1], ['L5', 5], ['L11', 11], ['l7', 7], ['  L3 ', 3],
    [1, 1], [11, 11], [5.9, 5],
  ])('%j → %i', (input, expected) => {
    expect(levelToNum(input)).toBe(expected);
  });

  it.each([
    [null], [undefined], [''], ['L'], ['L0'], ['L12'],
    ['X3'], ['3'], [0], [12], [-1], [{}], [[]],
  ])('%j → null', (input) => {
    expect(levelToNum(input)).toBeNull();
  });
});

describe('checkArea', () => {
  const desarrollo = { id: 1, name: 'Desarrollo' };
  const testing    = { id: 2, name: 'Testing' };

  it('passes when areas match by id', () => {
    const r = checkArea({ employeeArea: desarrollo, requestArea: desarrollo });
    expect(r.check).toBe(CHECK_KEYS.AREA);
    expect(r.status).toBe(STATUS.PASS);
    expect(r.detail.employee_area_id).toBe(1);
  });

  it('fails (overridable) when areas differ', () => {
    const r = checkArea({ employeeArea: testing, requestArea: desarrollo });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.overridable).toBe(true);
    expect(r.message).toMatch(/Testing/);
    expect(r.message).toMatch(/Desarrollo/);
  });

  it('warns when the employee has no area', () => {
    const r = checkArea({ employeeArea: null, requestArea: desarrollo });
    expect(r.status).toBe(STATUS.WARN);
    expect(r.overridable).toBe(true);
  });

  it('warns when the request has no area', () => {
    const r = checkArea({ employeeArea: desarrollo, requestArea: null });
    expect(r.status).toBe(STATUS.WARN);
  });

  it('matches numeric ids regardless of string/number type', () => {
    const r = checkArea({
      employeeArea: { id: '7', name: 'Data' },
      requestArea:  { id: 7,   name: 'Data' },
    });
    expect(r.status).toBe(STATUS.PASS);
  });
});

describe('checkLevel', () => {
  it('passes at exact match', () => {
    const r = checkLevel({ employeeLevel: 'L5', requestLevel: 'L5' });
    expect(r.status).toBe(STATUS.PASS);
    expect(r.detail).toEqual({ requested: 5, actual: 5, gap: 0 });
  });

  it('returns info when overqualified', () => {
    const r = checkLevel({ employeeLevel: 'L7', requestLevel: 'L5' });
    expect(r.status).toBe(STATUS.INFO);
    expect(r.detail.gap).toBe(2);
    expect(r.message).toMatch(/Sobre-calificado/);
  });

  it('warns at exactly one level below', () => {
    const r = checkLevel({ employeeLevel: 'L4', requestLevel: 'L5' });
    expect(r.status).toBe(STATUS.WARN);
    expect(r.detail.gap).toBe(-1);
    expect(r.overridable).toBeUndefined();
  });

  it('fails overridably at two or more levels below', () => {
    const r = checkLevel({ employeeLevel: 'L3', requestLevel: 'L5' });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.overridable).toBe(true);
    expect(r.detail.gap).toBe(-2);
    expect(r.message).toMatch(/Gap de 2/);
  });

  it('fails overridably at large gaps', () => {
    const r = checkLevel({ employeeLevel: 'L1', requestLevel: 'L10' });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail.gap).toBe(-9);
  });

  it.each([
    [null, 'L5'],
    ['L5', null],
    ['foo', 'L5'],
    ['L5', 'L0'],
  ])('warns (overridable) when level is invalid: emp=%j req=%j', (emp, req) => {
    const r = checkLevel({ employeeLevel: emp, requestLevel: req });
    expect(r.status).toBe(STATUS.WARN);
    expect(r.overridable).toBe(true);
  });

  it('accepts numeric levels too', () => {
    const r = checkLevel({ employeeLevel: 6, requestLevel: 5 });
    expect(r.status).toBe(STATUS.INFO);
    expect(r.detail).toEqual({ requested: 5, actual: 6, gap: 1 });
  });
});

describe('checkCapacity', () => {
  it('passes when available covers the request', () => {
    const r = checkCapacity({ weeklyCapacity: 40, committedHours: 10, requestedHours: 20 });
    expect(r.status).toBe(STATUS.PASS);
    expect(r.detail).toMatchObject({ capacity: 40, committed: 10, requested: 20, available: 30 });
    expect(r.detail.utilization_after_pct).toBe(75);
  });

  it('warns (overridable) when capacity is partial', () => {
    const r = checkCapacity({ weeklyCapacity: 40, committedHours: 30, requestedHours: 20 });
    expect(r.status).toBe(STATUS.WARN);
    expect(r.overridable).toBe(true);
    expect(r.detail.available).toBe(10);
  });

  it('fails (overridable) at zero or negative available', () => {
    const r = checkCapacity({ weeklyCapacity: 40, committedHours: 40, requestedHours: 8 });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.overridable).toBe(true);
    expect(r.detail.utilization_after_pct).toBe(120);
  });

  it('reports utilization over 100% correctly', () => {
    const r = checkCapacity({ weeklyCapacity: 40, committedHours: 50, requestedHours: 10 });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail.utilization_after_pct).toBe(150);
  });

  it('warns when capacity is missing or zero', () => {
    const r = checkCapacity({ weeklyCapacity: 0, committedHours: 0, requestedHours: 10 });
    expect(r.status).toBe(STATUS.WARN);
    expect(r.overridable).toBe(true);
  });

  it('handles string-typed numeric inputs (pg returns NUMERIC as strings)', () => {
    const r = checkCapacity({ weeklyCapacity: '40.00', committedHours: '12.50', requestedHours: '20' });
    expect(r.status).toBe(STATUS.PASS);
    expect(r.detail.available).toBe(27.5);
  });
});

describe('checkDates', () => {
  it('passes when assignment is fully contained in request window', () => {
    const r = checkDates({
      assignmentStart: '2026-05-01', assignmentEnd: '2026-06-30',
      requestStart:    '2026-04-01', requestEnd:    '2026-12-31',
    });
    expect(r.status).toBe(STATUS.PASS);
  });

  it('passes when request has no end_date (open-ended) and assignment fits', () => {
    const r = checkDates({
      assignmentStart: '2026-05-01', assignmentEnd: '2026-06-30',
      requestStart:    '2026-04-01', requestEnd:    null,
    });
    expect(r.status).toBe(STATUS.PASS);
  });

  it('warns on partial overlap (assignment starts before request)', () => {
    const r = checkDates({
      assignmentStart: '2026-03-01', assignmentEnd: '2026-05-15',
      requestStart:    '2026-04-01', requestEnd:    '2026-12-31',
    });
    expect(r.status).toBe(STATUS.WARN);
    expect(r.overridable).toBe(true);
  });

  it('fails (non-overridable) when there is no overlap at all', () => {
    const r = checkDates({
      assignmentStart: '2025-01-01', assignmentEnd: '2025-12-31',
      requestStart:    '2026-01-01', requestEnd:    '2026-12-31',
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.overridable).toBe(false);
  });

  it('fails (non-overridable) on inverted dates', () => {
    const r = checkDates({
      assignmentStart: '2026-06-01', assignmentEnd: '2026-01-01',
      requestStart:    '2026-01-01', requestEnd:    '2026-12-31',
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.overridable).toBe(false);
    expect(r.message).toMatch(/anterior/);
  });

  it('fails (non-overridable) on unparseable assignment start', () => {
    const r = checkDates({
      assignmentStart: 'not-a-date', requestStart: '2026-01-01',
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.overridable).toBe(false);
  });

  it('warns (overridable) when request has no start_date', () => {
    const r = checkDates({
      assignmentStart: '2026-05-01',
      requestStart:    null,
    });
    expect(r.status).toBe(STATUS.WARN);
    expect(r.overridable).toBe(true);
  });

  it('passes when the overlap edges touch by a single day', () => {
    const r = checkDates({
      assignmentStart: '2026-04-30', assignmentEnd: '2026-04-30',
      requestStart:    '2026-04-30', requestEnd:    '2026-04-30',
    });
    expect(r.status).toBe(STATUS.PASS);
  });
});

describe('runAllChecks aggregator', () => {
  const happyEmployee = {
    area_id: 1, area_name: 'Desarrollo',
    level: 'L5', weekly_capacity_hours: 40, committed_hours: 0,
  };
  const happyRequest = {
    area_id: 1, area_name: 'Desarrollo',
    level: 'L5', start_date: '2026-04-01', end_date: '2026-12-31',
  };
  const happyProposed = { weekly_hours: 40, start_date: '2026-04-15', end_date: '2026-10-15' };

  it('returns valid when everything passes', () => {
    const r = runAllChecks({ employee: happyEmployee, request: happyRequest, proposed: happyProposed });
    expect(r.valid).toBe(true);
    expect(r.can_override).toBe(false);
    expect(r.requires_justification).toBe(false);
    expect(r.summary.pass).toBe(4);
    expect(r.summary.fail).toBe(0);
    expect(r.checks).toHaveLength(4);
    expect(r.checks.map((c) => c.check).sort())
      .toEqual([CHECK_KEYS.AREA, CHECK_KEYS.CAPACITY, CHECK_KEYS.DATES, CHECK_KEYS.LEVEL].sort());
  });

  it('flags overridable when only overridable fails are present', () => {
    const r = runAllChecks({
      employee: { ...happyEmployee, area_id: 2, area_name: 'Testing' },
      request: happyRequest, proposed: happyProposed,
    });
    expect(r.valid).toBe(false);
    expect(r.can_override).toBe(true);
    expect(r.requires_justification).toBe(true);
    expect(r.summary.overridable_fails).toBe(1);
    expect(r.summary.non_overridable_fails).toBe(0);
  });

  it('is not overridable when any check is a non-overridable fail', () => {
    const r = runAllChecks({
      employee: happyEmployee,
      request: happyRequest,
      // Assignment window entirely before request window → non-overridable
      proposed: { ...happyProposed, start_date: '2025-01-01', end_date: '2025-12-31' },
    });
    expect(r.valid).toBe(false);
    expect(r.can_override).toBe(false);
    expect(r.summary.non_overridable_fails).toBeGreaterThanOrEqual(1);
  });

  it('combines warn + info (not fail) as still valid', () => {
    const r = runAllChecks({
      employee: { ...happyEmployee, level: 'L7' },                    // overqualified → info
      request: happyRequest,
      proposed: { ...happyProposed, weekly_hours: 35 },               // partial? no, still within capacity
    });
    expect(r.valid).toBe(true);
    expect(r.summary.info).toBe(1);
    expect(r.summary.fail).toBe(0);
  });

  it('is defensive against missing sub-objects', () => {
    const r = runAllChecks({});
    expect(r.checks).toHaveLength(4);
    // With no request/employee data, everything degrades to warn or fail — engine must not throw
    expect(Array.isArray(r.checks)).toBe(true);
  });
});
