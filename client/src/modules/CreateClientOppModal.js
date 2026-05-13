/**
 * CreateClientOppModal — modal para crear un Cliente y/o Oportunidad nuevos
 * directamente desde los editores de cotización (Staff Aug / Proyecto).
 *
 * Props:
 *   mode         'client' | 'opportunity'
 *   clientId     string | null — si mode='opportunity', el cliente ya seleccionado
 *   clientName   string — nombre del cliente (para context en modo opportunity)
 *   onCreated    ({ client_id, client_name, opportunity_id?, opportunity_name? }) => void
 *   onCancel     () => void
 */
import React, { useState } from 'react';
import { apiPost } from '../utils/apiV2';

const s = {
  bg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  modal: { background: '#fff', borderRadius: 12, padding: 28, width: 480, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
  h2: { margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat', fontSize: 18 },
  sub: { fontSize: 13, color: 'var(--text-light)', margin: '4px 0 20px' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
};

export default function CreateClientOppModal({ mode, clientId, clientName, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [oppName, setOppName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // When the backend returns 409, we store the existing client so the user
  // can opt to use it instead of being left stuck with just an error message.
  const [existingClient, setExistingClient] = useState(null); // { id, name }

  const isClientMode = mode === 'client';

  const useExistingClient = async () => {
    if (!existingClient) return;
    setBusy(true);
    setErr('');
    try {
      if (oppName.trim()) {
        const opp = await apiPost('/api/opportunities', {
          client_id: existingClient.id,
          name: oppName.trim(),
        });
        onCreated({
          client_id: existingClient.id,
          client_name: existingClient.name,
          opportunity_id: opp.id,
          opportunity_name: opp.name,
        });
      } else {
        onCreated({
          client_id: existingClient.id,
          client_name: existingClient.name,
        });
      }
    } catch (ex) {
      setErr(ex.message || 'Error al crear la oportunidad');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    setErr('');
    setExistingClient(null);
    if (isClientMode) {
      if (!name.trim()) return setErr('El nombre del cliente es requerido');
    } else {
      if (!oppName.trim()) return setErr('El nombre de la oportunidad es requerido');
    }
    setBusy(true);
    try {
      if (isClientMode) {
        const client = await apiPost('/api/clients', { name: name.trim() });
        // If user also typed an opp name, create it under the new client
        if (oppName.trim()) {
          const opp = await apiPost('/api/opportunities', {
            client_id: client.id,
            name: oppName.trim(),
          });
          onCreated({
            client_id: client.id,
            client_name: client.name,
            opportunity_id: opp.id,
            opportunity_name: opp.name,
          });
        } else {
          onCreated({
            client_id: client.id,
            client_name: client.name,
          });
        }
      } else {
        // mode === 'opportunity'
        const opp = await apiPost('/api/opportunities', {
          client_id: clientId,
          name: oppName.trim(),
        });
        onCreated({
          client_id: clientId,
          client_name: clientName,
          opportunity_id: opp.id,
          opportunity_name: opp.name,
        });
      }
    } catch (ex) {
      // 409 means the client already exists — the backend returns existing_id + hint
      // so the user can opt to use the existing client instead of being stuck.
      if (ex.status === 409 && ex.body?.existing_id) {
        setExistingClient({ id: ex.body.existing_id, name: ex.body.hint || name.trim() });
        setErr(`Ya existe un cliente con ese nombre: "${ex.body.hint || name.trim()}"`);
      } else {
        setErr(ex.message || 'Error al crear');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={s.bg} role="dialog" aria-modal="true" aria-label={isClientMode ? 'Crear cliente' : 'Crear oportunidad'}>
      <div style={s.modal}>
        <h2 style={s.h2}>{isClientMode ? 'Nuevo Cliente' : 'Nueva Oportunidad'}</h2>
        <div style={s.sub}>
          {isClientMode
            ? 'Crea un nuevo cliente y opcionalmente una oportunidad asociada.'
            : `Crea una oportunidad para ${clientName || 'el cliente seleccionado'}.`}
        </div>

        {isClientMode && (
          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>Nombre del cliente *</label>
            <input
              style={s.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Acme Corp"
              autoFocus
            />
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={s.label}>
            {isClientMode ? 'Nombre de la oportunidad (opcional)' : 'Nombre de la oportunidad *'}
          </label>
          <input
            style={s.input}
            value={oppName}
            onChange={(e) => setOppName(e.target.value)}
            placeholder="Ej: Portal E-commerce 2026"
            autoFocus={!isClientMode}
          />
        </div>

        {err && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>
            {existingClient && (
              <button
                type="button"
                style={{ ...s.btn('var(--teal-mid)'), marginTop: 8, width: '100%' }}
                onClick={useExistingClient}
                disabled={busy}
              >
                {busy ? 'Vinculando…' : `Usar "${existingClient.name}" (cliente existente)`}
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" style={s.btnOutline} onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" style={s.btn('var(--teal-mid)')} onClick={handleCreate} disabled={busy}>
            {busy ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  );
}
