import React from 'react';

export default function KpiGrid({ children, columns = 'repeat(auto-fit, minmax(180px, 1fr))' }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 12, marginBottom: 16 }}>
      {children}
    </div>
  );
}
