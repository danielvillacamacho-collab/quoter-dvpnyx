import React from 'react';

const s = {
  card: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  title: { fontSize: 14, fontFamily: 'Montserrat', fontWeight: 600, margin: 0, color: 'var(--ds-text)' },
  subtitle: { fontSize: 12, color: 'var(--ds-text-soft, var(--text-light))', marginTop: 2 },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ds-text-soft)', fontSize: 13 },
};

export default function ChartCard({ title, subtitle, loading, error, height = 300, children }) {
  return (
    <div style={s.card}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={s.title}>{title}</h3>
        {subtitle && <div style={s.subtitle}>{subtitle}</div>}
      </div>
      <div style={{ height, position: 'relative' }}>
        {loading ? (
          <div style={{ ...s.center, height: '100%' }}>Cargando...</div>
        ) : error ? (
          <div style={{ ...s.center, height: '100%', color: 'var(--ds-bad, #ef4444)' }}>{error}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
