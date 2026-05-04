import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import * as api from './utils/api';
import { AuthProvider, useAuth } from './AuthContext';
import { formatUSD, formatPct } from './utils/calc';
import ProjectEditor from './ProjectEditor';
import StaffAugEditor from './StaffAugEditor';
import Wiki from './Wiki';
import Footer from './shell/Footer';
import Topbar from './shell/Topbar';
import Sidebar from './shell/Sidebar';
import { th as dsTh, td as dsTd, TABLE_CLASS } from './shell/tableStyles';
import CommandPalette from './shell/CommandPalette';
import StatusBadge from './shell/StatusBadge';
import NotificationsDrawer from './shell/NotificationsDrawer';
import { apiGet } from './utils/apiV2';
import ErrorBoundary from './shell/ErrorBoundary';
import Clients from './modules/Clients';
import Opportunities from './modules/Opportunities';
import PipelineKanban from './modules/PipelineKanban';
import Revenue from './modules/Revenue';
import RevenuePlanEditor from './modules/RevenuePlanEditor';
import ExchangeRates from './modules/ExchangeRates';
import Areas from './modules/Areas';
import Skills from './modules/Skills';
import Employees from './modules/Employees';
import Contracts from './modules/Contracts';
import ResourceRequests from './modules/ResourceRequests';
import Assignments from './modules/Assignments';
import CapacityPlanner from './modules/CapacityPlanner';
import TimeMe from './modules/TimeMe';
import TimeTeam from './modules/TimeTeam';
import Reports from './modules/Reports';
import DashboardMe from './modules/DashboardMe';
import ClientDetail from './modules/ClientDetail';
import OpportunityDetail from './modules/OpportunityDetail';
import ContractDetail from './modules/ContractDetail';
import EmployeeDetail from './modules/EmployeeDetail';
import NewQuotationPreModal from './modules/NewQuotationPreModal';
import BulkImport from './modules/BulkImport';
import Users from './modules/Users';
import Preferencias from './modules/Preferencias';
import EmployeeCosts from './modules/EmployeeCosts';
import EmployeeCostsImport from './modules/EmployeeCostsImport';
// SPEC-II-00 — Internal Initiatives, Novelties & Idle Time
import InternalInitiatives from './modules/InternalInitiatives';
import InternalInitiativeDetail from './modules/InternalInitiativeDetail';
import Novelties from './modules/Novelties';
import IdleTime from './modules/IdleTime';
import CountryHolidays from './modules/CountryHolidays';
import './theme.css';
import './App.css';

/* ========== STYLES ========== */
const css = {
  logo: { padding: '24px 20px 8px', fontFamily: 'var(--font-ui, inherit)', fontWeight: 700, fontSize: 22, color: 'var(--teal)', letterSpacing: 1 },
  tagline: { padding: '0 20px 24px', fontSize: 10, color: '#998899', fontStyle: 'italic' },
  nav: { flex: 1, padding: '0 12px', overflowY: 'auto', overflowX: 'hidden' },
  navItem: (active) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, marginBottom: 2, textDecoration: 'none', color: active ? '#fff' : '#ccbbcc', background: active ? 'rgba(0,216,212,0.15)' : 'transparent', transition: 'all .15s' }),
  card: { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: '24px', marginBottom: 20 },
  btn: (color = 'var(--ds-accent, var(--purple-dark))') => ({ background: color, color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 8px)', padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'opacity .15s', fontFamily: 'var(--font-ui, inherit)' }),
  btnOutline: { background: 'transparent', color: 'var(--ds-text, var(--purple-dark))', border: '1px solid var(--ds-border, var(--purple-dark))', borderRadius: 'var(--ds-radius, 8px)', padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-ui, inherit)' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none', transition: 'border .15s' },
  select: { padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer', outline: 'none' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 4, display: 'block' },
  // UI refresh Phase 2 — list tables now consume the shared DS tokens.
  th: dsTh,
  td: dsTd,
  badge: (color) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: color + '20', color }),
  // UI refresh Phase 5 — metric cards now consume DS tokens (tabular numerals
  // on the big number, uppercase label, no more purple-dark accent so the
  // card sits on the DS soft/border palette like the ExecutiveKpis strip).
  metric: { textAlign: 'left', padding: '14px 16px' },
  metricValue: {
    fontSize: 26,
    fontWeight: 500,
    fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
    fontFeatureSettings: "'tnum'",
    letterSpacing: '-0.02em',
    color: 'var(--ds-text)',
    lineHeight: 1.1,
  },
  metricLabel: {
    fontSize: 11,
    color: 'var(--ds-text-dim)',
    marginTop: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.04,
    fontWeight: 500,
  },
};

/* ========== LAYOUT ========== */
function Layout() {
  const { user, doLogout, isAdmin } = useAuth();
  const nav = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Poll unread notifications every 60s so the bell badge stays fresh
  // without a heavy websocket. First fetch fires immediately on login.
  // Fail-soft: a failing fetch simply leaves the badge at 0.
  //
  // PERF-001: skip the poll when the tab is hidden, and re-fetch on
  // visibility change. Users with multiple tabs open were generating
  // a poll per tab per minute against a count(*) that scans the
  // unread index — multiplied by ~10 users this was the dominant
  // background DB load. Hidden tabs no longer contribute.
  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    const fetchCount = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const d = await apiGet('/api/notifications/unread-count');
        if (live && d && typeof d.count === 'number') setUnread(d.count);
      } catch (_e) { /* hide badge on error */ }
    };
    fetchCount();
    const t = setInterval(fetchCount, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') fetchCount(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user]);

  // Global ⌘K / Ctrl+K opens the Command Palette. Registered once per
  // Layout mount so no child has to care. We also close on route change
  // implicitly because the palette calls onClose on navigation.
  useEffect(() => {
    const onKey = (e) => {
      const isK = (e.key === 'k' || e.key === 'K');
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeSidebar = () => setSidebarOpen(false);

  if (!user) return <Navigate to="/login" />;
  return (
    <div>
      <button className="hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Menú">☰</button>

      <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={closeSidebar} />

      <Sidebar
        user={user}
        isAdmin={isAdmin}
        open={sidebarOpen}
        onNavigate={closeSidebar}
        onLogout={() => { doLogout(); nav('/login'); }}
      />

      <div className="main-content">
        <Topbar
          onOpenSearch={() => setPaletteOpen(true)}
          onOpenNotifications={() => setNotifOpen(true)}
          unreadCount={unread}
        />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <NotificationsDrawer
          open={notifOpen}
          onClose={() => setNotifOpen(false)}
          onUpdateUnread={setUnread}
        />
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/quotation/new/:type" element={<QuotationRouter />} />
          <Route path="/quotation/:id" element={<QuotationRouter />} />
          <Route path="/wiki" element={<Wiki />} />
          {isAdmin && <Route path="/admin/params" element={<AdminParams />} />}
          {isAdmin && <Route path="/admin/exchange-rates" element={<ExchangeRates />} />}
          {isAdmin && <Route path="/admin/users" element={<Users />} />}
          {isAdmin && <Route path="/admin/bulk-import" element={<BulkImport />} />}
          {/* V2 modules — placeholders until they ship in later sprints */}
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/pipeline" element={<PipelineKanban />} />
          <Route path="/revenue" element={<Revenue />} />
          <Route path="/revenue/plan/:contract_id" element={<RevenuePlanEditor />} />
          <Route path="/opportunities/:id" element={<OpportunityDetail />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/employees/:id" element={<EmployeeDetail />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/contracts/:id" element={<ContractDetail />} />
          <Route path="/resource-requests" element={<ResourceRequests />} />
          <Route path="/assignments" element={<Assignments />} />
          <Route path="/capacity/planner" element={<CapacityPlanner />} />
          <Route path="/time" element={<TimeMe />} />
          <Route path="/time/me" element={<TimeMe />} />
          <Route path="/time/team" element={<TimeTeam />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:type" element={<Reports />} />
          <Route path="/dashboard/me" element={<DashboardMe />} />
          {isAdmin && <Route path="/admin/areas" element={<Areas />} />}
          {isAdmin && <Route path="/admin/skills" element={<Skills />} />}
          {isAdmin && <Route path="/admin/employee-costs" element={<EmployeeCosts />} />}
          {isAdmin && <Route path="/admin/employee-costs/import" element={<EmployeeCostsImport />} />}
          {/* SPEC-II-00 */}
          <Route path="/internal-initiatives"        element={<InternalInitiatives />} />
          <Route path="/internal-initiatives/:id"    element={<InternalInitiativeDetail />} />
          <Route path="/novelties"                    element={<Novelties />} />
          <Route path="/idle-time"                    element={<IdleTime />} />
          <Route path="/admin/holidays"               element={<CountryHolidays />} />
          <Route path="/preferencias" element={<Preferencias />} />
        </Routes>
        </ErrorBoundary>
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
          <div style={{ fontFamily: 'var(--font-ui, inherit)', fontSize: 32, fontWeight: 700, color: 'var(--teal)', letterSpacing: '-0.015em' }}>DVPNYX</div>
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
            <button style={{ ...css.btn('var(--ds-accent, var(--purple-dark))'), width: '100%', padding: 14, fontSize: 15 }} disabled={loading}>{loading ? 'Ingresando...' : 'Ingresar'}</button>
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
/**
 * Executive cockpit strip — renders above the quotations section on `/`.
 *
 * Pulls KPIs from `GET /api/dashboard/overview` (aggregated server-side in
 * one round-trip). Fails soft: on error / loading / missing data it simply
 * doesn't render, so the quotations view below keeps working exactly as
 * before. That's the whole point — the strip is additive.
 */
function ExecutiveKpis() {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    let live = true;
    // Wrapped in async IIFE + try/catch so a mocked api (returns undefined
    // in App.test.js auto-mock) or a failing fetch just hides the strip.
    (async () => {
      try {
        const d = await api.getDashboardOverview();
        if (live && d && typeof d === 'object') setData(d);
      } catch (e) {
        if (live) setErr(e?.message || 'Error');
      }
    })();
    return () => { live = false; };
  }, []);

  if (err || !data) return null; // fail-soft: hide strip, keep rest of dashboard intact.

  const n = (v) => (typeof v === 'number' ? v : 0);
  const fmtHours = (h) => `${Math.round(n(h))}h`;

  const tile = {
    background: 'var(--ds-surface, #fff)',
    border: '1px solid var(--ds-border, #e5e5e5)',
    borderRadius: 'var(--ds-radius-lg, 10px)',
    padding: '14px 16px',
    cursor: 'pointer',
    transition: 'transform .1s ease, box-shadow .1s ease',
    display: 'flex', flexDirection: 'column', gap: 4,
  };
  // Phase 5 refresh — KPI strip now uses the same design tokens as the
  // shared `.ds-*` palette: mono tabular numerals on the big value so
  // numbers align across the grid, uppercase micro-label.
  const label = { fontSize: 11, color: 'var(--ds-text-dim, #888)', textTransform: 'uppercase', letterSpacing: 0.04, fontWeight: 500 };
  const value = {
    fontSize: 26,
    fontWeight: 500,
    fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
    fontFeatureSettings: "'tnum'",
    letterSpacing: '-0.02em',
    color: 'var(--ds-text, #222)',
    lineHeight: 1.1,
  };
  const sub   = { fontSize: 11, color: 'var(--ds-text-muted, #666)' };

  const kpis = [
    { k: 'assign',    label: 'Asignaciones activas', value: n(data.assignments?.active_count), sub: `${n(data.assignments?.planned_count)} planificadas`, go: '/assignments' },
    { k: 'hours',     label: 'Horas comprometidas',  value: fmtHours(data.assignments?.weekly_hours), sub: 'semanal', go: '/capacity/planner' },
    { k: 'requests',  label: 'Solicitudes abiertas', value: n(data.requests?.open_count),       sub: `${fmtHours(data.requests?.open_hours_weekly)} por cubrir`, go: '/resource-requests' },
    { k: 'bench',     label: 'Bench',                 value: n(data.employees?.bench),           sub: `${n(data.employees?.total)} empleados`, go: '/employees' },
    { k: 'pipeline',  label: 'Pipeline comercial',    value: n(data.opportunities?.pipeline_count), sub: `${n(data.contracts?.active_count)} contratos activos`, go: '/opportunities' },
    { k: 'quots',     label: 'Cotizaciones',          value: n(data.quotations?.total),          sub: `${n(data.quotations?.by_status?.sent || 0)} enviadas`, go: null },
  ];

  return (
    <section
      aria-label="Indicadores ejecutivos"
      data-testid="exec-kpis"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 20,
      }}
    >
      {kpis.map((k) => (
        <div
          key={k.k}
          role={k.go ? 'button' : undefined}
          tabIndex={k.go ? 0 : undefined}
          aria-label={k.go ? `${k.label}: ${k.value}. Ir a ${k.go}` : undefined}
          style={tile}
          onClick={() => k.go && nav(k.go)}
          onKeyDown={(e) => {
            if (!k.go) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav(k.go); }
          }}
          data-testid={`kpi-${k.k}`}
        >
          <div style={label}>{k.label}</div>
          <div style={value}>{k.value}</div>
          <div style={sub}>{k.sub}</div>
        </div>
      ))}
    </section>
  );
}

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
      <ExecutiveKpis />
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ds-text)', margin: 0 }}>Cotizaciones</h1>
        <div className="page-header-actions">
          <button style={css.btn('var(--teal-mid)')} onClick={() => nav('/quotation/new/staff_aug')}>+ Staff Augmentation</button>
          <button style={css.btn('var(--orange)')} onClick={() => nav('/quotation/new/fixed_scope')}>+ Proyecto Alcance Fijo</button>
        </div>
      </div>

      <div className="metrics-grid">
        {[
          // Phase 5 — tone maps onto the DS semaphore: total/drafts stay
          // neutral, sent = warn (pending reply), approved = ok.
          { label: 'Total', value: quots.length, color: 'var(--ds-text)' },
          { label: 'Borradores', value: quots.filter(q => q.status === 'draft').length, color: 'var(--ds-text-dim)' },
          { label: 'Enviadas', value: quots.filter(q => q.status === 'sent').length, color: 'var(--ds-warn, var(--orange))' },
          { label: 'Aprobadas', value: quots.filter(q => q.status === 'approved').length, color: 'var(--ds-ok, var(--success))' },
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
            <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead><tr>
                {['Proyecto', 'Cliente', 'Tipo', 'Estado', 'Líneas', 'Creada', 'Acciones'].map(h => <th key={h} style={css.th}>{h}</th>)}
              </tr></thead>
              <tbody>{quots.map(q => (
                <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/quotation/${q.id}`)}>
                  <td style={{ ...css.td, fontWeight: 600 }}>{q.project_name}</td>
                  <td style={css.td}>{q.client_name}</td>
                  <td style={css.td}><span style={css.badge(q.type === 'staff_aug' ? 'var(--teal-mid)' : 'var(--orange)')}>{q.type === 'staff_aug' ? 'Staff Aug' : 'Proyecto'}</span></td>
                  <td style={css.td}><StatusBadge domain="quotation" value={q.status} label={statusLabel[q.status]} /></td>
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
      <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ds-text, var(--purple-dark))', margin: '0 0 24px', fontFamily: 'var(--font-ui, inherit)' }}>⚙️ Administración de Parámetros</h1>
      {params && Object.entries(params).map(([cat, items]) => (
        <div key={cat} style={css.card}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text, var(--purple-dark))', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.04 }}>{categoryLabels[cat] || cat}</h3>
          <div className="table-wrapper">
            <table className={TABLE_CLASS} style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Parámetro', 'Valor', 'Descripción', 'Acción'].map(h => <th key={h} style={css.th}>{h}</th>)}
              </tr></thead>
              <tbody>{items.sort((a, b) => a.sort_order - b.sort_order).map(p => (
                <tr key={p.id}>
                  <td style={{ ...css.td, fontWeight: 600 }}>{p.key}</td>
                  <td style={{ ...css.td, minWidth: 120 }}>
                    {editing === p.id ? (
                      <input style={{ ...css.input, width: 100, padding: 6 }} type="number" step="any" value={newVal} onChange={e => setNewVal(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && handleSave(p)} />
                    ) : (
                      <span style={{ color: 'var(--ds-text, var(--purple-dark))', fontWeight: 600, fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)', fontFeatureSettings: "'tnum'" }}>
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
