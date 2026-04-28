import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPut, apiPost } from '../utils/apiV2';
import { useAuth } from '../AuthContext';

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
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const userId = auth.user?.id;
  const [contract, setContract] = useState(null);
  const [requests, setRequests] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Pickers para admin: lista de usuarios con rol admin/lead para roles del contrato.
  const [userCandidates, setUserCandidates] = useState([]);
  const [savingDM, setSavingDM] = useState(false);
  // Kick-off form state.
  const [kickOffDate, setKickOffDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [kickOffBusy, setKickOffBusy] = useState(false);
  const [kickOffMsg, setKickOffMsg] = useState(null); // { ok, msg }

  const reload = () => {
    return Promise.all([
      apiGet(`/api/contracts/${id}`),
      apiGet(`/api/resource-requests?contract_id=${id}&limit=200`),
      apiGet(`/api/assignments?contract_id=${id}&limit=200`),
    ]).then(([c, r, a]) => {
      setContract(c || null);
      setRequests(r?.data || []);
      setAssignments(a?.data || []);
    });
  };

  useEffect(() => {
    setLoading(true);
    const tasks = [reload()];
    if (isAdmin) {
      tasks.push(
        apiGet('/api/users')
          .then((u) => {
            const list = (u?.data || u || []).filter((x) => ['admin', 'lead', 'superadmin'].includes(x.role));
            setUserCandidates(list);
          })
          .catch(() => {})
      );
    }
    Promise.all(tasks)
      .catch((e) => setErr(e.message || 'Error'))
      .finally(() => setLoading(false));
  }, [id, isAdmin]); // reload no se incluye intencionalmente: sólo refrescamos al cambiar id/isAdmin.

  const updateDeliveryManager = async (deliveryManagerId) => {
    setSavingDM(true);
    try {
      await apiPut(`/api/contracts/${id}`, { delivery_manager_id: deliveryManagerId || null });
      await reload();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error guardando delivery manager: ' + (e.message || ''));
    } finally { setSavingDM(false); }
  };

  const runKickOff = async (force = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(kickOffDate)) {
      setKickOffMsg({ ok: false, msg: 'Fecha de kick-off inválida.' });
      return;
    }
    setKickOffBusy(true); setKickOffMsg(null);
    try {
      const url = `/api/contracts/${id}/kick-off${force ? '?force=1' : ''}`;
      const res = await apiPost(url, { kick_off_date: kickOffDate });
      const created = res?.created_requests?.length ?? 0;
      const skipped = res?.skipped?.length ?? 0;
      setKickOffMsg({
        ok: true,
        msg: `✓ Kick-off ${kickOffDate}: ${created} solicitudes creadas${skipped ? ` (${skipped} líneas saltadas)` : ''}.`,
      });
      await reload();
    } catch (e) {
      const msg = e.message || 'Error en kick-off';
      // El servidor devuelve 409 con code:'already_seeded' — ofrecer
      // resembrar.
      if (/already.?seeded|ya tiene solicitudes/i.test(msg)) {
        // eslint-disable-next-line no-alert
        if (window.confirm('El contrato ya tiene solicitudes. ¿Borrarlas y resembrar desde la cotización?')) {
          await runKickOff(true);
          return;
        }
      }
      setKickOffMsg({ ok: false, msg });
    } finally { setKickOffBusy(false); }
  };

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
          <Field label="Cotización ganadora">
            {contract.winning_quotation_id
              ? <Link to={`/quotation/${contract.winning_quotation_id}`} style={s.link}>{contract.winning_quotation_name || 'ver'}</Link>
              : null}
          </Field>
          <Field label="Account owner">{contract.account_owner_name || contract.account_owner_email || contract.account_owner_id}</Field>
          <Field label="Delivery manager">{contract.delivery_manager_name || contract.delivery_manager_email || (contract.delivery_manager_id ? contract.delivery_manager_id : '— sin asignar —')}</Field>
          <Field label="Capacity manager">{contract.capacity_manager_name || contract.capacity_manager_email || contract.capacity_manager_id}</Field>
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

      {/* Admin: asignar delivery manager. */}
      {isAdmin && (
        <div style={s.card}>
          <h2 style={s.h2}>Delivery manager</h2>
          <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8 }}>
            El delivery manager es quien hace el kick-off (sembrar solicitudes desde la cotización) y administra los recursos del contrato.
          </div>
          <select
            value={contract.delivery_manager_id || ''}
            onChange={(e) => updateDeliveryManager(e.target.value || null)}
            disabled={savingDM}
            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, minWidth: 320 }}
            aria-label="Delivery manager"
          >
            <option value="">— Sin delivery manager asignado —</option>
            {userCandidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email} {u.role !== 'lead' ? `(${u.role})` : ''}
              </option>
            ))}
          </select>
          {savingDM && <span style={{ fontSize: 12, color: 'var(--text-light)', marginLeft: 10 }}>Guardando…</span>}
        </div>
      )}

      {/* Kick-off panel: visible si el contrato tiene cotización ganadora y el
          caller es admin / DM / account_owner / capacity_manager. */}
      {contract.winning_quotation_id && (isAdmin
        || contract.delivery_manager_id === userId
        || contract.account_owner_id === userId
        || contract.capacity_manager_id === userId
      ) && (
        <div style={{ ...s.card, borderColor: 'var(--purple-dark)', background: '#fbfaff' }}>
          <h2 style={s.h2}>🚀 Kick-off del proyecto</h2>
          {requests.length === 0 ? (
            <>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                Cuando ejecutes el kick-off, el sistema leerá las líneas de la cotización ganadora y creará automáticamente las solicitudes de recursos con estos defaults:
              </div>
              <ul style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 0, marginBottom: 12, paddingLeft: 20 }}>
                <li>Rol, nivel, país y cantidad de cada línea</li>
                <li>Horas semanales = horas/semana de la cotización</li>
                <li>Inicio = fecha de kick-off</li>
                <li>Fin = kick-off + duración (meses) de la línea</li>
                <li>Área inferida del specialty (puedes ajustar después)</li>
              </ul>
            </>
          ) : (
            <div style={{ fontSize: 13, marginBottom: 12, color: 'var(--text-light)' }}>
              {contract.metadata?.kick_off_date ? (
                <>Kick-off realizado el <strong>{String(contract.metadata.kick_off_date).slice(0, 10)}</strong>. {requests.length} solicitudes vivas. Puedes resembrar (borra las actuales) si necesitas reiniciar desde la cotización.</>
              ) : (
                <>Este contrato ya tiene {requests.length} solicitudes — el kick-off no es necesario. Si quieres regenerar desde la cotización, marca "Resembrar".</>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
            <div>
              <div style={s.label}>Fecha de kick-off</div>
              <input
                type="date"
                value={kickOffDate}
                onChange={(e) => setKickOffDate(e.target.value)}
                style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, marginTop: 4 }}
                aria-label="Fecha de kick-off"
              />
            </div>
            <button
              type="button"
              onClick={() => runKickOff(false)}
              disabled={kickOffBusy}
              style={{
                background: 'var(--purple-dark)', color: '#fff', border: 'none', borderRadius: 8,
                padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: kickOffBusy ? 'wait' : 'pointer',
                opacity: kickOffBusy ? 0.6 : 1,
              }}
              aria-label="Iniciar kick-off"
            >
              {kickOffBusy ? 'Procesando…' : (requests.length === 0 ? '🚀 Iniciar kick-off' : '🔄 Resembrar desde cotización')}
            </button>
          </div>
          {kickOffMsg && (
            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13,
              background: kickOffMsg.ok ? '#e8f5ec' : '#fde8eb',
              border: `1px solid ${kickOffMsg.ok ? '#10b981' : '#ef4444'}`,
              color: kickOffMsg.ok ? '#065f46' : '#b00020',
            }} role="status">
              {kickOffMsg.msg}
            </div>
          )}
        </div>
      )}

      {/* Si tiene cotización pero no hay DM ni eres admin → recordatorio. */}
      {contract.winning_quotation_id && !contract.delivery_manager_id && !isAdmin && (
        <div style={{ ...s.card, background: '#fffbe6', borderColor: '#facc15' }}>
          <div style={{ fontSize: 13, color: '#92400e' }}>
            Este contrato aún no tiene <strong>delivery manager</strong> asignado. Pídele al admin que asigne uno antes de iniciar el kick-off.
          </div>
        </div>
      )}

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
