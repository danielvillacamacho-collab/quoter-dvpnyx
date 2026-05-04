/**
 * Revenue recognition (RR-MVP-00.1, Abril 2026).
 *
 * REEMPLAZA el Excel "Portafolio_de_cuentas_por_Delivery_Manager.xlsx"
 * para que DMs/CFO puedan operar el cierre mensual sin hoja paralela.
 *
 * SCOPE INTENCIONAL: trabajo funcional placeholder. Cuando el equipo de
 * ingeniería entre a refactorizar, ver SPEC-RR-00 para el modelo
 * NIIF 15-friendly real (immutability triggers, plan_frozen_at,
 * service_period_history append-only, multi-currency, atomic worker
 * async, 4 motores polimórficos por tipo de contrato). Aquí solo hay:
 *
 *   - 1 motor: monthly_projection plano (un número proyectado y un
 *     número real por mes y contrato).
 *   - status 'open' / 'closed' por celda. Sin trigger inmutable: si el
 *     CFO necesita corregir, edita y queda en audit_log.
 *   - USD único. Multi-currency queda explícitamente diferido.
 *   - audit log usa la tabla audit_log existente (no append-only
 *     dedicada — eso lo hará el eng team).
 *
 * Endpoints:
 *   GET /api/revenue?from=YYYYMM&to=YYYYMM[&type=&owner_id=&country=]
 *     → matriz contracts × meses con totales por columna y global.
 *   PUT /api/revenue/:contract_id/:yyyymm
 *     → upsert. body: { projected_usd?, real_usd?, status?, notes? }
 *   POST /api/revenue/:contract_id/:yyyymm/close
 *     → marca status='closed', requiere real_usd no nulo.
 */

const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');
const { safeRollback, serverError } = require('../utils/http');

router.use(auth);

const YYYYMM_RE = /^[0-9]{6}$/;

function expandMonths(from, to) {
  if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) return [];
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4));
  const yEnd = Number(to.slice(0, 4));
  const mEnd = Number(to.slice(4));
  let safety = 0;
  while ((y < yEnd || (y === yEnd && m <= mEnd)) && safety < 240) {
    out.push(`${y.toString().padStart(4, '0')}${m.toString().padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
    safety += 1;
  }
  return out;
}

/* -------- LIST (matrix) -------- */
router.get('/', async (req, res) => {
  try {
    const fxUtils = require('../utils/fx');
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) {
      return res.status(400).json({ error: 'from/to inválidos (formato YYYYMM)' });
    }
    const months = expandMonths(from, to);
    if (!months.length) return res.status(400).json({ error: 'Rango de meses vacío' });
    // RR-MVP-00.6: moneda en la que el usuario quiere ver totales y celdas.
    const displayCurrency = String(req.query.display_currency || 'USD').toUpperCase();

    const wheres = ['c.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };
    if (req.query.type)     wheres.push(`c.type = ${add(req.query.type)}`);
    if (req.query.owner_id) wheres.push(`c.account_owner_id = ${add(req.query.owner_id)}`);
    if (req.query.country)  wheres.push(`cl.country = ${add(req.query.country)}`);

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';

    const { rows: contracts } = await pool.query(
      `SELECT c.id, c.name, c.type, c.status, c.start_date, c.end_date,
              c.total_value_usd, c.original_currency,
              cl.id   AS client_id,
              cl.name AS client_name,
              cl.country AS client_country,
              u.id   AS owner_id,
              u.name AS owner_name,
              EXISTS(SELECT 1 FROM revenue_periods rp WHERE rp.contract_id=c.id) AS plan_declared
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN users u    ON u.id  = c.account_owner_id
         ${where}
         ORDER BY c.start_date DESC, c.name ASC`,
      params,
    );

    const ids = contracts.map((c) => c.id);
    let periodsByContract = new Map();
    if (ids.length) {
      const { rows: periods } = await pool.query(
        `SELECT contract_id, yyyymm, projected_usd, projected_pct, real_usd, real_pct, status, notes,
                closed_at, closed_by, updated_at, updated_by
           FROM revenue_periods
          WHERE contract_id = ANY($1::uuid[]) AND yyyymm BETWEEN $2 AND $3`,
        [ids, from, to],
      );
      periods.forEach((p) => {
        const key = p.contract_id;
        if (!periodsByContract.has(key)) periodsByContract.set(key, {});
        periodsByContract.get(key)[p.yyyymm] = p;
      });
    }

    // ── Capacity auto-projection: sum prorated client_rate per month ──
    // For capacity contracts, the projected revenue is derived from
    // actual assignments and their rate history, NOT from the manual plan.
    // When rate history exists, it uses the applicable rate per day based
    // on effective_date. Falls back to assignment.client_rate if no history.
    const capacityIds = contracts.filter((c) => c.type === 'capacity').map((c) => c.id);
    const capacityProjections = new Map(); // contract_id → { yyyymm → amount }
    if (capacityIds.length) {
      const { rows: capAsg } = await pool.query(
        `SELECT a.id, a.contract_id, a.start_date, a.end_date, a.client_rate,
                a.client_rate_currency
           FROM assignments a
          WHERE a.contract_id = ANY($1::uuid[])
            AND a.deleted_at IS NULL
            AND a.status NOT IN ('cancelled')
            AND a.client_rate IS NOT NULL`,
        [capacityIds],
      );
      // Load rate history for all these assignments in one query.
      const asgIds = capAsg.map((a) => a.id);
      let rateHistoryByAsg = new Map();
      if (asgIds.length) {
        const { rows: rateRows } = await pool.query(
          `SELECT assignment_id, effective_date, client_rate, client_rate_currency
             FROM assignment_rate_history
            WHERE assignment_id = ANY($1::uuid[])
            ORDER BY assignment_id, effective_date ASC`,
          [asgIds],
        );
        for (const r of rateRows) {
          if (!rateHistoryByAsg.has(r.assignment_id)) rateHistoryByAsg.set(r.assignment_id, []);
          rateHistoryByAsg.get(r.assignment_id).push({
            effective: new Date(r.effective_date),
            rate: Number(r.client_rate),
          });
        }
      }

      // Helper: find the applicable rate for a given date from history.
      // Returns the rate whose effective_date is <= date (latest one).
      function rateForDate(history, date) {
        if (!history || !history.length) return null;
        let applicable = null;
        for (const h of history) {
          if (h.effective <= date) applicable = h.rate;
          else break; // sorted ASC, so first one after date means we stop
        }
        return applicable;
      }

      // Build month-by-month proration for each capacity assignment.
      for (const a of capAsg) {
        const fallbackRate = Number(a.client_rate);
        if (!fallbackRate) continue;
        const history = rateHistoryByAsg.get(a.id);
        const hasHistory = history && history.length > 0;
        const aStart = new Date(a.start_date);
        const aEnd = a.end_date ? new Date(a.end_date) : null;

        for (const m of months) {
          const year = Number(m.slice(0, 4));
          const month = Number(m.slice(4)); // 1-indexed
          const dim = new Date(year, month, 0).getDate();
          const monthStart = new Date(year, month - 1, 1);
          const monthEnd = new Date(year, month - 1, dim);
          // Overlap check
          if (aStart > monthEnd) continue;
          if (aEnd && aEnd < monthStart) continue;
          const activeStart = aStart > monthStart ? aStart : monthStart;
          const activeEnd = aEnd && aEnd < monthEnd ? aEnd : monthEnd;

          let monthAmount = 0;
          if (hasHistory && history.length > 1) {
            // Day-by-day calculation when multiple rates exist.
            // Group consecutive days with same rate for efficiency.
            let curDay = new Date(activeStart);
            while (curDay <= activeEnd) {
              const dayRate = rateForDate(history, curDay) || fallbackRate;
              // Find how many consecutive days have this same rate.
              let streak = 1;
              const nextDay = new Date(curDay);
              nextDay.setDate(nextDay.getDate() + 1);
              while (nextDay <= activeEnd) {
                const nr = rateForDate(history, nextDay) || fallbackRate;
                if (nr !== dayRate) break;
                streak++;
                nextDay.setDate(nextDay.getDate() + 1);
              }
              monthAmount += dayRate * streak / dim;
              curDay.setDate(curDay.getDate() + streak);
            }
          } else {
            // Single rate (or no history) — simple proration.
            const rate = hasHistory ? history[0].rate : fallbackRate;
            const daysActive = Math.round((activeEnd - activeStart) / 86400000) + 1;
            monthAmount = rate * daysActive / dim;
          }

          const prorated = parseFloat(monthAmount.toFixed(4));
          if (!capacityProjections.has(a.contract_id)) capacityProjections.set(a.contract_id, {});
          const byMonth = capacityProjections.get(a.contract_id);
          byMonth[m] = (byMonth[m] || 0) + prorated;
        }
      }
    }

    // Cargar TODOS los rates relevantes — todas las monedas que aparecen
    // en los contratos + display_currency. Carga una sola query y el
    // helper buildRatesMap maneja fallback al rate más reciente disponible.
    const ratesNeeded = new Set([displayCurrency]);
    contracts.forEach((c) => {
      const ccy = String(c.original_currency || 'USD').toUpperCase();
      if (ccy !== 'USD') ratesNeeded.add(ccy);
    });
    const fxList = ratesNeeded.size > 0
      ? (await pool.query(
          `SELECT yyyymm, currency, usd_rate FROM exchange_rates WHERE currency = ANY($1::text[]) ORDER BY currency, yyyymm`,
          [Array.from(ratesNeeded)],
        )).rows
      : [];
    const rates = fxUtils.buildRatesMap(fxList);

    // Para cada celda construimos:
    //   amount_original (en contract.original_currency)
    //   amount_display  (convertido a displayCurrency, null si rate falta)
    // Los totales (row/col/global) se computan en displayCurrency.
    let missingRate = false;
    const rowsOut = contracts.map((c) => {
      const cells = {};
      const ccyOrig = String(c.original_currency || 'USD').toUpperCase();
      const isCapacity = c.type === 'capacity';
      const capProj = isCapacity ? (capacityProjections.get(c.id) || {}) : null;
      let row_proj_disp = 0; let row_real_disp = 0;
      let row_proj_orig = 0; let row_real_orig = 0;
      months.forEach((m) => {
        const cell = (periodsByContract.get(c.id) || {})[m] || null;

        // For capacity contracts, projected comes from assignments (auto),
        // not from the manually declared plan. The plan's projected_usd
        // is kept as `plan_amount_original` for comparison.
        const autoProjOrig = isCapacity ? (capProj[m] || 0) : 0;
        const projOrig = isCapacity ? autoProjOrig : Number(cell?.projected_usd || 0);

        // If capacity and no cell AND no auto projection, skip entirely.
        if (!cell && !isCapacity) { cells[m] = null; return; }
        if (!cell && isCapacity && autoProjOrig === 0) { cells[m] = null; return; }

        const realOrig = cell?.real_usd != null ? Number(cell.real_usd) : null;
        const projConv = fxUtils.convert(projOrig, ccyOrig, displayCurrency, m, rates);
        const realConv = realOrig == null
          ? { amount: null, rateUsed: null }
          : fxUtils.convert(realOrig, ccyOrig, displayCurrency, m, rates);
        if (projOrig > 0 && projConv.amount == null) missingRate = true;
        if (realOrig != null && realConv.amount == null) missingRate = true;
        row_proj_orig += projOrig;
        row_proj_disp += projConv.amount != null ? projConv.amount : 0;
        if (realOrig != null) {
          row_real_orig += realOrig;
          row_real_disp += realConv.amount != null ? realConv.amount : 0;
        }

        // plan_amount_original: what the capacity manager declared (if any).
        const planOrig = cell ? Number(cell.projected_usd || 0) : 0;
        const planConv = isCapacity && planOrig > 0
          ? fxUtils.convert(planOrig, ccyOrig, displayCurrency, m, rates)
          : { amount: null };

        cells[m] = {
          projected_amount_original: projOrig,
          projected_amount_display:  projConv.amount,
          projected_pct: cell?.projected_pct != null ? Number(cell.projected_pct) : null,
          // For capacity: plan declared by manager (separate from auto-projection).
          plan_amount_original: isCapacity ? planOrig : null,
          plan_amount_display:  isCapacity ? planConv.amount : null,
          auto_projected: isCapacity, // flag: projection is auto-computed
          real_amount_original: realOrig,
          real_amount_display:  realConv.amount,
          real_pct: cell?.real_pct != null ? Number(cell.real_pct) : null,
          projected_usd: projOrig,
          real_usd: realOrig,
          fx_missing: (projOrig > 0 && projConv.amount == null) || (realOrig != null && realConv.amount == null),
          status: cell?.status || 'open',
          notes: cell?.notes || null,
          closed_at: cell?.closed_at || null,
          closed_by: cell?.closed_by || null,
          updated_at: cell?.updated_at || null,
          updated_by: cell?.updated_by || null,
        };
      });
      return {
        contract: { ...c, auto_projected: isCapacity },
        cells,
        row_total: {
          projected_amount_display: row_proj_disp,
          real_amount_display:      row_real_disp,
          projected_amount_original: row_proj_orig,
          real_amount_original:      row_real_orig,
          original_currency:         ccyOrig,
          projected_usd: row_proj_orig,
          real_usd:      row_real_orig,
        },
      };
    });

    // Column totals + global (en displayCurrency).
    const col_totals = {};
    months.forEach((m) => { col_totals[m] = { projected_amount_display: 0, real_amount_display: 0 }; });
    let global_proj = 0; let global_real = 0;
    rowsOut.forEach((r) => {
      months.forEach((m) => {
        const c = r.cells[m];
        if (!c) return;
        if (c.projected_amount_display != null) {
          col_totals[m].projected_amount_display += c.projected_amount_display;
          global_proj += c.projected_amount_display;
        }
        if (c.real_amount_display != null) {
          col_totals[m].real_amount_display += c.real_amount_display;
          global_real += c.real_amount_display;
        }
      });
      // Legacy aliases on col_totals:
      Object.values(col_totals).forEach((t) => {
        t.projected_usd = t.projected_amount_display;
        t.real_usd      = t.real_amount_display;
      });
    });

    res.json({
      months, rows: rowsOut, col_totals,
      display_currency: displayCurrency,
      fx_missing: missingRate,
      global_total: {
        projected_amount_display: global_proj,
        real_amount_display:      global_real,
        // Legacy aliases:
        projected_usd: global_proj,
        real_usd:      global_real,
      },
    });
  } catch (err) {
    serverError(res, 'GET /revenue', err);
  }
});

/* ====================================================================
 * RR-MVP-00.2 — Plan de reconocimiento (PROY).
 *
 * Pantalla aparte donde el operations_owner declara la curva de
 * reconocimiento esperada de un contrato.
 *
 *   - type='project'         → entrada en `pct` (0..1) por mes.
 *                              projected_usd = pct × contracts.total_value_usd
 *   - type='capacity'/'resell' → entrada directa en USD por mes.
 *
 * En la grilla matricial principal, PROY queda read-only. El usuario
 * solo manipula REAL allí.
 *
 * Las rutas /plan deben ir ANTES de /:yyyymm porque Express matchea
 * por orden y `plan` no es un yyyymm válido.
 * ==================================================================== */

router.get('/:contract_id/plan', async (req, res) => {
  try {
    const { rows: cRows } = await pool.query(
      `SELECT c.id, c.name, c.type, c.status, c.start_date, c.end_date,
              c.total_value_usd, c.original_currency,
              cl.id AS client_id, cl.name AS client_name, cl.country AS client_country,
              u.name AS owner_name
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN users u    ON u.id  = c.account_owner_id
        WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [req.params.contract_id],
    );
    if (!cRows.length) return res.status(404).json({ error: 'Contrato no encontrado' });

    const { rows: periods } = await pool.query(
      `SELECT yyyymm, projected_usd, projected_pct, real_usd, real_pct, status, notes,
              closed_at, closed_by, updated_at, updated_by
         FROM revenue_periods
        WHERE contract_id=$1
        ORDER BY yyyymm ASC`,
      [req.params.contract_id],
    );

    res.json({ contract: cRows[0], periods });
  } catch (err) {
    serverError(res, 'GET /revenue/:contract_id/plan', err);
  }
});

router.put('/:contract_id/plan', async (req, res) => {
  const { contract_id } = req.params;
  const body = req.body || {};
  const entries = Array.isArray(body.entries) ? body.entries : null;
  if (!entries) return res.status(400).json({ error: 'entries[] es requerido' });
  if (!entries.every((e) => YYYYMM_RE.test(String(e.yyyymm || '')))) {
    return res.status(400).json({ error: 'Todas las entries deben tener un yyyymm válido' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: cRows } = await conn.query(
      `SELECT id, type, total_value_usd, original_currency FROM contracts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [contract_id],
    );
    if (!cRows.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }

    // RR-MVP-00.3: el plan editor también permite ajustar el valor del
    // contrato y la moneda en el mismo save. Se permite solo si vienen
    // explícitos en el body. Así el operations_owner que entra a declarar
    // el plan puede corregir el valor sin saltar al módulo de contratos
    // (que es admin-only).
    let totalValue = Number(cRows[0].total_value_usd || 0);
    let originalCurrency = cRows[0].original_currency || 'USD';
    const newValueProvided = body.total_value_usd != null;
    const newCurrencyProvided = typeof body.original_currency === 'string' && body.original_currency.trim();
    if (newValueProvided || newCurrencyProvided) {
      const nextValue = newValueProvided ? Number(body.total_value_usd) : totalValue;
      if (newValueProvided && (isNaN(nextValue) || nextValue < 0)) {
        await conn.query('ROLLBACK');
        return res.status(400).json({ error: 'total_value_usd inválido' });
      }
      const nextCurrency = newCurrencyProvided ? String(body.original_currency).trim().toUpperCase().slice(0, 3) : originalCurrency;
      await conn.query(
        `UPDATE contracts SET total_value_usd = $2, original_currency = $3, updated_at = NOW() WHERE id = $1`,
        [contract_id, nextValue, nextCurrency],
      );
      totalValue = nextValue;
      originalCurrency = nextCurrency;
    }

    const contract = cRows[0];
    const isProject = contract.type === 'project';

    for (const e of entries) {
      if (isProject) {
        if (e.pct == null || isNaN(Number(e.pct))) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: `Entry ${e.yyyymm}: pct requerido para contratos de tipo project` });
        }
        const pct = Number(e.pct);
        if (pct < 0 || pct > 1) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: `Entry ${e.yyyymm}: pct debe estar entre 0 y 1` });
        }
      } else {
        if (e.projected_usd == null || isNaN(Number(e.projected_usd))) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: `Entry ${e.yyyymm}: projected_usd requerido para contratos no-project` });
        }
      }
    }

    let warnings = [];
    if (isProject) {
      const sumPct = entries.reduce((s, e) => s + Number(e.pct || 0), 0);
      // RR-MVP-00.4: la suma >100% ahora es bloqueo duro, no warning. Un
      // proyecto no puede tener avance acumulado mayor al 100% del contrato.
      if (sumPct > 1.0001) {
        await conn.query('ROLLBACK');
        return res.status(400).json({
          error: `La suma de % declarados es ${(sumPct * 100).toFixed(2)}%. No puede exceder 100%.`,
          code: 'pct_sum_exceeds_1',
          sum_pct: sumPct,
        });
      }
    }

    const upserted = [];
    for (const e of entries) {
      const yyyymm = String(e.yyyymm);
      const projectedPct = isProject ? Number(e.pct) : null;
      const projectedUsd = isProject
        ? Number(e.pct) * totalValue
        : Number(e.projected_usd);

      const { rows } = await conn.query(
        `INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, projected_pct,
                                      created_by, updated_by)
           VALUES ($1, $2, $3::numeric, $4::numeric, $5, $5)
         ON CONFLICT (contract_id, yyyymm) DO UPDATE SET
           projected_usd = EXCLUDED.projected_usd,
           projected_pct = EXCLUDED.projected_pct,
           updated_by    = EXCLUDED.updated_by,
           updated_at    = NOW()
         RETURNING contract_id, yyyymm, projected_usd, projected_pct, real_usd, status`,
        [contract_id, yyyymm, projectedUsd, projectedPct, req.user.id],
      );
      upserted.push(rows[0]);
    }

    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'revenue_plan_declared', 'contract', $2,
                 jsonb_build_object('contract_id', $3::uuid,
                                    'is_project', $4::boolean,
                                    'entries_count', $5::int))`,
      [req.user.id, contract_id, contract_id, isProject, entries.length],
    );

    await conn.query('COMMIT');
    res.json({ entries: upserted, warnings, contract: { id: contract_id, type: contract.type, total_value_usd: totalValue, original_currency: originalCurrency } });
  } catch (err) {
    await safeRollback(conn, 'revenue');
    serverError(res, 'PUT /revenue/:contract_id/plan', err);
  } finally {
    conn.release();
  }
});

/* -------- UPSERT cell (REAL only) -------- */
// CRM-MVP-00.2: el PROY ya no se edita aquí (lo gestiona /plan). Este
// endpoint sólo actualiza real (USD para no-project, % para project) + notes.
//
// RR-MVP-00.5: para contratos type='project', el body acepta `real_pct` (0..1)
// y el sistema deriva real_usd = real_pct × contracts.total_value_usd.
// También valida cumulative: SUM(real_pct) ≤ 1 a través de todos los meses
// del contrato. Para los demás tipos sigue siendo `real_usd` directo.
router.put('/:contract_id/:yyyymm', async (req, res) => {
  const { contract_id, yyyymm } = req.params;
  if (!YYYYMM_RE.test(yyyymm)) return res.status(400).json({ error: 'yyyymm inválido' });
  const body = req.body || {};
  const { notes } = body;

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: cRows } = await conn.query(
      `SELECT id, type, total_value_usd FROM contracts WHERE id=$1 AND deleted_at IS NULL`,
      [contract_id],
    );
    if (!cRows.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }
    const contract = cRows[0];
    const isProject = contract.type === 'project';

    let { rows: existing } = await conn.query(
      `SELECT * FROM revenue_periods WHERE contract_id=$1 AND yyyymm=$2 FOR UPDATE`,
      [contract_id, yyyymm],
    );
    // For capacity contracts, auto-create the row if it doesn't exist
    // (projected is computed from assignments, so no manual plan needed).
    if (!existing.length && contract.type === 'capacity') {
      const { rows: created } = await conn.query(
        `INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, created_by, updated_by)
           VALUES ($1, $2, 0, $3, $3)
         RETURNING *`,
        [contract_id, yyyymm, req.user.id],
      );
      existing = created;
    }
    if (!existing.length) {
      await conn.query('ROLLBACK');
      return res.status(409).json({ error: 'Aún no hay plan declarado para este mes. Usa "Editar plan" antes de capturar reales.' });
    }
    const wasClosed = existing[0].status === 'closed';

    // Resolver finalRealPct y finalRealUsd según el tipo de contrato.
    let finalRealPct = existing[0].real_pct != null ? Number(existing[0].real_pct) : null;
    let finalRealUsd = existing[0].real_usd != null ? Number(existing[0].real_usd) : null;

    if (isProject) {
      const realPctProvided = Object.prototype.hasOwnProperty.call(body, 'real_pct');
      const realUsdProvidedFallback = Object.prototype.hasOwnProperty.call(body, 'real_usd');
      if (realPctProvided) {
        const v = body.real_pct == null ? null : Number(body.real_pct);
        if (v != null && (isNaN(v) || v < 0 || v > 1)) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: 'real_pct debe estar entre 0 y 1' });
        }
        finalRealPct = v;
        const totalValue = Number(contract.total_value_usd || 0);
        finalRealUsd = v == null ? null : v * totalValue;
      } else if (realUsdProvidedFallback) {
        // Fallback legacy: si llega real_usd directo, lo guardamos sin
        // tocar real_pct. No lo recomendamos para project pero no rompemos.
        finalRealUsd = body.real_usd == null ? null : Number(body.real_usd);
      }
      // Validación cumulative: la suma de real_pct (incluyendo el nuevo) no
      // puede exceder 100% de avance del proyecto.
      if (finalRealPct != null) {
        const { rows: sumRows } = await conn.query(
          `SELECT COALESCE(SUM(real_pct), 0)::numeric AS sum_pct
             FROM revenue_periods
            WHERE contract_id=$1 AND yyyymm <> $2 AND real_pct IS NOT NULL`,
          [contract_id, yyyymm],
        );
        const otherSum = Number(sumRows[0].sum_pct);
        const newSum = otherSum + finalRealPct;
        if (newSum > 1.0001) {
          await conn.query('ROLLBACK');
          return res.status(400).json({
            error: `La suma de % real declarados sería ${(newSum * 100).toFixed(2)}%. No puede exceder 100%.`,
            code: 'real_pct_sum_exceeds_1',
            sum_pct: newSum,
          });
        }
      }
    } else {
      // No-project: real_usd directo.
      const realUsdProvided = Object.prototype.hasOwnProperty.call(body, 'real_usd');
      if (realUsdProvided) {
        finalRealUsd = body.real_usd == null ? null : Number(body.real_usd);
      }
    }

    const finalNotes = notes != null ? notes : existing[0].notes;

    const { rows } = await conn.query(
      `UPDATE revenue_periods SET
         real_usd   = $3::numeric,
         real_pct   = $4::numeric,
         notes      = $5,
         updated_by = $6,
         updated_at = NOW()
       WHERE contract_id=$1 AND yyyymm=$2
       RETURNING *`,
      [contract_id, yyyymm, finalRealUsd, finalRealPct, finalNotes, req.user.id],
    );
    const row = rows[0];

    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'revenue_period_real_update', 'revenue_period', $2,
                 jsonb_build_object('contract_id', $3::uuid, 'yyyymm', $4::text,
                                    'wasClosed', $5::boolean,
                                    'real_usd', $6::numeric, 'real_pct', $7::numeric))`,
      [req.user.id, contract_id, contract_id, yyyymm, wasClosed, row.real_usd, row.real_pct],
    );

    await conn.query('COMMIT');
    res.json(row);
  } catch (err) {
    await safeRollback(conn, 'revenue');
    serverError(res, 'PUT /revenue/:contract_id/:yyyymm', err);
  } finally {
    conn.release();
  }
});

/* -------- CLOSE month -------- */
router.post('/:contract_id/:yyyymm/close', async (req, res) => {
  const { contract_id, yyyymm } = req.params;
  if (!YYYYMM_RE.test(yyyymm)) return res.status(400).json({ error: 'yyyymm inválido' });
  const body = req.body || {};

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    // Necesitamos el contract para saber si es project (ahí real viene en pct).
    const { rows: cRows } = await conn.query(
      `SELECT id, type, total_value_usd FROM contracts WHERE id=$1 AND deleted_at IS NULL`,
      [contract_id],
    );
    if (!cRows.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }
    const isProject = cRows[0].type === 'project';
    const totalValue = Number(cRows[0].total_value_usd || 0);

    let { rows: existing } = await conn.query(
      `SELECT * FROM revenue_periods WHERE contract_id=$1 AND yyyymm=$2 FOR UPDATE`,
      [contract_id, yyyymm],
    );
    if (!existing.length && cRows[0].type === 'capacity') {
      const { rows: created } = await conn.query(
        `INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, created_by, updated_by)
           VALUES ($1, $2, 0, $3, $3)
         RETURNING *`,
        [contract_id, yyyymm, req.user.id],
      );
      existing = created;
    }
    if (!existing.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Período no existe — agrega proyección antes de cerrar' });
    }

    // RR-MVP-00.5: para projects, aceptamos real_pct y derivamos real_usd.
    let newRealPct = existing[0].real_pct != null ? Number(existing[0].real_pct) : null;
    let newRealUsd = existing[0].real_usd != null ? Number(existing[0].real_usd) : null;
    if (isProject) {
      if (body.real_pct != null) {
        const v = Number(body.real_pct);
        if (isNaN(v) || v < 0 || v > 1) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: 'real_pct debe estar entre 0 y 1' });
        }
        newRealPct = v;
        newRealUsd = v * totalValue;
      } else if (body.real_usd != null) {
        newRealUsd = Number(body.real_usd);
      }
    } else if (body.real_usd != null) {
      newRealUsd = Number(body.real_usd);
    }

    if (newRealUsd == null) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: isProject ? 'real_pct es requerido para cerrar el mes' : 'real_usd es requerido para cerrar el mes' });
    }

    const { rows } = await conn.query(
      `UPDATE revenue_periods SET
         status='closed',
         real_usd=$3::numeric,
         real_pct=$4::numeric,
         notes=COALESCE($5, notes),
         closed_at=NOW(),
         closed_by=$6,
         updated_by=$6,
         updated_at=NOW()
       WHERE contract_id=$1 AND yyyymm=$2
       RETURNING *`,
      [contract_id, yyyymm, newRealUsd, newRealPct, body.notes || null, req.user.id],
    );
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'revenue_period_close', 'revenue_period', $2,
                 jsonb_build_object('contract_id', $3::uuid, 'yyyymm', $4::text,
                                    'real_usd', $5::numeric, 'real_pct', $6::numeric))`,
      [req.user.id, contract_id, contract_id, yyyymm, newRealUsd, newRealPct],
    );
    await conn.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await safeRollback(conn, 'revenue');
    serverError(res, 'POST /revenue/:contract_id/:yyyymm/close', err);
  } finally {
    conn.release();
  }
});


/* -------- GET /capacity-projection --------
 * Proyección mensual de ingresos para un contrato de capacidad,
 * calculada a partir de las tarifas de cada asignación activa.
 */
const MONTH_LABELS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function daysInMonth(year, month) {
  // month is 1-indexed
  return new Date(year, month, 0).getDate();
}

function toYYYYMM(year, month) {
  return `${year}${String(month).padStart(2, '0')}`;
}

function monthLabel(year, month) {
  return `${MONTH_LABELS_ES[month - 1]} ${year}`;
}

router.get('/capacity-projection', async (req, res) => {
  const { contract_id } = req.query;
  if (!contract_id) return res.status(400).json({ error: 'contract_id es requerido' });

  try {
    // 1. Verify contract exists and is type='capacity'
    const { rows: cRows } = await pool.query(
      `SELECT id, name, type FROM contracts WHERE id=$1 AND deleted_at IS NULL`,
      [contract_id]
    );
    if (!cRows.length) return res.status(404).json({ error: 'Contrato no encontrado' });
    const contract = cRows[0];
    if (contract.type !== 'capacity') {
      return res.status(400).json({ error: `El contrato no es de tipo capacity (es '${contract.type}')` });
    }

    // 2. Fetch active assignments with a client_rate
    const { rows: asgRows } = await pool.query(
      `SELECT a.id, a.start_date, a.end_date, a.client_rate, a.client_rate_currency,
              e.first_name || ' ' || e.last_name AS employee_name
         FROM assignments a
         LEFT JOIN employees e ON e.id = a.employee_id
        WHERE a.contract_id = $1
          AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled')
          AND a.client_rate IS NOT NULL`,
      [contract_id]
    );

    if (!asgRows.length) {
      return res.json({
        contract_id,
        contract_name: contract.name,
        contract_type: 'capacity',
        months: [],
        grand_total: 0,
        currency_note: 'Todos los montos en la moneda de cada asignación. Conversión a USD no implementada.',
      });
    }

    // 2b. Load rate history for all assignments.
    const asgIds = asgRows.map((a) => a.id);
    const rateHistoryByAsg = new Map();
    if (asgIds.length) {
      const { rows: rateRows } = await pool.query(
        `SELECT assignment_id, effective_date, client_rate
           FROM assignment_rate_history
          WHERE assignment_id = ANY($1::uuid[])
          ORDER BY assignment_id, effective_date ASC`,
        [asgIds],
      );
      for (const r of rateRows) {
        if (!rateHistoryByAsg.has(r.assignment_id)) rateHistoryByAsg.set(r.assignment_id, []);
        rateHistoryByAsg.get(r.assignment_id).push({
          effective: new Date(r.effective_date),
          rate: Number(r.client_rate),
        });
      }
    }
    function rateForDateCP(history, date) {
      if (!history || !history.length) return null;
      let applicable = null;
      for (const h of history) {
        if (h.effective <= date) applicable = h.rate;
        else break;
      }
      return applicable;
    }

    // 3. Determine date range: earliest start → latest end (or today+12m if null)
    const today = new Date();
    const horizonEnd = new Date(today.getFullYear(), today.getMonth() + 12, 0);

    let rangeStart = null;
    let rangeEnd   = null;
    for (const a of asgRows) {
      const s = new Date(a.start_date);
      const e = a.end_date ? new Date(a.end_date) : horizonEnd;
      if (!rangeStart || s < rangeStart) rangeStart = s;
      if (!rangeEnd   || e > rangeEnd)   rangeEnd   = e;
    }

    // 4. Build month-by-month projection (rate-history aware)
    const monthsMap = new Map();

    let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);

    while (cur <= endMonth) {
      const year  = cur.getFullYear();
      const month = cur.getMonth() + 1;
      const yyyymm = toYYYYMM(year, month);
      const dim = daysInMonth(year, month);
      const monthStart = new Date(year, month - 1, 1);
      const monthEndDay = new Date(year, month, 0);

      const assignmentRows = [];
      for (const a of asgRows) {
        const aStart = new Date(a.start_date);
        const aEnd   = a.end_date ? new Date(a.end_date) : horizonEnd;
        if (aStart > monthEndDay || aEnd < monthStart) continue;

        const activeStart = aStart > monthStart ? aStart : monthStart;
        const activeEnd   = aEnd   < monthEndDay ? aEnd   : monthEndDay;
        const history = rateHistoryByAsg.get(a.id);
        const hasHistory = history && history.length > 0;
        const fallbackRate = Number(a.client_rate);
        let amount = 0;

        if (hasHistory && history.length > 1) {
          // Day-by-day with rate changes.
          let curDay = new Date(activeStart);
          while (curDay <= activeEnd) {
            const dayRate = rateForDateCP(history, curDay) || fallbackRate;
            let streak = 1;
            const nextDay = new Date(curDay);
            nextDay.setDate(nextDay.getDate() + 1);
            while (nextDay <= activeEnd) {
              if ((rateForDateCP(history, nextDay) || fallbackRate) !== dayRate) break;
              streak++;
              nextDay.setDate(nextDay.getDate() + 1);
            }
            amount += dayRate * streak / dim;
            curDay.setDate(curDay.getDate() + streak);
          }
        } else {
          const rate = hasHistory ? history[0].rate : fallbackRate;
          const daysActive = Math.round((activeEnd - activeStart) / 86400000) + 1;
          amount = rate * daysActive / dim;
        }

        assignmentRows.push({
          assignment_id:        a.id,
          employee_name:        a.employee_name,
          client_rate:          hasHistory ? (rateForDateCP(history, monthStart) || fallbackRate) : fallbackRate,
          client_rate_currency: a.client_rate_currency || 'USD',
          days_active:          Math.round((activeEnd - activeStart) / 86400000) + 1,
          days_in_month:        dim,
          prorated_amount:      parseFloat(amount.toFixed(4)),
          has_rate_changes:     hasHistory && history.length > 1,
        });
      }

      if (assignmentRows.length > 0) {
        const total = parseFloat(assignmentRows.reduce((s, r) => s + r.prorated_amount, 0).toFixed(4));
        monthsMap.set(yyyymm, {
          yyyymm,
          label: monthLabel(year, month),
          assignments: assignmentRows,
          total,
        });
      }

      cur = new Date(year, month, 1);
    }

    const months = Array.from(monthsMap.values()).sort((a, b) => a.yyyymm.localeCompare(b.yyyymm));
    const grand_total = parseFloat(months.reduce((s, m) => s + m.total, 0).toFixed(4));

    res.json({
      contract_id,
      contract_name: contract.name,
      contract_type: 'capacity',
      months,
      grand_total,
      currency_note: 'Montos en moneda de cada asignación. Se usa historial de tarifas cuando hay cambios.',
    });
  } catch (err) {
    serverError(res, 'GET /revenue/capacity-projection', err);
  }
});


module.exports = router;
module.exports._internal = { expandMonths };
