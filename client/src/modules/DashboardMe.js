/**
 * ED-1 — Personal dashboard.
 *
 * Shows the logged-in user's rollup: active assignments + week hours +
 * capacity usage. Pulls from /api/reports/my-dashboard which the server
 * tailors to req.user.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../utils/apiV2';

const s = {
  page:   { maxWidth: 1100, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  grid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 24 },
  metric: { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, textAlign: 'center' },
  metricLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-light)', fontWeight: 700 },
  metricValue: { fontSize: 32, fontWeight: 800, color: 'var(--purple-dark)', fontFamily: 'Montserrat', marginTop: 8 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  th:     { padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:     { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
};

function formatHours(n) { return `${Number(n || 0).toFixed(1)}h`; }

export default function DashboardMe() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    apiGet('/api/reports/my-dashboard')
      .then((r) => setData(r))
      .catch((e) => setErr(e.message || 'Error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={s.page}><div style={{ color: 'var(--text-light)' }}>Cargando…</div></div>;
  if (err) return <div style={s.page}><div style={{ color: 'var(--danger)' }}>{err}</div></div>;
  if (!data) return null;

  const { employee, active_assignments = [], week_hours = {} } = data;
  const compliancePct = week_hours.expected > 0 ? (Number(week_hours.logged) / Number(week_hours.expected)) : null;

  return (
    <div style={s.page}>
      <h1 style={s.h1}>
        👋 Hola{employee ? `, ${employee.first_name}` : ''}
      </h1>
      <div style={s.sub}>
        {employee
          ? `Tu semana actual (${week_hours.week_start} → ${week_hours.week_end})`
          : 'Tu cuenta no tiene un empleado asociado — vista limitada.'}
      </div>

      <div style={s.grid}>
        <div style={s.metric} aria-label="Asignaciones activas">
          <div style={s.metricLabel}>Asignaciones activas</div>
          <div style={s.metricValue}>{active_assignments.length}</div>
        </div>
        {employee && (
          <>
            <div style={s.metric} aria-label="Horas registradas esta semana">
              <div style={s.metricLabel}>Horas esta semana</div>
              <div style={s.metricValue}>{formatHours(week_hours.logged)}</div>
            </div>
            <div style={s.metric} aria-label="Capacidad semanal">
              <div style={s.metricLabel}>Capacidad semanal</div>
              <div style={s.metricValue}>{formatHours(week_hours.capacity)}</div>
            </div>
            {compliancePct != null && (
              <div style={{ ...s.metric }} aria-label="Cumplimiento de horas">
                <div style={s.metricLabel}>Cumplimiento</div>
                <div style={{ ...s.metricValue,
                  color: compliancePct >= 0.8 ? 'var(--success)' : compliancePct >= 0.5 ? 'var(--orange)' : 'var(--danger)',
                }}>
                  {(compliancePct * 100).toFixed(0)}%
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {employee && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>Mis asignaciones activas</h2>
            <Link to="/time/me" style={{ color: 'var(--teal-mid)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              Ir a Mis horas →
            </Link>
          </div>
          {active_assignments.length === 0 ? (
            <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
              No tienes asignaciones activas.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Contrato', 'Horas/sem', 'Inicio', 'Fin', 'Estado'].map((h) => <th key={h} style={s.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {active_assignments.map((a) => (
                    <tr key={a.id}>
                      <td style={{ ...s.td, fontWeight: 600 }}>{a.contract_name || '—'}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>{Number(a.weekly_hours)}h</td>
                      <td style={s.td}>{a.start_date ? String(a.start_date).slice(0, 10) : '—'}</td>
                      <td style={s.td}>{a.end_date ? String(a.end_date).slice(0, 10) : '—'}</td>
                      <td style={s.td}>{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
