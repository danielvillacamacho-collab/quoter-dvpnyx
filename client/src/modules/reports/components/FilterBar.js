import React from 'react';

const inputStyle = {
  padding: '6px 10px',
  border: '1px solid var(--ds-border)',
  borderRadius: 'var(--ds-radius, 6px)',
  background: 'var(--ds-surface)',
  color: 'var(--ds-text)',
  fontSize: 13,
};

const ghostBtn = {
  background: 'transparent',
  color: 'var(--ds-accent)',
  border: '1px solid var(--ds-border)',
  borderRadius: 'var(--ds-radius, 6px)',
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: 13,
};

function FilterControl({ filter }) {
  const { key, label, type, value, onChange, options } = filter;

  if (type === 'select') {
    return (
      <select
        aria-label={label}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      >
        <option value="">{label}</option>
        {(options || []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={type === 'month' ? 'month' : 'date'}
      aria-label={label}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  );
}

export default function FilterBar({ filters, onReset }) {
  const hasValue = filters.some((f) => f.value);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
      {filters.map((f) => (
        <FilterControl key={f.key} filter={f} />
      ))}
      {hasValue && onReset && (
        <button type="button" style={ghostBtn} onClick={onReset}>
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
