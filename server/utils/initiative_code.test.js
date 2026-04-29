const {
  AREA_CODE, areaCode, buildInitiativeCode, nextSequence, acquireSequenceLock,
} = require('./initiative_code');

describe('areaCode', () => {
  it('mapea áreas conocidas', () => {
    expect(areaCode('product')).toBe('PROD');
    expect(areaCode('operations')).toBe('OPER');
    expect(areaCode('hr')).toBe('HR');
    expect(areaCode('finance')).toBe('FIN');
    expect(areaCode('commercial')).toBe('COMM');
    expect(areaCode('technology')).toBe('TECH');
  });
  it('default XXXX para áreas desconocidas', () => {
    expect(areaCode('unknown')).toBe('XXXX');
    expect(areaCode(null)).toBe('XXXX');
    expect(areaCode(undefined)).toBe('XXXX');
  });
});

describe('buildInitiativeCode', () => {
  it('formato canónico', () => {
    expect(buildInitiativeCode('product', 2026, 1)).toBe('II-PROD-2026-00001');
    expect(buildInitiativeCode('technology', 2026, 42)).toBe('II-TECH-2026-00042');
  });
  it('rechaza year fuera de rango', () => {
    expect(() => buildInitiativeCode('product', 1999, 1)).toThrow();
    expect(() => buildInitiativeCode('product', 2200, 1)).toThrow();
  });
  it('rechaza seq inválido', () => {
    expect(() => buildInitiativeCode('product', 2026, 0)).toThrow();
    expect(() => buildInitiativeCode('product', 2026, 100000)).toThrow();
    expect(() => buildInitiativeCode('product', 2026, -1)).toThrow();
  });
  it('zero-padding hasta 5 dígitos', () => {
    expect(buildInitiativeCode('hr', 2026, 99999)).toBe('II-HR-2026-99999');
  });
});

describe('nextSequence', () => {
  function mockConn(rows) {
    return { query: jest.fn().mockResolvedValue({ rows }) };
  }
  it('1 si no hay rows previas', async () => {
    const conn = mockConn([]);
    const seq = await nextSequence(conn, 'product', 2026);
    expect(seq).toBe(1);
  });
  it('+1 sobre el último', async () => {
    const conn = mockConn([{ initiative_code: 'II-PROD-2026-00007' }]);
    const seq = await nextSequence(conn, 'product', 2026);
    expect(seq).toBe(8);
  });
  it('LIKE prefix correcto', async () => {
    const conn = mockConn([]);
    await nextSequence(conn, 'technology', 2026);
    expect(conn.query).toHaveBeenCalledWith(
      expect.stringContaining('initiative_code LIKE $1'),
      ['II-TECH-2026-%']
    );
  });
  it('si el código no cuadra al regex, vuelve a 1', async () => {
    const conn = mockConn([{ initiative_code: 'II-PROD-2026-XXXXX' }]);
    const seq = await nextSequence(conn, 'product', 2026);
    expect(seq).toBe(1);
  });
});

describe('acquireSequenceLock', () => {
  it('llama pg_advisory_xact_lock con un int', async () => {
    const conn = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await acquireSequenceLock(conn, 'product', 2026);
    expect(conn.query).toHaveBeenCalledTimes(1);
    const [sql, params] = conn.query.mock.calls[0];
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(typeof params[0]).toBe('number');
    expect(Number.isInteger(params[0])).toBe(true);
  });
  it('mismo input → mismo lock key', async () => {
    const conn1 = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const conn2 = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await acquireSequenceLock(conn1, 'product', 2026);
    await acquireSequenceLock(conn2, 'product', 2026);
    expect(conn1.query.mock.calls[0][1][0]).toBe(conn2.query.mock.calls[0][1][0]);
  });
  it('inputs distintos → keys distintos (probabilísticamente)', async () => {
    const conn1 = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const conn2 = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await acquireSequenceLock(conn1, 'product', 2026);
    await acquireSequenceLock(conn2, 'technology', 2026);
    expect(conn1.query.mock.calls[0][1][0]).not.toBe(conn2.query.mock.calls[0][1][0]);
  });
});

describe('AREA_CODE export', () => {
  it('contiene las 6 áreas del seed', () => {
    expect(Object.keys(AREA_CODE).sort()).toEqual(
      ['commercial', 'finance', 'hr', 'operations', 'product', 'technology'].sort()
    );
  });
});
