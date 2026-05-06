import React from 'react';
import { th as thBase, td as tdBase, TABLE_CLASS } from '../../../shell/tableStyles';

const s = {
  th: { ...thBase, cursor: 'default' },
  thSortable: { ...thBase, cursor: 'pointer', userSelect: 'none' },
  td: { ...tdBase },
  wrap: { overflowX: 'auto' },
  center: { padding: '24px 12px', textAlign: 'center', fontSize: 13, color: 'var(--ds-text-soft)' },
};

function SortArrow({ field, sort }) {
  if (!sort) return null;
  const active = sort.field === field;
  const arrow = !active ? '⇅' : (sort.dir === 'asc' ? '▲' : '▼');
  return <span aria-hidden="true" style={{ opacity: active ? 1 : 0.45, fontSize: 10, marginLeft: 4 }}>{arrow}</span>;
}

export default function ReportTable({
  columns, data, loading, emptyMessage = 'Sin datos', sort, onSort,
}) {
  const colCount = columns.length;

  return (
    <div style={s.wrap}>
      <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = col.sortable && onSort;
              const thStyle = {
                ...(sortable ? s.thSortable : s.th),
                textAlign: col.align || 'left',
              };
              return sortable ? (
                <th
                  key={col.key}
                  role="button"
                  tabIndex={0}
                  aria-sort={sort?.field === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  aria-label={`Ordenar por ${col.label}`}
                  style={thStyle}
                  onClick={() => onSort(col.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col.key); } }}
                >
                  {col.label}<SortArrow field={col.key} sort={sort} />
                </th>
              ) : (
                <th key={col.key} style={thStyle}>{col.label}</th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colCount} style={s.center}>Cargando...</td></tr>
          ) : !data || data.length === 0 ? (
            <tr><td colSpan={colCount} style={s.center}>{emptyMessage}</td></tr>
          ) : (
            data.map((row, i) => (
              <tr key={row.id ?? i}>
                {columns.map((col) => {
                  const cellColor = col.color ? col.color(row) : undefined;
                  return (
                    <td
                      key={col.key}
                      style={{
                        ...s.td,
                        textAlign: col.align || 'left',
                        ...(cellColor ? { color: cellColor } : {}),
                      }}
                    >
                      {col.get(row)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
