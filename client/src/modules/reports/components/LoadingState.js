import React from 'react';

const pulse = `
@keyframes rpt-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
`;

export default function LoadingState({ message = 'Cargando...' }) {
  return (
    <>
      <style>{pulse}</style>
      <div style={{
        textAlign: 'center',
        padding: 40,
        color: 'var(--ds-text-soft)',
        fontSize: 13,
        animation: 'rpt-pulse 1.5s ease-in-out infinite',
      }}>
        {message}
      </div>
    </>
  );
}
