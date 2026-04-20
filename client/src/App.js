import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, Link, useParams } from 'react-router-dom';
import * as api from './utils/api';
import { calcStaffAugLine, formatUSD, formatPct, SPECIALTIES, EMPTY_LINE } from './utils/calc';
import ProjectEditor from './ProjectEditor';
import Wiki from './Wiki';
import Footer from './shell/Footer';
import Breadcrumb from './shell/Breadcrumb';
import ComingSoon from './shell/ComingSoon';
import Clients from './modules/Clients';
import Opportunities from './modules/Opportunities';
import Areas from './modules/Areas';
import Skills from './modules/Skills';
import Employees from './modules/Employees';
import Contracts from './modules/Contracts';
import ResourceRequests from './modules/ResourceRequests';
import Assignments from './modules/Assignments';
import TimeMe from './modules/TimeMe';
import Reports from './modules/Reports';
import DashboardMe from './modules/DashboardMe';
import ClientDetail from './modules/ClientDetail';
import OpportunityDetail from './modules/OpportunityDetail';
import ContractDetail from './modules/ContractDetail';
import EmployeeDetail from './modules/EmployeeDetail';
import NewQuotationPreModal from './modules/NewQuotationPreModal';
import './App.css';

/* ========== AUTH CONTEXT ========== */
const AuthCtx = createContext();
const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('dvpnyx_token');
    if (token) {
      // Fetch user and params concurrently, then set both in the same state update
      Promise.all([api.getMe(), api.getParams()])
        .then(([u, p]) => { setUser(u); setParams(p); })
        .catch(() => localStorage.removeItem('dvpnyx_token'))
        .finally(() => setLoading(false));
    } else setLoading(false);
  }, []);

  // Returns { user, params } — caller is responsible for calling commitLogin
  // so all state (user, params, changePw) is set in the same React batch.
  const doLogin = async (email, pw) => {
    const { token, user: u } = await api.login(email, pw);
    localStorage.setItem('dvpnyx_token', token);
    const p = await api.getParams();
    return { user: u, params: p };
  };
  // Commit user + params atomically (called by Login after doLogin resolves)
  const commitLogin = (u, p) => { setUser(u); setParams(p); };
  const doLogout = () => { localStorage.removeItem('dvpnyx_token'); setUser(null); setParams(null); };
  const refreshParams = async () => { const p = await api.getParams(); setParams(p); };
  const isAdmin = user && ['admin', 'superadmin'].includes(user.role);

  if (loading) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: 'var(--purple-dark)', fontSize: 18 }}>Cargando...</div></div>;
  return <AuthCtx.Provider value={{ user, params, doLogin, commitLogin, doLogout, refreshParams, isAdmin }}>{children}</AuthCtx.Provider>;
}

/* ========== STYLES ========== */
const css = {
  logo: { padding: '24px 20px 8px', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 22, color: 'var(--teal)', letterSpacing: 1 },
  tagline: { padding: '0 20px 24px', fontSize: 10, color: '#998899', fontStyle: 'italic' },
  nav: { flex: 1, padding: '0 12px' },
  navItem: (active) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, marginBottom: 2, textDecoration: 'none', color: active ? '#fff' : '#ccbbcc', background: active ? 'rgba(0,216,212,0.15)' : 'transparent', transition: 'all .15s' }),
  card: { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: '24px', marginBottom: 20 },
  btn: (color = 'var(--purple-dark)') => ({ background: color, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'opacity .15s' }),
  btnOutline: { background: 'transparent', color: 'var(--purple-dark)', border: '1px solid var(--purple-dark)', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none', transition: 'border .15s' },
  select: { padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer', outline: 'none' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  th: { padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--purple-dark)', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' },
  badge: (color) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: color + '20', color }),
  metric: { textAlign: 'center', padding: '16px' },
  metricValue: { fontSize: 28, fontWeight: 700, fontFamily: 'Montserrat', color: 'var(--purple-dark)' },
  metricLabel: { fontSize: 11, color: 'var(--text-light)', marginTop: 4 },
};

/* ========== LAYOUT ========== */
function Layout() {
  const { user, doLogout, isAdmin } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Sidebar is organized in groups. Groups 2+ route to ComingSoon screens
  // until their corresponding module ships. Visibility is role-based; fine-
  // grained visibility by function lands when users.function is populated.
  const groups = [
    {
      title: null, items: [
        { path: '/', label: '📊 Dashboard' },
      ],
    },
    {
      title: 'Comercial', items: [
        { path: '/quotation/new/staff_aug', label: '👥 Nueva Staff Aug' },
        { path: '/quotation/new/fixed_scope', label: '📋 Nuevo Proyecto' },
        { path: '/clients', label: '🏢 Clientes' },
        { path: '/opportunities', label: '💼 Oportunidades' },
      ],
    },
    {
      title: 'Delivery', items: [
        { path: '/contracts', label: '📑 Contratos' },
        { path: '/resource-requests', label: '🧾 Solicitudes' },
        { path: '/assignments', label: '🗓 Asignaciones' },
      ],
    },
    {
      title: 'Gente', items: [
        { path: '/employees', label: '🧑‍💻 Empleados' },
        ...(isAdmin ? [
          { path: '/admin/areas',  label: '🧭 Áreas' },
          { path: '/admin/skills', label: '🏷 Skills' },
          // Squads ship in v2.1 — the default squad is managed by migrate_v2_data.js today
        ] : []),
      ],
    },
    {
      title: 'Time Tracking', items: [
        { path: '/time/me',   label: '⏱ Mis horas' },
        { path: '/time/team', label: '📈 Horas del equipo' },
      ],
    },
    {
      title: null, items: [
        { path: '/reports', label: '📊 Reportes' },
        { path: '/wiki',    label: '📚 Wiki' },
      ],
    },
    ...(isAdmin ? [{
      title: 'Configuración', items: [
        { path: '/admin/params', label: '⚙️ Parámetros' },
        { path: '/admin/users',  label: '👤 Usuarios' },
      ],
    }] : []),
  ];
  // Flattened version kept for compatibility with existing tests and
  // behavior (any component that expected `items` can still use it).
  const items = groups.flatMap(g => g.items);

  const closeSidebar = () => setSidebarOpen(false);

  if (!user) return <Navigate to="/login" />;
  return (
    <div>
      <button className="hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Menú">☰</button>

      <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={closeSidebar} />

      <div className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div style={css.logo}>DVPNYX</div>
        <div style={css.tagline}>Unconventional People. Disruptive Tech.</div>
        <nav style={css.nav}>
          {groups.map((g, gi) => (
            <React.Fragment key={gi}>
              {g.title && (
                <div style={{ padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {g.title}
                </div>
              )}
              {g.items.map(i => (
                <Link key={i.path} to={i.path} style={css.navItem(loc.pathname === i.path)} onClick={closeSidebar}>{i.label}</Link>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
          <div style={{ fontSize: 12, color: '#ccbbcc' }}>{user.name}</div>
          <div style={{ fontSize: 10, color: '#998899' }}>{user.email}</div>
          <div style={{ fontSize: 10, color: 'var(--teal)', marginTop: 2 }}>{user.role.toUpperCase()}</div>
          <button onClick={() => { doLogout(); nav('/login'); }} style={{ ...css.btn('transparent'), padding: '6px 0', color: '#998899', fontSize: 11, marginTop: 8 }}>Cerrar sesión →</button>
        </div>
      </div>

      <div className="main-content">
        <Breadcrumb />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/quotation/new/:type" element={<QuotationRouter />} />
          <Route path="/quotation/:id" element={<QuotationRouter />} />
          <Route path="/wiki" element={<Wiki />} />
          {isAdmin && <Route path="/admin/params" element={<AdminParams />} />}
          {isAdmin && <Route path="/admin/users" element={<AdminUsers />} />}
          {/* V2 modules — placeholders until they ship in later sprints */}
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/opportunities/:id" element={<OpportunityDetail />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/employees/:id" element={<EmployeeDetail />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/contracts/:id" element={<ContractDetail />} />
          <Route path="/resource-requests" element={<ResourceRequests />} />
          <Route path="/assignments" element={<Assignments />} />
          <Route path="/time" element={<TimeMe />} />
          <Route path="/time/me" element={<TimeMe />} />
          <Route path="/time/team" element={<ComingSoon />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:type" element={<Reports />} />
          <Route path="/dashboard/me" element={<DashboardMe />} />
          {isAdmin && <Route path="/admin/areas" element={<Areas />} />}
          {isAdmin && <Route path="/admin/skills" element={<Skills />} />}
        </Routes>
        <Footer />
      </div>
    </div>
  );
}

/* ========== LOGIN ========== */
function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [changePw, setChangePw] = useState(false);
  const [newPw, setNewPw] = useState('');
  const { doLogin, commitLogin, user } = useAuth();
  const nav = useNavigate();

  // Only redirect when user is set AND we are NOT waiting for a password change.
  // This prevents premature redirect during the 'must_change_password' flow.
  if (user && !changePw) return <Navigate to="/" />;

  const handleLogin = async (e) => {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const { user: u, params: p } = await doLogin(email, pw);
      // Set all state in the same microtask → single React render batch.
      // If we set user first (via doLogin internally) React would re-render
      // and redirect to "/" before setChangePw(true) runs.
      commitLogin(u, p);
      if (u.must_change_password) setChangePw(true);
      else nav('/');
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  };

  const handleChangePw = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api.changePassword(pw, newPw);
      nav('/');
    } catch (e) { setErr(e.message); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #56234d 0%, #1e0f1c 100%)' }}>
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'Montserrat', fontSize: 32, fontWeight: 800, color: 'var(--teal)' }}>DVPNYX</div>
          <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>Cotizador de Servicios</div>
        </div>
        {!changePw ? (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={css.label}>Email</label>
              <input style={css.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@dvpnyx.com" required />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={css.label}>Contraseña</label>
              <input style={css.input} type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" required />
            </div>
            {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{err}</div>}
            <button style={{ ...css.btn('var(--purple-dark)'), width: '100%', padding: 14, fontSize: 15 }} disabled={loading}>{loading ? 'Ingresando...' : 'Ingresar'}</button>
          </form>
        ) : (
          <form onSubmit={handleChangePw}>
            <div style={{ fontSize: 14, color: 'var(--purple-mid)', marginBottom: 16, textAlign: 'center' }}>Debe cambiar su contraseña</div>
            <div style={{ marginBottom: 24 }}>
              <label style={css.label}>Nueva contraseña (mín. 8 caracteres)</label>
              <input style={css.input} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={8} required />
            </div>
            {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{err}</div>}
            <button style={{ ...css.btn('var(--teal)'), width: '100%', padding: 14 }}>Guardar contraseña</button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ========== DASHBOARD ========== */
function Dashboard() {
  const [quots, setQuots] = useState([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => { api.getQuotations().then(setQuots).catch(console.error).finally(() => setLoading(false)); }, []);

  const statusColor = { draft: 'var(--text-light)', sent: 'var(--orange)', approved: 'var(--success)', rejected: 'var(--danger)', expired: '#999' };
  const statusLabel = { draft: 'Borrador', sent: 'Enviada', approved: 'Aprobada', rejected: 'Rechazada', expired: 'Expirada' };

  const handleDuplicate = async (id) => {
    const q = await api.duplicateQuotation(id);
    nav(`/quotation/${q.id}`);
  };

  return (
    <div>
      <div className="page-header">
        <h1 style={{ fontSize: 24, color: 'var(--purple-dark)' }}>Cotizaciones</h1>
        <div className="page-header-actions">
          <button style={css.btn('var(--teal-mid)')} onClick={() => nav('/quotation/new/staff_aug')}>+ Staff Augmentation</button>
          <button style={css.btn('var(--orange)')} onClick={() => nav('/quotation/new/fixed_scope')}>+ Proyecto Alcance Fijo</button>
        </div>
      </div>

      <div className="metrics-grid">
        {[
          { label: 'Total', value: quots.length, color: 'var(--purple-dark)' },
          { label: 'Borradores', value: quots.filter(q => q.status === 'draft').length, color: 'var(--text-light)' },
          { label: 'Enviadas', value: quots.filter(q => q.status === 'sent').length, color: 'var(--orange)' },
          { label: 'Aprobadas', value: quots.filter(q => q.status === 'approved').length, color: 'var(--success)' },
        ].map((m, i) => (
          <div key={i} style={{ ...css.card, ...css.metric }}>
            <div style={{ ...css.metricValue, color: m.color }}>{m.value}</div>
            <div style={css.metricLabel}>{m.label}</div>
          </div>
        ))}
      </div>

      <div style={css.card}>
        {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>Cargando...</div> : quots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 16, color: 'var(--text-light)' }}>No hay cotizaciones aún</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>Crea tu primera cotización con los botones de arriba</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead><tr>
                {['Proyecto', 'Cliente', 'Tipo', 'Estado', 'Líneas', 'Creada', 'Acciones'].map(h => <th key={h} style={css.th}>{h}</th>)}
              </tr></thead>
              <tbody>{quots.map(q => (
                <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/quotation/${q.id}`)}>
                  <td style={{ ...css.td, fontWeight: 600 }}>{q.project_name}</td>
                  <td style={css.td}>{q.client_name}</td>
                  <td style={css.td}><span style={css.badge(q.type === 'staff_aug' ? 'var(--teal-mid)' : 'var(--orange)')}>{q.type === 'staff_aug' ? 'Staff Aug' : 'Proyecto'}</span></td>
                  <td style={css.td}><span style={css.badge(statusColor[q.status])}>{statusLabel[q.status]}</span></td>
                  <td style={{ ...css.td, textAlign: 'center' }}>{q.line_count}</td>
                  <td style={css.td}>{new Date(q.created_at).toLocaleDateString('es-CO')}</td>
                  <td style={css.td} onClick={e => e.stopPropagation()}>
                    <button style={{ ...css.btnOutline, padding: '4px 10px', fontSize: 11, marginRight: 4 }} onClick={() => handleDuplicate(q.id)}>Duplicar</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== QUOTATION ROUTER ========== */
// Dispatches to the correct editor based on type (fixed_scope → stepper, staff_aug → linear).
// EX-1: when creating a NEW quotation, intercepts with a pre-modal that forces
// the user to pick cliente + oportunidad before the editor loads — the server
// now rejects POST /api/quotations without both IDs.
function QuotationRouter() {
  const { params } = useAuth();
  const nav = useNavigate();
  const { id: quotId, type: newType } = useParams();
  const isNew = !!newType;

  const [loading, setLoading] = useState(!!quotId);
  const [type, setType] = useState(newType || 'staff_aug');
  const [linkingContext, setLinkingContext] = useState(null); // { client_id, opportunity_id, client_name, opportunity_name }

  useEffect(() => {
    if (isNew) { setType(newType); setLoading(false); return; }
    if (quotId) {
      api.getQuotation(quotId).then(q => { setType(q.type); setLoading(false); }).catch(() => nav('/'));
    }
  }, [quotId, newType, isNew, nav]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Cargando...</div>;

  // New-quotation flow: show the cliente+opp selector first
  if (isNew && !linkingContext) {
    return (
      <NewQuotationPreModal
        type={newType}
        onContext={setLinkingContext}
        onCancel={() => nav('/')}
      />
    );
  }

  if (type === 'fixed_scope') return <ProjectEditor params={params} context={linkingContext} />;
  return <StaffAugEditor params={params} context={linkingContext} />;
}

/* ========== STAFF AUG EDITOR (linear table) ========== */
function StaffAugEditor({ params, context }) {
  const nav = useNavigate();
  const { id: quotId, type: newType } = useParams();
  const isNew = !!newType;

  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({
    type: newType || 'staff_aug',
    // EX-1: when creating a new quotation, the cliente+opp IDs come from the
    // pre-modal's context. On edit, they arrive via the GET /api/quotations/:id
    // payload below. Both persist through save via api.createQuotation.
    client_id: context?.client_id || null,
    opportunity_id: context?.opportunity_id || null,
    project_name: '', client_name: context?.client_name || '', commercial_name: '', preventa_name: '',
    discount_pct: 0, notes: '', status: 'draft', lines: [{ ...EMPTY_LINE }], metadata: {}
  });

  useEffect(() => {
    if (quotId) { api.getQuotation(quotId).then(q => setData({ ...q, lines: q.lines?.length ? q.lines : [{ ...EMPTY_LINE }] })).catch(() => nav('/')); }
  }, [quotId, nav]);

  const updateField = (field, value) => setData(d => ({ ...d, [field]: value }));
  const updateLine = (idx, field, value) => {
    setData(d => {
      const lines = [...d.lines];
      lines[idx] = { ...lines[idx], [field]: value };
      if (params) lines[idx] = calcStaffAugLine(lines[idx], params);
      return { ...d, lines };
    });
  };
  const addLine = () => setData(d => ({ ...d, lines: [...d.lines, { ...EMPTY_LINE }] }));
  const removeLine = (idx) => setData(d => ({ ...d, lines: d.lines.filter((_, i) => i !== idx) }));

  const totalMonthly = data.lines.reduce((s, l) => s + (l.rate_month || 0) * (l.quantity || 1), 0);
  const totalContract = data.lines.reduce((s, l) => s + (l.total || 0), 0);

  const save = async (status) => {
    setSaving(true);
    try {
      const payload = { ...data, status: status || data.status };
      if (quotId) { await api.updateQuotation(quotId, payload); }
      else { const q = await api.createQuotation(payload); nav(`/quotation/${q.id}`, { replace: true }); }
      alert('Cotización guardada');
    } catch (e) { alert('Error: ' + e.message); } finally { setSaving(false); }
  };

  const countries = params?.geo?.map(p => p.key) || [];
  const stacks = params?.stack?.map(p => p.key) || [];
  const modalities = params?.modality?.map(p => p.key) || [];
  const toolsOpts = params?.tools?.map(p => p.key) || [];

  return (
    <div>
      <div className="editor-header">
        <div>
          <button onClick={() => nav('/')} style={{ ...css.btnOutline, padding: '6px 12px', fontSize: 11, marginRight: 12 }}>← Volver</button>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
            {isNew ? 'Nueva Cotización' : 'Editar Cotización'} — {data.type === 'staff_aug' ? 'Staff Augmentation' : 'Alcance Fijo'}
          </span>
        </div>
        <div className="editor-actions">
          <button style={css.btnOutline} onClick={() => save()} disabled={saving}>{saving ? 'Guardando...' : 'Guardar borrador'}</button>
          <button style={css.btn('var(--teal-mid)')} onClick={() => save('sent')} disabled={saving}>Guardar como Enviada</button>
        </div>
      </div>

      {/* Project info */}
      <div style={css.card}>
        <h3 style={{ fontSize: 14, color: 'var(--purple-dark)', marginBottom: 16 }}>Datos del Proyecto</h3>
        <div className="project-info-grid">
          {[
            ['project_name', 'Nombre del Proyecto'],
            ['client_name', 'Cliente'],
            ['commercial_name', 'Responsable Comercial'],
            ['preventa_name', 'Ingeniero Pre-venta'],
          ].map(([field, label]) => (
            <div key={field}>
              <label style={css.label}>{label}</label>
              <input style={css.input} value={data[field] || ''} onChange={e => updateField(field, e.target.value)} />
            </div>
          ))}
          <div>
            <label style={css.label}>Estado</label>
            <select style={{ ...css.select, width: '100%' }} value={data.status} onChange={e => updateField('status', e.target.value)}>
              {['draft', 'sent', 'approved', 'rejected', 'expired'].map(s => <option key={s} value={s}>{{ draft: 'Borrador', sent: 'Enviada', approved: 'Aprobada', rejected: 'Rechazada', expired: 'Expirada' }[s]}</option>)}
            </select>
          </div>
          <div>
            <label style={css.label}>Descuento (%)</label>
            <input style={css.input} type="number" min={0} max={50} step={1} value={(data.discount_pct || 0) * 100} onChange={e => updateField('discount_pct', Number(e.target.value) / 100)} />
          </div>
        </div>
      </div>

      {/* Lines */}
      <div style={css.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, color: 'var(--purple-dark)' }}>Recursos ({data.lines.length})</h3>
          <button style={css.btn('var(--teal-mid)')} onClick={addLine}>+ Agregar recurso</button>
        </div>
        <div className="table-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
            <thead><tr>
              {['#', 'Especialidad', 'Rol / Título', 'Nivel', 'País', 'Bilingüe', 'Herramientas', 'Stack', 'Modalidad', 'Cant', 'Meses', 'Tarifa/Mes', 'Total', ''].map(h => <th key={h} style={{ ...css.th, fontSize: 10, padding: '8px 6px' }}>{h}</th>)}
            </tr></thead>
            <tbody>{data.lines.map((line, idx) => (
              <tr key={idx}>
                <td style={{ ...css.td, textAlign: 'center', fontWeight: 600, width: 30 }}>{idx + 1}</td>
                <td style={css.td}><select style={{ ...css.select, width: 120, fontSize: 11 }} value={line.specialty} onChange={e => updateLine(idx, 'specialty', e.target.value)}><option value="">—</option>{SPECIALTIES.map(s => <option key={s}>{s}</option>)}</select></td>
                <td style={css.td}><input style={{ ...css.input, width: 140, fontSize: 12, padding: 6 }} value={line.role_title || ''} onChange={e => updateLine(idx, 'role_title', e.target.value)} placeholder="Ej: Senior React Dev" /></td>
                <td style={css.td}><select style={{ ...css.select, width: 50, fontSize: 11 }} value={line.level || ''} onChange={e => updateLine(idx, 'level', Number(e.target.value))}><option value="">—</option>{[1,2,3,4,5,6,7,8,9,10,11].map(n => <option key={n} value={n}>L{n}</option>)}</select></td>
                <td style={css.td}><select style={{ ...css.select, width: 100, fontSize: 11 }} value={line.country} onChange={e => updateLine(idx, 'country', e.target.value)}>{countries.map(c => <option key={c}>{c}</option>)}</select></td>
                <td style={{ ...css.td, textAlign: 'center' }}><input type="checkbox" checked={line.bilingual || false} onChange={e => updateLine(idx, 'bilingual', e.target.checked)} /></td>
                <td style={css.td}><select style={{ ...css.select, width: 110, fontSize: 11 }} value={line.tools} onChange={e => updateLine(idx, 'tools', e.target.value)}>{toolsOpts.map(t => <option key={t}>{t}</option>)}</select></td>
                <td style={css.td}><select style={{ ...css.select, width: 110, fontSize: 11 }} value={line.stack} onChange={e => updateLine(idx, 'stack', e.target.value)}>{stacks.map(s => <option key={s}>{s}</option>)}</select></td>
                <td style={css.td}><select style={{ ...css.select, width: 100, fontSize: 11 }} value={line.modality} onChange={e => updateLine(idx, 'modality', e.target.value)}>{modalities.map(m => <option key={m}>{m}</option>)}</select></td>
                <td style={css.td}><input style={{ ...css.input, width: 45, fontSize: 12, padding: 6, textAlign: 'center' }} type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} /></td>
                <td style={css.td}><input style={{ ...css.input, width: 45, fontSize: 12, padding: 6, textAlign: 'center' }} type="number" min={1} value={line.duration_months} onChange={e => updateLine(idx, 'duration_months', Number(e.target.value))} /></td>
                <td style={{ ...css.td, fontWeight: 600, color: 'var(--purple-dark)', whiteSpace: 'nowrap' }}>{formatUSD(line.rate_month)}</td>
                <td style={{ ...css.td, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>{formatUSD(line.total)}</td>
                <td style={css.td}><button onClick={() => removeLine(idx)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="summary-grid">
        <div style={{ ...css.card, ...css.metric }}>
          <div style={css.metricValue}>{formatUSD(totalMonthly)}</div>
          <div style={css.metricLabel}>Valor mensual total</div>
        </div>
        <div style={{ ...css.card, ...css.metric }}>
          <div style={{ ...css.metricValue, color: 'var(--success)' }}>{formatUSD(totalContract)}</div>
          <div style={css.metricLabel}>Valor total del contrato</div>
        </div>
        <div style={{ ...css.card, ...css.metric }}>
          <div style={{ ...css.metricValue, color: 'var(--teal-mid)' }}>{formatUSD(totalContract * (1 - (data.discount_pct || 0)))}</div>
          <div style={css.metricLabel}>Con descuento ({formatPct(data.discount_pct)})</div>
        </div>
      </div>
    </div>
  );
}

/* ========== ADMIN PARAMS ========== */
function AdminParams() {
  const { params, refreshParams } = useAuth();
  const [editing, setEditing] = useState(null);
  const [newVal, setNewVal] = useState('');

  const handleSave = async (param) => {
    try {
      await api.updateParam(param.id, { value: Number(newVal) });
      await refreshParams();
      setEditing(null);
    } catch (e) { alert('Error: ' + e.message); }
  };

  const categoryLabels = { level: 'Costo Empresa por Nivel', geo: 'Multiplicador Geográfico', bilingual: 'Bilingüe', tools: 'Herramientas', stack: 'Stack Tecnológico', modality: 'Modalidad', margin: 'Márgenes', project: 'Parámetros de Proyecto' };

  return (
    <div>
      <h1 style={{ fontSize: 24, color: 'var(--purple-dark)', marginBottom: 24 }}>⚙️ Administración de Parámetros</h1>
      {params && Object.entries(params).map(([cat, items]) => (
        <div key={cat} style={css.card}>
          <h3 style={{ fontSize: 14, color: 'var(--purple-dark)', marginBottom: 12 }}>{categoryLabels[cat] || cat}</h3>
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Parámetro', 'Valor', 'Descripción', 'Acción'].map(h => <th key={h} style={{ ...css.th, background: 'var(--teal-mid)' }}>{h}</th>)}
              </tr></thead>
              <tbody>{items.sort((a, b) => a.sort_order - b.sort_order).map(p => (
                <tr key={p.id}>
                  <td style={{ ...css.td, fontWeight: 600 }}>{p.key}</td>
                  <td style={{ ...css.td, minWidth: 120 }}>
                    {editing === p.id ? (
                      <input style={{ ...css.input, width: 100, padding: 6 }} type="number" step="any" value={newVal} onChange={e => setNewVal(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && handleSave(p)} />
                    ) : (
                      <span style={{ color: 'var(--purple-dark)', fontWeight: 600, fontFamily: 'monospace' }}>
                        {['level', 'tools'].includes(cat) ? formatUSD(p.value) : ['margin', 'project'].includes(cat) && p.value < 1000 && p.key !== 'hours_month' ? formatPct(p.value) : p.value}
                      </span>
                    )}
                  </td>
                  <td style={{ ...css.td, color: 'var(--text-light)', fontSize: 12 }}>{p.label} {p.note && `— ${p.note}`}</td>
                  <td style={css.td}>
                    {editing === p.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button style={css.btn('var(--success)')} onClick={() => handleSave(p)}>✓</button>
                        <button style={css.btnOutline} onClick={() => setEditing(null)}>✕</button>
                      </div>
                    ) : (
                      <button style={{ ...css.btnOutline, padding: '4px 12px', fontSize: 11 }} onClick={() => { setEditing(p.id); setNewVal(p.value); }}>Editar</button>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ========== ADMIN USERS ========== */
function AdminUsers() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'preventa', password: '000000' });

  useEffect(() => { api.getUsers().then(setUsers).catch(console.error); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.createUser(form);
      const u = await api.getUsers();
      setUsers(u);
      setShowNew(false);
      setForm({ email: '', name: '', role: 'preventa', password: '000000' });
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handleReset = async (id) => {
    if (window.confirm('¿Resetear contraseña a 000000?')) {
      await api.resetUserPassword(id);
      alert('Contraseña reseteada');
    }
  };

  const handleToggle = async (id, active) => {
    await api.updateUser(id, { active: !active });
    setUsers(users.map(u => u.id === id ? { ...u, active: !active } : u));
  };

  const handleRoleChange = async (id, role) => {
    try {
      const updated = await api.updateUser(id, { role });
      setUsers(users.map(u => u.id === id ? { ...u, role: updated.role } : u));
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`¿Eliminar permanentemente a ${u.name} (${u.email})? Esta acción no se puede deshacer.`)) return;
    try {
      await api.deleteUser(u.id);
      setUsers(users.filter(x => x.id !== u.id));
    } catch (e) { alert('Error: ' + e.message); }
  };

  const isSuperadmin = user.role === 'superadmin';

  return (
    <div>
      <div className="page-header">
        <h1 style={{ fontSize: 24, color: 'var(--purple-dark)' }}>👤 Gestión de Usuarios</h1>
        <button style={css.btn('var(--teal-mid)')} onClick={() => setShowNew(true)}>+ Nuevo usuario</button>
      </div>

      {showNew && (
        <div style={{ ...css.card, border: '2px solid var(--teal)', marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, color: 'var(--teal-mid)', marginBottom: 12 }}>Nuevo Usuario</h3>
          <form onSubmit={handleCreate} className="users-form-grid">
            <div><label style={css.label}>Nombre</label><input style={css.input} required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={css.label}>Email</label><input style={css.input} type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><label style={css.label}>Rol</label>
              <select style={{ ...css.select, width: '100%' }} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="preventa">Pre-venta</option>
                {user.role === 'superadmin' && <option value="admin">Administrador</option>}
              </select>
            </div>
            <div><label style={css.label}>Contraseña inicial</label><input style={css.input} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={css.btn('var(--success)')}>Crear</button>
              <button type="button" style={css.btnOutline} onClick={() => setShowNew(false)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div style={css.card}>
        <div className="table-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Nombre', 'Email', 'Rol', 'Estado', 'Creado', 'Acciones'].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>{users.map(u => {
              // A superadmin row, the current user's own row, can't have role changed / be deleted
              const isProtected = u.role === 'superadmin' || u.id === user.id;
              const canEditRole = isSuperadmin && !isProtected;
              return (
              <tr key={u.id}>
                <td style={{ ...css.td, fontWeight: 600 }}>{u.name}</td>
                <td style={css.td}>{u.email}</td>
                <td style={css.td}>
                  {canEditRole ? (
                    <select
                      style={{ ...css.select, fontSize: 12, padding: '4px 8px' }}
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      aria-label={`Rol de ${u.name}`}
                    >
                      <option value="preventa">Pre-venta</option>
                      <option value="admin">Administrador</option>
                    </select>
                  ) : (
                    <span style={css.badge(u.role === 'superadmin' ? 'var(--purple-dark)' : u.role === 'admin' ? 'var(--teal-mid)' : 'var(--orange)')}>{u.role}</span>
                  )}
                </td>
                <td style={css.td}><span style={css.badge(u.active ? 'var(--success)' : 'var(--danger)')}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
                <td style={css.td}>{new Date(u.created_at).toLocaleDateString('es-CO')}</td>
                <td style={css.td}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button style={{ ...css.btnOutline, padding: '4px 8px', fontSize: 10 }} onClick={() => handleReset(u.id)}>Reset clave</button>
                    <button style={{ ...css.btn(u.active ? 'var(--danger)' : 'var(--success)'), padding: '4px 8px', fontSize: 10 }} onClick={() => handleToggle(u.id, u.active)}>{u.active ? 'Desactivar' : 'Activar'}</button>
                    {isSuperadmin && !isProtected && (
                      <button
                        style={{ ...css.btn('var(--danger)'), padding: '4px 8px', fontSize: 10 }}
                        onClick={() => handleDelete(u)}
                        aria-label={`Eliminar ${u.name}`}
                      >Eliminar</button>
                    )}
                  </div>
                </td>
              </tr>
            );})}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ========== APP ========== */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<Layout />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
