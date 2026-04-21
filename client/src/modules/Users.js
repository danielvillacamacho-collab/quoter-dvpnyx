import React, { useState, useEffect } from 'react';
import * as api from '../utils/api';
import { useAuth } from '../AuthContext';
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';

/* ── constants ─────────────────────────────────────────────────── */
const ASSIGNABLE_ROLES = ['admin', 'lead', 'member', 'viewer'];
const ROLE_LABELS = {
  superadmin: 'Superadmin',
  admin:      'Administrador',
  lead:       'Lead',
  member:     'Member',
  viewer:     'Viewer',
};
const ROLE_COLORS = {
  superadmin: 'var(--purple-dark)',
  admin:      'var(--teal-mid)',
  lead:       '#7c3aed',
  member:     'var(--orange)',
  viewer:     'var(--text-light)',
};

const FUNCTION_LABELS = {
  comercial:         'Comercial',
  preventa:          'Pre-venta',
  capacity_manager:  'Capacity Manager',
  delivery_manager:  'Delivery Manager',
  project_manager:   'Project Manager',
  fte_tecnico:       'FTE Técnico',
  people:            'People',
  finance:           'Finance',
  pmo:               'PMO',
  admin:             'Administración',
};

/* ── styles ────────────────────────────────────────────────────── */
const css = {
  card: {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid var(--border)',
    padding: 20,
    marginBottom: 16,
  },
  btn: (bg) => ({
    background: bg,
    color: bg === 'transparent' ? 'var(--text-light)' : '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }),
  btnOutline: {
    background: 'transparent',
    color: 'var(--purple-dark)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-light)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'Inter, sans-serif' },
  select: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'Inter, sans-serif', background: '#fff' },
  // UI refresh Phase 2 — table styles from shared DS tokens.
  th: dsTh,
  td: dsTd,
  badge: (color) => ({
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    background: color + '20',
    color,
  }),
};

const EMPTY_FORM = { email: '', name: '', role: 'member', function: '', password: '000000' };

/* ── component ─────────────────────────────────────────────────── */
export default function Users() {
  const { user } = useAuth();
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showNew, setShowNew]   = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const isSuperadmin = user?.role === 'superadmin';

  /* load --------------------------------------------------------- */
  useEffect(() => {
    api.getUsers()
      .then(setUsers)
      .catch(() => setError('No se pudo cargar la lista de usuarios.'))
      .finally(() => setLoading(false));
  }, []);

  /* create ------------------------------------------------------- */
  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createUser({
        email:    form.email,
        name:     form.name,
        role:     form.role,
        function: form.function || undefined,
        password: form.password || '000000',
      });
      const updated = await api.getUsers();
      setUsers(updated);
      setShowNew(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      alert('Error al crear usuario: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* reset password ----------------------------------------------- */
  const handleReset = async (id, name) => {
    if (!window.confirm(`¿Resetear la contraseña de ${name} a 000000?`)) return;
    try {
      await api.resetUserPassword(id);
      alert('Contraseña reseteada. El usuario deberá cambiarla al ingresar.');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  /* toggle active ------------------------------------------------ */
  const handleToggle = async (id, active) => {
    try {
      await api.updateUser(id, { active: !active });
      setUsers(prev => prev.map(u => u.id === id ? { ...u, active: !active } : u));
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  /* change role -------------------------------------------------- */
  const handleRoleChange = async (id, role) => {
    try {
      const updated = await api.updateUser(id, { role });
      setUsers(prev => prev.map(u => u.id === id ? { ...u, role: updated.role } : u));
    } catch (e) {
      alert('Error al cambiar rol: ' + e.message);
    }
  };

  /* change function ---------------------------------------------- */
  const handleFunctionChange = async (id, fn) => {
    try {
      const updated = await api.updateUser(id, { function: fn || null });
      setUsers(prev => prev.map(u => u.id === id ? { ...u, function: updated.function } : u));
    } catch (e) {
      alert('Error al cambiar función: ' + e.message);
    }
  };

  /* delete ------------------------------------------------------- */
  const handleDelete = async (u) => {
    if (!window.confirm(`¿Eliminar permanentemente a ${u.name} (${u.email})?\nEsta acción no se puede deshacer.`)) return;
    try {
      await api.deleteUser(u.id);
      setUsers(prev => prev.filter(x => x.id !== u.id));
    } catch (e) {
      alert('Error al eliminar: ' + e.message);
    }
  };

  /* render ------------------------------------------------------- */
  if (loading) return <p style={{ padding: 32, color: 'var(--text-light)' }}>Cargando usuarios…</p>;
  if (error)   return <p style={{ padding: 32, color: 'var(--danger)' }}>{error}</p>;

  return (
    <div>
      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: 0 }}>👤 Gestión de Usuarios</h1>
          <p style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 4 }}>{users.length} usuario{users.length !== 1 ? 's' : ''} registrados</p>
        </div>
        <button style={css.btn('var(--teal-mid)')} onClick={() => setShowNew(true)}>+ Nuevo usuario</button>
      </div>

      {/* ── new user form ── */}
      {showNew && (
        <div style={{ ...css.card, border: '2px solid var(--teal)', marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, color: 'var(--teal-mid)', marginBottom: 16 }}>Nuevo Usuario</h3>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div>
                <label htmlFor="new-name" style={css.label}>Nombre completo *</label>
                <input id="new-name" style={css.input} required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ana López" />
              </div>
              <div>
                <label htmlFor="new-email" style={css.label}>Email corporativo *</label>
                <input id="new-email" style={css.input} type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="ana@dvpnyx.com" />
              </div>
              <div>
                <label htmlFor="new-role" style={css.label}>Rol *</label>
                <select id="new-role" style={{ ...css.select, width: '100%' }} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                  <option value="lead">Lead</option>
                  {isSuperadmin && <option value="admin">Administrador</option>}
                </select>
              </div>
              <div>
                <label htmlFor="new-function" style={css.label}>Función</label>
                <select id="new-function" style={{ ...css.select, width: '100%' }} value={form.function} onChange={e => setForm({ ...form, function: e.target.value })}>
                  <option value="">— Sin función —</option>
                  {Object.entries(FUNCTION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="new-password" style={css.label}>Contraseña inicial</label>
                <input id="new-password" style={css.input} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="000000" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={css.btn('var(--success)')} disabled={submitting}>
                {submitting ? 'Creando…' : 'Crear usuario'}
              </button>
              <button type="button" style={css.btnOutline} onClick={() => { setShowNew(false); setForm(EMPTY_FORM); }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* ── table ── */}
      <div style={css.card}>
        <div style={{ overflowX: 'auto' }}>
          <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nombre', 'Email', 'Rol', 'Función', 'Estado', 'Desde', 'Acciones'].map(h => (
                  <th key={h} style={css.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isProtected = u.role === 'superadmin' || u.id === user.id;
                const canEditRole = isSuperadmin && !isProtected;
                return (
                  <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                    <td style={{ ...css.td, fontWeight: 600 }}>{u.name}</td>
                    <td style={{ ...css.td, color: 'var(--text-light)', fontSize: 12 }}>{u.email}</td>

                    {/* rol */}
                    <td style={css.td}>
                      {canEditRole ? (
                        <select
                          style={{ ...css.select, fontSize: 12, padding: '4px 8px' }}
                          value={u.role}
                          onChange={e => handleRoleChange(u.id, e.target.value)}
                          aria-label={`Rol de ${u.name}`}
                        >
                          {ASSIGNABLE_ROLES.map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={css.badge(ROLE_COLORS[u.role] || 'var(--text-light)')}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      )}
                    </td>

                    {/* función */}
                    <td style={css.td}>
                      {!isProtected ? (
                        <select
                          style={{ ...css.select, fontSize: 12, padding: '4px 8px' }}
                          value={u.function || ''}
                          onChange={e => handleFunctionChange(u.id, e.target.value)}
                          aria-label={`Función de ${u.name}`}
                        >
                          <option value="">— Sin función —</option>
                          {Object.entries(FUNCTION_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
                          {FUNCTION_LABELS[u.function] || '—'}
                        </span>
                      )}
                    </td>

                    {/* estado */}
                    <td style={css.td}>
                      <span style={css.badge(u.active ? 'var(--success)' : 'var(--danger)')}>
                        {u.active ? 'Activo' : 'Inactivo'}
                      </span>
                      {u.must_change_password && (
                        <span style={{ ...css.badge('var(--warning)'), marginLeft: 4 }}>Clave temporal</span>
                      )}
                    </td>

                    {/* fecha */}
                    <td style={{ ...css.td, fontSize: 12, color: 'var(--text-light)' }}>
                      {new Date(u.created_at).toLocaleDateString('es-CO')}
                    </td>

                    {/* acciones */}
                    <td style={css.td}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button
                          style={{ ...css.btnOutline, padding: '3px 8px', fontSize: 11 }}
                          onClick={() => handleReset(u.id, u.name)}
                          title="Resetear contraseña a 000000"
                        >
                          🔑 Reset clave
                        </button>
                        {!isProtected && (
                          <button
                            style={{ ...css.btn(u.active ? 'var(--warning)' : 'var(--success)'), padding: '3px 8px', fontSize: 11 }}
                            onClick={() => handleToggle(u.id, u.active)}
                          >
                            {u.active ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                        {isSuperadmin && !isProtected && (
                          <button
                            style={{ ...css.btn('var(--danger)'), padding: '3px 8px', fontSize: 11 }}
                            onClick={() => handleDelete(u)}
                            aria-label={`Eliminar ${u.name}`}
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
