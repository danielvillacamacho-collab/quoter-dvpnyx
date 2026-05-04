import React from 'react';
import ReportsLayout from './ReportsLayout';

export default function DeliveryReports() {
  return (
    <ReportsLayout
      area="delivery"
      title="Reportes de Delivery"
      subtitle="Utilización, cobertura y solicitudes"
    >
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--ds-text-soft)' }}>
        Próximamente — reportes de delivery con gráficas interactivas.
      </div>
    </ReportsLayout>
  );
}
