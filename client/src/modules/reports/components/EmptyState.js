import React from 'react';

export default function EmptyState({ message = 'No hay datos para mostrar', icon }) {
  return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--ds-text-soft, var(--text-light))', fontSize: 13 }}>
      {icon && <div style={{ marginBottom: 8 }}>{icon}</div>}
      {message}
    </div>
  );
}
