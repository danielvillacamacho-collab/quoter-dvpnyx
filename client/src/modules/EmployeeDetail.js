import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet } from '../utils/apiV2';

const s = {
  page:   { maxWidth: 1100, margin: '0 auto' },
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
};

const STATUS_LABEL = { active: 'Activo', on_leave: 'De permiso', bench: 'En banca', terminated: 'Terminado' };
const STATUS_COLOR = { active: 'var(--success)', on_leave: 'var(--orange)', bench: 'var(--teal-mid)', terminated: 'var(--text-light)' };

function Field({ label, children }) {
  return (
    <div>
      <div style={s.label}>{label}</div>
      <div style={s.value}>{children || '—'}</div>
    </div>
  );
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [emp, setEmp] = useState(null);
  const [skills, setSkills] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiGet(`/api/employees/${id}`),
      apiGet(`/api/employees/${id}/skills`),
      apiGet(`/api/assignments?employee_id=${id}&limit=200`),
    ])
      .then(([e, sk, a]) => {
        setEmp(e || null);
        setSkills(sk?.data || []);
        setAssignments(a?.data || []);
      })
      .catch((e) => setErr(e.message || 'Error'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={s.page}><div style={{ color: 'var(--text-light)' }}>Cargando…</div></div>;
  if (err || !emp) return <div style={s.page}><div style={{ color: 'var(--danger)' }}>{err || 'Empleado no encontrado'}</div></div>;

  const activeHours = assignments
    .filter((a) => a.status === 'active')
    .reduce((sum, a) => sum + Number(a.weekly_hours || 0), 0);
  const utilization = emp.weekly_capacity_hours > 0 ? activeHours / Number(emp.weekly_capacity_hours) : 0;

  return (
    <div style={s.page}>
      <button type="button" style={{ ...s.btnOutline, marginBottom: 12 }} onClick={() => nav('/employees')}>← Empleados</button>

      <h1 style={s.h1}>🧑‍💻 {emp.first_name} {emp.last_name}</h1>
      <div style={s.sub}>
        {emp.area_name || '—'} · <strong>{emp.level}</strong> · {emp.country}
        {' · '}
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
          background: STATUS_COLOR[emp.status] || 'var(--text-light)', color: '#fff',
        }}>{STATUS_LABEL[emp.status] || emp.status}</span>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Resumen</h2>
        <div style={s.grid}>
          <Field label="Email corporativo">{emp.corporate_email}</Field>
          <Field label="Email personal">{emp.personal_email}</Field>
          <Field label="Ciudad">{emp.city}</Field>
          <Field label="Tipo de contrato">{emp.employment_type}</Field>
          <Field label="Capacidad">{emp.weekly_capacity_hours ? `${Number(emp.weekly_capacity_hours)}h/sem` : null}</Field>
          <Field label="Inicio">{emp.start_date ? String(emp.start_date).slice(0, 10) : null}</Field>
          <Field label="Fin">{emp.end_date ? String(emp.end_date).slice(0, 10) : null}</Field>
          <Field label="Seniority">{emp.seniority_label}</Field>
          <Field label="Cuenta de usuario">{emp.user_email || '—'}</Field>
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Utilización</h2>
        <div style={s.grid}>
          <Field label="Asignadas">{activeHours.toFixed(1)}h / semana</Field>
          <Field label="Capacidad">{Number(emp.weekly_capacity_hours || 0)}h / semana</Field>
          <Field label="Utilización">
            <span style={{ color: utilization > 1 ? 'var(--danger)' : utilization > 0.7 ? 'var(--success)' : 'var(--orange)' }}>
              {(utilization * 100).toFixed(0)}%
            </span>
          </Field>
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Skills ({skills.length})</h2>
        {skills.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin skills asignados. Edita al empleado desde la lista para agregar.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Skill', 'Categoría', 'Proficiency', 'Años', 'Notas'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {skills.map((sk) => (
                <tr key={sk.skill_id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{sk.skill_name}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{sk.skill_category || '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{sk.proficiency}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{sk.years_experience ?? '—'}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{sk.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Asignaciones ({assignments.length})</h2>
        {assignments.length === 0 ? (
          <div style={{ color: 'var(--text-light)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Sin asignaciones registradas.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Contrato', 'Role', 'h/sem', 'Inicio', 'Fin', 'Estado'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{a.contract_name || '—'}</td>
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
