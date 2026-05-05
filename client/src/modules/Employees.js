import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiV2';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';
import StatusBadge from '../shell/StatusBadge';
import Avatar from '../shell/Avatar';
import SortableTh from '../shell/SortableTh';
import { useSort } from '../utils/useSort';

const s = {
  page:   { maxWidth: 1300, margin: '0 auto' },
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
  modal:  { background: '#fff', borderRadius: 12, padding: 24, width: 640, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' },
};

const LEVELS = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];
const STATUSES = [
  { value: 'active',     label: 'Activo' },
  { value: 'on_leave',   label: 'De permiso' },
  { value: 'bench',      label: 'En banca' },
  { value: 'terminated', label: 'Terminado' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((x) => [x.value, x.label]));
const STATUS_COLOR = {
  active: 'var(--success)', on_leave: 'var(--orange)', bench: 'var(--teal-mid)', terminated: 'var(--text-light)',
};
const EMPLOYMENT_TYPES = [
  { value: 'fulltime',   label: 'Full time' },
  { value: 'parttime',   label: 'Part time' },
  { value: 'contractor', label: 'Contratista' },
];

const PROFICIENCIES = [
  { value: 'beginner',     label: 'Principiante' },
  { value: 'intermediate', label: 'Intermedio' },
  { value: 'advanced',     label: 'Avanzado' },
  { value: 'expert',       label: 'Experto' },
];

const EMPTY = {
  first_name: '', last_name: '', personal_email: '', corporate_email: '',
  country: 'Colombia', city: '', area_id: '', level: 'L3',
  seniority_label: '', employment_type: 'fulltime',
  weekly_capacity_hours: 40, start_date: '', end_date: '',
  status: 'active', notes: '', tags: [],
};

function EmployeeForm({ initial, areas, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.first_name.trim()) return setErr('Nombre es requerido');
    if (!form.last_name.trim()) return setErr('Apellido es requerido');
    if (!form.country.trim()) return setErr('País es requerido');
    if (!form.area_id) return setErr('Área es requerida');
    if (!form.level) return setErr('Level es requerido');
    if (!form.start_date) return setErr('Fecha de inicio es requerida');
    try { await onSave(form); }
    catch (ex) { setErr(ex.message || 'Error guardando'); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
        {initial?.id ? 'Editar empleado' : 'Nuevo empleado'}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Nombre *</label>
          <input style={s.input} value={form.first_name} onChange={(e) => set('first_name', e.target.value)} aria-label="Nombre" required autoFocus />
        </div>
        <div>
          <label style={s.label}>Apellido *</label>
          <input style={s.input} value={form.last_name} onChange={(e) => set('last_name', e.target.value)} aria-label="Apellido" required />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Email corporativo</label>
          <input style={s.input} type="email" value={form.corporate_email || ''} onChange={(e) => set('corporate_email', e.target.value)} aria-label="Email corporativo" />
        </div>
        <div>
          <label style={s.label}>Email personal</label>
          <input style={s.input} type="email" value={form.personal_email || ''} onChange={(e) => set('personal_email', e.target.value)} aria-label="Email personal" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>País *</label>
          <input style={s.input} value={form.country} onChange={(e) => set('country', e.target.value)} aria-label="País" required />
        </div>
        <div>
          <label style={s.label}>Ciudad</label>
          <input style={s.input} value={form.city || ''} onChange={(e) => set('city', e.target.value)} aria-label="Ciudad" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Área *</label>
          <select style={s.input} value={form.area_id || ''} onChange={(e) => set('area_id', Number(e.target.value) || '')} aria-label="Área" required>
            <option value="">— Selecciona —</option>
            {areas.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Level *</label>
          <select style={s.input} value={form.level} onChange={(e) => set('level', e.target.value)} aria-label="Level" required>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Seniority (texto)</label>
          <input style={s.input} value={form.seniority_label || ''} onChange={(e) => set('seniority_label', e.target.value)} placeholder="ej. Senior" aria-label="Seniority" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Tipo de contrato</label>
          <select style={s.input} value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)} aria-label="Tipo de contrato">
            {EMPLOYMENT_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Horas semanales</label>
          <input style={s.input} type="number" min={0} max={60} step={0.5} value={form.weekly_capacity_hours} onChange={(e) => set('weekly_capacity_hours', Number(e.target.value))} aria-label="Horas semanales" />
        </div>
        <div>
          <label style={s.label}>Estado</label>
          <select style={s.input} value={form.status} onChange={(e) => set('status', e.target.value)} aria-label="Estado">
            {STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Fecha de inicio *</label>
          <input style={s.input} type="date" value={form.start_date ? String(form.start_date).slice(0, 10) : ''} onChange={(e) => set('start_date', e.target.value)} aria-label="Fecha de inicio" required />
        </div>
        <div>
          <label style={s.label}>Fecha de fin</label>
          {/* Indefinida = NULL en BD = "proyectada al futuro" para todos los
              cálculos internos del quoter (capacity, planner, idle time).
              Solo se pone fecha si hay contrato a término fijo o si renunció
              /se despidió. Sin esta opción explícita, los comerciales tendían
              a poner una fecha cualquiera y el empleado quedaba como inactivo
              al pasar esa fecha (ver fix 36a8b37). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="end_date_mode"
                  checked={!form.end_date}
                  onChange={() => set('end_date', null)}
                  aria-label="Fecha de fin indefinida"
                />
                Indefinida
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="end_date_mode"
                  checked={!!form.end_date}
                  onChange={() => set('end_date', new Date().toISOString().slice(0, 10))}
                  aria-label="Fecha de fin específica"
                />
                Hasta una fecha
              </label>
            </div>
            {form.end_date ? (
              <input
                style={s.input}
                type="date"
                value={String(form.end_date).slice(0, 10)}
                onChange={(e) => set('end_date', e.target.value || null)}
                aria-label="Fecha de fin"
              />
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-light)', lineHeight: 1.4 }}>
                Indefinida — se proyecta al futuro. Solo pon fecha si tienes contrato a término fijo o si renunció/se despidió.
              </div>
            )}
          </div>
        </div>
      </div>
      <div>
        <label style={s.label}>Notas</label>
        <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={s.btnOutline} onClick={onCancel}>Cancelar</button>
        <button type="submit" style={s.btn()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

/**
 * EE-3: inline skills manager for a single employee. Opens over the
 * employee row so admins can add/edit/remove skills without leaving
 * the list. Uses the nested /api/employees/:id/skills endpoints.
 */
function EmployeeSkillsModal({ employee, onClose }) {
  const [skills, setSkills] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [addForm, setAddForm] = useState({ skill_id: '', proficiency: 'intermediate', years_experience: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        apiGet(`/api/employees/${employee.id}/skills`),
        apiGet('/api/skills?active=true'),
      ]);
      setSkills(r?.data || []);
      setCatalog(c?.data || []);
    } catch (e) {
      setErr(e.message || 'Error cargando');
    } finally {
      setLoading(false);
    }
  }, [employee.id]);

  useEffect(() => { reload(); }, [reload]);

  const availableCatalog = catalog.filter((c) => !skills.some((sk) => sk.skill_id === c.id));

  const addSkill = async (e) => {
    e.preventDefault();
    setErr('');
    if (!addForm.skill_id) return setErr('Selecciona un skill');
    setBusy(true);
    try {
      await apiPost(`/api/employees/${employee.id}/skills`, {
        skill_id: Number(addForm.skill_id),
        proficiency: addForm.proficiency,
        years_experience: addForm.years_experience ? Number(addForm.years_experience) : null,
        notes: addForm.notes || null,
      });
      setAddForm({ skill_id: '', proficiency: 'intermediate', years_experience: '', notes: '' });
      await reload();
    } catch (ex) {
      setErr(ex.message || 'Error');
    } finally {
      setBusy(false);
    }
  };

  const updateSkill = async (sk, patch) => {
    try {
      await apiPut(`/api/employees/${employee.id}/skills/${sk.skill_id}`, patch);
      await reload();
    } catch (ex) {
      // eslint-disable-next-line no-alert
      alert(ex.message);
    }
  };

  const removeSkill = async (sk) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Remover "${sk.skill_name}" de ${employee.first_name}?`)) return;
    try {
      await apiDelete(`/api/employees/${employee.id}/skills/${sk.skill_id}`);
      await reload();
    } catch (ex) {
      // eslint-disable-next-line no-alert
      alert(ex.message);
    }
  };

  return (
    <div style={s.modalBg} role="dialog" aria-modal="true" aria-label="Skills del empleado">
      <div style={{ ...s.modal, width: 760 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>Skills</h2>
            <div style={{ fontSize: 13, color: 'var(--text-light)' }}>{employee.first_name} {employee.last_name}</div>
          </div>
          <button type="button" style={s.btnOutline} onClick={onClose}>Cerrar</button>
        </div>

        <div style={{ marginTop: 12 }}>
          {loading && <div style={{ color: 'var(--text-light)', fontSize: 13 }}>Cargando…</div>}
          {!loading && skills.length === 0 && (
            <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 12, textAlign: 'center' }}>
              Sin skills asignados todavía.
            </div>
          )}
          {!loading && skills.length > 0 && (
            <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Skill', 'Categoría', 'Proficiency', 'Años', 'Notas', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {skills.map((sk) => (
                  <tr key={sk.skill_id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>{sk.skill_name}</td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{sk.skill_category || '—'}</td>
                    <td style={s.td}>
                      <select
                        style={{ ...s.input, padding: '4px 6px', fontSize: 12 }}
                        value={sk.proficiency}
                        onChange={(e) => updateSkill(sk, { proficiency: e.target.value })}
                        aria-label={`Proficiency ${sk.skill_name}`}
                      >
                        {PROFICIENCIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </td>
                    <td style={s.td}>
                      <input
                        type="number" min={0} step={0.5}
                        style={{ ...s.input, padding: '4px 6px', fontSize: 12, width: 80 }}
                        defaultValue={sk.years_experience ?? ''}
                        onBlur={(e) => {
                          const v = e.target.value ? Number(e.target.value) : null;
                          if (v !== (sk.years_experience ?? null)) updateSkill(sk, { years_experience: v });
                        }}
                        aria-label={`Años ${sk.skill_name}`}
                      />
                    </td>
                    <td style={s.td}>
                      <input
                        style={{ ...s.input, padding: '4px 6px', fontSize: 12 }}
                        defaultValue={sk.notes || ''}
                        onBlur={(e) => { if (e.target.value !== (sk.notes || '')) updateSkill(sk, { notes: e.target.value }); }}
                        aria-label={`Notas ${sk.skill_name}`}
                      />
                    </td>
                    <td style={s.td}>
                      <button
                        style={{ ...s.btnOutline, padding: '3px 8px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        onClick={() => removeSkill(sk)}
                        aria-label={`Remover ${sk.skill_name}`}
                      >Remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add form */}
        <form onSubmit={addSkill} style={{ marginTop: 16, padding: 12, background: 'var(--bg-soft, #f7f5f8)', borderRadius: 8 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--purple-dark)' }}>Agregar skill</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr auto', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={s.label}>Skill *</label>
              <select
                style={s.input}
                value={addForm.skill_id}
                onChange={(e) => setAddForm({ ...addForm, skill_id: e.target.value })}
                aria-label="Nuevo skill"
                required
              >
                <option value="">— Selecciona —</option>
                {availableCatalog.map((c) => <option key={c.id} value={c.id}>{c.name}{c.category ? ` · ${c.category}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Proficiency</label>
              <select
                style={s.input}
                value={addForm.proficiency}
                onChange={(e) => setAddForm({ ...addForm, proficiency: e.target.value })}
                aria-label="Nueva proficiency"
              >
                {PROFICIENCIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Años</label>
              <input
                type="number" min={0} step={0.5} style={s.input}
                value={addForm.years_experience}
                onChange={(e) => setAddForm({ ...addForm, years_experience: e.target.value })}
                aria-label="Nuevos años"
              />
            </div>
            <div>
              <label style={s.label}>Notas</label>
              <input
                style={s.input}
                value={addForm.notes}
                onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                aria-label="Nuevas notas"
              />
            </div>
            <button type="submit" style={s.btn('var(--teal-mid)')} disabled={busy}>{busy ? 'Guardando…' : 'Agregar'}</button>
          </div>
          {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{err}</div>}
        </form>
      </div>
    </div>
  );
}

export default function Employees() {
  const [state, setState] = useState({ data: [], loading: true, page: 1, total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [areas, setAreas] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [skillsFor, setSkillsFor] = useState(null); // employee row for which the skills modal is open
  const sort = useSort({ field: 'last_name', dir: 'asc' });

  const load = useCallback(async (page = 1) => {
    setState((x) => ({ ...x, loading: true }));
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (search) qs.set('search', search);
    if (areaFilter) qs.set('area_id', areaFilter);
    if (levelFilter) qs.set('level', levelFilter);
    if (statusFilter) qs.set('status', statusFilter);
    sort.applyToQs(qs);
    try {
      const r = await apiGet(`/api/employees?${qs}`);
      setState({ data: r.data || [], loading: false, page: r.pagination?.page || 1, total: r.pagination?.total || 0, pages: r.pagination?.pages || 1 });
    } catch (e) {
      setState({ data: [], loading: false, page: 1, total: 0, pages: 1 });
      // eslint-disable-next-line no-alert
      alert('Error cargando empleados: ' + e.message);
    }
  }, [search, areaFilter, levelFilter, statusFilter, sort.field, sort.dir]);

  const loadAreas = useCallback(async () => {
    try {
      const r = await apiGet('/api/areas');
      setAreas(r?.data || []);
    } catch { setAreas([]); }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadAreas(); }, [loadAreas]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      if (editing?.id) await apiPut(`/api/employees/${editing.id}`, form);
      else await apiPost('/api/employees', form);
      setShowForm(false);
      setEditing(null);
      await load(state.page);
    } finally { setSaving(false); }
  };

  const onDelete = async (e) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Eliminar a "${e.first_name} ${e.last_name}"? (soft delete)`)) return;
    try {
      await apiDelete(`/api/employees/${e.id}`);
      await load(state.page);
    } catch (ex) {
      // eslint-disable-next-line no-alert
      alert(ex.message);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>🧑‍💻 Empleados</h1>
          <div style={s.sub}>Directorio de talento. Distinto de "Usuarios" del sistema (user_id es opcional).</div>
        </div>
        <button style={s.btn('var(--teal-mid)')} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nuevo Empleado
        </button>
      </div>

      <div style={s.card}>
        <div style={s.filters}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={s.label}>Buscar</label>
            <input style={s.input} placeholder="Nombre, apellido o email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar empleados" />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Área</label>
            <select style={s.input} value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} aria-label="Filtro por área">
              <option value="">Cualquiera</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 110 }}>
            <label style={s.label}>Level</label>
            <select style={s.input} value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} aria-label="Filtro por level">
              <option value="">Todos</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={s.label}>Estado</label>
            <select style={s.input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtro por estado">
              <option value="">Todos</option>
              {STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <SortableTh sort={sort} field="last_name" style={s.th}>Nombre</SortableTh>
                <SortableTh sort={sort} field="area_name" style={s.th}>Área</SortableTh>
                <SortableTh sort={sort} field="level" style={s.th}>Level</SortableTh>
                <SortableTh sort={sort} field="country" style={s.th}>País</SortableTh>
                <SortableTh sort={sort} field="weekly_capacity_hours" style={s.th}>Capacidad</SortableTh>
                <SortableTh sort={sort} field="skills_count" style={s.th}>Skills</SortableTh>
                <SortableTh sort={sort} field="status" style={s.th}>Estado</SortableTh>
                <SortableTh sort={sort} field="start_date" style={s.th}>Inicio</SortableTh>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</td></tr>
              )}
              {!state.loading && state.data.length === 0 && (
                <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  No hay empleados que coincidan con los filtros.
                </td></tr>
              )}
              {state.data.map((emp) => (
                <tr key={emp.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={`${emp.first_name} ${emp.last_name}`} size={28} />
                      <div>
                        <div><Link to={`/employees/${emp.id}`} style={{ color: 'var(--ds-text, var(--purple-dark))', textDecoration: 'none' }} aria-label={`Ver ${emp.first_name} ${emp.last_name}`}>{emp.first_name} {emp.last_name}</Link></div>
                        {emp.corporate_email && <div style={{ fontSize: 11, color: 'var(--ds-text-dim, var(--text-light))', fontWeight: 400 }}>{emp.corporate_email}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={s.td}>{emp.area_name || '—'}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{emp.level}</td>
                  <td style={s.td}>{emp.country}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{Number(emp.weekly_capacity_hours || 0)}h</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{emp.skills_count ?? 0}</td>
                  <td style={s.td}>
                    <StatusBadge domain="employee" value={emp.status} label={STATUS_LABEL[emp.status]} />
                  </td>
                  <td style={{ ...s.td, fontSize: 12 }}>{emp.start_date ? String(emp.start_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => { setEditing(emp); setShowForm(true); }}
                            aria-label={`Editar ${emp.first_name} ${emp.last_name}`}>Editar</button>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }}
                            onClick={() => setSkillsFor(emp)}
                            aria-label={`Skills ${emp.first_name} ${emp.last_name}`}>Skills</button>
                    <button style={{ ...s.btnOutline, padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={() => onDelete(emp)}
                            aria-label={`Eliminar ${emp.first_name} ${emp.last_name}`}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {state.pages > 1 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <button style={s.btnOutline} disabled={state.page <= 1} onClick={() => load(state.page - 1)}>← Anterior</button>
            <span style={{ fontSize: 13, color: 'var(--text-light)' }}>
              Página {state.page} de {state.pages} · {state.total} empleados
            </span>
            <button style={s.btnOutline} disabled={state.page >= state.pages} onClick={() => load(state.page + 1)}>Siguiente →</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={s.modalBg} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <EmployeeForm
              initial={editing}
              areas={areas}
              saving={saving}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSave={onSave}
            />
          </div>
        </div>
      )}

      {skillsFor && (
        <EmployeeSkillsModal
          employee={skillsFor}
          onClose={() => { setSkillsFor(null); load(state.page); }}
        />
      )}
    </div>
  );
}
