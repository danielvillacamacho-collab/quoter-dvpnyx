const {
  calculateIdleTime,
  deriveHourlyRateUsd,
  parsePeriod,
  periodStart,
  periodEnd,
  workdaysOfPeriod,
  intersectRange,
  inRange,
} = require('./idle_time_engine');

/* ================================================================== */
/* Calendario                                                          */
/* ================================================================== */

describe('parsePeriod', () => {
  it('acepta YYYY-MM', () => expect(parsePeriod('2026-04')).toEqual({ year: 2026, month: 4 }));
  it('acepta YYYYMM',  () => expect(parsePeriod('202604')).toEqual({ year: 2026, month: 4 }));
  it('rechaza basura', () => {
    expect(parsePeriod('foo')).toBeNull();
    expect(parsePeriod('2026-13')).toBeNull();
    expect(parsePeriod('2026-00')).toBeNull();
    expect(parsePeriod('1999-01')).toBeNull();
    expect(parsePeriod(null)).toBeNull();
  });
});

describe('periodStart / periodEnd', () => {
  it('Abril 2026', () => {
    expect(periodStart('2026-04')).toBe('2026-04-01');
    expect(periodEnd('2026-04')).toBe('2026-04-30');
  });
  it('Febrero bisiesto 2028', () => {
    expect(periodEnd('2028-02')).toBe('2028-02-29');
  });
  it('Diciembre', () => {
    expect(periodEnd('2026-12')).toBe('2026-12-31');
  });
});

describe('workdaysOfPeriod', () => {
  it('cuenta lunes-viernes de Abril 2026 (22 días hábiles)', () => {
    expect(workdaysOfPeriod('2026-04').length).toBe(22);
  });
  it('respeta límite from', () => {
    const days = workdaysOfPeriod('2026-04', { from: '2026-04-15' });
    expect(days[0]).toBe('2026-04-15');
    expect(days.length).toBe(12); // 15-30 abril, sin sáb/dom
  });
  it('respeta límite to', () => {
    const days = workdaysOfPeriod('2026-04', { to: '2026-04-15' });
    expect(days[days.length - 1]).toBe('2026-04-15');
  });
});

describe('intersectRange', () => {
  it('overlap normal', () => expect(intersectRange('2026-01-01','2026-12-31','2026-04-01','2026-06-30')).toEqual(['2026-04-01','2026-06-30']));
  it('a contiene b', () => expect(intersectRange('2026-01-01','2026-12-31','2026-04-15','2026-04-20')).toEqual(['2026-04-15','2026-04-20']));
  it('disjuntos', () => expect(intersectRange('2026-01-01','2026-02-28','2026-04-01','2026-04-30')).toBeNull());
  it('null end_date = infinito', () => expect(intersectRange('2026-04-01', null,'2026-05-01','2026-05-15')).toEqual(['2026-05-01','2026-05-15']));
});

describe('inRange', () => {
  it('inclusivo', () => expect(inRange('2026-04-15','2026-04-01','2026-04-30')).toBe(true));
  it('end null = infinito', () => expect(inRange('9999-01-01','2026-04-01', null)).toBe(true));
  it('antes', () => expect(inRange('2026-03-31','2026-04-01','2026-04-30')).toBe(false));
});

/* ================================================================== */
/* deriveHourlyRateUsd                                                 */
/* ================================================================== */

describe('deriveHourlyRateUsd', () => {
  it('40h/sem y costo $7800/mes ≈ $45/h', () => {
    // 40 × 52 / 12 = 173.333... horas/mes; 7800 / 173.33 ≈ 45
    expect(deriveHourlyRateUsd({ cost_usd: 7800, weekly_capacity_hours: 40 })).toBeCloseTo(45, 1);
  });
  it('null si cost faltante', () => {
    expect(deriveHourlyRateUsd({ cost_usd: null, weekly_capacity_hours: 40 })).toBeNull();
  });
  it('null si weekly_capacity_hours = 0', () => {
    expect(deriveHourlyRateUsd({ cost_usd: 5000, weekly_capacity_hours: 0 })).toBeNull();
  });
  it('null si negativo', () => {
    expect(deriveHourlyRateUsd({ cost_usd: -100, weekly_capacity_hours: 40 })).toBeNull();
  });
});

/* ================================================================== */
/* calculateIdleTime — escenarios canónicos                            */
/* ================================================================== */

const EMP_CO_FT = {
  id: 'emp-1',
  weekly_capacity_hours: 40,
  hire_date: '2020-01-01',
  end_date: null,
  country_id: 'CO',
};

const COUNTRY_CO = { id: 'CO', standard_workday_hours: 8 };

describe('calculateIdleTime — escenario base spec §17.1 (Diego Males abril 2026)', () => {
  it('reproduce el ejemplo de la spec exactamente', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [
        { holiday_date: '2026-04-02', label: 'Jueves Santo' },
        { holiday_date: '2026-04-03', label: 'Viernes Santo' },
      ],
      novelties: [],
      contractAssignments: [
        // 75% de 40h = 30h/sem, todo el mes
        { start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 30 },
      ],
      internalAssignments: [
        // 15% de 40h = 6h/sem, todo el mes
        { start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 6 },
      ],
      hourly_rate_usd: 45,
    });
    expect(out.total_capacity_hours).toBe(176);
    expect(out.holiday_hours).toBe(16);
    expect(out.novelty_hours).toBe(0);
    expect(out.available_hours).toBe(160);
    // 20 días hábiles × 30/5 = 120
    expect(out.assigned_hours_contract).toBe(120);
    // 20 días hábiles × 6/5 = 24
    expect(out.assigned_hours_internal).toBe(24);
    expect(out.assigned_hours_total).toBe(144);
    expect(out.idle_hours).toBe(16);
    expect(out.idle_pct).toBeCloseTo(0.10, 4);
    expect(out.hourly_rate_usd_at_calc).toBe(45);
    expect(out.idle_cost_usd).toBe(720);
    expect(out.breakdown.flags.missing_rate).toBeFalsy();
  });
});

describe('calculateIdleTime — edge cases', () => {
  it('mes en vacaciones full → available = 0, idle_pct = 0', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [
        { start_date: '2026-04-01', end_date: '2026-04-30', novelty_type_id: 'vacation', counts_in_capacity: false, status: 'approved' },
      ],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.available_hours).toBe(0);
    expect(out.idle_pct).toBe(0);
    expect(out.idle_cost_usd).toBe(0);
  });

  it('festivo en sábado → ignorado (no era día hábil)', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-05',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [{ holiday_date: '2026-05-02', label: 'Sábado festivo' }], // sábado
      novelties: [],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.holiday_hours).toBe(0);
  });

  it('corporate_training cuenta como assigned_internal y NO resta', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [
        { holiday_date: '2026-04-02', label: 'Jueves Santo' },
        { holiday_date: '2026-04-03', label: 'Viernes Santo' },
      ],
      novelties: [
        // 5 días hábiles de training (lun-vie 13-17 abril)
        { start_date: '2026-04-13', end_date: '2026-04-17', novelty_type_id: 'corporate_training', counts_in_capacity: true, status: 'approved' },
      ],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    // novelty_hours debe ser 0 (counts_in_capacity)
    expect(out.novelty_hours).toBe(0);
    expect(out.available_hours).toBe(160);
    expect(out.assigned_hours_internal).toBe(40); // 5 días × 8h
  });

  it('sobre-asignación → idle_hours = 0 + flag over_allocation', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [
        { start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 60 }, // 150% capacity
      ],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.idle_hours).toBe(0);
    expect(out.breakdown.flags.over_allocation).toBe(true);
    expect(out.breakdown.flags.over_allocation_hours).toBeGreaterThan(0);
  });

  it('tarifa horaria ausente → idle_cost_usd = 0 + flag missing_rate', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: null,
    });
    expect(out.idle_cost_usd).toBe(0);
    expect(out.breakdown.flags.missing_rate).toBe(true);
    expect(out.hourly_rate_usd_at_calc).toBeNull();
  });

  it('empleado contratado mid-mes → capacidad proporcional', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: { ...EMP_CO_FT, hire_date: '2026-04-15' },
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    // Días hábiles del 15 al 30 de abril = 12 días × 8h = 96h
    expect(out.total_capacity_hours).toBe(96);
    expect(out.breakdown.flags.partial_hire).toBe(true);
  });

  it('empleado dado de baja mid-mes → capacidad hasta end_date', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: { ...EMP_CO_FT, end_date: '2026-04-15' },
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    // 1-15 abril, días hábiles = 11 (1,2,3,6,7,8,9,10,13,14,15)
    expect(out.total_capacity_hours).toBe(88);
    expect(out.breakdown.flags.partial_termination).toBe(true);
  });

  it('empleado sin actividad en el mes → snapshot zero', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: { ...EMP_CO_FT, end_date: '2026-03-31' },
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.total_capacity_hours).toBe(0);
    expect(out.idle_hours).toBe(0);
    expect(out.breakdown.flags.not_active).toBe(true);
  });

  it('asignación parcial dentro del mes → solo días cubiertos', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [
        // Solo 6-17 abril (10 días hábiles)
        { start_date: '2026-04-06', end_date: '2026-04-17', weekly_hours: 40 },
      ],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    // 10 días × (40/5) = 80h
    expect(out.assigned_hours_contract).toBe(80);
  });

  it('asignación con end_date null = abierta hacia adelante', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [
        { start_date: '2026-04-01', end_date: null, weekly_hours: 40 },
      ],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.assigned_hours_contract).toBe(176); // 22 días × 8h
  });

  it('novedad parcial dentro del mes → solo días hábiles cubiertos', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [
        // 6-10 abril = 5 días hábiles
        { start_date: '2026-04-06', end_date: '2026-04-10', novelty_type_id: 'vacation', counts_in_capacity: false, status: 'approved' },
      ],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.novelty_hours).toBe(40);
    expect(out.available_hours).toBe(176 - 40);
  });

  it('novedad cancelled → ignorada', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [
        { start_date: '2026-04-01', end_date: '2026-04-30', novelty_type_id: 'vacation', counts_in_capacity: false, status: 'cancelled' },
      ],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.novelty_hours).toBe(0);
  });

  it('asignación durante festivo NO suma horas', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [
        { holiday_date: '2026-04-02', label: 'Jueves Santo' },
        { holiday_date: '2026-04-03', label: 'Viernes Santo' },
      ],
      novelties: [],
      contractAssignments: [
        { start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 40 },
      ],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    // 20 días hábiles × 8 = 160h asignadas (no 176)
    expect(out.assigned_hours_contract).toBe(160);
    // 160h available, 160h asignadas → 0 idle
    expect(out.idle_hours).toBe(0);
  });

  it('asignación durante novedad NO suma horas', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [
        { start_date: '2026-04-13', end_date: '2026-04-17', novelty_type_id: 'vacation', counts_in_capacity: false, status: 'approved' },
      ],
      contractAssignments: [
        { start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 40 },
      ],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    // 22 días hábiles - 5 días vacación = 17 × 8 = 136
    expect(out.assigned_hours_contract).toBe(136);
    // 176 - 0 holidays - 40 vacación = 136 available
    expect(out.available_hours).toBe(136);
    expect(out.idle_hours).toBe(0);
  });

  it('breakdown contiene detalle de holidays, novelties, assignments', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [{ holiday_date: '2026-04-02', label: 'Jueves Santo' }],
      novelties: [{ start_date: '2026-04-13', end_date: '2026-04-17', novelty_type_id: 'vacation', counts_in_capacity: false, status: 'approved' }],
      contractAssignments: [{ start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 30 }],
      internalAssignments: [{ start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 6 }],
      hourly_rate_usd: 45,
    });
    expect(out.breakdown.holidays_used).toHaveLength(1);
    expect(out.breakdown.holidays_used[0]).toMatchObject({ date: '2026-04-02', label: 'Jueves Santo' });
    expect(out.breakdown.novelties_used).toHaveLength(1);
    expect(out.breakdown.contract_assignments).toHaveLength(1);
    expect(out.breakdown.internal_assignments).toHaveLength(1);
  });

  it('country sin standard_workday_hours → default 8h', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: { ...EMP_CO_FT, weekly_capacity_hours: 40 },
      country: {}, // sin standard_workday_hours
      holidays: [],
      novelties: [],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.total_capacity_hours).toBe(176); // 22 × 8
  });

  it('parttime 20h/sem → 4h/día hábil', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: { ...EMP_CO_FT, weekly_capacity_hours: 20 },
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    // 22 × (20/5) = 88h capacity
    expect(out.total_capacity_hours).toBe(88);
  });

  it('asignación fuera del rango activo del empleado → 0h', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: { ...EMP_CO_FT, hire_date: '2026-04-15' },
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [
        // Asignado del 1 al 10 abril, pero empleado contratado el 15
        { start_date: '2026-04-01', end_date: '2026-04-10', weekly_hours: 40 },
      ],
      internalAssignments: [],
      hourly_rate_usd: 45,
    });
    expect(out.assigned_hours_contract).toBe(0);
  });

  it('rate inválido (negativo) → trata como missing_rate', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [],
      novelties: [],
      contractAssignments: [],
      internalAssignments: [],
      hourly_rate_usd: -5,
    });
    expect(out.breakdown.flags.missing_rate).toBe(true);
    expect(out.idle_cost_usd).toBe(0);
  });

  it('lanza si period inválido', () => {
    expect(() => calculateIdleTime({
      period_yyyymm: 'bad',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
    })).toThrow(/period_yyyymm/);
  });

  it('lanza si employee falta', () => {
    expect(() => calculateIdleTime({
      period_yyyymm: '2026-04',
      country: COUNTRY_CO,
    })).toThrow(/employee/);
  });
});

describe('calculateIdleTime — escenarios agregados', () => {
  it('mezcla típica: 50% contract + 30% internal + 5 días vac → idle pequeño', () => {
    const out = calculateIdleTime({
      period_yyyymm: '2026-04',
      employee: EMP_CO_FT,
      country: COUNTRY_CO,
      holidays: [
        { holiday_date: '2026-04-02', label: 'Jueves Santo' },
        { holiday_date: '2026-04-03', label: 'Viernes Santo' },
      ],
      novelties: [
        { start_date: '2026-04-13', end_date: '2026-04-17', novelty_type_id: 'vacation', counts_in_capacity: false, status: 'approved' },
      ],
      contractAssignments: [
        { start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 20 }, // 50%
      ],
      internalAssignments: [
        { start_date: '2026-04-01', end_date: '2026-04-30', weekly_hours: 12 }, // 30%
      ],
      hourly_rate_usd: 50,
    });
    // capacity 176, holiday 16, novelty 40 → available 120
    expect(out.available_hours).toBe(120);
    // 15 días hábiles (22 - 2 holiday - 5 novelty) × 4 = 60
    expect(out.assigned_hours_contract).toBe(60);
    // 15 × 2.4 = 36
    expect(out.assigned_hours_internal).toBe(36);
    // idle = 120 - 96 = 24
    expect(out.idle_hours).toBe(24);
    expect(out.idle_cost_usd).toBe(1200);
  });
});
