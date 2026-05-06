import { useCallback } from 'react';

function escapeCell(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export default function useExport() {
  const exportCSV = useCallback((filename, data, columns) => {
    const BOM = '﻿';
    const header = columns.map((c) => escapeCell(c.label)).join(',');
    const rows = data.map((row) =>
      columns.map((c) => escapeCell(c.get ? c.get(row) : row[c.key])).join(','),
    );
    const csv = BOM + header + '\n' + rows.join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  return { exportCSV };
}
