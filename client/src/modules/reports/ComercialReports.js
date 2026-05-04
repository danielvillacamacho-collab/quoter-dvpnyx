import React from 'react';
import ReportsLayout from './ReportsLayout';

export default function ComercialReports() {
  return (
    <ReportsLayout
      area="comercial"
      title="Reportes Comerciales"
      subtitle="Pipeline, actividades y cotizaciones"
    >
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--ds-text-soft)' }}>
        Próximamente — reportes comerciales con gráficas interactivas.
      </div>
    </ReportsLayout>
  );
}
