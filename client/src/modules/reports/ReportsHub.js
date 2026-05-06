import React from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Briefcase, Truck, Users, DollarSign } from 'lucide-react';

const AREAS = [
  { key: 'ejecutivo',  label: 'Ejecutivo',  desc: 'KPIs globales, pipeline y tendencias de revenue', Icon: TrendingUp },
  { key: 'comercial',  label: 'Comercial',  desc: 'Pipeline, actividades y cotizaciones', Icon: Briefcase },
  { key: 'delivery',   label: 'Delivery',   desc: 'Utilización, cobertura y solicitudes', Icon: Truck },
  { key: 'gente',      label: 'Gente',      desc: 'Time compliance, plan vs real, hiring needs', Icon: Users },
  { key: 'finanzas',   label: 'Finanzas',   desc: 'Revenue recognition y presupuestos', Icon: DollarSign },
];

const s = {
  page: { maxWidth: 1200, margin: '0 auto', padding: 16 },
  h1: { fontSize: 24, color: 'var(--ds-accent, var(--purple-dark))', fontFamily: 'Montserrat', margin: '0 0 4px' },
  sub: { fontSize: 14, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 20,
    background: 'var(--ds-surface, #fff)',
    borderRadius: 'var(--ds-radius, 10px)',
    border: '1px solid var(--ds-border, var(--border))',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'box-shadow .15s, border-color .15s',
    cursor: 'pointer',
  },
  cardTitle: { fontSize: 16, fontWeight: 700, color: 'var(--ds-accent, var(--purple-dark))', fontFamily: 'Montserrat' },
  cardDesc: { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', lineHeight: 1.4 },
  icon: { color: 'var(--ds-accent, var(--purple-dark))' },
};

function AreaCard({ area }) {
  const { key, label, desc, Icon } = area;
  return (
    <Link
      to={`/reports/${key}`}
      style={s.card}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)';
        e.currentTarget.style.borderColor = 'var(--ds-accent, var(--purple-dark))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = 'var(--ds-border, var(--border))';
      }}
    >
      <Icon size={28} style={s.icon} />
      <div style={s.cardTitle}>{label}</div>
      <div style={s.cardDesc}>{desc}</div>
    </Link>
  );
}

export default function ReportsHub() {
  return (
    <div style={s.page}>
      <h1 style={s.h1}>{'📊'} Centro de Reportes</h1>
      <p style={s.sub}>Selecciona un área para explorar los reportes disponibles.</p>
      <div style={s.grid}>
        {AREAS.map((a) => (
          <AreaCard key={a.key} area={a} />
        ))}
      </div>
    </div>
  );
}
