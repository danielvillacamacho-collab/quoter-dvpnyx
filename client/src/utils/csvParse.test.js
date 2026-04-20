import { parseCsv } from './csvParse';

describe('parseCsv (client-side)', () => {
  it('returns empty for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv(null)).toEqual({ headers: [], rows: [] });
  });

  it('parses headers + simple rows', () => {
    const out = parseCsv('name,age\nAlice,30\nBob,25');
    expect(out.headers).toEqual(['name', 'age']);
    expect(out.rows).toEqual([{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }]);
  });

  it('supports quoted fields with commas and quotes', () => {
    const out = parseCsv('name,note\n"Doe, John","He said ""hi"""');
    expect(out.rows[0]).toEqual({ name: 'Doe, John', note: 'He said "hi"' });
  });

  it('strips UTF-8 BOM and lowercases headers', () => {
    const out = parseCsv('\uFEFFName, AGE \nA,1');
    expect(out.headers).toEqual(['name', 'age']);
    expect(out.rows[0]).toEqual({ name: 'A', age: '1' });
  });

  it('tolerates CRLF and trailing blank lines', () => {
    const out = parseCsv('a,b\r\n1,2\r\n\r\n');
    expect(out.rows).toEqual([{ a: '1', b: '2' }]);
  });
});
