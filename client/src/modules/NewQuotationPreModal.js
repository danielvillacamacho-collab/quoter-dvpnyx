/**
 * Pre-modal shown when a user clicks "+ Staff Aug" or "+ Proyecto"
 * (EX-1). Forces selection of cliente + oportunidad BEFORE the editor
 * loads — the server now rejects POST /api/quotations without both IDs.
 *
 * Minimal viable UX:
 *  - Cliente dropdown (active only, up to 100). Fallback: link to /clients.
 *  - Oportunidad dropdown filtered by the selected cliente.
 *  - "+ Nueva oportunidad" inline sub-form (captures name; owner/squad
 *    default server-side from req.user).
 *
 * Picking a client does NOT auto-create legacy data — that migration
 * is handled by `migrate_v2_data.js` at infra level.
 */
import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../utils/apiV2';

const s = {
  bg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  modal: { background: '#fff', borderRadius: 12, padding: 28, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
  h2: { margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat', fontSize: 20 },
  sub: { fontSize: 13, color: 'var(--text-light)', margin: '4px 0 20px' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none' },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  inlineBtn: { background: 'transparent', color: 'var(--teal-mid)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, marginTop: 4 },
};

export default function NewQuotationPreModal({ type, onContext, onCancel }) {
  const [clients, setClients] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [clientId, setClientId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [showNewOpp, setShowNewOpp] = useState(false);
  const [newOppName, setNewOppName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Load active clients on mount
  useEffect(() => {
    apiGet('/api/clients?limit=100&active=true')
      .then((r) => setClients(r?.data || []))
      .catch(() => setClients([]));
  }, []);

  // Load opportunities whenever the selected client changes
  useEffect(() => {
    setOpportunityId('');
    setShowNewOpp(false);
    if (!clientId) { setOpportunities([]); return; }
    apiGet(`/api/opportunities?client_id=${clientId}&limit=100`)
      .then((r) => setOpportunities((r?.data || []).filter((o) => !['lost', 'cancelled'].includes(o.status))))
      .catch(() => setOpportunities([]));
  }, [clientId]);

  const createOpp = async () => {
    if (!newOppName.trim()) return setErr('Nombre de oportunidad requerido');
    setBusy(true);
    setErr('');
    try {
      const opp = await apiPost('/api/opportunities', {
        client_id: clientId,
        name: newOppName.trim(),
      });
      setOpportunities((prev) => [opp, ...prev]);
      setOpportunityId(opp.id);
      setShowNewOpp(false);
      setNewOppName('');
    } catch (ex) {
      setErr(ex.message || 'Error creando oportunidad');
    } finally {
      setBusy(false);
    }
  };

  const continueToEditor = () => {
    if (!clientId) return setErr('Selecciona un cliente');
    if (!opportunityId) return setErr('Selecciona una oportunidad');
    const cl = clients.find((c) => c.id === clientId);
    const opp = opportunities.find((o) => o.id === opportunityId);
    onContext({
      client_id: clientId,
      opportunity_id: opportunityId,
      client_name: cl?.name || '',
      opportunity_name: opp?.name || '',
    });
  };

  const typeLabel = type === 'fixed_scope' ? 'Proyecto Alcance Fijo' : 'Staff Augmentation';

  return (
    <div style={s.bg} role="dialog" aria-modal="true" aria-label="Seleccionar cliente y oportunidad">
      <div style={s.modal}>
        <h2 style={s.h2}>Nueva cotización — {typeLabel}</h2>
        <div style={s.sub}>Antes de crear la cotización necesitamos vincularla a un cliente y una oportunidad.</div>

        <div style={{ marginBottom: 16 }}>
          <label style={s.label}>Cliente *</label>
          <select
            style={s.input}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            aria-label="Cliente"
          >
            <option value="">— Selecciona un cliente —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {clients.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
              No hay clientes activos. <a href="/clients" style={{ color: 'var(--teal-mid)' }}>Crea uno en /clients</a> y vuelve.
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={s.label}>Oportunidad *</label>
          <select
            style={s.input}
            value={opportunityId}
            onChange={(e) => setOpportunityId(e.target.value)}
            aria-label="Oportunidad"
            disabled={!clientId}
          >
            <option value="">
              {clientId ? '— Selecciona una oportunidad —' : '— Primero selecciona un cliente —'}
            </option>
            {opportunities.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.status})</option>)}
          </select>
          {clientId && opportunities.length === 0 && !showNewOpp && (
            <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
              Este cliente no tiene oportunidades abiertas.
            </div>
          )}
          {clientId && !showNewOpp && (
            <button type="button" style={s.inlineBtn} onClick={() => setShowNewOpp(true)}>
              + Nueva oportunidad para este cliente
            </button>
          )}
        </div>

        {showNewOpp && (
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-soft, #f7f5f8)', borderRadius: 8 }}>
            <label style={s.label}>Nombre de la oportunidad *</label>
            <input
              style={s.input}
              value={newOppName}
              onChange={(e) => setNewOppName(e.target.value)}
              placeholder="Ej. Portal E-commerce 2026"
              aria-label="Nombre de nueva oportunidad"
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" style={s.btnOutline} onClick={() => { setShowNewOpp(false); setNewOppName(''); }} disabled={busy}>
                Cancelar
              </button>
              <button type="button" style={s.btn('var(--teal-mid)')} onClick={createOpp} disabled={busy}>
                {busy ? 'Creando…' : 'Crear oportunidad'}
              </button>
            </div>
          </div>
        )}

        {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
          <button type="button" style={s.btn()} onClick={continueToEditor} disabled={!clientId || !opportunityId}>
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
