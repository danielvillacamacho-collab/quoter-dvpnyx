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
  field:  { fontSize: 13 },
  label:  { fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 1 },
  value:  { fontSize: 14, color: 'var(--purple-dark)', fontWeight: 600, marginTop: 2 },
  th:     { padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left' },
  td:     { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  link:   { color: 'var(--teal-mid)', textDecoration: 'none', fontWeight: 600 },
};

function Field({ label, children }) {
  return (
    <div style={s.field}>
      <div style={s.label}>{label}</div>
      <div style={s.value}>{children || '—'}</div>
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [client, setClient] = useState(null);
  const [opps, setOpps] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiGet(`/api/clients/${id}`),
      apiGet(`/api/opportunities?client_id=${id}&limit=100`),
      apiGet(`/api/contracts?client_id=${id}&limit=100`),
    ])
      .then(([c, o, ct]) => {
        setClient(c || null);
        setOpps(o?.data || []);
        setContracts(ct?.data || []);
      })
      .catch((e) => setErr(e.message || 'Error'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={s.page}><div style={{ color: 'var(--text-light)' }}>Cargando…</div></div>;
  if (err || !client) return <div style={s.page}><div style={{ color: 'var(--danger)' }}>{err || 'Cliente no encontrado'}</div></div>;

  return (
    <div style={s.page}>
      <button type="button" style={{ ...s.btnOutline, marginBottom: 12 }} onClick={() => nav('/clients')} aria-label="Volver a clientes">← Clientes</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={s.h1}>🏢 {client.name}</h1>
          <div style={s.sub}>
            {client.legal_name && <>{client.legal_name} · </>}
            {client.country || 'Sin país'} · Tier {client.tier || '—'} ·{' '}
            <span style={{ color: client.active ? 'var(--success)' : 'var(--text-light)', fontWeight: 700 }}>
              {client.active ? 'Activo' : 'Inactivo'}
            </span>
          </div>
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Resumen</h2>
        <div style={s.grid}>
          <Field label="Industria">{client.industry}</Field>
          <Field label="Ciudad">{client.city}</Field>
          <Field label="Moneda preferida">{client.preferred_currency || 'USD'}</Field>
          <Field label="Oportunidades">{client.opportunities_count ?? opps.length}</Field>
          <Field label="Contratos activos">{client.active_contracts_count ?? contracts.filter((c) => c.status === 'active').length}</Field>
          <Field label="Tags">{(client.tags || []).join(', ')}</Field>
        </div>
        {client.notes && (
          <div style={{ marginTop: 16 }}>
            <div style={s.label}>Notas</div>
            <div style={{ marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>{client.notes}</div>
          </div>
        )}
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={s.h2}>Oportunidades ({opps.length})</h2>
          <Link to="/opportunities" style={s.link}>Ver todas →</Link>
        </div>
        {opps.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin oportunidades registradas para este cliente.{' '}
            <Link to="/opportunities" style={s.link}>Crear una</Link>.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nombre', 'Estado', 'Cotizaciones', 'Cierre esperado'].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {opps.map((o) => (
                <tr key={o.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <Link to={`/opportunities/${o.id}`} style={s.link}>{o.name}</Link>
                  </td>
                  <td style={{ ...s.td, fontSize: 12 }}>{o.status}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{o.quotations_count ?? 0}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{o.expected_close_date ? String(o.expected_close_date).slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={s.h2}>Contratos ({contracts.length})</h2>
          <Link to="/contracts" style={s.link}>Ver todos →</Link>
        </div>
        {contracts.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin contratos para este cliente.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nombre', 'Tipo', 'Estado', 'Inicio', 'Asig. activas'].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <Link to={`/contracts/${c.id}`} style={s.link}>{c.name}</Link>
                  </td>
                  <td style={{ ...s.td, fontSize: 12 }}>{c.type}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{c.status}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{c.start_date ? String(c.start_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{c.active_assignments_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
