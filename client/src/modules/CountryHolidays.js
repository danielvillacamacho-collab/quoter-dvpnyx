import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiDelete } from '../utils/apiV2';
import { useAuth } from '../AuthContext';

/**
 * Country Holidays admin — SPEC-II-00.
 *
 * Lectura libre. Mutación admin only. La carga inicial viene del seed
 * embebido en migrate.js (CO/MX/GT/EC/PA/PE/US, 2026 + 2027). Esta UI
 * es para correcciones manuales y agregados puntuales.
 */

const ds = {
  page: { maxWidth: 1100, margin: '0 auto', padding: 16 },
  h1: { fontSize: 24, fontFamily: 'Montserrat', margin: '0 0 6px', color: 'var(--ds-text)' },
  sub: { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 16 },
  card: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 8px)', border: '1px solid var(--ds-border)', padding: 16, marginBottom: 12 },
  filterRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 },
  input: { padding: '6px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13 },
  btn: { background: 'var(--ds-accent, var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius, 6px)', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: 'var(--ds-accent)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius, 6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  btnDanger: { background: 'transparent', color: 'var(--ds-bad, #ef4444)', border: '1px solid var(--ds-bad, #ef4444)', borderRadius: 'var(--ds-radius, 6px)', padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: 'var(--ds-surface, #fff)', borderRadius: 'var(--ds-radius, 12px)', padding: 24, width: 460, maxWidth: '95vw', color: 'var(--ds-text)' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 4, display: 'block' },
};

const CURRENT_YEAR = new Date().getFullYear();

function CreateModal({ countries, onClose, onSaved }) {
  const [form, setForm] = useState({ country_id: 'CO', holiday_date: '', label: '', holiday_type: 'national' });
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      await apiPost('/api/holidays', form);
      onSaved();
    } catch (ex) { setErr(ex.message || 'Error'); } finally { setSaving(false); }
  };
  return (
    <div style={ds.modalBg} onClick={onClose}>
      <div style={ds.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 16px' }}>Nuevo festivo</h2>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={ds.label}>País *</label>
            <select style={ds.input} value={form.country_id} onChange={(e) => setForm((f) => ({ ...f, country_id: e.target.value }))}>
              {countries.map((c) => <option key={c.id} value={c.id}>{c.label_es} ({c.id})</option>)}
            </select>
          </div>
          <div>
            <label style={ds.label}>Fecha *</label>
            <input style={ds.input} type="date" value={form.holiday_date} onChange={(e) => setForm((f) => ({ ...f, holiday_date: e.target.value }))} required />
          </div>
          <div>
            <label style={ds.label}>Etiqueta *</label>
            <input style={ds.input} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required minLength={3} />
          </div>
          <div>
            <label style={ds.label}>Tipo</label>
            <select style={ds.input} value={form.holiday_type} onChange={(e) => setForm((f) => ({ ...f, holiday_type: e.target.value }))}>
              <option value="national">Nacional</option>
              <option value="regional">Regional</option>
              <option value="optional">Opcional</option>
              <option value="company">De la empresa</option>
            </select>
          </div>
          {err && <div style={{ color: 'var(--ds-bad, #ef4444)', fontSize: 12 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} style={ds.btnGhost}>Cancelar</button>
            <button type="submit" disabled={saving} style={ds.btn}>{saving ? 'Guardando…' : 'Crear'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CountryHolidays() {
  const auth = useAuth() || {};
  const isAdmin = !!auth.isAdmin;
  const [country, setCountry] = useState('CO');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [holidays, setHolidays] = useState([]);
  const [countries, setCountries] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await apiGet(`/api/holidays?country=${country}&year=${year}`);
      setHolidays(r?.data || []);
    } catch (ex) { setErr(ex.message || 'Error'); }
    finally { setLoading(false); }
  }, [country, year]);

  useEffect(() => {
    let alive = true;
    apiGet('/api/holidays/_meta/countries').then((r) => {
      if (alive) setCountries(r?.data || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (id) => {
    if (!window.confirm('¿Eliminar festivo?')) return;
    try {
      await apiDelete(`/api/holidays/${id}`);
      load();
    } catch (ex) { alert(ex.message || 'Error'); }
  };

  return (
    <div style={ds.page}>
      <h1 style={ds.h1}>📅 Festivos por país</h1>
      <div style={ds.sub}>
        Catálogo usado por el motor de idle time para descontar días festivos
        de la capacidad disponible. La carga inicial viene del seed; aquí
        haces correcciones puntuales.
      </div>

      <div style={ds.filterRow}>
        <select style={ds.input} value={country} onChange={(e) => setCountry(e.target.value)}>
          {countries.map((c) => <option key={c.id} value={c.id}>{c.label_es}</option>)}
        </select>
        <select style={ds.input} value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
          {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <button style={ds.btn} onClick={() => setShowCreate(true)}>+ Nuevo festivo</button>
        )}
      </div>

      {loading && <div>Cargando…</div>}
      {err && <div style={{ color: 'var(--ds-bad, #ef4444)' }}>{err}</div>}

      <div style={ds.card}>
        {holidays.length === 0 ? (
          <div style={{ color: 'var(--ds-text-soft)' }}>Sin festivos para {country} {year}.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>Fecha</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>Etiqueta</th>
                <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }}>Tipo</th>
                {isAdmin && <th style={{ padding: '6px 4px', borderBottom: '1px solid var(--ds-border)' }} />}
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id}>
                  <td style={{ padding: '6px 4px' }}>{(h.holiday_date || '').slice(0, 10)}</td>
                  <td style={{ padding: '6px 4px' }}>{h.label}</td>
                  <td style={{ padding: '6px 4px' }}>{h.holiday_type}</td>
                  {isAdmin && (
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                      <button style={ds.btnDanger} onClick={() => remove(h.id)}>Eliminar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateModal countries={countries} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />
      )}
    </div>
  );
}
