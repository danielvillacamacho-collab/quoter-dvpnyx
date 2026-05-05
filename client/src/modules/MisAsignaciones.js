import React, { useEffect, useState } from 'react';
import { apiGet } from '../utils/apiV2';
import cx from './MisAsignaciones.module.css';

const STATUS_LABEL = {
  active: 'Activa', planned: 'Planificada', completed: 'Completada',
  on_hold: 'En pausa', cancelled: 'Cancelada',
};
const STATUS_COLOR = {
  active: 'var(--ds-ok)', planned: 'var(--ds-accent)',
  completed: 'var(--ds-text-muted)', on_hold: 'var(--ds-warn)',
};

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

export default function MisAsignaciones() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet('/api/me/assignments')
      .then((r) => setRows(r.data || []))
      .catch((e) => setErr(e.message || 'Error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={cx.page}><div className={cx.loading}>Cargando...</div></div>;
  if (err) return <div className={cx.page}><div className={cx.error}>{err}</div></div>;

  const active = rows.filter((r) => r.status === 'active' || r.status === 'planned');
  const past = rows.filter((r) => r.status !== 'active' && r.status !== 'planned');
  const totalHours = active.reduce((sum, r) => sum + Number(r.weekly_hours || 0), 0);

  return (
    <div className={cx.page}>
      <h1 className={cx.h1}>Mis Asignaciones</h1>
      <div className={cx.sub}>{active.length} activas — {totalHours}h/semana asignadas</div>

      {rows.length === 0 ? (
        <div className={cx.card}><div className={cx.empty}>No tienes asignaciones registradas.</div></div>
      ) : (
        <>
          {active.length > 0 && (
            <div className={cx.card}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--ds-text)', fontFamily: 'Montserrat, sans-serif' }}>Activas y planificadas</h2>
              <AssignmentTable rows={active} />
            </div>
          )}
          {past.length > 0 && (
            <div className={cx.card}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--ds-text)', fontFamily: 'Montserrat, sans-serif' }}>Historial</h2>
              <AssignmentTable rows={past} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AssignmentTable({ rows }) {
  return (
    <div className={cx.tableWrap}>
      <table className={cx.table}>
        <thead>
          <tr>
            {['Cliente', 'Contrato', 'Rol', 'Horas/sem', 'Inicio', 'Fin', 'Estado'].map((h) => (
              <th key={h} className={cx.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className={cx.tdBold}>{a.client_name || '—'}</td>
              <td className={cx.td}>{a.contract_name || '—'}</td>
              <td className={cx.td}>{a.role_title || '—'}</td>
              <td className={cx.td} style={{ textAlign: 'center' }}>{Number(a.weekly_hours)}h</td>
              <td className={cx.td}>{fmtDate(a.start_date)}</td>
              <td className={cx.td}>{fmtDate(a.end_date)}</td>
              <td className={cx.td}>
                <span className={cx.badge} style={{ background: STATUS_COLOR[a.status] || 'var(--ds-text-muted)', color: '#fff' }}>
                  {STATUS_LABEL[a.status] || a.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
