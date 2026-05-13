import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPut, apiPost, apiDelete } from '../utils/apiV2';
import FilterableSelect from '../shell/FilterableSelect';
import cx from './MiPerfil.module.css';

const PROF_LABELS = { beginner: 'Principiante', intermediate: 'Intermedio', advanced: 'Avanzado', expert: 'Experto' };
const PROF_COLORS = {
  beginner: 'var(--ds-text-muted)', intermediate: 'var(--ds-accent)',
  advanced: 'var(--ds-ok)', expert: 'var(--ds-warn)',
};

export default function MiPerfil() {
  const [profile, setProfile] = useState(null);
  const [skills, setSkills] = useState([]);
  const [education, setEducation] = useState([]);
  const [completeness, setCompleteness] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet('/api/me/profile'),
      apiGet('/api/me/skills'),
      apiGet('/api/me/education'),
      apiGet('/api/me/completeness'),
      apiGet('/api/skills?active=true'),
    ])
      .then(([p, sk, ed, comp, cat]) => {
        setProfile(p);
        setSkills(sk.data || []);
        setEducation(ed.data || []);
        setCompleteness(comp);
        setCatalog((cat.data || cat || []).filter((s) => s.active !== false));
      })
      .catch((e) => setErr(e.message || 'Error al cargar perfil'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={cx.page}><div className={cx.loading}>Cargando...</div></div>;
  if (err) return <div className={cx.page}><div className={cx.error}>{err}</div></div>;
  if (!profile) return null;

  return (
    <div className={cx.page}>
      <h1 className={cx.h1}>Mi Perfil</h1>
      <div className={cx.sub}>{profile.first_name} {profile.last_name} — {profile.area_name || 'Sin área'}</div>

      {completeness && <CompletenessBar pct={completeness.pct} checks={completeness.checks} />}
      <ProfileCard profile={profile} onSave={(updated) => { setProfile({ ...profile, ...updated }); load(); }} />
      <SkillsCard skills={skills} catalog={catalog} onRefresh={load} />
      <EducationCard education={education} onRefresh={load} />
    </div>
  );
}

/* ── Completeness ─────────────────────────────────────────────────── */

function CompletenessBar({ pct, checks }) {
  const missing = (checks || []).filter((c) => !c.done).map((c) => c.key);
  const LABELS = { bio: 'Bio', city: 'Ciudad', linkedin: 'LinkedIn', skills: '3+ skills', education: 'Educación', languages: 'Idiomas' };
  return (
    <div className={cx.completenessWrap}>
      <div className={cx.completenessLabel}>Perfil completado</div>
      <div className={cx.completenessBar}>
        <div className={cx.completenessFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={cx.completenessPct}>{pct}%</div>
      {missing.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ds-text-muted)', marginTop: 4 }}>
          Falta: {missing.map((k) => LABELS[k] || k).join(', ')}
        </div>
      )}
    </div>
  );
}

/* ── Profile Card ─────────────────────────────────────────────────── */

function ProfileCard({ profile, onSave }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setForm({
      bio: profile.bio || '',
      linkedin_url: profile.linkedin_url || '',
      github_url: profile.github_url || '',
      portfolio_url: profile.portfolio_url || '',
      city: profile.city || '',
    });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await apiPut('/api/me/profile', form);
      onSave(updated);
      setEditing(false);
    } catch (e) {
      alert(e.message || 'Error al guardar');
    } finally { setSaving(false); }
  };

  const langs = Array.isArray(profile.languages) ? profile.languages : [];

  return (
    <div className={cx.card}>
      <div className={cx.cardHeader}>
        <h2 className={cx.cardTitle}>Información personal</h2>
        {!editing && <button className={cx.btnPrimary} onClick={startEdit}>Editar</button>}
      </div>

      {editing ? (
        <>
          <div className={cx.formRow}>
            <div className={cx.field}>
              <label className={cx.label}>Ciudad</label>
              <input className={cx.input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className={cx.field}>
              <label className={cx.label}>LinkedIn</label>
              <input className={cx.input} value={form.linkedin_url} placeholder="https://linkedin.com/in/..." onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} />
            </div>
            <div className={cx.field}>
              <label className={cx.label}>GitHub</label>
              <input className={cx.input} value={form.github_url} placeholder="https://github.com/..." onChange={(e) => setForm({ ...form, github_url: e.target.value })} />
            </div>
            <div className={cx.field}>
              <label className={cx.label}>Portfolio</label>
              <input className={cx.input} value={form.portfolio_url} placeholder="https://..." onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })} />
            </div>
          </div>
          <div className={cx.field}>
            <label className={cx.label}>Bio</label>
            <textarea className={cx.textarea} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Cuéntanos sobre ti..." />
          </div>
          <div className={cx.formActions}>
            <button className={cx.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
            <button className={cx.btnSecondary} onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </>
      ) : (
        <div className={cx.profileGrid}>
          <Field label="Email corporativo" value={profile.corporate_email} />
          <Field label="Ciudad" value={profile.city} />
          <Field label="Nivel" value={profile.level} />
          <Field label="Seniority" value={profile.seniority_label} />
          <Field label="Tipo" value={profile.employment_type} />
          <Field label="Capacidad" value={profile.weekly_capacity_hours ? `${profile.weekly_capacity_hours}h/semana` : null} />
          <Field label="Idiomas" value={langs.length ? langs.join(', ') : null} />
          <Field label="LinkedIn" value={profile.linkedin_url} link />
          <Field label="GitHub" value={profile.github_url} link />
          <Field label="Portfolio" value={profile.portfolio_url} link />
          <div className={cx.field} style={{ gridColumn: '1 / -1' }}>
            <span className={cx.label}>Bio</span>
            <span className={profile.bio ? cx.value : cx.valueMuted}>{profile.bio || 'Sin bio'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, link }) {
  return (
    <div className={cx.field}>
      <span className={cx.label}>{label}</span>
      {link && value ? (
        <a className={cx.link} href={value} target="_blank" rel="noopener noreferrer">
          {value.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
        </a>
      ) : (
        <span className={value ? cx.value : cx.valueMuted}>{value || '—'}</span>
      )}
    </div>
  );
}

/* ── Skills Card ──────────────────────────────────────────────────── */

function SkillsCard({ skills, catalog, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ skill_id: '', proficiency: 'intermediate', years_experience: '' });
  const [saving, setSaving] = useState(false);

  const existing = new Set(skills.map((s) => s.skill_id));
  const available = catalog.filter((s) => !existing.has(s.id));
  const grouped = {};
  for (const s of available) {
    const cat = s.category || 'Otro';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  }

  const addSkill = async () => {
    if (!form.skill_id) return;
    setSaving(true);
    try {
      await apiPost('/api/me/skills', {
        skill_id: Number(form.skill_id),
        proficiency: form.proficiency,
        years_experience: form.years_experience ? Number(form.years_experience) : null,
      });
      setForm({ skill_id: '', proficiency: 'intermediate', years_experience: '' });
      setAdding(false);
      onRefresh();
    } catch (e) { alert(e.message || 'Error'); }
    finally { setSaving(false); }
  };

  const removeSkill = async (skillId) => {
    if (!window.confirm('¿Eliminar este skill de tu perfil?')) return;
    try { await apiDelete(`/api/me/skills/${skillId}`); onRefresh(); }
    catch (e) { alert(e.message || 'Error'); }
  };

  const categories = {};
  for (const s of skills) {
    const cat = s.skill_category || 'Otro';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(s);
  }

  return (
    <div className={cx.card}>
      <div className={cx.cardHeader}>
        <h2 className={cx.cardTitle}>Skills ({skills.length})</h2>
        {!adding && <button className={cx.btnPrimary} onClick={() => setAdding(true)}>+ Agregar</button>}
      </div>

      {adding && (
        <div style={{ marginBottom: 16, padding: 12, background: 'var(--ds-bg-soft)', borderRadius: 'var(--ds-radius)' }}>
          <div className={cx.formRow}>
            <div className={cx.field}>
              <label className={cx.label}>Skill</label>
              <FilterableSelect
                value={form.skill_id}
                onChange={(e) => setForm({ ...form, skill_id: e.target.value })}
                placeholder="Seleccionar..."
                options={Object.keys(grouped).sort().flatMap((cat) =>
                  grouped[cat].map((s) => ({ id: String(s.id), label: `${cat} — ${s.name}` }))
                )}
              />
            </div>
            <div className={cx.field}>
              <label className={cx.label}>Nivel</label>
              <FilterableSelect
                value={form.proficiency}
                onChange={(e) => setForm({ ...form, proficiency: e.target.value })}
                placeholder="— Selecciona nivel —"
                options={Object.entries(PROF_LABELS).map(([k, v]) => ({ id: k, label: v }))}
              />
            </div>
            <div className={cx.field}>
              <label className={cx.label}>Años experiencia</label>
              <input className={cx.input} type="number" min="0" max="50" step="0.5" value={form.years_experience} onChange={(e) => setForm({ ...form, years_experience: e.target.value })} />
            </div>
          </div>
          <div className={cx.formActions}>
            <button className={cx.btnPrimary} onClick={addSkill} disabled={saving || !form.skill_id}>{saving ? 'Guardando...' : 'Agregar'}</button>
            <button className={cx.btnSecondary} onClick={() => setAdding(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <div className={cx.empty}>No tienes skills registrados. Agrega al menos 3 para completar tu perfil.</div>
      ) : (
        Object.keys(categories).sort().map((cat) => (
          <div key={cat}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ds-text-dim)', margin: '12px 0 4px', letterSpacing: 0.5 }}>{cat}</div>
            {categories[cat].map((sk) => (
              <div className={cx.itemRow} key={sk.skill_id}>
                <div className={cx.itemMain}>
                  <div className={cx.itemName}>{sk.skill_name}</div>
                  <div className={cx.itemMeta}>
                    <span className={cx.badge} style={{ background: PROF_COLORS[sk.proficiency] || 'var(--ds-text-muted)', color: '#fff' }}>
                      {PROF_LABELS[sk.proficiency] || sk.proficiency}
                    </span>
                    {sk.years_experience != null && <span style={{ marginLeft: 8 }}>{sk.years_experience} años</span>}
                  </div>
                </div>
                <div className={cx.itemActions}>
                  <button className={`${cx.btnSmall} ${cx.btnDanger}`} onClick={() => removeSkill(sk.skill_id)}>Quitar</button>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/* ── Education Card ───────────────────────────────────────────────── */

function EducationCard({ education, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ institution: '', degree: '', field_of_study: '', start_year: '', end_year: '', description: '' });
  const [saving, setSaving] = useState(false);

  const addEdu = async () => {
    if (!form.institution || !form.degree) return;
    setSaving(true);
    try {
      await apiPost('/api/me/education', form);
      setForm({ institution: '', degree: '', field_of_study: '', start_year: '', end_year: '', description: '' });
      setAdding(false);
      onRefresh();
    } catch (e) { alert(e.message || 'Error'); }
    finally { setSaving(false); }
  };

  const removeEdu = async (id) => {
    if (!window.confirm('¿Eliminar este registro de educación?')) return;
    try { await apiDelete(`/api/me/education/${id}`); onRefresh(); }
    catch (e) { alert(e.message || 'Error'); }
  };

  return (
    <div className={cx.card}>
      <div className={cx.cardHeader}>
        <h2 className={cx.cardTitle}>Educación ({education.length})</h2>
        {!adding && <button className={cx.btnPrimary} onClick={() => setAdding(true)}>+ Agregar</button>}
      </div>

      {adding && (
        <div style={{ marginBottom: 16, padding: 12, background: 'var(--ds-bg-soft)', borderRadius: 'var(--ds-radius)' }}>
          <div className={cx.formRow}>
            <div className={cx.field}>
              <label className={cx.label}>Institución *</label>
              <input className={cx.input} value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
            </div>
            <div className={cx.field}>
              <label className={cx.label}>Título *</label>
              <input className={cx.input} value={form.degree} onChange={(e) => setForm({ ...form, degree: e.target.value })} />
            </div>
            <div className={cx.field}>
              <label className={cx.label}>Área de estudio</label>
              <input className={cx.input} value={form.field_of_study} onChange={(e) => setForm({ ...form, field_of_study: e.target.value })} />
            </div>
          </div>
          <div className={cx.formRow}>
            <div className={cx.field}>
              <label className={cx.label}>Año inicio</label>
              <input className={cx.input} type="number" min="1970" max="2030" value={form.start_year} onChange={(e) => setForm({ ...form, start_year: e.target.value })} />
            </div>
            <div className={cx.field}>
              <label className={cx.label}>Año fin</label>
              <input className={cx.input} type="number" min="1970" max="2035" value={form.end_year} onChange={(e) => setForm({ ...form, end_year: e.target.value })} />
            </div>
          </div>
          <div className={cx.field}>
            <label className={cx.label}>Descripción</label>
            <textarea className={cx.textarea} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className={cx.formActions}>
            <button className={cx.btnPrimary} onClick={addEdu} disabled={saving || !form.institution || !form.degree}>{saving ? 'Guardando...' : 'Agregar'}</button>
            <button className={cx.btnSecondary} onClick={() => setAdding(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {education.length === 0 ? (
        <div className={cx.empty}>No tienes registros de educación.</div>
      ) : (
        education.map((ed) => (
          <div className={cx.itemRow} key={ed.id}>
            <div className={cx.itemMain}>
              <div className={cx.itemName}>{ed.degree}</div>
              <div className={cx.itemMeta}>
                {ed.institution}
                {ed.field_of_study && ` — ${ed.field_of_study}`}
                {(ed.start_year || ed.end_year) && ` (${ed.start_year || '?'}–${ed.end_year || 'actual'})`}
              </div>
              {ed.description && <div style={{ fontSize: 12, color: 'var(--ds-text-muted)', marginTop: 4 }}>{ed.description}</div>}
            </div>
            <div className={cx.itemActions}>
              <button className={`${cx.btnSmall} ${cx.btnDanger}`} onClick={() => removeEdu(ed.id)}>Eliminar</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
