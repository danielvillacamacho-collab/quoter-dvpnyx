import React from 'react';
import ReportsLayout from './ReportsLayout';

export default function ExecutiveReports() {
  return (
    <ReportsLayout
      area="ejecutivo"
      title="Reportes Ejecutivos"
      subtitle="KPIs globales, pipeline y tendencias de revenue"
    >
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--ds-text-soft)' }}>
        Próximamente — reportes ejecutivos con gráficas interactivas.
      </div>
    </ReportsLayout>
  );
}
