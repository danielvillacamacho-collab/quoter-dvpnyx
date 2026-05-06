import React from 'react';
import { NavLink } from 'react-router-dom';

const TABS = [
  { key: 'ejecutivo', label: 'Ejecutivo' },
  { key: 'comercial', label: 'Comercial' },
  { key: 'delivery',  label: 'Delivery' },
  { key: 'gente',     label: 'Gente' },
  { key: 'finanzas',  label: 'Finanzas' },
];

const s = {
  page: { maxWidth: 1200, margin: '0 auto', padding: 16 },
  header: { marginBottom: 16 },
  h1: { fontSize: 22, color: 'var(--ds-accent, var(--purple-dark))', fontFamily: 'Montserrat', margin: '0 0 4px' },
  sub: { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', margin: 0 },
  nav: {
    display: 'flex',
    gap: 0,
    borderBottom: '2px solid var(--ds-border, var(--border))',
    marginBottom: 20,
    overflowX: 'auto',
  },
  tab: {
    padding: '10px 18px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--ds-text-soft, var(--text-light))',
    textDecoration: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: -2,
    whiteSpace: 'nowrap',
    transition: 'color .15s, border-color .15s',
  },
  tabActive: {
    color: 'var(--ds-accent, var(--purple-dark))',
    borderBottomColor: 'var(--ds-accent, var(--purple-dark))',
  },
};

export default function ReportsLayout({ area, title, subtitle, children }) {
  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.h1}>{title}</h1>
        {subtitle && <p style={s.sub}>{subtitle}</p>}
      </div>

      <nav style={s.nav}>
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/reports/${t.key}`}
            style={({ isActive }) => ({
              ...s.tab,
              ...(isActive || t.key === area ? s.tabActive : {}),
            })}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      {children}
    </div>
  );
}
