/*
 * Revenue recognition (RR-MVP-00.1, Abril 2026).
 *
 * REEMPLAZA el Excel mensual por una matriz editable contracts × meses.
 *
 * SCOPE INTENCIONAL: trabajo funcional placeholder. El equipo de
 * ingeniería refactorizará esta vista cuando entre. Las decisiones
 * obvias que se ven aquí (HTML table sin react-table, autosave on-blur
 * sin React Query, sin charts) son DELIBERADAS para no agregar deuda
 * que después haya que tumbar.
 *
 * Layout:
 *   - First column: contracts (cliente · nombre · type · owner · total).
 *   - Subsequent columns: meses dentro del rango configurable.
 *   - Cada celda: input proyectado + input real (al cerrar). Cierre vía
 *     botón "Cerrar mes" que aparece al pasar el mouse cuando hay real.
 *   - Filtros: tipo, owner, país.
 *   - Footer: totales por columna + global. Sticky.
 *
 * Autosave on-blur: cada input dispara un PUT al perder foco si cambió.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPut, apiPost } from '../utils/apiV2';

const fmtPct = (n) => (n == null ? '—' : `${(Number(n) * 100).toFixed(1)}%`);

const fmtUSD = (n) => (n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n)));
const monthLabel = (yyyymm) => {
  const y = yyyymm.slice(0, 4); const m = Number(yyyymm.slice(4));
  const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${names[m - 1] || '?'} ${y.slice(2)}`;
};
const todayYYYYMM = () => {
  const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const offsetMonth = (yyyymm, delta) => {
  let y = Number(yyyymm.slice(0, 4)); let m = Number(yyyymm.slice(4)) + delta;
  while (m < 1) { m += 12; y -= 1; } while (m > 12) { m -= 12; y += 1; }
  return `${y}${String(m).padStart(2, '0')}`;
};
// Conversores entre YYYYMM (BD/URL) y YYYY-MM (input nativo type="month").
const yyyymmToMonthInput = (yyyymm) => /^[0-9]{6}$/.test(yyyymm) ? `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}` : '';
const monthInputToYyyymm = (val) => {
  if (!val || typeof val !== 'string') return '';
  const m = val.match(/^([0-9]{4})-([0-9]{2})$/);
  return m ? `${m[1]}${m[2]}` : '';
};

const s = {
  page: { padding: 18 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: 0 },
  sub: { fontSize: 13, color: 'var(--text-light)' },
  filters: { display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' },
  inp: { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: '#fff' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' },
  table: { borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: '100%' },
  thFirst: { position: 'sticky', left: 0, top: 0, background: 'var(--purple-dark)', color: '#fff', padding: '8px 10px', textAlign: 'left', minWidth: 240, zIndex: 3 },
  th: { position: 'sticky', top: 0, background: 'var(--purple-dark)', color: '#fff', padding: '8px 10px', textAlign: 'right', minWidth: 110, zIndex: 2, whiteSpace: 'nowrap' },
  tdFirst: { position: 'sticky', left: 0, background: '#fff', padding: '6px 10px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', minWidth: 240, zIndex: 1 },
  td: { padding: 0, borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', verticalAlign: 'top', minWidth: 110 },
  cellInner: { padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 2 },
  cellInput: { width: '100%', padding: '3px 4px', fontSize: 11, border: '1px solid transparent', borderRadius: 3, textAlign: 'right', background: 'transparent' },
  cellInputFocused: { borderColor: 'var(--purple-mid)', background: '#fff' },
  cellLabel: { fontSize: 9, color: 'var(--text-light)', textTransform: 'uppercase' },
  cellClosed: { background: '#e8f5ec' },
  closedBadge: { fontSize: 9, color: '#1f7a3a', fontWeight: 700 },
  totalRow: { background: 'var(--bg)' },
  rowTotalCell: { fontWeight: 700, color: 'var(--purple-dark)', textAlign: 'right', padding: '6px 10px' },
  contractMeta: { fontSize: 11, color: 'var(--text-light)' },
  banner: { background: '#fffbe6', border: '1px solid #facc15', color: '#92400e', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 },
};

// Evita "30.000000000000004" cuando un float redondea raro tras *100.
const formatPctForInput = (pctFraction) => pctFraction == null
  ? ''
  : Number((Number(pctFraction) * 100).toFixed(2)).toString();

function EditableCell({ cell, contract, yyyymm, onSaved, onCloseMonth }) {
  const isClosed = cell?.status === 'closed';
  const isProject = contract?.type === 'project';
  const planExists = cell != null;
  const totalValueUsd = Number(contract?.total_value_usd || 0);

  // Para projects el input es % (string del input). Para no-projects es USD.
  // Mantenemos el state como string del input que el usuario tipea.
  const initialReal = isProject
    ? formatPctForInput(cell?.real_pct)
    : (cell?.real_usd != null ? String(cell.real_usd) : '');
  const [real, setReal] = useState(initialReal);
  const [savingField, setSavingField] = useState(null);
  const realInitial = useRef(initialReal);

  useEffect(() => {
    const nextInit = isProject
      ? formatPctForInput(cell?.real_pct)
      : (cell?.real_usd != null ? String(cell.real_usd) : '');
    setReal(nextInit);
    realInitial.current = nextInit;
  }, [cell, isProject]);

  const flushReal = async () => {
    if (real === realInitial.current) return;
    setSavingField('real');
    try {
      const empty = real === '';
      const body = isProject
        ? { real_pct: empty ? null : Number(real) / 100 }
        : { real_usd: empty ? null : Number(real) };
      const updated = await apiPut(`/api/revenue/${contract.id}/${yyyymm}`, body);
      onSaved(updated);
      realInitial.current = real;
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error guardando real: ' + e.message);
      setReal(realInitial.current);
    } finally { setSavingField(null); }
  };

  // USD derivado en vivo cuando el usuario tipea % (sin necesidad de guardar).
  const liveDerivedUsd = isProject && real !== '' && !isNaN(Number(real))
    ? (Number(real) / 100) * totalValueUsd
    : null;

  return (
    <td style={{ ...s.td, ...(isClosed ? s.cellClosed : {}) }}>
      <div style={s.cellInner}>
        {/* PROY read-only: si es project, mostramos % + USD derivado; si no, USD directo. */}
        <div>
          <span style={s.cellLabel}>Proy</span>
          <div style={{ ...s.cellInput, color: 'var(--text)', textAlign: 'right', cursor: 'default', padding: '3px 4px' }}>
            {planExists
              ? (isProject
                  ? <span title={fmtUSD(cell.projected_usd)}>{fmtPct(cell.projected_pct)}<br /><span style={{ fontSize: 9, color: 'var(--text-light)' }}>{fmtUSD(cell.projected_usd)}</span></span>
                  : fmtUSD(cell.projected_usd))
              : <span style={{ fontSize: 9, color: 'var(--text-light)', fontStyle: 'italic' }}>sin plan</span>}
          </div>
        </div>
        <div>
          <span style={s.cellLabel}>Real {isProject ? '(%)' : ''}</span>
          <input
            type="number" step="any" inputMode="decimal"
            min="0" max={isProject ? '100' : undefined}
            style={s.cellInput}
            value={real}
            disabled={isClosed || !planExists}
            onChange={(e) => setReal(e.target.value)}
            onBlur={flushReal}
            placeholder={planExists ? (isProject ? '0' : '—') : 'declara plan'}
            aria-label={`Real ${yyyymm}`}
            title={!planExists ? 'Declara primero el plan de reconocimiento del contrato' : (isProject ? 'Avance del proyecto este mes (0-100%)' : undefined)}
          />
          {isProject && planExists && (
            <span style={{ fontSize: 9, color: 'var(--text-light)' }}>
              {liveDerivedUsd != null ? fmtUSD(liveDerivedUsd) : (cell.real_usd != null ? fmtUSD(cell.real_usd) : '—')}
            </span>
          )}
        </div>
        {isClosed ? (
          <span style={s.closedBadge}>✓ Cerrado</span>
        ) : (real !== '' && real === realInitial.current && planExists && (
          <button type="button"
                  onClick={() => onCloseMonth(contract.id, yyyymm, real, isProject)}
                  style={{ fontSize: 10, color: 'var(--purple-dark)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'right' }}>
            cerrar mes →
          </button>
        ))}
        {savingField && <span style={{ fontSize: 9, color: 'var(--warning)' }}>guardando…</span>}
      </div>
    </td>
  );
}

export default function Revenue() {
  const [from, setFrom] = useState(() => offsetMonth(todayYYYYMM(), -3));
  const [to, setTo] = useState(() => offsetMonth(todayYYYYMM(), 5));
  const [filters, setFilters] = useState({ type: '', owner_id: '', country: '' });
  const [data, setData] = useState({ months: [], rows: [], col_totals: {}, global_total: { projected_usd: 0, real_usd: 0 } });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ from, to });
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
      const result = await apiGet(`/api/revenue?${qs}`);
      setData(result);
    } catch (e) { setError(e.message || 'Error cargando revenue'); }
    finally { setLoading(false); }
  }, [from, to, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiGet('/api/users').then(setUsers).catch(() => {}); }, []);

  const handleCellSaved = (updated) => {
    setData((prev) => {
      const next = { ...prev, rows: prev.rows.map((r) => {
        if (r.contract.id !== updated.contract_id) return r;
        const prevCell = r.cells[updated.yyyymm] || {};
        const cells = { ...r.cells, [updated.yyyymm]: {
          // Mantener el plan (projected_usd / projected_pct) — ahora viene del endpoint /plan, no de la celda.
          projected_usd: updated.projected_usd != null ? Number(updated.projected_usd) : prevCell.projected_usd ?? 0,
          projected_pct: updated.projected_pct != null ? Number(updated.projected_pct) : prevCell.projected_pct ?? null,
          real_usd: updated.real_usd != null ? Number(updated.real_usd) : null,
          real_pct: updated.real_pct != null ? Number(updated.real_pct) : null,
          status: updated.status, notes: updated.notes,
          closed_at: updated.closed_at, closed_by: updated.closed_by,
          updated_at: updated.updated_at, updated_by: updated.updated_by,
        } };
        let row_projected = 0; let row_real = 0;
        Object.values(cells).forEach((c) => { if (c) { row_projected += c.projected_usd; if (c.real_usd != null) row_real += c.real_usd; } });
        return { ...r, cells, row_total: { projected_usd: row_projected, real_usd: row_real } };
      }) };
      // Recompute col + global
      next.col_totals = {};
      next.months.forEach((m) => { next.col_totals[m] = { projected_usd: 0, real_usd: 0 }; });
      let gp = 0; let gr = 0;
      next.rows.forEach((r) => next.months.forEach((m) => {
        const c = r.cells[m]; if (c) {
          next.col_totals[m].projected_usd += c.projected_usd;
          if (c.real_usd != null) next.col_totals[m].real_usd += c.real_usd;
          gp += c.projected_usd; if (c.real_usd != null) gr += c.real_usd;
        }
      }));
      next.global_total = { projected_usd: gp, real_usd: gr };
      return next;
    });
  };

  const closeMonth = async (contractId, yyyymm, realValue, isProject) => {
    const valueNum = Number(realValue);
    // Para project, realValue viene en % (string del input). Convertimos
    // para el confirm humano y el body.
    const confirmText = isProject
      ? `¿Cerrar el mes ${monthLabel(yyyymm)} con avance real ${valueNum.toFixed(2)}%?`
      : `¿Cerrar el mes ${monthLabel(yyyymm)} con real ${fmtUSD(valueNum)}?`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`${confirmText}\n\nUna vez cerrado, este placeholder NO bloquea ediciones futuras (eso lo hará el eng team), pero sí queda marcado como cerrado en el audit_log.`)) return;
    try {
      const body = isProject ? { real_pct: valueNum / 100 } : { real_usd: valueNum };
      const updated = await apiPost(`/api/revenue/${contractId}/${yyyymm}/close`, body);
      handleCellSaved(updated);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error al cerrar mes: ' + e.message);
    }
  };

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const rowsToShow = useMemo(() => data.rows || [], [data.rows]);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>💰 Reconocimiento de Ingresos</h2>
          <div style={s.sub}>
            {data.months.length > 0 && (
              <>
                {data.months[0] && monthLabel(data.months[0])} → {data.months[data.months.length - 1] && monthLabel(data.months[data.months.length - 1])}
                {' · '}<strong>Total proyectado: {fmtUSD(data.global_total.projected_usd)}</strong>
                {' · '}<strong>Real: {fmtUSD(data.global_total.real_usd)}</strong>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={s.banner}>
        <strong>MVP funcional.</strong> Esta vista reemplaza el Excel mensual mientras el equipo de ingeniería entra a refactorizar. No tiene aún immutability post-cierre, multi-currency, ni los 4 motores de cálculo del SPEC-RR-00. Cada cambio queda en <code>audit_log</code>.
      </div>

      <div style={s.filters}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          Desde
          <input
            type="month"
            value={yyyymmToMonthInput(from)}
            onChange={(e) => setFrom(monthInputToYyyymm(e.target.value))}
            style={{ ...s.inp, width: 150 }}
            aria-label="Mes desde"
          />
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          Hasta
          <input
            type="month"
            value={yyyymmToMonthInput(to)}
            onChange={(e) => setTo(monthInputToYyyymm(e.target.value))}
            style={{ ...s.inp, width: 150 }}
            aria-label="Mes hasta"
          />
        </label>
        <select value={filters.type} onChange={(e) => setFilter('type', e.target.value)} style={s.inp} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          <option value="capacity">Capacity</option>
          <option value="project">Proyectos</option>
          <option value="resell">Resell</option>
        </select>
        <select value={filters.owner_id} onChange={(e) => setFilter('owner_id', e.target.value)} style={s.inp} aria-label="Owner">
          <option value="">Todos los owners</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
        <input type="text" placeholder="País (CO, MX, …)" maxLength={3}
               value={filters.country} onChange={(e) => setFilter('country', e.target.value)}
               style={{ ...s.inp, width: 110 }} aria-label="País" />
        {(filters.type || filters.owner_id || filters.country) && (
          <button type="button" onClick={() => setFilters({ type: '', owner_id: '', country: '' })}
                  style={{ ...s.inp, cursor: 'pointer', color: 'var(--purple-dark)', fontWeight: 600 }}>
            ✕ Limpiar
          </button>
        )}
      </div>

      {error && <div style={{ ...s.banner, background: '#fde8eb', borderColor: '#ef4444', color: '#b00020' }}>{error}</div>}
      {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</div>}

      {!loading && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.thFirst}>Contrato</th>
                {data.months.map((m) => <th key={m} style={s.th}>{monthLabel(m)}</th>)}
                <th style={{ ...s.th, background: 'var(--teal)' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rowsToShow.length === 0 && (
                <tr>
                  <td colSpan={data.months.length + 2} style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                    Sin contratos en el rango / filtros seleccionados.
                  </td>
                </tr>
              )}
              {rowsToShow.map((r) => (
                <tr key={r.contract.id}>
                  <td style={s.tdFirst}>
                    <Link to={`/contracts/${r.contract.id}`} style={{ color: 'var(--purple-dark)', textDecoration: 'none', fontWeight: 600 }}>
                      {r.contract.name}
                    </Link>
                    <div style={s.contractMeta}>
                      {r.contract.client_name || '—'} · {r.contract.client_country || '—'} · <span style={{ textTransform: 'capitalize' }}>{r.contract.type}</span>
                      {r.contract.owner_name && <> · {r.contract.owner_name}</>}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'var(--text)' }}>
                        <strong>{fmtUSD(r.contract.total_value_usd)}</strong>
                        <span style={{ fontSize: 10, color: 'var(--text-light)', marginLeft: 4 }}>{r.contract.original_currency || 'USD'}</span>
                      </span>
                      <Link to={`/revenue/plan/${r.contract.id}`}
                            style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: r.contract.plan_declared ? 'var(--bg)' : '#fff7e6', border: '1px solid var(--border)', color: r.contract.plan_declared ? 'var(--purple-dark)' : '#92400e', textDecoration: 'none', fontWeight: 600 }}>
                        {r.contract.plan_declared ? '✎ Plan' : '⚠ Declarar plan'}
                      </Link>
                    </div>
                  </td>
                  {data.months.map((m) => (
                    <EditableCell
                      key={m}
                      cell={r.cells[m]}
                      contract={r.contract}
                      yyyymm={m}
                      onSaved={handleCellSaved}
                      onCloseMonth={closeMonth}
                    />
                  ))}
                  <td style={s.rowTotalCell}>
                    <div>{fmtUSD(r.row_total.projected_usd)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-light)' }}>real {fmtUSD(r.row_total.real_usd)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
            {rowsToShow.length > 0 && (
              <tfoot>
                <tr style={s.totalRow}>
                  <td style={{ ...s.tdFirst, fontWeight: 700 }}>TOTALES</td>
                  {data.months.map((m) => {
                    const t = data.col_totals[m] || { projected_usd: 0, real_usd: 0 };
                    return (
                      <td key={m} style={s.rowTotalCell}>
                        <div>{fmtUSD(t.projected_usd)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-light)' }}>real {fmtUSD(t.real_usd)}</div>
                      </td>
                    );
                  })}
                  <td style={{ ...s.rowTotalCell, background: 'var(--teal)', color: '#fff' }}>
                    <div>{fmtUSD(data.global_total.projected_usd)}</div>
                    <div style={{ fontSize: 10 }}>real {fmtUSD(data.global_total.real_usd)}</div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
