import { renderHook, act } from '@testing-library/react';
import useExport from './useExport';

describe('useExport', () => {
  let createObjectURL;
  let revokeObjectURL;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Helper: read Blob content as text (jsdom has no blob.text())
  function readBlob(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
  }

  // Helper: call exportCSV and return the generated CSV text
  async function callExport(result, data, columns, filename = 't.csv') {
    const links = [];
    const origAppend = document.body.appendChild.bind(document.body);
    jest.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if (el.tagName === 'A') {
        links.push(el);
        el.click = jest.fn();
        el.remove = jest.fn();
        return el;
      }
      return origAppend(el);
    });

    act(() => { result.current.exportCSV(filename, data, columns); });

    expect(createObjectURL).toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0][0];
    const text = await readBlob(blob);

    document.body.appendChild.mockRestore();
    return { text, blob, link: links[0] };
  }

  it('returns exportCSV function', () => {
    const { result } = renderHook(() => useExport());
    expect(typeof result.current.exportCSV).toBe('function');
  });

  it('creates CSV and triggers download', async () => {
    const { result } = renderHook(() => useExport());
    const columns = [
      { key: 'name', label: 'Nombre', get: (r) => r.name },
      { key: 'value', label: 'Valor', get: (r) => r.value },
    ];
    const data = [{ name: 'Acme', value: 100 }];

    const { blob, link } = await callExport(result, data, columns, 'report.csv');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(link.download).toBe('report.csv');
    expect(link.click).toHaveBeenCalled();
    expect(link.remove).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('generates correct CSV header and rows', async () => {
    const { result } = renderHook(() => useExport());
    const columns = [
      { key: 'name', label: 'Name', get: (r) => r.name },
      { key: 'qty', label: 'Qty', get: (r) => r.qty },
    ];
    const data = [{ name: 'Acme', qty: 10 }, { name: 'Beta', qty: 20 }];

    const { text } = await callExport(result, data, columns);
    expect(text).toContain('Name,Qty');
    expect(text).toContain('Acme,10');
    expect(text).toContain('Beta,20');
  });

  it('escapes cells with commas', async () => {
    const { result } = renderHook(() => useExport());
    const columns = [{ key: 'd', label: 'D', get: (r) => r.d }];
    const { text } = await callExport(result, [{ d: 'has, comma' }], columns);
    expect(text).toContain('"has, comma"');
  });

  it('escapes cells with quotes', async () => {
    const { result } = renderHook(() => useExport());
    const columns = [{ key: 'v', label: 'V', get: (r) => r.v }];
    const { text } = await callExport(result, [{ v: 'has "quotes"' }], columns);
    expect(text).toContain('"has ""quotes"""');
  });

  it('escapes cells with newlines', async () => {
    const { result } = renderHook(() => useExport());
    const columns = [{ key: 'v', label: 'V', get: (r) => r.v }];
    const { text } = await callExport(result, [{ v: 'line1\nline2' }], columns);
    expect(text).toContain('"line1\nline2"');
  });

  it('handles null and undefined cell values', async () => {
    const { result } = renderHook(() => useExport());
    const columns = [{ key: 'v', label: 'V', get: (r) => r.v }];
    const { text } = await callExport(result, [{ v: null }, { v: undefined }], columns);
    const lines = text.split('\n');
    expect(lines[1]).toBe(''); // null → empty
    expect(lines[2]).toBe(''); // undefined → empty
  });

  it('uses column key fallback when no get function', async () => {
    const { result } = renderHook(() => useExport());
    const columns = [{ key: 'name', label: 'Name' }]; // no get
    const { text } = await callExport(result, [{ name: 'Acme' }], columns);
    expect(text).toContain('Acme');
  });
});
