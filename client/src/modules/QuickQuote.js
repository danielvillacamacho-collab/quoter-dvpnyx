import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { apiGet } from '../utils/apiV2';
import FilterableSelect from '../shell/FilterableSelect';
import cx from './QuickQuote.module.css';

const STORAGE_KEY = 'dvpnyx_quick_quotes_v1';
const COMPANY_FACTOR = 1.5;
const CURRENCIES = ['USD', 'COP', 'MXN', 'EUR', 'GTQ', 'PEN', 'CLP', 'ARS'];
const FX_FALLBACK_MONTHS = 3;

const loadSaved = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

const persist = (list) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
};

const fmtMoney = (n, ccy) => {
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: ccy,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${ccy} ${n.toFixed(0)}`;
  }
};

const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;

// es-CO locale: 5000000 → "5.000.000". Estado mantiene solo dígitos.
const fmtThousands = (digits) => (digits ? Number(digits).toLocaleString('es-CO') : '');

function currentYyyymm() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftYyyymm(yyyymm, deltaMonths) {
  let y = Number(yyyymm.slice(0, 4));
  let m = Number(yyyymm.slice(4)) + deltaMonths;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}${String(m).padStart(2, '0')}`;
}

export default function QuickQuote() {
  const { params } = useAuth();
  const nav = useNavigate();

  const toolsOpts = useMemo(
    () => (params?.tools || []).map((t) => ({ key: t.key, value: Number(t.value) || 0 })),
    [params],
  );

  const defaultPersonMargin = useMemo(() => {
    const m = params?.margin?.find((p) => p.key === 'talent');
    return m ? Number(m.value) : 0.35;
  }, [params]);

  const defaultToolsMargin = useMemo(() => {
    const m = params?.margin?.find((p) => p.key === 'tools');
    return m ? Number(m.value) : 0.20;
  }, [params]);

  const [salary, setSalary] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [personMarginPct, setPersonMarginPct] = useState('');
  const [toolsMarginPct, setToolsMarginPct] = useState('');
  const [toolsKey, setToolsKey] = useState('');

  const [clients, setClients] = useState([]);
  const [clientsError, setClientsError] = useState(false);
  const [clientId, setClientId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [savedList, setSavedList] = useState(() => loadSaved());
  const [feedback, setFeedback] = useState(null);

  // FX: para convertir el costo de herramientas (USD) a la moneda del salario.
  // status: 'loading' | 'ok' | 'fallback' | 'missing' | 'error'
  // rate: USD→<currency> (1 USD = N <currency>); 1 cuando currency=USD.
  // sourceMonth: yyyymm del cual se tomó la tasa.
  const [fx, setFx] = useState({ status: 'ok', rate: 1, sourceMonth: null });

  useEffect(() => {
    if (toolsOpts.length && !toolsKey) setToolsKey(toolsOpts[0].key);
  }, [toolsOpts, toolsKey]);

  useEffect(() => {
    if (personMarginPct === '' && Number.isFinite(defaultPersonMargin)) {
      setPersonMarginPct(String((defaultPersonMargin * 100).toFixed(1)));
    }
  }, [defaultPersonMargin, personMarginPct]);

  useEffect(() => {
    if (toolsMarginPct === '' && Number.isFinite(defaultToolsMargin)) {
      setToolsMarginPct(String((defaultToolsMargin * 100).toFixed(1)));
    }
  }, [defaultToolsMargin, toolsMarginPct]);

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/clients?limit=200&active=true')
      .then((r) => { if (!cancelled) { setClients(r?.data || []); setClientsError(false); } })
      .catch(() => { if (!cancelled) { setClients([]); setClientsError(true); } });
    return () => { cancelled = true; };
  }, []);

  // Carga la tasa USD→currency. Intenta el mes actual; si no está,
  // mira hasta FX_FALLBACK_MONTHS atrás y usa el más reciente.
  useEffect(() => {
    if (currency === 'USD') {
      setFx({ status: 'ok', rate: 1, sourceMonth: null });
      return undefined;
    }
    let cancelled = false;
    setFx({ status: 'loading', rate: null, sourceMonth: null });
    const to = currentYyyymm();
    const from = shiftYyyymm(to, -FX_FALLBACK_MONTHS);
    apiGet(`/api/admin/exchange-rates?from=${from}&to=${to}&currency=${currency}`)
      .then((r) => {
        if (cancelled) return;
        const cells = r?.cells || {};
        // Buscar de más reciente a más viejo dentro del rango.
        let found = null;
        for (let i = 0; i <= FX_FALLBACK_MONTHS; i++) {
          const ym = shiftYyyymm(to, -i);
          const cell = cells[`${currency}|${ym}`];
          if (cell && Number.isFinite(Number(cell.usd_rate)) && Number(cell.usd_rate) > 0) {
            found = { rate: Number(cell.usd_rate), month: ym };
            break;
          }
        }
        if (!found) {
          setFx({ status: 'missing', rate: null, sourceMonth: null });
          return;
        }
        setFx({
          status: found.month === to ? 'ok' : 'fallback',
          rate: found.rate,
          sourceMonth: found.month,
        });
      })
      .catch(() => {
        if (!cancelled) setFx({ status: 'error', rate: null, sourceMonth: null });
      });
    return () => { cancelled = true; };
  }, [currency]);

  const calc = useMemo(() => {
    const salaryNum = Number(salary) || 0;
    const personMargin = Math.max(0, Math.min(0.99, (Number(personMarginPct) || 0) / 100));
    const toolsMargin = Math.max(0, Math.min(0.99, (Number(toolsMarginPct) || 0) / 100));
    const toolsCostUsd = toolsOpts.find((t) => t.key === toolsKey)?.value || 0;
    // Tools están almacenadas en USD; convertir a la moneda del salario.
    // Si la tasa todavía está cargando o no hay rate, toolsCost queda 0
    // para que el usuario vea claramente que falta el dato.
    const fxRate = currency === 'USD' ? 1 : (Number.isFinite(fx.rate) && fx.rate > 0 ? fx.rate : null);
    const toolsCost = fxRate == null ? 0 : toolsCostUsd * fxRate;
    const companyCost = salaryNum * COMPANY_FACTOR;
    const personPrice = personMargin >= 1 ? 0 : companyCost / (1 - personMargin);
    const toolsPrice = toolsMargin >= 1 ? 0 : toolsCost / (1 - toolsMargin);
    const price = personPrice + toolsPrice;
    return { salaryNum, personMargin, toolsMargin, toolsCostUsd, toolsCost, companyCost, personPrice, toolsPrice, price, fxRate };
  }, [salary, personMarginPct, toolsMarginPct, toolsKey, toolsOpts, currency, fx.rate]);

  // Si la moneda no es USD, requerimos una tasa válida para que el precio
  // guardado sea correcto. Sin tasa, toolsCost queda 0 y es engañoso.
  const fxBlocksSave = currency !== 'USD' && !(Number.isFinite(calc.fxRate) && calc.fxRate > 0);
  const canSave = Boolean(clientId) && profileName.trim().length > 0 && calc.salaryNum > 0 && !fxBlocksSave;

  const handleSave = useCallback(() => {
    setFeedback(null);
    if (!clientId) { setFeedback({ type: 'error', text: 'Selecciona un cliente para guardar' }); return; }
    if (!profileName.trim()) { setFeedback({ type: 'error', text: 'El nombre del perfil es obligatorio' }); return; }
    if (calc.salaryNum <= 0) { setFeedback({ type: 'error', text: 'Ingresa un salario base mayor a 0' }); return; }

    const cli = clients.find((c) => c.id === clientId);
    const entry = {
      id: `qq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString(),
      client_id: clientId,
      client_name: cli?.name || '',
      profile_name: profileName.trim(),
      currency,
      salary: calc.salaryNum,
      person_margin: calc.personMargin,
      tools_margin: calc.toolsMargin,
      tools_key: toolsKey,
      tools_cost_usd: calc.toolsCostUsd,
      tools_cost: calc.toolsCost,
      company_cost: calc.companyCost,
      price: calc.price,
      fx_rate: calc.fxRate,
      fx_source_month: fx.sourceMonth,
    };
    // Functional update guards against rapid double-clicks: the second
    // call sees the post-update list, not the stale closure value.
    setSavedList((prev) => {
      const next = [entry, ...prev].slice(0, 100);
      persist(next);
      return next;
    });
    setFeedback({ type: 'success', text: 'Cotización rápida guardada' });
  }, [clientId, profileName, calc, clients, currency, toolsKey]);

  const handleDelete = useCallback((id) => {
    const next = savedList.filter((q) => q.id !== id);
    setSavedList(next);
    persist(next);
  }, [savedList]);

  const handleReset = useCallback(() => {
    setSalary('');
    setCurrency('USD');
    setPersonMarginPct(String((defaultPersonMargin * 100).toFixed(1)));
    setToolsMarginPct(String((defaultToolsMargin * 100).toFixed(1)));
    if (toolsOpts.length) setToolsKey(toolsOpts[0].key);
    setClientId('');
    setProfileName('');
    setFeedback(null);
  }, [defaultPersonMargin, defaultToolsMargin, toolsOpts]);

  return (
    <div className={cx.page}>
      <div className={cx.header}>
        <div>
          <h1 className={cx.title}>Cotización Rápida</h1>
          <div className={cx.subtitle}>
            Calcula el precio de una persona en segundos. Guardar requiere cliente y nombre del perfil.
          </div>
        </div>
        <div>
          <button type="button" className={cx.btnSecondary} onClick={() => nav('/quotations')}>
            ← Historial
          </button>
        </div>
      </div>

      <div className={cx.grid}>
        <section className={cx.card}>
          <h2 className={cx.cardTitle}>Entradas</h2>

          <div className={cx.field}>
            <label className={cx.label} htmlFor="qq-salary">Salario base</label>
            <div className={cx.row}>
              <input
                id="qq-salary"
                className={cx.input}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={fmtThousands(salary)}
                onChange={(e) => setSalary(e.target.value.replace(/\D/g, ''))}
                placeholder="Ej. 5.000.000"
              />
              <select
                aria-label="Moneda"
                className={cx.select}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <span className={cx.hint}>Salario mensual de la persona, en la moneda seleccionada.</span>
          </div>

          <div className={cx.rowTwo}>
            <div className={cx.field}>
              <label className={cx.label} htmlFor="qq-pmargin">Margen sobre salario (%)</label>
              <input
                id="qq-pmargin"
                className={cx.input}
                type="number"
                min="0"
                max="99"
                step="0.1"
                value={personMarginPct}
                onChange={(e) => setPersonMarginPct(e.target.value)}
                placeholder="35"
              />
            </div>
            <div className={cx.field}>
              <label className={cx.label} htmlFor="qq-tmargin">Margen sobre herramientas (%)</label>
              <input
                id="qq-tmargin"
                className={cx.input}
                type="number"
                min="0"
                max="99"
                step="0.1"
                value={toolsMarginPct}
                onChange={(e) => setToolsMarginPct(e.target.value)}
                placeholder="20"
              />
            </div>
          </div>

          <div className={cx.field}>
            <label className={cx.label} htmlFor="qq-tools">Tipo de herramientas</label>
            <select
              id="qq-tools"
              className={cx.select}
              value={toolsKey}
              onChange={(e) => setToolsKey(e.target.value)}
            >
              {toolsOpts.length === 0 && <option value="">— Sin parámetros de herramientas —</option>}
              {toolsOpts.map((t) => {
                const usd = Number(t.value) || 0;
                const inCurrency = currency === 'USD'
                  ? usd
                  : (Number.isFinite(calc.fxRate) && calc.fxRate > 0 ? usd * calc.fxRate : null);
                const valueLabel = inCurrency == null
                  ? `${fmtMoney(usd, 'USD')} (sin tasa)`
                  : currency === 'USD'
                    ? fmtMoney(usd, 'USD')
                    : `${fmtMoney(inCurrency, currency)} · ${fmtMoney(usd, 'USD')}`;
                return (
                  <option key={t.key} value={t.key}>{t.key} — {valueLabel}</option>
                );
              })}
            </select>
            {currency !== 'USD' && (
              <span className={cx.hint}>
                {fx.status === 'loading' && 'Cargando tasa USD→' + currency + '…'}
                {fx.status === 'ok' && `Tasa USD→${currency} ${currentYyyymm()}: 1 USD = ${fmtMoney(fx.rate, currency)}`}
                {fx.status === 'fallback' && (
                  <span style={{ color: 'var(--ds-warn, #d97706)' }}>
                    No hay tasa para {currentYyyymm()}; usando {fx.sourceMonth}: 1 USD = {fmtMoney(fx.rate, currency)}
                  </span>
                )}
                {fx.status === 'missing' && (
                  <span style={{ color: 'var(--ds-danger, #dc2626)' }}>
                    No hay tasa USD→{currency} cargada en los últimos {FX_FALLBACK_MONTHS + 1} meses. Las herramientas no pueden convertirse — pedile a admin que cargue la tasa.
                  </span>
                )}
                {fx.status === 'error' && (
                  <span style={{ color: 'var(--ds-danger, #dc2626)' }}>
                    Error al cargar tasa de cambio.
                  </span>
                )}
              </span>
            )}
          </div>

          <div className={cx.formula}>
            costo_empresa = salario × {COMPANY_FACTOR}<br />
            precio = costo_empresa ÷ (1 − margen_persona) + costo_herramientas ÷ (1 − margen_herramientas)
          </div>
        </section>

        <section className={cx.card}>
          <h2 className={cx.cardTitle}>Resultado</h2>
          <div className={cx.results}>
            <div className={cx.resultRow}>
              <span className={cx.resultLabel}>Costo empresa (×{COMPANY_FACTOR})</span>
              <span className={cx.resultValue}>{fmtMoney(calc.companyCost, currency)}</span>
            </div>
            <div className={cx.resultRow}>
              <span className={cx.resultLabel}>Costo herramientas</span>
              <span className={cx.resultValue}>{fmtMoney(calc.toolsCost, currency)}</span>
            </div>
            <div className={cx.resultRow}>
              <span className={cx.resultLabel}>Precio persona</span>
              <span className={cx.resultValue}>{fmtMoney(calc.personPrice, currency)}</span>
            </div>
            <div className={cx.resultRow}>
              <span className={cx.resultLabel}>Precio herramientas</span>
              <span className={cx.resultValue}>{fmtMoney(calc.toolsPrice, currency)}</span>
            </div>

            <div className={cx.priceRow}>
              <span className={cx.priceLabel}>Precio total</span>
              <span className={cx.priceValue}>{fmtMoney(calc.price, currency)}</span>
              <span className={cx.priceSecondary}>
                Margen persona {fmtPct(calc.personMargin)} · Margen herramientas {fmtPct(calc.toolsMargin)}
              </span>
            </div>
          </div>
        </section>
      </div>

      <section className={`${cx.card} ${cx.saveCard}`}>
        <h2 className={cx.cardTitle}>Guardar cotización rápida</h2>
        <div className={cx.saveRow}>
          <div className={cx.field}>
            <label className={cx.label}>Cliente *</label>
            <FilterableSelect
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="— Selecciona un cliente —"
              options={clients.map((c) => ({ id: String(c.id), label: c.name }))}
              aria-label="Cliente"
            />
            {clientsError && (
              <span className={cx.hint} style={{ color: 'var(--ds-danger, #dc2626)' }}>
                No se pudo cargar la lista de clientes. Reintenta recargando la página.
              </span>
            )}
          </div>
          <div className={cx.field}>
            <label className={cx.label} htmlFor="qq-profile">Nombre del perfil *</label>
            <input
              id="qq-profile"
              className={cx.input}
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Ej. Desarrollador Senior Full-Stack"
            />
          </div>
          <div className={cx.field}>
            <label className={cx.label}>&nbsp;</label>
            <div className={cx.btnGroup}>
              <button type="button" className={cx.btnPrimary} onClick={handleSave} disabled={!canSave}>
                Guardar
              </button>
              <button type="button" className={cx.btnSecondary} onClick={handleReset}>
                Limpiar
              </button>
            </div>
          </div>
        </div>
        {feedback && (
          <div className={feedback.type === 'error' ? cx.error : cx.success}>{feedback.text}</div>
        )}
      </section>

      <section className={cx.card}>
        <h2 className={cx.cardTitle}>Cotizaciones rápidas guardadas</h2>
        {savedList.length === 0 ? (
          <div className={cx.empty}>Aún no has guardado ninguna cotización rápida.</div>
        ) : (
          <div className={cx.tableWrap}>
            <table className={cx.table}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Perfil</th>
                  <th>Herramientas</th>
                  <th className={cx.tableNum}>Salario</th>
                  <th className={cx.tableNum}>Margen P / H</th>
                  <th className={cx.tableNum}>Precio</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {savedList.map((q) => (
                  <tr key={q.id}>
                    <td>{new Date(q.created_at).toLocaleDateString('es-CO')}</td>
                    <td>{q.client_name}</td>
                    <td>{q.profile_name}</td>
                    <td>{q.tools_key}</td>
                    <td className={cx.tableNum}>{fmtMoney(q.salary, q.currency)}</td>
                    <td className={cx.tableNum}>{fmtPct(q.person_margin)} / {fmtPct(q.tools_margin)}</td>
                    <td className={cx.tableNum}>{fmtMoney(q.price, q.currency)}</td>
                    <td>
                      <button type="button" className={cx.btnDanger} onClick={() => handleDelete(q.id)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
