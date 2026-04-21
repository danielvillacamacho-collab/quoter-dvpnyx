const { parseCsv, stringifyCsv } = require('./csv');

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

describe('stringifyCsv', () => {
  const cols = [
    { key: 'name', header: 'Name' },
    { key: 'age',  header: 'Age' },
  ];

  it('emits a BOM + header row even when there are no data rows', () => {
    const out = stringifyCsv([], cols);
    expect(out).toBe('\uFEFFName,Age\r\n');
  });

  it('stringifies scalar values with CRLF line endings', () => {
    const out = stringifyCsv([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }], cols);
    expect(out).toBe('\uFEFFName,Age\r\nAlice,30\r\nBob,25\r\n');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const out = stringifyCsv(
      [{ name: 'Smith, John', age: 'has "quote"' }, { name: 'line\nbreak', age: 'ok' }],
      cols,
      { bom: false }
    );
    expect(out).toBe(
      'Name,Age\r\n"Smith, John","has ""quote"""\r\n"line\nbreak",ok\r\n'
    );
  });

  it('supports a value() accessor for computed columns', () => {
    const out = stringifyCsv(
      [{ first: 'Ana', last: 'García' }],
      [{ header: 'Full', value: (r) => `${r.first} ${r.last}` }],
      { bom: false }
    );
    expect(out).toBe('Full\r\nAna García\r\n');
  });

  it('renders null/undefined as empty strings', () => {
    const out = stringifyCsv([{ name: null, age: undefined }], cols, { bom: false });
    expect(out).toBe('Name,Age\r\n,\r\n');
  });
});
