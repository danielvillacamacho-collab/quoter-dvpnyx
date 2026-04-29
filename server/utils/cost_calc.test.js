const {
  VALID_CURRENCIES,
  validatePeriod, previousPeriod, addMonths, periodsForward, currentPeriod,
  periodLessThan, periodLessOrEqual, periodWithinAllowedFuture,
  validateCurrency, convertToUsd, validateEmployeePeriod, deltaVsTheoretical,
} = require('./cost_calc');

describe('validatePeriod', () => {
  it('acepta YYYYMM', () => {
    expect(validatePeriod('202604')).toEqual({ ok: true, period: '202604' });
  });
  it('acepta YYYY-MM y normaliza', () => {
    expect(validatePeriod('2026-04')).toEqual({ ok: true, period: '202604' });
  });
  it('rechaza basura', () => {
    expect(validatePeriod('foo').ok).toBe(false);
    expect(validatePeriod('').ok).toBe(false);
    expect(validatePeriod(null).ok).toBe(false);
    expect(validatePeriod('20264').ok).toBe(false);
  });
  it('rechaza meses fuera de rango', () => {
    expect(validatePeriod('202613').ok).toBe(false);
    expect(validatePeriod('202600').ok).toBe(false);
  });
  it('rechaza años fuera de rango', () => {
    expect(validatePeriod('199912').ok).toBe(false);
    expect(validatePeriod('210101').ok).toBe(false);
  });
});

describe('previousPeriod', () => {
  it('mes intermedio', () => expect(previousPeriod('202604')).toBe('202603'));
  it('rollover de año', () => expect(previousPeriod('202601')).toBe('202512'));
  it('null si inválido', () => expect(previousPeriod('foo')).toBeNull());
});

describe('addMonths', () => {
  it('suma positiva sin rollover', () => {
    expect(addMonths('202604', 3)).toBe('202607');
  });
  it('rollover hacia adelante', () => {
    expect(addMonths('202611', 3)).toBe('202702');
    expect(addMonths('202612', 1)).toBe('202701');
  });
  it('suma negativa con rollover hacia atrás', () => {
    expect(addMonths('202602', -3)).toBe('202511');
    expect(addMonths('202601', -1)).toBe('202512');
  });
  it('cero devuelve el mismo período', () => {
    expect(addMonths('202604', 0)).toBe('202604');
  });
  it('rangos grandes (12+)', () => {
    expect(addMonths('202604', 12)).toBe('202704');
    expect(addMonths('202604', 24)).toBe('202804');
    expect(addMonths('202604', -12)).toBe('202504');
  });
  it('null para inputs inválidos', () => {
    expect(addMonths('foo', 1)).toBeNull();
    expect(addMonths('202604', 'foo')).toBeNull();
    expect(addMonths('202604', 1.5)).toBeNull();
  });
});

describe('periodsForward', () => {
  it('genera N períodos consecutivos hacia adelante', () => {
    expect(periodsForward('202604', 3)).toEqual(['202604', '202605', '202606']);
  });
  it('atraviesa frontera de año', () => {
    expect(periodsForward('202611', 4)).toEqual(['202611', '202612', '202701', '202702']);
  });
  it('count=1 devuelve solo el inicial', () => {
    expect(periodsForward('202604', 1)).toEqual(['202604']);
  });
  it('count inválido devuelve []', () => {
    expect(periodsForward('202604', 0)).toEqual([]);
    expect(periodsForward('202604', -1)).toEqual([]);
    expect(periodsForward('202604', 1.5)).toEqual([]);
  });
  it('start inválido devuelve []', () => {
    expect(periodsForward('foo', 3)).toEqual([]);
  });
});

describe('comparadores de período', () => {
  it('periodLessThan', () => {
    expect(periodLessThan('202601', '202602')).toBe(true);
    expect(periodLessThan('202602', '202602')).toBe(false);
    expect(periodLessThan('202612', '202701')).toBe(true);
  });
  it('periodLessOrEqual', () => {
    expect(periodLessOrEqual('202602', '202602')).toBe(true);
    expect(periodLessOrEqual('202603', '202602')).toBe(false);
  });
});

describe('periodWithinAllowedFuture', () => {
  // Los tests pueden correr en cualquier mes; comparamos con currentPeriod.
  it('mes actual permitido', () => {
    expect(periodWithinAllowedFuture(currentPeriod())).toBe(true);
  });
  it('pasado lejano permitido', () => {
    expect(periodWithinAllowedFuture('200001')).toBe(true);
  });
  it('1 mes adelante permitido (default)', () => {
    const cur = currentPeriod();
    let year = parseInt(cur.slice(0, 4), 10);
    let month = parseInt(cur.slice(4, 6), 10) + 1;
    if (month > 12) { month = 1; year += 1; }
    const next = `${year}${String(month).padStart(2, '0')}`;
    expect(periodWithinAllowedFuture(next)).toBe(true);
  });
  it('3 meses adelante NO permitido (default 1)', () => {
    const cur = currentPeriod();
    let year = parseInt(cur.slice(0, 4), 10);
    let month = parseInt(cur.slice(4, 6), 10) + 3;
    while (month > 12) { month -= 12; year += 1; }
    const far = `${year}${String(month).padStart(2, '0')}`;
    expect(periodWithinAllowedFuture(far)).toBe(false);
  });
});

describe('validateCurrency', () => {
  it('acepta canónicas', () => {
    for (const c of VALID_CURRENCIES) {
      expect(validateCurrency(c).ok).toBe(true);
    }
  });
  it('case-insensitive', () => {
    expect(validateCurrency('cop')).toEqual({ ok: true, currency: 'COP' });
  });
  it('rechaza desconocidas', () => {
    expect(validateCurrency('BTC').ok).toBe(false);
    expect(validateCurrency(null).ok).toBe(false);
    expect(validateCurrency('').ok).toBe(false);
  });
});

describe('convertToUsd', () => {
  it('USD: rate=1, mismo monto', () => {
    expect(convertToUsd(5000, 'USD', null)).toEqual({ cost_usd: 5000, exchange_rate_used: 1 });
  });
  it('COP a USD con rate', () => {
    // 1 USD = 4000 COP → 12,000,000 COP / 4000 = 3000 USD
    expect(convertToUsd(12000000, 'COP', 4000)).toEqual({ cost_usd: 3000, exchange_rate_used: 4000 });
  });
  it('redondea a 2 decimales', () => {
    expect(convertToUsd(1000, 'COP', 3)).toEqual({ cost_usd: 333.33, exchange_rate_used: 3 });
  });
  it('sin rate para no-USD → null', () => {
    expect(convertToUsd(1000, 'COP', null)).toEqual({ cost_usd: null, exchange_rate_used: null });
    expect(convertToUsd(1000, 'COP', 0)).toEqual({ cost_usd: null, exchange_rate_used: null });
    expect(convertToUsd(1000, 'COP', -5)).toEqual({ cost_usd: null, exchange_rate_used: null });
  });
  it('grossCost inválido → null', () => {
    expect(convertToUsd('foo', 'USD', null)).toEqual({ cost_usd: null, exchange_rate_used: null });
    expect(convertToUsd(-100, 'USD', null)).toEqual({ cost_usd: null, exchange_rate_used: null });
  });
});

describe('validateEmployeePeriod', () => {
  const emp = { start_date: '2025-06-15', end_date: null };
  const empTerminated = { start_date: '2025-06-15', end_date: '2026-03-20' };

  it('acepta período activo', () => {
    expect(validateEmployeePeriod(emp, '202508').ok).toBe(true);
  });

  it('rechaza período antes del inicio', () => {
    const r = validateEmployeePeriod(emp, '202505');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('period_before_employee_start');
  });

  it('mes exacto del inicio: OK', () => {
    expect(validateEmployeePeriod(emp, '202506').ok).toBe(true);
  });

  it('rechaza período después de la terminación', () => {
    const r = validateEmployeePeriod(empTerminated, '202604');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('period_after_employee_end');
  });

  it('mes exacto del end: OK', () => {
    expect(validateEmployeePeriod(empTerminated, '202603').ok).toBe(true);
  });

  it('rechaza período demasiado en el futuro', () => {
    const cur = currentPeriod();
    let year = parseInt(cur.slice(0, 4), 10);
    let month = parseInt(cur.slice(4, 6), 10) + 5;
    while (month > 12) { month -= 12; year += 1; }
    const far = `${year}${String(month).padStart(2, '0')}`;
    const r = validateEmployeePeriod({ start_date: '2020-01-01' }, far);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('period_too_far_future');
  });

  it('period inválido → period_invalid', () => {
    const r = validateEmployeePeriod(emp, 'foo');
    expect(r.code).toBe('period_invalid');
  });
});

describe('deltaVsTheoretical', () => {
  it('on_target cuando |Δ%| <= 5', () => {
    expect(deltaVsTheoretical(1050, 1000).zone).toBe('on_target');
    expect(deltaVsTheoretical(950, 1000).zone).toBe('on_target');
    expect(deltaVsTheoretical(1000, 1000)).toEqual({ delta: 0, deltaPct: 0, zone: 'on_target' });
  });
  it('warn cuando 5 < |Δ%| <= 15', () => {
    expect(deltaVsTheoretical(1100, 1000).zone).toBe('warn');
    expect(deltaVsTheoretical(850, 1000).zone).toBe('warn');
  });
  it('alert cuando |Δ%| > 15', () => {
    expect(deltaVsTheoretical(1300, 1000).zone).toBe('alert');
    expect(deltaVsTheoretical(700, 1000).zone).toBe('alert');
  });
  it('no_baseline si theoretical no válido', () => {
    expect(deltaVsTheoretical(1000, 0).zone).toBe('no_baseline');
    expect(deltaVsTheoretical(1000, null).zone).toBe('no_baseline');
  });
  it('no_data si real no válido', () => {
    expect(deltaVsTheoretical(null, 1000).zone).toBe('no_data');
    expect(deltaVsTheoretical(undefined, 1000).zone).toBe('no_data');
  });
});
