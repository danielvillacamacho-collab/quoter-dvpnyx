const {
  parseDateUTC, formatDateUTC, mondayOf, isoWeekNumber,
  buildWeekWindows, rangesOverlap, weekRangeForAssignment,
  utilizationBucket, computeWeeklyForEmployee, colorFor, aggregateMeta,
  computeAlerts,
  CONTRACT_COLORS,
} = require('./capacity_planner');

describe('capacity_planner — date helpers', () => {
  it('parses YYYY-MM-DD at UTC midnight', () => {
    const d = parseDateUTC('2026-04-20');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(3);
    expect(d.getUTCDate()).toBe(20);
    expect(d.getUTCHours()).toBe(0);
  });

  it('rejects malformed or non-calendar dates', () => {
    expect(parseDateUTC('nope')).toBeNull();
    expect(parseDateUTC('2026-02-31')).toBeNull(); // not a real date
    expect(parseDateUTC(null)).toBeNull();
  });

  it('mondayOf snaps any weekday to its Monday', () => {
    expect(formatDateUTC(mondayOf(parseDateUTC('2026-04-20')))).toBe('2026-04-20'); // Mon
    expect(formatDateUTC(mondayOf(parseDateUTC('2026-04-24')))).toBe('2026-04-20'); // Fri
    expect(formatDateUTC(mondayOf(parseDateUTC('2026-04-26')))).toBe('2026-04-20'); // Sun
    expect(formatDateUTC(mondayOf(parseDateUTC('2026-04-27')))).toBe('2026-04-27'); // Mon next
  });

  it('isoWeekNumber matches ISO-8601', () => {
    expect(isoWeekNumber(parseDateUTC('2026-04-20'))).toBe(17);
    expect(isoWeekNumber(parseDateUTC('2026-01-01'))).toBe(1);   // Thu → W1
    expect(isoWeekNumber(parseDateUTC('2026-12-28'))).toBe(53);  // W53 of 2026
  });
});

describe('buildWeekWindows', () => {
  it('emits 12 consecutive weeks starting from the week\'s Monday', () => {
    const ws = buildWeekWindows('2026-04-22', 12); // a Wednesday
    expect(ws).toHaveLength(12);
    expect(ws[0]).toMatchObject({ index: 0, start_date: '2026-04-20', end_date: '2026-04-26', iso_week: 17 });
    expect(ws[0].label).toBe('S17');
    expect(ws[1].start_date).toBe('2026-04-27');
    expect(ws[11].start_date).toBe('2026-07-06');
  });

  it('clamps weeks to [1, 26]', () => {
    expect(buildWeekWindows('2026-04-20', 0)).toHaveLength(1);
    expect(buildWeekWindows('2026-04-20', 100)).toHaveLength(26);
    expect(buildWeekWindows('2026-04-20', -5)).toHaveLength(1);
  });

  it('throws on invalid startDate', () => {
    expect(() => buildWeekWindows('nope', 4)).toThrow();
  });
});

describe('rangesOverlap', () => {
  it('detects overlap, touching, and no-overlap cases', () => {
    expect(rangesOverlap('2026-04-20', '2026-04-26', '2026-04-22', '2026-04-24')).toBe(true); // contained
    expect(rangesOverlap('2026-04-20', '2026-04-26', '2026-04-26', '2026-04-30')).toBe(true); // touching tail
    expect(rangesOverlap('2026-04-20', '2026-04-26', '2026-04-27', '2026-05-03')).toBe(false); // after
    expect(rangesOverlap('2026-04-20', '2026-04-26', '2026-04-10', '2026-04-19')).toBe(false); // before
  });

  it('treats null end_date as open-ended (infinity)', () => {
    expect(rangesOverlap('2026-04-20', null, '2030-01-01', '2030-01-07')).toBe(true);
    expect(rangesOverlap('2030-01-01', null, '2026-04-20', '2026-04-26')).toBe(false); // starts later
  });
});

describe('weekRangeForAssignment', () => {
  const windows = buildWeekWindows('2026-04-20', 12);

  it('returns [first, last] indexes for a multi-week assignment', () => {
    expect(weekRangeForAssignment('2026-05-04', '2026-05-17', windows)).toEqual([2, 3]);
  });

  it('returns null when the assignment is fully outside the viewport', () => {
    expect(weekRangeForAssignment('2027-01-01', '2027-02-01', windows)).toBeNull();
  });

  it('open-ended assignment runs to the last window', () => {
    expect(weekRangeForAssignment('2026-06-01', null, windows)).toEqual([6, 11]);
  });
});

describe('utilizationBucket', () => {
  it('classifies correctly', () => {
    expect(utilizationBucket(0)).toBe('idle');
    expect(utilizationBucket(50)).toBe('light');
    expect(utilizationBucket(90)).toBe('healthy');
    expect(utilizationBucket(120)).toBe('overbooked');
  });
});

describe('computeWeeklyForEmployee', () => {
  const windows = buildWeekWindows('2026-04-20', 4);
  const emp = { id: 'e1', weekly_capacity_hours: 40 };

  it('sums overlapping assignments per week and sets bucket', () => {
    const weekly = computeWeeklyForEmployee(emp, [
      { id: 'a1', weekly_hours: 20, start_date: '2026-04-20', end_date: '2026-05-03', status: 'active' },
      { id: 'a2', weekly_hours: 25, start_date: '2026-04-27', end_date: '2026-04-27', status: 'planned' }, // single day in W18
    ], windows);
    expect(weekly).toHaveLength(4);
    expect(weekly[0]).toMatchObject({ week_index: 0, hours: 20, utilization_pct: 50, bucket: 'light' });
    expect(weekly[1]).toMatchObject({ week_index: 1, hours: 45, utilization_pct: expect.any(Number), bucket: 'overbooked' });
    expect(weekly[1].utilization_pct).toBeCloseTo(112.5, 1);
    expect(weekly[2]).toMatchObject({ hours: 0, bucket: 'idle' });
  });

  it('ignores cancelled assignments', () => {
    const weekly = computeWeeklyForEmployee(emp, [
      { weekly_hours: 40, start_date: '2026-04-20', end_date: '2026-05-17', status: 'cancelled' },
    ], windows);
    for (const w of weekly) expect(w.hours).toBe(0);
  });

  it('zero capacity → utilization 0 but hours still aggregated', () => {
    const weekly = computeWeeklyForEmployee({ weekly_capacity_hours: 0 }, [
      { weekly_hours: 10, start_date: '2026-04-20', end_date: '2026-04-26', status: 'active' },
    ], windows);
    expect(weekly[0].hours).toBe(10);
    expect(weekly[0].utilization_pct).toBe(0);
  });
});

describe('colorFor', () => {
  it('returns a palette color deterministically per contractId', () => {
    const a1 = colorFor('contract-abc');
    const a2 = colorFor('contract-abc');
    expect(a1).toBe(a2);
    expect(CONTRACT_COLORS).toContain(a1);
  });

  it('different contracts can share colors (collisions ok), but same input is stable', () => {
    const c1 = colorFor('c1');
    const c2 = colorFor('c2');
    expect(CONTRACT_COLORS).toContain(c1);
    expect(CONTRACT_COLORS).toContain(c2);
  });
});

describe('aggregateMeta', () => {
  const windows = buildWeekWindows('2026-04-20', 4);
  const emp = (id, weekly) => ({ id, weekly });
  it('computes the 4 header numbers', () => {
    const employees = [
      emp('e1', computeWeeklyForEmployee({ weekly_capacity_hours: 40 }, [
        { weekly_hours: 40, start_date: '2026-04-20', end_date: '2026-05-17', status: 'active' },
      ], windows)),
      emp('e2', computeWeeklyForEmployee({ weekly_capacity_hours: 40 }, [
        { weekly_hours: 50, start_date: '2026-04-20', end_date: '2026-04-26', status: 'planned' }, // overbooked W17
      ], windows)),
      emp('e3', computeWeeklyForEmployee({ weekly_capacity_hours: 40 }, [], windows)),
    ];
    const meta = aggregateMeta(employees, [{ id: 'r1' }, { id: 'r2' }]);
    expect(meta.total_employees).toBe(3);
    expect(meta.active_employees).toBe(2);
    expect(meta.overbooked_count).toBe(1);      // only e2 tips over
    expect(meta.open_request_count).toBe(2);
    expect(meta.avg_utilization_pct).toBeGreaterThan(0);
  });
});

describe('computeAlerts (US-PLN-6)', () => {
  const windows = buildWeekWindows('2026-04-20', 4); // S17..S20

  it('returns [] when everything is healthy', () => {
    const employees = [
      {
        id: 'e1', full_name: 'Ana García', level: 'L5',
        assignments: [],
        weekly: windows.map((_, i) => ({ week_index: i, hours: 0, utilization_pct: 0, bucket: 'idle' })),
      },
    ];
    expect(computeAlerts(employees, [], windows)).toEqual([]);
  });

  it('collapses contiguous overbooked weeks into a single alert with Sx-Sy range', () => {
    const employees = [
      {
        id: 'e1', full_name: 'Ana García', level: 'L5', assignments: [],
        weekly: [
          { week_index: 0, hours: 50, utilization_pct: 125, bucket: 'overbooked' },
          { week_index: 1, hours: 50, utilization_pct: 130, bucket: 'overbooked' },
          { week_index: 2, hours: 20, utilization_pct: 50,  bucket: 'light' },
          { week_index: 3, hours: 45, utilization_pct: 112, bucket: 'overbooked' },
        ],
      },
    ];
    const alerts = computeAlerts(employees, [], windows);
    const over = alerts.filter((a) => a.type === 'overbooked');
    expect(over).toHaveLength(1);
    expect(over[0].severity).toBe('red');
    expect(over[0].employee_id).toBe('e1');
    expect(over[0].week_indices).toEqual([0, 1, 3]);
    expect(over[0].peak_pct).toBe(130);
    // Sx-Sy with gaps uses comma
    expect(over[0].message).toMatch(/S17-S18, S20/);
  });

  it('flags level mismatches: red when gap >= 2, amber when gap === 1', () => {
    const employees = [
      {
        id: 'eRed', full_name: 'Pedro Z', level: 'L3',
        assignments: [{ id: 'a1', resource_request_id: 'rr1', role_title: 'Lead',
                        request_level: 'L6' }],
        weekly: windows.map((_, i) => ({ week_index: i, hours: 0, utilization_pct: 0, bucket: 'idle' })),
      },
      {
        id: 'eAmber', full_name: 'Lía M', level: 'L4',
        assignments: [{ id: 'a2', resource_request_id: 'rr2', role_title: 'QA',
                        request_level: 'L5' }],
        weekly: windows.map((_, i) => ({ week_index: i, hours: 0, utilization_pct: 0, bucket: 'idle' })),
      },
      {
        id: 'eOK', full_name: 'Sam N', level: 'L6',
        assignments: [{ id: 'a3', resource_request_id: 'rr3', role_title: 'Sr',
                        request_level: 'L5' }], // overqualified -> no alert
        weekly: windows.map((_, i) => ({ week_index: i, hours: 0, utilization_pct: 0, bucket: 'idle' })),
      },
    ];
    const mm = computeAlerts(employees, [], windows).filter((a) => a.type === 'level_mismatch');
    expect(mm).toHaveLength(2);
    const red = mm.find((a) => a.employee_id === 'eRed');
    const amber = mm.find((a) => a.employee_id === 'eAmber');
    expect(red.severity).toBe('red');
    expect(red.gap).toBe(3);
    expect(amber.severity).toBe('amber');
    expect(amber.gap).toBe(1);
  });

  it('emits an amber open_request alert per uncovered request (skips fully filled)', () => {
    const openRequests = [
      { id: 'rr9', client_name: 'Acme', contract_name: 'Alpha',
        role_title: 'Backend', level: 'L5', missing: 2, week_range: [1, 3] },
      { id: 'rr10', client_name: 'Initech', contract_name: 'Beta',
        role_title: 'QA', level: 'L4', missing: 0, week_range: [0, 2] }, // filled
    ];
    const alerts = computeAlerts([], openRequests, windows).filter((a) => a.type === 'open_request');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('amber');
    expect(alerts[0].request_id).toBe('rr9');
    expect(alerts[0].message).toMatch(/S18/); // week_range[0] = 1 -> S18
    expect(alerts[0].message).toMatch(/2 vacantes/);
  });

  it('sorts red alerts before amber, then by type', () => {
    const employees = [
      {
        id: 'e1', full_name: 'Over', level: 'L5',
        assignments: [{ id: 'a1', resource_request_id: 'rr1', role_title: 'X', request_level: 'L6' }], // amber lvl
        weekly: [
          { week_index: 0, hours: 50, utilization_pct: 125, bucket: 'overbooked' },
          ...windows.slice(1).map((_, i) => ({ week_index: i + 1, hours: 0, utilization_pct: 0, bucket: 'idle' })),
        ],
      },
    ];
    const openRequests = [
      { id: 'rr9', client_name: 'X', contract_name: 'Y', role_title: 'R', level: 'L5', missing: 1, week_range: [0, 1] },
    ];
    const alerts = computeAlerts(employees, openRequests, windows);
    // red overbooked first, then amber level_mismatch, then amber open_request
    expect(alerts.map((a) => [a.severity, a.type])).toEqual([
      ['red', 'overbooked'],
      ['amber', 'level_mismatch'],
      ['amber', 'open_request'],
    ]);
  });
});
