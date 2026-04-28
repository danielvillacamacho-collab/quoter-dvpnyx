/*
 * Exchange Rates admin page (RR-MVP-00.6).
 *
 * Matriz currencies × meses, admin only, donde se administran las tasas
 * tipo "USDCOP" del Excel histórico. Convención: 1 USD = N <currency>.
 *
 * Edición inline con autosave on-blur (mismo patrón que el resto del
 * módulo de revenue). Permite agregar nuevas monedas con una fila vacía.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { apiGet, apiPut, apiDelete } from '../utils/apiV2';

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
const yyyymmToMonthInput = (yyyymm) => /^[0-9]{6}$/.test(yyyymm) ? `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}` : '';
const monthInputToYyyymm = (val) => {
  if (!val || typeof val !== 'string') return '';
  const m = val.match(/^([0-9]{4})-([0-9]{2})$/);
  return m ? `${m[1]}${m[2]}` : '';
};

const COMMON_CCYS = ['COP', 'MXN', 'GTQ', 'EUR', 'PEN', 'CRC', 'CAD'];

const s = {
  page: { padding: 18 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: 0 },
  sub: { fontSize: 13, color: 'var(--text-light)' },
  filters: { display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 },
  inp: { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: '#fff' },
  banner: { background: '#fffbe6', border: '1px solid #facc15', color: '#92400e', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' },
  table: { borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: '100%' },
  thFirst: { position: 'sticky', left: 0, top: 0, background: 'var(--purple-dark)', color: '#fff', padding: '8px 10px', textAlign: 'left', minWidth: 100, zIndex: 3 },
  th: { position: 'sticky', top: 0, background: 'var(--purple-dark)', color: '#fff', padding: '8px 10px', textAlign: 'right', minWidth: 100, zIndex: 2, whiteSpace: 'nowrap' },
  tdFirst: { position: 'sticky', left: 0, background: '#fff', padding: '6px 10px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', minWidth: 100, fontWeight: 600, color: 'var(--purple-dark)', zIndex: 1 },
  td: { padding: '4px 6px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' },
  cellInput: { width: '100%', padding: '4px 6px', border: '1px solid transparent', borderRadius: 4, textAlign: 'right', fontSize: 12 },
  addRow: { padding: '12px', display: 'flex', gap: 6, alignItems: 'center', background: '#fafafa' },
};

function FxCell({ value, yyyymm, currency, onSaved }) {
  const [v, setV] = useState(value != null ? String(value) : '');
  const [busy, setBusy] = useState(false);
  const initial = useRef(v);

  useEffect(() => {
    setV(value != null ? String(value) : '');
    initial.current = value != null ? String(value) : '';
  }, [value]);

  const flush = async () => {
    if (v === initial.current) return;
    if (v === '') {
      // Borrar la celda
      try {
        setBusy(true);
        await apiDelete(`/api/admin/exchange-rates/${yyyymm}/${currency}`);
        onSaved({ yyyymm, currency, deleted: true });
        initial.current = '';
      } catch (e) {
        // eslint-disable-next-line no-alert
        alert('Error al borrar tasa: ' + e.message);
        setV(initial.current);
      } finally { setBusy(false); }
      return;
    }
    const num = Number(v);
    if (!Number.isFinite(num) || num <= 0) {
      // eslint-disable-next-line no-alert
      alert('La tasa debe ser un número > 0');
      setV(initial.current);
      return;
    }
    try {
      setBusy(true);
      const updated = await apiPut(`/api/admin/exchange-rates/${yyyymm}/${currency}`, { usd_rate: num });
      onSaved({ yyyymm, currency, usd_rate: Number(updated.usd_rate) });
      initial.current = String(num);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error al guardar: ' + e.message);
      setV(initial.current);
    } finally { setBusy(false); }
  };

  return (
    <td style={s.td}>
      <input
        type="number" step="any" min="0"
        style={s.cellInput}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={flush}
        disabled={busy}
        placeholder="—"
        aria-label={`${currency} ${yyyymm}`}
      />
    </td>
  );
}

export default function ExchangeRates() {
  const [from, setFrom] = useState(() => offsetMonth(todayYYYYMM(), -3));
  const [to, setTo] = useState(() => offsetMonth(todayYYYYMM(), 8));
  const [data, setData] = useState({ months: [], currencies: [], cells: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newCcy, setNewCcy] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await apiGet(`/api/admin/exchange-rates?from=${from}&to=${to}`);
      setData(result);
    } catch (e) { setError(e.message || 'Error cargando tasas'); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const months = data.months || [];
  // Currencies a mostrar = unión de las que vinieron del backend + las "comunes"
  // sugeridas. El admin las puede agregar via "+ Agregar moneda".
  const allCurrencies = useMemo(() => {
    const fromBackend = data.currencies || [];
    return Array.from(new Set([...fromBackend])).sort();
  }, [data.currencies]);

  const handleSaved = (event) => {
    setData((prev) => {
      const next = { ...prev, cells: { ...prev.cells } };
      const key = `${event.currency}|${event.yyyymm}`;
      if (event.deleted) {
        delete next.cells[key];
      } else {
        next.cells[key] = { ...(next.cells[key] || {}), usd_rate: event.usd_rate };
      }
      // Si la moneda no estaba en la lista, agregarla.
      if (!event.deleted && !next.currencies.includes(event.currency)) {
        next.currencies = [...next.currencies, event.currency].sort();
      }
      return next;
    });
  };

  const addCurrency = () => {
    const ccy = newCcy.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(ccy)) {
      // eslint-disable-next-line no-alert
      alert('Código de moneda debe ser 3 letras ISO 4217 (COP, MXN, EUR, etc.)');
      return;
    }
    if (ccy === 'USD') {
      // eslint-disable-next-line no-alert
      alert('USD se asume rate=1.0 implícito; no se almacena.');
      return;
    }
    if (allCurrencies.includes(ccy)) {
      // eslint-disable-next-line no-alert
      alert(`${ccy} ya está en la matriz.`);
      return;
    }
    setData((prev) => ({ ...prev, currencies: [...prev.currencies, ccy].sort() }));
    setNewCcy('');
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>💱 Tasas de cambio</h2>
          <div style={s.sub}>
            Convención: <strong>1 USD = N moneda</strong>. USD se asume rate 1 implícito (no se edita).
            Los reconocimientos usan estas tasas para convertir entre monedas.
          </div>
        </div>
      </div>

      <div style={s.banner}>
        <strong>MVP funcional.</strong> El equipo de ingeniería va a refactorizar este módulo con
        cierre de tasa por mes, integración con un proveedor FX (BanRep / fixer.io / etc.) y locked
        rates para meses cerrados. Por ahora los rates se editan a mano.
      </div>

      <div style={s.filters}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          Desde
          <input type="month" value={yyyymmToMonthInput(from)}
                 onChange={(e) => setFrom(monthInputToYyyymm(e.target.value))}
                 style={{ ...s.inp, width: 150 }} />
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          Hasta
          <input type="month" value={yyyymmToMonthInput(to)}
                 onChange={(e) => setTo(monthInputToYyyymm(e.target.value))}
                 style={{ ...s.inp, width: 150 }} />
        </label>
      </div>

      {error && <div style={{ ...s.banner, background: '#fde8eb', borderColor: '#ef4444', color: '#b00020' }}>{error}</div>}
      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-light)' }}>Cargando…</div>}

      {!loading && (
        <>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.thFirst}>Moneda</th>
                  {months.map((m) => <th key={m} style={s.th}>{monthLabel(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                {allCurrencies.length === 0 && (
                  <tr>
                    <td colSpan={months.length + 1} style={{ textAlign: 'center', padding: 24, color: 'var(--text-light)' }}>
                      Sin tasas configuradas en este rango. Agrega una moneda abajo.
                    </td>
                  </tr>
                )}
                {allCurrencies.map((ccy) => (
                  <tr key={ccy}>
                    <td style={s.tdFirst}>USD/{ccy}</td>
                    {months.map((m) => {
                      const cell = data.cells[`${ccy}|${m}`];
                      return (
                        <FxCell
                          key={m}
                          value={cell ? cell.usd_rate : null}
                          yyyymm={m} currency={ccy}
                          onSaved={handleSaved}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={s.addRow}>
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Agregar moneda:</span>
            <input
              type="text" maxLength={3}
              value={newCcy}
              onChange={(e) => setNewCcy(e.target.value.toUpperCase())}
              placeholder="COP, MXN, EUR…"
              style={{ ...s.inp, width: 100, textTransform: 'uppercase' }}
              list="ccy-suggestions"
              aria-label="Nueva moneda"
            />
            <datalist id="ccy-suggestions">
              {COMMON_CCYS.map((c) => <option key={c} value={c} />)}
            </datalist>
            <button type="button" onClick={addCurrency}
                    style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--purple-dark)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              + Agregar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
