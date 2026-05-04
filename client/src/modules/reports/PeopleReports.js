import React from 'react';
import ReportsLayout from './ReportsLayout';

export default function PeopleReports() {
  return (
    <ReportsLayout
      area="gente"
      title="Reportes de Gente"
      subtitle="Time compliance, plan vs real, hiring needs"
    >
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--ds-text-soft)' }}>
        Próximamente — reportes de gente con gráficas interactivas.
      </div>
    </ReportsLayout>
  );
}
