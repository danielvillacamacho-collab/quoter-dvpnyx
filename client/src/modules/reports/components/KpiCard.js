import React from 'react';

const s = {
  card: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16 },
  label: { fontSize: 11, color: 'var(--ds-text-soft, var(--text-light))', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  value: { fontSize: 26, fontWeight: 700, color: 'var(--ds-accent, var(--purple-dark))', marginTop: 4, fontVariantNumeric: 'tabular-nums' },
  sub: { fontSize: 12, color: 'var(--ds-text-soft, var(--text-light))', marginTop: 2 },
  trend: { fontSize: 12, fontWeight: 600, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 3 },
};

export default function KpiCard({ label, value, subtitle, color, trend, invertTrend }) {
  let trendColor = null;
  let trendArrow = null;
  if (trend) {
    const isUp = trend.direction === 'up';
    const good = invertTrend ? !isUp : isUp;
    trendColor = good ? '#10B981' : '#EF4444';
    trendArrow = isUp ? '▲' : '▼';
  }

  return (
    <div style={s.card}>
      <div style={s.label}>{label}</div>
      <div style={{ ...s.value, ...(color ? { color } : {}) }}>{value}</div>
      {subtitle && <div style={s.sub}>{subtitle}</div>}
      {trend && (
        <div style={{ ...s.trend, color: trendColor }}>
          {trendArrow} {trend.delta}
        </div>
      )}
    </div>
  );
}
