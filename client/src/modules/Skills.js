import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut } from '../utils/apiV2';

const s = {
  page:   { maxWidth: 1100, margin: '0 auto' },
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
  filters:{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'end' },
  modalBg:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

/** Predefined categories per spec (UI hint — backend stores the free-form string). */
const CATEGORY_OPTIONS = [
  '', 'language', 'framework', 'database', 'cloud', 'tool', 'methodology', 'soft', 'other',
];

const EMPTY = { name: '', category: '', description: '' };

function SkillForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) return setErr('Nombre es requerido');
    try { await onSave(form); }
    catch (ex) { setErr(ex.message || 'Error guardando'); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar skill' : 'Nuevo skill'}
      </h2>
      <div>
        <label style={s.label}>Nombre *</label>
        <input
          style={s.input}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="ej. TypeScript"
          autoFocus
          aria-label="Nombre"
          required
        />
      </div>
      <div>
        <label style={s.label}>Categoría</label>
        <select
          style={s.input}
          value={form.category || ''}
          onChange={(e) => set('category', e.target.value)}
          aria-label="Categoría"
        >
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c || '— Sin categoría —'}</option>)}
        </select>
      </div>
      <div>
        <label style={s.label}>Descripción</label>
        <textarea
          style={{ ...s.input, minHeight: 60, resize: 'vertical' }}
          value={form.description || ''}
          onChange={(e) => set('description', e.target.value)}
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

export default function Skills() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      if (categoryFilter) qs.set('category', categoryFilter);
      if (activeOnly) qs.set('active', 'true');
      const r = await apiGet(`/api/skills?${qs}`);
      setData(r?.data || []);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error cargando skills: ' + e.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, activeOnly]);

  useEffect(() => { load(); }, [load]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      if (editing?.id) await apiPut(`/api/skills/${editing.id}`, form);
      else await apiPost('/api/skills', form);
      setShowForm(false);
      setEditing(null);
      await load();
    } finally { setSaving(false); }
  };

  const onToggleActive = async (sk) => {
    const endpoint = sk.active ? 'deactivate' : 'activate';
    try {
      await apiPost(`/api/skills/${sk.id}/${endpoint}`, {});
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
          <h1 style={s.h1}>🏷 Skills</h1>
          <div style={s.sub}>Catálogo de skills técnicos y blandos. ~60 seeded al instalar.</div>
        </div>
        <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nuevo Skill
        </button>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input
              style={s.input}
              placeholder="Nombre del skill"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar skills"
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Categoría</label>
            <select style={s.input} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filtro por categoría">
              <option value="">Cualquiera</option>
              {CATEGORY_OPTIONS.filter((c) => c).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-light)' }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Sólo activos
          </label>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                {['Nombre', 'Categoría', 'Empleados', 'Estado', ''].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!loading && data.length === 0 && (
                <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay skills que coincidan.
                </td></tr>
              )}
              {data.map((sk) => (
                <tr key={sk.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{sk.name}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{sk.category || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{sk.employees_count ?? 0}</td>
                  <td style={s.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: sk.active ? 'var(--success)' : 'var(--text-light)', color: '#fff',
                    }}>{sk.active ? 'Activo' : 'Inactivo'}</span>
                  </td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => { setEditing(sk); setShowForm(true); }}
                            aria-label={`Editar ${sk.name}`}>Editar</button>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11 }}
                            onClick={() => onToggleActive(sk)}
                            aria-label={`${sk.active ? 'Desactivar' : 'Activar'} ${sk.name}`}>
                      {sk.active ? 'Desactivar' : 'Activar'}
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
            <SkillForm
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
