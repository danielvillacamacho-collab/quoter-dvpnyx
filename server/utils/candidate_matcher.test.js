/**
 * Unit tests for the pure candidate matcher.
 *
 * We cover sub-scores individually plus the composite ranking so the
 * weights are documented by tests (tuning them later forces the tests
 * to change too — by design).
 */

const {
  rankCandidates,
  scoreLevel,
  scoreArea,
  scoreSkills,
  scoreAvailability,
  WEIGHTS,
} = require('./candidate_matcher');

const makeRequest = (over = {}) => ({
  id: 'rr1',
  role_title: 'Backend Senior',
  area_id: 1,
  level: 'L5',
  required_skills: [10, 20, 30],
  nice_to_have_skills: [40, 50],
  weekly_hours: 20,
  start_date: '2026-05-01',
  end_date:   '2026-07-01',
  ...over,
});

const makeEmp = (over = {}) => ({
  id: 'e1', first_name: 'Ana', last_name: 'García',
  area_id: 1, area_name: 'Desarrollo',
  level: 'L5', weekly_capacity_hours: 40, status: 'active',
  skill_ids: [10, 20, 30, 40],
  ...over,
});

describe('scoreLevel', () => {
  it('perfect when levels match', () => {
    const s = scoreLevel({ level: 'L5' }, { level: 'L5' });
    expect(s).toMatchObject({ status: 'perfect', fraction: 1 });
  });
  it('close when ±1', () => {
    expect(scoreLevel({ level: 'L5' }, { level: 'L4' }).status).toBe('close');
    expect(scoreLevel({ level: 'L5' }, { level: 'L6' }).status).toBe('close');
  });
  it('±1 scores half (15 / 30 per US-RR-2)', () => {
    expect(scoreLevel({ level: 'L5' }, { level: 'L4' }).fraction).toBe(0.5);
    expect(scoreLevel({ level: 'L5' }, { level: 'L6' }).fraction).toBe(0.5);
  });
  it('overqualified gap ≥ 2 scores 0', () => {
    const s = scoreLevel({ level: 'L3' }, { level: 'L6' });
    expect(s.status).toBe('overqualified');
    expect(s.detail.gap).toBe(3);
    expect(s.fraction).toBe(0);
  });
  it('underqualified gap ≤ -2 scores 0', () => {
    const s = scoreLevel({ level: 'L6' }, { level: 'L3' });
    expect(s.status).toBe('underqualified');
    expect(s.fraction).toBe(0);
  });
  it('extreme gap stays at 0', () => {
    const s = scoreLevel({ level: 'L11' }, { level: 'L1' });
    expect(s.fraction).toBe(0);
  });
});

describe('scoreArea', () => {
  it('match / mismatch', () => {
    expect(scoreArea({ area_id: 1 }, { area_id: 1 }).status).toBe('match');
    expect(scoreArea({ area_id: 1 }, { area_id: 2 }).fraction).toBe(0);
  });
});

describe('scoreSkills', () => {
  it('1.0 when no required skills', () => {
    expect(scoreSkills(null, [1,2]).fraction).toBe(1);
    expect(scoreSkills([],   [1,2]).fraction).toBe(1);
  });
  it('fraction = matched/required', () => {
    const s = scoreSkills([10, 20, 30], [10, 20, 99]);
    expect(s.matched).toEqual([10, 20]);
    expect(s.missing).toEqual([30]);
    expect(s.fraction).toBeCloseTo(2/3, 5);
  });
  it('dedupes required skills', () => {
    const s = scoreSkills([10, 10, 20], [10]);
    expect(s.detail.required).toBe(2);
    expect(s.fraction).toBeCloseTo(1/2, 5);
  });
});

describe('scoreAvailability', () => {
  const req = makeRequest({ weekly_hours: 20 });
  const emp = makeEmp({ weekly_capacity_hours: 40 });

  it('full when no overlapping commitments', () => {
    const s = scoreAvailability(req, emp, []);
    expect(s.status).toBe('full');
    expect(s.fraction).toBe(1);
    expect(s.detail.available_hours).toBe(40);
  });

  it('subtracts only overlapping, non-cancelled assignments', () => {
    const asgs = [
      { employee_id: 'e1', weekly_hours: 15, start_date: '2026-06-01', end_date: '2026-06-30', status: 'active' },
      { employee_id: 'e1', weekly_hours: 50, start_date: '2025-01-01', end_date: '2025-12-31', status: 'active' }, // no overlap
      { employee_id: 'e1', weekly_hours: 10, start_date: '2026-05-10', end_date: null, status: 'cancelled' },     // cancelled
      { employee_id: 'e2', weekly_hours: 30, start_date: '2026-05-01', end_date: '2026-07-01', status: 'active' }, // other emp
    ];
    const s = scoreAvailability(req, emp, asgs);
    expect(s.detail.committed_hours).toBe(15);
    expect(s.detail.available_hours).toBe(25);
    expect(s.status).toBe('full');
  });

  it('partial but ≥ 80% of requested still earns full 10pts', () => {
    // request wants 20h, emp has 17h free → 85% ≥ 80% → fraction 1
    const asgs = [{ employee_id: 'e1', weekly_hours: 23, start_date: '2026-05-01', end_date: '2026-07-01', status: 'active' }];
    const s = scoreAvailability(req, emp, asgs);
    expect(s.detail.available_hours).toBe(17);
    expect(s.status).toBe('partial');
    expect(s.fraction).toBe(1);
    expect(s.detail.available_ratio).toBeCloseTo(17/20, 5);
  });

  it('partial < 80% of requested → 0pts', () => {
    // 15h free vs 20h requested → 75% < 80% → fraction 0
    const asgs = [{ employee_id: 'e1', weekly_hours: 25, start_date: '2026-05-01', end_date: '2026-07-01', status: 'active' }];
    const s = scoreAvailability(req, emp, asgs);
    expect(s.detail.available_hours).toBe(15);
    expect(s.status).toBe('partial');
    expect(s.fraction).toBe(0);
  });

  it('none when saturated', () => {
    const asgs = [{ employee_id: 'e1', weekly_hours: 40, start_date: '2026-05-01', end_date: '2026-07-01', status: 'active' }];
    const s = scoreAvailability(req, emp, asgs);
    expect(s.status).toBe('none');
    expect(s.fraction).toBe(0);
  });
});

describe('rankCandidates', () => {
  it('scores perfect match at 100 (US-RR-2 weights)', () => {
    const out = rankCandidates(makeRequest(), [makeEmp()], []);
    expect(out).toHaveLength(1);
    // area=40 + level=30 + required=20 + availability=10 = 100.
    // nice_to_have is not weighted in US-RR-2 (kept as UI metadata only).
    expect(out[0].score).toBe(100);
    expect(out[0].reasons).toEqual(expect.arrayContaining([
      'Mismo área', 'Nivel L5 (exacto)', '3/3 skills requeridas', 'Disponible 40h/sem',
    ]));
  });

  it('penalizes candidates with no capacity so they land at the bottom', () => {
    // Two identical perfect matches; only e2 is saturated.
    const saturating = [
      { employee_id: 'e2', weekly_hours: 40, start_date: '2026-05-01', end_date: '2026-07-01', status: 'active' },
    ];
    const e1 = makeEmp({ id: 'e1', first_name: 'Ana' });
    const e2 = makeEmp({ id: 'e2', first_name: 'Ana' });
    const out = rankCandidates(makeRequest(), [e1, e2], saturating);
    expect(out.map((c) => c.employee_id)).toEqual(['e1', 'e2']);
    // e1 = 100. e2 = 100 − 40 (NO_CAPACITY_PENALTY) − 10 (avail=0) = 50.
    expect(out[0].score).toBe(100);
    expect(out[1].score).toBe(50);
  });

  it('orders candidates by score descending, ties by name', () => {
    const emp1 = makeEmp({ id: 'e1', first_name: 'Beto', skill_ids: [10] });           // 1/3 required
    const emp2 = makeEmp({ id: 'e2', first_name: 'Ana',  skill_ids: [10, 20, 30, 40] }); // perfect
    const out = rankCandidates(makeRequest(), [emp1, emp2], []);
    expect(out.map((c) => c.employee_id)).toEqual(['e2', 'e1']);
  });

  it('skips terminated employees', () => {
    const emp1 = makeEmp({ id: 'e1', status: 'terminated' });
    const out = rankCandidates(makeRequest(), [emp1], []);
    expect(out).toHaveLength(0);
  });

  it('honors limit and includeIneligible=false threshold', () => {
    const bad = makeEmp({ id: 'e-bad', area_id: 99, level: 'L1', skill_ids: [] });
    const good = makeEmp({ id: 'e-good' });
    const out = rankCandidates(makeRequest(), [bad, good], [], { includeIneligible: false });
    expect(out.map((c) => c.employee_id)).toEqual(['e-good']);
  });

  it('weights sum to 100', () => {
    const total = WEIGHTS.level + WEIGHTS.area + WEIGHTS.required + WEIGHTS.nice + WEIGHTS.availability;
    expect(total).toBe(100);
  });

  it('exposes structured match breakdown for the UI', () => {
    const [c] = rankCandidates(makeRequest(), [makeEmp()], []);
    expect(c.match.area.status).toBe('match');
    expect(c.match.required_skills).toMatchObject({ matched: 3, required: 3 });
    expect(c.match.nice_skills).toMatchObject({ matched: 1, nice_to_have: 2 });
    expect(c.match.availability.has_full_capacity).toBe(true);
  });
});
