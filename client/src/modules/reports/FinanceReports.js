import React from 'react';
import ReportsLayout from './ReportsLayout';

export default function FinanceReports() {
  return (
    <ReportsLayout
      area="finanzas"
      title="Reportes de Finanzas"
      subtitle="Revenue recognition y presupuestos"
    >
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--ds-text-soft)' }}>
        Próximamente — reportes de finanzas con gráficas interactivas.
      </div>
    </ReportsLayout>
  );
}
