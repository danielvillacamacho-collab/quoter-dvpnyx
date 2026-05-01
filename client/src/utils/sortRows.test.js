import { sortRows } from './sortRows';

describe('sortRows', () => {
  it('asc por string accessor', () => {
    const rows = [{ name: 'Bravo' }, { name: 'Alpha' }, { name: 'charlie' }];
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'charlie']);
  });

  it('desc por string accessor', () => {
    const rows = [{ name: 'Bravo' }, { name: 'Alpha' }, { name: 'charlie' }];
    expect(sortRows(rows, 'name', 'desc').map((r) => r.name)).toEqual(['charlie', 'Bravo', 'Alpha']);
  });

  it('numbers naturales', () => {
    const rows = [{ x: 10 }, { x: 2 }, { x: 1 }];
    expect(sortRows(rows, 'x', 'asc').map((r) => r.x)).toEqual([1, 2, 10]);
  });

  it('strings con números (L1, L10, L2) usan numeric collation', () => {
    const rows = [{ lvl: 'L10' }, { lvl: 'L2' }, { lvl: 'L1' }];
    expect(sortRows(rows, 'lvl', 'asc').map((r) => r.lvl)).toEqual(['L1', 'L2', 'L10']);
  });

  it('null/undefined SIEMPRE al final, ambos sentidos', () => {
    const rows = [{ x: 5 }, { x: null }, { x: 1 }, { x: undefined }, { x: 3 }];
    expect(sortRows(rows, 'x', 'asc').map((r) => r.x)).toEqual([1, 3, 5, null, undefined]);
    expect(sortRows(rows, 'x', 'desc').map((r) => r.x)).toEqual([5, 3, 1, null, undefined]);
  });

  it('strings vacíos cuentan como null', () => {
    const rows = [{ name: '' }, { name: 'Beta' }, { name: 'Alpha' }];
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Alpha', 'Beta', '']);
  });

  it('Date asc', () => {
    const rows = [
      { d: new Date('2026-04-01') },
      { d: new Date('2026-01-15') },
      { d: new Date('2026-12-31') },
    ];
    const out = sortRows(rows, 'd', 'asc');
    expect(out[0].d.toISOString().slice(0, 10)).toBe('2026-01-15');
    expect(out[2].d.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('strings ISO de fecha también ordenan por valor temporal (no lexicográfico)', () => {
    const rows = [
      { date: '2026-04-01T00:00:00Z' },
      { date: '2025-12-31T00:00:00Z' },
    ];
    const asc = sortRows(rows, 'date', 'asc');
    expect(asc[0].date.startsWith('2025')).toBe(true);
  });

  it('accessor function', () => {
    const rows = [{ a: { b: 3 } }, { a: { b: 1 } }, { a: { b: 2 } }];
    expect(sortRows(rows, (r) => r.a.b, 'asc').map((r) => r.a.b)).toEqual([1, 2, 3]);
  });

  it('accessor por path "a.b.c"', () => {
    const rows = [{ a: { b: { c: 9 } } }, { a: { b: { c: 1 } } }];
    expect(sortRows(rows, 'a.b.c', 'asc').map((r) => r.a.b.c)).toEqual([1, 9]);
  });

  it('estable: rows con misma key conservan orden', () => {
    const rows = [
      { id: 1, x: 5 }, { id: 2, x: 5 }, { id: 3, x: 1 }, { id: 4, x: 5 },
    ];
    const out = sortRows(rows, 'x', 'asc');
    // Rows con x=5 mantienen orden 1,2,4
    expect(out.map((r) => r.id)).toEqual([3, 1, 2, 4]);
  });

  it('input no-array devuelve sin tocar', () => {
    expect(sortRows(null, 'x', 'asc')).toBeNull();
    expect(sortRows(undefined, 'x', 'asc')).toBeUndefined();
  });

  it('booleanos: false antes que true en asc', () => {
    const rows = [{ b: true }, { b: false }, { b: true }];
    expect(sortRows(rows, 'b', 'asc').map((r) => r.b)).toEqual([false, true, true]);
  });
});
