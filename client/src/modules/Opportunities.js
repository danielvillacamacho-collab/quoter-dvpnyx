import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '../utils/apiV2';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';

/* ========== styles (mirror Clients.js) ========== */
const s = {
  page:   { maxWidth: 1200, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  input:  { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none' },
  label:  { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  // UI refresh Phase 2 — table styles come from the shared design-tokens
  // helper so every list page adopts the same density + palette at once.
  th:     dsTh,
  td:     dsTd,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  filters:{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'end' },
  modalBg:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

const STATUS_OPTIONS = [
  { value: '',            label: 'Todos' },
  { value: 'open',        label: 'Abierta' },
  { value: 'qualified',   label: 'Calificada' },
  { value: 'proposal',    label: 'Propuesta' },
  { value: 'negotiation', label: 'Negociación' },
  { value: 'won',         label: 'Ganada' },
  { value: 'lost',        label: 'Perdida' },
  { value: 'cancelled',   label: 'Cancelada' },
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

const STATUS_COLORS = {
  open:        'var(--purple-dark)',
  qualified:   'var(--teal-mid)',
  proposal:    'var(--teal-mid)',
  negotiation: 'var(--orange)',
  won:         'var(--success)',
  lost:        'var(--danger)',
  cancelled:   'var(--text-light)',
};

const TRANSITIONS = {
  open:        ['qualified', 'cancelled'],
  qualified:   ['proposal',  'cancelled'],
  proposal:    ['negotiation', 'won', 'lost', 'cancelled'],
  negotiation: ['won', 'lost', 'cancelled'],
  won:         [],
  lost:        [],
  cancelled:   [],
};

const OUTCOME_REASONS = [
  { value: 'price',           label: 'Precio' },
  { value: 'timing',          label: 'Timing' },
  { value: 'competition',     label: 'Competencia' },
  { value: 'technical_fit',   label: 'Fit técnico' },
  { value: 'client_internal', label: 'Interna del cliente' },
  { value: 'other',           label: 'Otro' },
];

const EMPTY = {
  client_id: '', name: '', description: '',
  expected_close_date: '', tags: [],
};

function OpportunityForm({ initial, clients, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.client_id) return setErr('Cliente es requerido');
    if (!form.name.trim()) return setErr('El nombre es requerido');
    try {
      await onSave(form);
    } catch (ex) {
      setErr(ex.message || 'Error guardando');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar oportunidad' : 'Nueva oportunidad'}
      </h2>
      <div>
        <label style={s.label}>Cliente *</label>
        <select
          style={s.input}
          value={form.client_id || ''}
          onChange={(e) => set('client_id', e.target.value)}
          aria-label="Cliente"
          required
          disabled={!!initial?.id}
        >
          <option value="">— Selecciona —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label style={s.label}>Nombre *</label>
        <input style={s.input} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus required />
      </div>
      <div>
        <label style={s.label}>Descripción</label>
        <textarea
          style={{ ...s.input, minHeight: 80, resize: 'vertical' }}
          value={form.description || ''}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div>
        <label style={s.label}>Fecha esperada de cierre</label>
        <input
          type="date"
          style={s.input}
          value={form.expected_close_date || ''}
          onChange={(e) => set('expected_close_date', e.target.value)}
        />
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

function TransitionModal({ opp, target, onConfirm, onCancel, saving }) {
  const needsWinningQuot = target === 'won';
  const needsReason      = target === 'lost' || target === 'cancelled';
  const [winningId, setWinningId] = useState('');
  const [reason, setReason]       = useState('');
  const [notes, setNotes]         = useState('');
  const [err, setErr]             = useState('');

  // fetch quotations list for this opp when marking as won
  const [quotations, setQuotations] = useState([]);
  useEffect(() => {
    if (needsWinningQuot && opp?.id) {
      apiGet(`/api/opportunities/${opp.id}`).then((r) => setQuotations(r?.quotations || [])).catch(() => setQuotations([]));
    }
  }, [needsWinningQuot, opp?.id]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (needsWinningQuot && !winningId) return setErr('Selecciona cotización ganadora');
    if (needsReason && !reason) return setErr('Selecciona una razón');
    try {
      await onConfirm({
        new_status: target,
        winning_quotation_id: winningId || undefined,
        outcome_reason: reason || undefined,
        outcome_notes: notes || undefined,
      });
    } catch (ex) {
      setErr(ex.message || 'Error');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        Mover a {STATUS_LABEL[target] || target}
      </h2>
      <div style={{ fontSize: 13, color: 'var(--text-light)' }}>
        Oportunidad: <strong>{opp?.name}</strong>
      </div>
      {needsWinningQuot && (
        <div>
          <label style={s.label}>Cotización ganadora *</label>
          <select style={s.input} value={winningId} onChange={(e) => setWinningId(e.target.value)} aria-label="Cotización ganadora" required>
            <option value="">— Selecciona —</option>
            {quotations.map((q) => (
              <option key={q.id} value={q.id}>
                {q.project_name} · {q.status}
              </option>
            ))}
          </select>
          {quotations.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
              Esta oportunidad no tiene cotizaciones todavía.
            </div>
          )}
        </div>
      )}
      {needsReason && (
        <>
          <div>
            <label style={s.label}>Razón *</label>
            <select style={s.input} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Razón" required>
              <option value="">— Selecciona —</option>
              {OUTCOME_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>Notas</label>
            <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </>
      )}
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando…' : 'Confirmar'}</button>
      </div>
    </form>
  );
}

export default function Opportunities() {
  const nav = useNavigate();
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(null); // { opp, target }

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (search) qs.set('search', search);
    if (statusFilter) qs.set('status', statusFilter);
    if (clientFilter) qs.set('client_id', clientFilter);
    try {
      const r = await apiGet(`/api/opportunities?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando oportunidades: ' + e.message);
    }
  }, [search, statusFilter, clientFilter]);

  const loadClients = useCallback(async () => {
    try {
      const r = await apiGet('/api/clients?limit=100&active=true');
      setClients(r.data || []);
    } catch {
      setClients([]);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadClients(); }, [loadClients]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      const payload = {
        client_id: form.client_id,
        name: form.name,
        description: form.description,
        expected_close_date: form.expected_close_date || null,
      };
      if (editing?.id) {
        await apiPut(`/api/opportunities/${editing.id}`, payload);
      } else {
        await apiPost('/api/opportunities', payload);
      }
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (o) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar oportunidad "${o.name}"? Esta acción es reversible (soft delete).`)) return;
    try {
      await apiDelete(`/api/opportunities/${o.id}`);
      await load(state.page);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  const onTransition = async (payload) => {
    if (!transitioning) return;
    setSaving(true);
    try {
      await apiPost(`/api/opportunities/${transitioning.opp.id}/status`, payload);
      setTransitioning(null);
      await load(state.page);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>💼 Oportunidades</h1>
          <div style={s.sub}>Pipeline comercial. Una oportunidad agrupa cotizaciones de un mismo deal.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={{
              background: 'transparent',
              color: 'var(--ds-text, #222)',
              border: '1px solid var(--ds-border, #ccc)',
              borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'Montserrat',
            }}
            onClick={async () => {
              try {
                const qs = new URLSearchParams();
                if (search)        qs.set('search', search);
                if (clientFilter)  qs.set('client_id', clientFilter);
                if (statusFilter)  qs.set('status', statusFilter);
                await apiDownload(`/api/opportunities/export.csv${qs.toString() ? `?${qs}` : ''}`, 'oportunidades.csv');
              } catch (e) {
                // eslint-disable-next-line no-alert
                alert(`No se pudo descargar: ${e.message}`);
              }
            }}
            data-testid="opportunities-export-csv"
          >
            ⤓ Descargar CSV
          </button>
          <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
            + Nueva Oportunidad
          </button>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input
              style={s.input}
              placeholder="Nombre o descripción"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar oportunidades"
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Cliente</label>
            <select style={s.input} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Filtro por cliente">
              <option value="">Cualquiera</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Estado</label>
            <select style={s.input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtro por estado">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr>
                {['Nombre', 'Cliente', 'Estado', 'Cotizaciones', 'Cierre esperado', 'Creada', ''].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay oportunidades que coincidan con los filtros.
                </td></tr>
              )}
              {state.data.map((o) => {
                const nextStates = TRANSITIONS[o.status] || [];
                return (
                  <tr key={o.id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>
                      <Link to={`/opportunities/${o.id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none' }} aria-label={`Ver ${o.name}`}>{o.name}</Link>
                    </td>
                    <td style={s.td}>{o.client_name || '—'}</td>
                    <td style={s.td}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                        background: STATUS_COLORS[o.status] || 'var(--text-light)', color: '#fff',
                      }}>{STATUS_LABEL[o.status] || o.status}</span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{o.quotations_count ?? 0}</td>
                    <td style={s.td}>{o.expected_close_date ? String(o.expected_close_date).slice(0, 10) : '—'}</td>
                    <td style={s.td}>{o.created_at ? String(o.created_at).slice(0, 10) : '—'}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                              onClick={() => { setEditing(o); setShowForm(true); }}
                              aria-label={`Editar ${o.name}`}>Editar</button>
                      {nextStates.map((ns) => (
                        <button
                          key={ns}
                          style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                          onClick={() => setTransitioning({ opp: o, target: ns })}
                          aria-label={`Mover ${o.name} a ${STATUS_LABEL[ns]}`}
                        >
                          {STATUS_LABEL[ns]}
                        </button>
                      ))}
                      <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                              onClick={() => onDelete(o)}
                              aria-label={`Eliminar ${o.name}`}>Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {state.pages > 1 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <button style={s.btnOutline} disabled={state.page <= 1} onClick={() => load(state.page - 1)}>← Anterior</button>
            <span style={{ fontSize: 13, color: 'var(--text-light)' }}>
              Página {state.page} de {state.pages} · {state.total} oportunidades
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <OpportunityForm
              initial={editing}
              clients={clients}
              saving={saving}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSave={onSave}
            />
          </div>
        </div>
      )}

      {transitioning && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <TransitionModal
              opp={transitioning.opp}
              target={transitioning.target}
              saving={saving}
              onCancel={() => setTransitioning(null)}
              onConfirm={onTransition}
            />
          </div>
        </div>
      )}

      {/* Breadcrumb hosts the "back" link — keep a hidden anchor for Router */}
      <button type="button" onClick={() => nav('/')} style={{ display: 'none' }} aria-hidden="true" />
    </div>
  );
}
