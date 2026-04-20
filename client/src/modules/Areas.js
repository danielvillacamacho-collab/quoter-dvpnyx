import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut } from '../utils/apiV2';

/* ========== styles (mirror Clients.js) ========== */
const s = {
  page:   { maxWidth: 1000, margin: '0 auto' },
  h1:     { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '0 0 6px' },
  sub:    { fontSize: 13, color: 'var(--text-light)', marginBottom: 16 },
  card:   { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 },
  btn: (c = 'var(--purple-dark)') => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Montserrat' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  input:  { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none' },
  label:  { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th:     { padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:     { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  modalBg:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

const EMPTY = { key: '', name: '', description: '', sort_order: 0 };

function AreaForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.key.trim()) return setErr('key es requerido');
    if (!form.name.trim()) return setErr('Nombre es requerido');
    try { await onSave(form); }
    catch (ex) { setErr(ex.message || 'Error guardando'); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar área' : 'Nueva área'}
      </h2>
      <div>
        <label style={s.label}>Key (identificador técnico) *</label>
        <input
          style={s.input}
          value={form.key}
          onChange={(e) => set('key', e.target.value)}
          placeholder="ej. frontend_development"
          disabled={!!initial?.id}
          aria-label="Key"
          required
        />
        {initial?.id && (
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
            La key no se edita una vez creada (otros sistemas pueden referenciarla).
          </div>
        )}
      </div>
      <div>
        <label style={s.label}>Nombre *</label>
        <input
          style={s.input}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="ej. Desarrollo Frontend"
          autoFocus
          aria-label="Nombre"
          required
        />
      </div>
      <div>
        <label style={s.label}>Descripción</label>
        <textarea
          style={{ ...s.input, minHeight: 60, resize: 'vertical' }}
          value={form.description || ''}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div>
        <label style={s.label}>Orden</label>
        <input
          style={s.input}
          type="number"
          value={form.sort_order ?? 0}
          onChange={(e) => set('sort_order', Number(e.target.value))}
          aria-label="Orden"
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

export default function Areas() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet('/api/areas');
      setData(r?.data || []);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error cargando áreas: ' + e.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      if (editing?.id) await apiPut(`/api/areas/${editing.id}`, form);
      else await apiPost('/api/areas', form);
      setShowForm(false);
      setEditing(null);
      await load();
    } finally { setSaving(false); }
  };

  const onToggleActive = async (a) => {
    const endpoint = a.active ? 'deactivate' : 'activate';
    try {
      await apiPost(`/api/areas/${a.id}/${endpoint}`, {});
      await load();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>🧭 Áreas</h1>
          <div style={s.sub}>Agrupaciones de especialidad. Se seedean 9 al instalar; puedes crear o desactivar.</div>
        </div>
        <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nueva Área
        </button>
      </div>

      <div style={s.card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                {['Orden', 'Key', 'Nombre', 'Descripción', 'Empleados activos', 'Estado', ''].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!loading && data.length === 0 && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay áreas todavía.
                </td></tr>
              )}
              {data.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...s.td, textAlign: 'center', fontFamily: 'monospace' }}>{a.sort_order}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{a.key}</td>
                  <td style={{ ...s.td, fontWeight: 600 }}>{a.name}</td>
                  <td style={{ ...s.td, color: 'var(--text-light)' }}>{a.description || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{a.active_employees_count ?? 0}</td>
                  <td style={s.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: a.active ? 'var(--success)' : 'var(--text-light)', color: '#fff',
                    }}>{a.active ? 'Activa' : 'Inactiva'}</span>
                  </td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => { setEditing(a); setShowForm(true); }}
                            aria-label={`Editar ${a.name}`}>Editar</button>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11 }}
                            onClick={() => onToggleActive(a)}
                            aria-label={`${a.active ? 'Desactivar' : 'Activar'} ${a.name}`}>
                      {a.active ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <AreaForm
              initial={editing}
              saving={saving}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSave={onSave}
            />
          </div>
        </div>
      )}
    </div>
  );
}
