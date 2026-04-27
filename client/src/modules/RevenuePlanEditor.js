/*
 * RevenuePlanEditor (RR-MVP-00.2).
 *
 * Pantalla aparte donde el operations_owner declara la curva de
 * reconocimiento (PROY) para un contrato. La grilla principal de
 * /revenue muestra esos valores como read-only — solo REAL es
 * editable allí.
 *
 *   - type='project'        → input por mes en % (0..100). El sistema
 *                             multiplica por contracts.total_value_usd.
 *   - type='capacity'/'resell' → input por mes en USD directo.
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPut } from '../utils/apiV2';

const fmtUSD = (n) => (n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n)));
const fmtPct = (n) => (n == null ? '—' : `${(Number(n) * 100).toFixed(2)}%`);
const monthLabel = (yyyymm) => {
  const y = yyyymm.slice(0, 4); const m = Number(yyyymm.slice(4));
  const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${names[m - 1] || '?'} ${y.slice(2)}`;
};
const todayYYYYMM = () => {
  const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const yyyymmFromDate = (str) => {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const expandMonths = (from, to) => {
  if (!/^[0-9]{6}$/.test(from) || !/^[0-9]{6}$/.test(to)) return [];
  const out = [];
  let y = Number(from.slice(0, 4)); let m = Number(from.slice(4));
  const yEnd = Number(to.slice(0, 4)); const mEnd = Number(to.slice(4));
  let safety = 0;
  while ((y < yEnd || (y === yEnd && m <= mEnd)) && safety < 240) {
    out.push(`${y.toString().padStart(4, '0')}${m.toString().padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
    safety += 1;
  }
  return out;
};

const s = {
  page: { padding: 18, maxWidth: 900, margin: '0 auto' },
  header: { marginBottom: 14 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: 0 },
  sub: { fontSize: 13, color: 'var(--text-light)' },
  card: { background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16 },
  banner: { background: '#fffbe6', border: '1px solid #facc15', color: '#92400e', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 },
  errBox: { background: '#fde8eb', border: '1px solid #ef4444', color: '#b00020', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 },
  okBox: { background: '#e8f5ec', border: '1px solid #10b981', color: '#065f46', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 },
  metaGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13, marginBottom: 12 },
  metaLabel: { color: 'var(--text-light)' },
  rangeRow: { display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, marginBottom: 12 },
  inp: { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-light)', borderBottom: '1px solid var(--border)' },
  td: { padding: '6px 10px', borderBottom: '1px solid var(--border)' },
  rowInput: { width: '100%', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, textAlign: 'right' },
  totalRow: { background: 'var(--bg)', fontWeight: 700 },
  buttons: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 8 },
  btn: { padding: '8px 16px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnPrimary: { background: 'var(--purple-dark)', color: '#fff' },
  btnGhost: { background: '#fff', color: 'var(--text)', border: '1px solid var(--border)' },
};

export default function RevenuePlanEditor() {
  const nav = useNavigate();
  const { contract_id } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [contract, setContract] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // entries: { [yyyymm]: { pct?: number, usd?: number } } — almacenamos como string del input.
  const [entries, setEntries] = useState({});

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await apiGet(`/api/revenue/${contract_id}/plan`);
      setContract(data.contract);
      // Default range: contract.start_date → contract.end_date (o si no hay, ±6 meses).
      const startMonth = yyyymmFromDate(data.contract.start_date) || todayYYYYMM();
      const endMonth = yyyymmFromDate(data.contract.end_date)
        || (data.periods.length ? data.periods[data.periods.length - 1].yyyymm
          : (() => { const t = todayYYYYMM(); const y = Number(t.slice(0, 4)); const m = Number(t.slice(4)) + 6;
              const ny = m > 12 ? y + 1 : y; const nm = m > 12 ? m - 12 : m;
              return `${ny}${String(nm).padStart(2, '0')}`; })());
      setFrom(startMonth);
      setTo(endMonth);

      // Pre-populate entries from existing periods.
      const isProject = data.contract.type === 'project';
      const seed = {};
      data.periods.forEach((p) => {
        seed[p.yyyymm] = isProject
          ? { pct: p.projected_pct != null ? String(Number(p.projected_pct) * 100) : '' }
          : { usd: p.projected_usd != null ? String(p.projected_usd) : '' };
      });
      setEntries(seed);
    } catch (e) {
      setError(e.message || 'Error cargando plan');
    } finally { setLoading(false); }
  }, [contract_id]);

  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => expandMonths(from, to), [from, to]);
  const isProject = contract?.type === 'project';
  const totalValueUsd = Number(contract?.total_value_usd || 0);

  const setEntryField = (yyyymm, field, value) => {
    setEntries((prev) => ({ ...prev, [yyyymm]: { ...(prev[yyyymm] || {}), [field]: value } }));
  };

  // Live totals
  const totals = useMemo(() => {
    let pct = 0; let usd = 0;
    months.forEach((m) => {
      const e = entries[m] || {};
      if (isProject) {
        const p = Number(e.pct || 0);
        if (!isNaN(p)) { pct += p / 100; usd += (p / 100) * totalValueUsd; }
      } else {
        const u = Number(e.usd || 0);
        if (!isNaN(u)) usd += u;
      }
    });
    return { pct, usd };
  }, [entries, months, isProject, totalValueUsd]);

  const submit = async () => {
    if (!months.length) { setError('Rango de meses inválido'); return; }
    const payload = {
      entries: months.map((m) => {
        const e = entries[m] || {};
        if (isProject) {
          const p = e.pct === '' || e.pct == null ? null : Number(e.pct);
          return { yyyymm: m, pct: p == null ? 0 : p / 100 };
        }
        const u = e.usd === '' || e.usd == null ? null : Number(e.usd);
        return { yyyymm: m, projected_usd: u == null ? 0 : u };
      }),
    };
    // Validación cliente: rango razonable.
    if (isProject) {
      for (const ent of payload.entries) {
        if (ent.pct < 0 || ent.pct > 1) { setError(`% fuera de rango en ${monthLabel(ent.yyyymm)} (${(ent.pct * 100).toFixed(1)}%). Cada mes debe estar entre 0 y 100.`); return; }
      }
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      const result = await apiPut(`/api/revenue/${contract_id}/plan`, payload);
      const warns = (result.warnings || []).map((w) => '⚠ ' + w.message).join(' · ');
      setSuccess(`Plan guardado: ${result.entries.length} meses.${warns ? ' ' + warns : ''}`);
      // Reload to sync with persisted state.
      await load();
    } catch (e) {
      setError(e.message || 'Error guardando plan');
    } finally { setSaving(false); }
  };

  if (loading) return <div style={s.page}>Cargando…</div>;
  if (!contract) return <div style={s.page}>{error || 'Contrato no encontrado'}</div>;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <Link to="/revenue" style={{ fontSize: 12, color: 'var(--purple-dark)', textDecoration: 'none' }}>← Volver al reconocimiento</Link>
        <h2 style={{ ...s.title, marginTop: 6 }}>📋 Plan de reconocimiento — {contract.name}</h2>
        <div style={s.sub}>{contract.client_name || '—'} · {contract.client_country || '—'} · <span style={{ textTransform: 'capitalize' }}>{contract.type}</span></div>
      </div>

      <div style={s.banner}>
        Lo que declares aquí viaja a la grilla principal como <strong>PROY</strong> (read-only). En la grilla, sólo REAL queda editable. Puedes redeclarar este plan cuando quieras — el último guardado reemplaza al anterior.
      </div>

      <div style={s.card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--purple-dark)' }}>Datos del contrato</h3>
        <div style={s.metaGrid}>
          <div style={s.metaLabel}>Valor del contrato</div>
          <div><strong>{fmtUSD(totalValueUsd)}</strong> <span style={{ color: 'var(--text-light)' }}>{contract.original_currency || 'USD'}</span></div>
          <div style={s.metaLabel}>Tipo</div>
          <div style={{ textTransform: 'capitalize' }}>{contract.type}</div>
          <div style={s.metaLabel}>Inicio</div>
          <div>{contract.start_date || '—'}</div>
          <div style={s.metaLabel}>Fin</div>
          <div>{contract.end_date || '—'}</div>
        </div>

        <div style={s.rangeRow}>
          <label>Desde
            <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                   value={from} onChange={(e) => setFrom(e.target.value)}
                   style={{ ...s.inp, width: 90, marginLeft: 6 }} aria-label="Desde YYYYMM" />
          </label>
          <label>Hasta
            <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                   value={to} onChange={(e) => setTo(e.target.value)}
                   style={{ ...s.inp, width: 90, marginLeft: 6 }} aria-label="Hasta YYYYMM" />
          </label>
          <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
            {months.length} mes{months.length === 1 ? '' : 'es'}
          </span>
        </div>
      </div>

      <div style={s.card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--purple-dark)' }}>
          {isProject ? 'Curva de avance (% por mes)' : 'Reconocimiento mensual (USD)'}
        </h3>

        {error && <div style={s.errBox}>{error}</div>}
        {success && <div style={s.okBox}>{success}</div>}

        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Mes</th>
              {isProject
                ? <>
                  <th style={{ ...s.th, textAlign: 'right' }}>% del contrato</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>USD derivado</th>
                </>
                : <th style={{ ...s.th, textAlign: 'right' }}>USD</th>
              }
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const e = entries[m] || {};
              const pctVal = e.pct === '' || e.pct == null ? null : Number(e.pct);
              return (
                <tr key={m}>
                  <td style={s.td}>{monthLabel(m)}</td>
                  {isProject ? (
                    <>
                      <td style={s.td}>
                        <input
                          type="number" step="0.1" min="0" max="100"
                          value={e.pct ?? ''}
                          onChange={(ev) => setEntryField(m, 'pct', ev.target.value)}
                          placeholder="0.0"
                          style={s.rowInput}
                          aria-label={`% ${m}`}
                        />
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', color: 'var(--text-light)' }}>
                        {pctVal != null ? fmtUSD((pctVal / 100) * totalValueUsd) : '—'}
                      </td>
                    </>
                  ) : (
                    <td style={s.td}>
                      <input
                        type="number" step="any" min="0"
                        value={e.usd ?? ''}
                        onChange={(ev) => setEntryField(m, 'usd', ev.target.value)}
                        placeholder="0"
                        style={s.rowInput}
                        aria-label={`USD ${m}`}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={s.totalRow}>
              <td style={s.td}>TOTAL</td>
              {isProject ? (
                <>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    {fmtPct(totals.pct)}
                    {totals.pct > 1.0001 && <span style={{ color: 'var(--warning)', marginLeft: 6 }}>⚠ >100%</span>}
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{fmtUSD(totals.usd)}</td>
                </>
              ) : (
                <td style={{ ...s.td, textAlign: 'right' }}>{fmtUSD(totals.usd)}</td>
              )}
            </tr>
          </tfoot>
        </table>

        <div style={s.buttons}>
          <button type="button" onClick={() => nav('/revenue')} style={{ ...s.btn, ...s.btnGhost }}>Cancelar</button>
          <button type="button" onClick={submit} disabled={saving} style={{ ...s.btn, ...s.btnPrimary, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Guardando…' : 'Guardar plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
