import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet } from '../utils/apiV2';

const s = {
  page:   { maxWidth: 1200, margin: '0 auto' },
  h1:     { fontSize: 26, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 4px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  h2:     { fontSize: 16, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 12px' },
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  grid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 },
  label:  { fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 1 },
  value:  { fontSize: 14, color: 'var(--purple-dark)', fontWeight: 600, marginTop: 2 },
  th:     { padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left' },
  td:     { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  link:   { color: 'var(--teal-mid)', textDecoration: 'none', fontWeight: 600 },
};

function Field({ label, children }) {
  return (
    <div>
      <div style={s.label}>{label}</div>
      <div style={s.value}>{children || '—'}</div>
    </div>
  );
}

export default function ContractDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [contract, setContract] = useState(null);
  const [requests, setRequests] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiGet(`/api/contracts/${id}`),
      apiGet(`/api/resource-requests?contract_id=${id}&limit=200`),
      apiGet(`/api/assignments?contract_id=${id}&limit=200`),
    ])
      .then(([c, r, a]) => {
        setContract(c || null);
        setRequests(r?.data || []);
        setAssignments(a?.data || []);
      })
      .catch((e) => setErr(e.message || 'Error'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={s.page}><div style={{ color: 'var(--text-light)' }}>Cargando…</div></div>;
  if (err || !contract) return <div style={s.page}><div style={{ color: 'var(--danger)' }}>{err || 'Contrato no encontrado'}</div></div>;

  return (
    <div style={s.page}>
      <button type="button" style={{ ...s.btnOutline, marginBottom: 12 }} onClick={() => nav('/contracts')}>← Contratos</button>

      <h1 style={s.h1}>📑 {contract.name}</h1>
      <div style={s.sub}>
        Cliente:{' '}
        {contract.client_id ? <Link to={`/clients/${contract.client_id}`} style={s.link}>{contract.client_name}</Link> : '—'}
        {' · '}{contract.type}{' · '}
        <strong>{contract.status}</strong>{' · '}
        {contract.start_date ? String(contract.start_date).slice(0, 10) : '—'} →{' '}
        {contract.end_date ? String(contract.end_date).slice(0, 10) : 'sin fin'}
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Resumen</h2>
        <div style={s.grid}>
          <Field label="Oportunidad">
            {contract.opportunity_id
              ? <Link to={`/opportunities/${contract.opportunity_id}`} style={s.link}>{contract.opportunity_name || 'ver'}</Link>
              : null}
          </Field>
          <Field label="Cotización ganadora">{contract.winning_quotation_name}</Field>
          <Field label="Squad">{contract.squad_id}</Field>
          <Field label="Account owner">{contract.account_owner_id}</Field>
          <Field label="Delivery manager">{contract.delivery_manager_id}</Field>
          <Field label="Capacity manager">{contract.capacity_manager_id}</Field>
          <Field label="Solicitudes abiertas">{contract.open_requests_count ?? 0}</Field>
          <Field label="Asignaciones activas">{contract.active_assignments_count ?? 0}</Field>
        </div>
        {contract.notes && (
          <div style={{ marginTop: 16 }}>
            <div style={s.label}>Notas</div>
            <div style={{ marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>{contract.notes}</div>
          </div>
        )}
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={s.h2}>Solicitudes ({requests.length})</h2>
          <Link to={`/resource-requests?contract_id=${id}`} style={s.link}>Ver todas →</Link>
        </div>
        {requests.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin solicitudes aún.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Role', 'Level', 'Cantidad', 'Prioridad', 'Estado'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{r.role_title}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{r.level}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{r.quantity}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{r.priority}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={s.h2}>Asignaciones ({assignments.length})</h2>
          <Link to={`/assignments?contract_id=${id}`} style={s.link}>Ver todas →</Link>
        </div>
        {assignments.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin asignaciones. Crea una desde /assignments seleccionando una solicitud de este contrato.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Empleado', 'Role', 'h/sem', 'Inicio', 'Fin', 'Estado'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{a.employee_first_name} {a.employee_last_name}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.request_role_title || a.role_title || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{Number(a.weekly_hours)}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.start_date ? String(a.start_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.end_date ? String(a.end_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
