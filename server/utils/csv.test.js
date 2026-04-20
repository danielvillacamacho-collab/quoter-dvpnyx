const { parseCsv } = require('./csv');

describe('parseCsv', () => {
  it('returns empty on empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv(null)).toEqual({ headers: [], rows: [] });
  });

  it('parses a simple CSV with headers', () => {
    const out = parseCsv('name,age\nAlice,30\nBob,25');
    expect(out.headers).toEqual(['name', 'age']);
    expect(out.rows).toEqual([{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }]);
  });

  it('lowercases and trims headers', () => {
    const out = parseCsv(' Name , AGE \nAlice,30');
    expect(out.headers).toEqual(['name', 'age']);
    expect(out.rows[0]).toEqual({ name: 'Alice', age: '30' });
  });

  it('handles quoted fields with commas and quotes', () => {
    const out = parseCsv('name,note\n"Smith, John","He said ""hi"""');
    expect(out.rows[0]).toEqual({ name: 'Smith, John', note: 'He said "hi"' });
  });

  it('handles CRLF line endings', () => {
    const out = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(out.rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('drops trailing empty rows', () => {
    const out = parseCsv('a\n1\n\n\n');
    expect(out.rows).toEqual([{ a: '1' }]);
  });

  it('treats missing columns as empty strings', () => {
    const out = parseCsv('a,b,c\n1,2');
    expect(out.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('ignores extra columns beyond header width', () => {
    const out = parseCsv('a,b\n1,2,3,4');
    expect(out.rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('strips the UTF-8 BOM', () => {
    const out = parseCsv('\uFEFFname,age\nAlice,30');
    expect(out.headers).toEqual(['name', 'age']);
  });

  it('respects a custom separator', () => {
    const out = parseCsv('a;b\n1;2', { separator: ';' });
    expect(out.rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('preserves embedded newlines in quoted fields', () => {
    const out = parseCsv('a,b\n"line1\nline2",x');
    expect(out.rows[0]).toEqual({ a: 'line1\nline2', b: 'x' });
  });
});
