import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter, parseBody } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { convert, buildRatesMap } from '@shared/fx/convert';
import { requireSuperadmin } from '@shared/auth/rbac';
import { createRevenueRepository } from './repository';
import { createRevenueService } from './service';
import { createExchangeRateRepository } from './exchange-rates.repository';
import { createBudgetRepository } from './budgets.repository';
import { createBudgetService } from './budgets.service';
import { EXCHANGE_RATE_SORTABLE, BUDGET_SORTABLE } from './types';
import type { BudgetFilters } from './types';

const YYYYMM_RE = /^[0-9]{6}$/;

function expandMonths(from: string, to: string): string[] {
  if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) return [];
  const out: string[] = [];
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

function rateForDate(history: Array<{ effective: Date; rate: number }>, date: Date): number | null {
  let applicable: number | null = null;
  for (const h of history) {
    if (h.effective <= date) applicable = h.rate; else break;
  }
  return applicable;
}

const db = getPool();
const events = createEventEmitter();

const revenueRepo = createRevenueRepository(db);
const revenueSvc = createRevenueService(revenueRepo, events, db);

const exchangeRateRepo = createExchangeRateRepository(db);

const budgetRepo = createBudgetRepository(db);
const budgetSvc = createBudgetService(budgetRepo, events, db);

const router = createRouter();

/* ──────────── Revenue matrix ──────────── */

router.get('/api/revenue', async (event) => {
  const qs = event.queryStringParameters || {};
  const from = String(qs.from || '').trim();
  const to = String(qs.to || '').trim();

  if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'from/to inválidos (formato YYYYMM)' }) };
  }
  const months = expandMonths(from, to);
  if (!months.length) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Rango de meses vacío' }) };
  }

  const displayCurrency = String(qs.display_currency || 'USD').toUpperCase();
  const wheres = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (qs.type)     wheres.push(`c.type = ${add(qs.type)}`);
  if (qs.owner_id) wheres.push(`c.account_owner_id = ${add(qs.owner_id)}`);
  if (qs.country)  wheres.push(`cl.country = ${add(qs.country)}`);

  const { rows: contracts } = await db.query(
    `SELECT c.id, c.name, c.type, c.status, c.start_date, c.end_date,
            c.total_value_usd, c.original_currency,
            cl.id AS client_id, cl.name AS client_name, cl.country AS client_country,
            u.id AS owner_id, u.name AS owner_name,
            EXISTS(SELECT 1 FROM revenue_periods rp WHERE rp.contract_id=c.id) AS plan_declared
       FROM contracts c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users u    ON u.id  = c.account_owner_id
      WHERE ${wheres.join(' AND ')}
      ORDER BY c.start_date DESC, c.name ASC`,
    params,
  );

  const ids = contracts.map((c: Record<string, unknown>) => c.id);
  const periodsByContract = new Map<string, Record<string, Record<string, unknown>>>();
  if (ids.length) {
    const { rows: periods } = await db.query(
      `SELECT contract_id, yyyymm, projected_usd, projected_pct, real_usd, real_pct, status, notes,
              closed_at, closed_by, updated_at, updated_by
         FROM revenue_periods
        WHERE contract_id = ANY($1::uuid[]) AND yyyymm BETWEEN $2 AND $3`,
      [ids, from, to],
    );
    for (const p of periods as Record<string, unknown>[]) {
      const cid = p.contract_id as string;
      if (!periodsByContract.has(cid)) periodsByContract.set(cid, {});
      periodsByContract.get(cid)![p.yyyymm as string] = p;
    }
  }

  // Capacity: assignments + rate history
  const capacityIds = (contracts as Record<string, unknown>[]).filter(c => c.type === 'capacity').map(c => c.id);
  let capAsg: Record<string, unknown>[] = [];
  const rateHistoryByAsg = new Map<string, Array<{ effective: Date; rate: number }>>();
  if (capacityIds.length) {
    const { rows } = await db.query(
      `SELECT a.id, a.contract_id, a.start_date, a.end_date, a.client_rate, a.client_rate_currency
         FROM assignments a
        WHERE a.contract_id = ANY($1::uuid[])
          AND a.deleted_at IS NULL AND a.status NOT IN ('cancelled')
          AND a.client_rate IS NOT NULL`,
      [capacityIds],
    );
    capAsg = rows as Record<string, unknown>[];
    const asgIds = capAsg.map(a => a.id);
    if (asgIds.length) {
      const { rows: rateRows } = await db.query(
        `SELECT assignment_id, effective_date, client_rate
           FROM assignment_rate_history
          WHERE assignment_id = ANY($1::uuid[])
          ORDER BY assignment_id, effective_date ASC`,
        [asgIds],
      );
      for (const r of rateRows as Record<string, unknown>[]) {
        const aid = r.assignment_id as string;
        if (!rateHistoryByAsg.has(aid)) rateHistoryByAsg.set(aid, []);
        rateHistoryByAsg.get(aid)!.push({ effective: new Date(r.effective_date as string), rate: Number(r.client_rate) });
      }
    }
  }

  // FX rates
  const ratesNeeded = new Set([displayCurrency]);
  for (const c of contracts as Record<string, unknown>[]) {
    const ccy = String(c.original_currency || 'USD').toUpperCase();
    if (ccy !== 'USD') ratesNeeded.add(ccy);
  }
  for (const a of capAsg) {
    const ccy = String(a.client_rate_currency || 'USD').toUpperCase();
    if (ccy !== 'USD') ratesNeeded.add(ccy);
  }
  const fxList = ratesNeeded.size > 0
    ? (await db.query(
        `SELECT yyyymm, currency, usd_rate FROM exchange_rates WHERE currency = ANY($1::text[]) ORDER BY currency, yyyymm`,
        [Array.from(ratesNeeded)],
      )).rows
    : [];
  const rates = buildRatesMap(fxList as Array<{ yyyymm: string; currency: string; usd_rate: number }>);

  // Capacity auto-real
  const contractCcyMap = new Map<string, string>();
  for (const c of contracts as Record<string, unknown>[]) contractCcyMap.set(c.id as string, String(c.original_currency || 'USD').toUpperCase());
  const capacityReals = new Map<string, Record<string, number>>();

  for (const a of capAsg) {
    const fallbackRate = Number(a.client_rate);
    if (!fallbackRate) continue;
    const history = rateHistoryByAsg.get(a.id as string);
    const hasHistory = !!(history && history.length > 0);
    const aStart = new Date(a.start_date as string);
    const aEnd = a.end_date ? new Date(a.end_date as string) : null;
    const rateCcy = String(a.client_rate_currency || 'USD').toUpperCase();
    const contractCcy = contractCcyMap.get(a.contract_id as string) || 'USD';

    for (const m of months) {
      const year = Number(m.slice(0, 4));
      const month = Number(m.slice(4));
      const dim = new Date(year, month, 0).getDate();
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month - 1, dim);
      if (aStart > monthEnd) continue;
      if (aEnd && aEnd < monthStart) continue;
      const activeStart = aStart > monthStart ? aStart : monthStart;
      const activeEnd = aEnd && aEnd < monthEnd ? aEnd : monthEnd;

      let monthAmount = 0;
      if (hasHistory && history!.length > 1) {
        let curDay = new Date(activeStart);
        while (curDay <= activeEnd) {
          const dayRate = rateForDate(history!, curDay) || fallbackRate;
          let streak = 1;
          const nextDay = new Date(curDay);
          nextDay.setDate(nextDay.getDate() + 1);
          while (nextDay <= activeEnd) {
            if ((rateForDate(history!, nextDay) || fallbackRate) !== dayRate) break;
            streak++;
            nextDay.setDate(nextDay.getDate() + 1);
          }
          monthAmount += dayRate * streak / dim;
          curDay.setDate(curDay.getDate() + streak);
        }
      } else {
        const rate = hasHistory ? history![0].rate : fallbackRate;
        const daysActive = Math.round((activeEnd.getTime() - activeStart.getTime()) / 86400000) + 1;
        monthAmount = rate * daysActive / dim;
      }

      let prorated = parseFloat(monthAmount.toFixed(4));
      if (rateCcy !== contractCcy) {
        const conv = convert(prorated, rateCcy, contractCcy, m, rates);
        prorated = conv.amount != null ? parseFloat(conv.amount.toFixed(4)) : prorated;
      }
      if (!capacityReals.has(a.contract_id as string)) capacityReals.set(a.contract_id as string, {});
      const byMonth = capacityReals.get(a.contract_id as string)!;
      byMonth[m] = (byMonth[m] || 0) + prorated;
    }
  }

  // Build rows
  let missingRate = false;
  const rowsOut = (contracts as Record<string, unknown>[]).map(c => {
    const cells: Record<string, unknown> = {};
    const ccyOrig = String(c.original_currency || 'USD').toUpperCase();
    const isCapacity = c.type === 'capacity';
    const isResell = c.type === 'resell';
    const capReal = isCapacity ? (capacityReals.get(c.id as string) || {}) : null;
    let row_proj_disp = 0; let row_real_disp = 0;
    let row_proj_orig = 0; let row_real_orig = 0;

    for (const m of months) {
      const cell = (periodsByContract.get(c.id as string) || {})[m] || null;
      const projOrig = Number((cell as Record<string, unknown>)?.projected_usd || 0);
      const autoRealOrig = isCapacity ? ((capReal as Record<string, number>)[m] || 0) : 0;
      const realOrig = isCapacity
        ? (autoRealOrig > 0 ? autoRealOrig : null)
        : (cell && (cell as Record<string, unknown>).real_usd != null ? Number((cell as Record<string, unknown>).real_usd) : null);

      if (!cell && !isCapacity && !isResell) { cells[m] = null; continue; }
      if (!cell && isCapacity && autoRealOrig === 0) { cells[m] = null; continue; }

      const projConv = convert(projOrig, ccyOrig, displayCurrency, m, rates);
      const realConv = realOrig == null ? { amount: null } : convert(realOrig, ccyOrig, displayCurrency, m, rates);

      if (projOrig > 0 && projConv.amount == null) missingRate = true;
      if (realOrig != null && realConv.amount == null) missingRate = true;

      row_proj_orig += projOrig;
      row_proj_disp += projConv.amount != null ? projConv.amount : 0;
      if (realOrig != null) {
        row_real_orig += realOrig;
        row_real_disp += realConv.amount != null ? realConv.amount : 0;
      }

      const cellData = cell as Record<string, unknown> | null;
      cells[m] = {
        projected_amount_original: projOrig,
        projected_amount_display:  projConv.amount,
        projected_pct: cellData?.projected_pct != null ? Number(cellData.projected_pct) : null,
        real_amount_original: realOrig,
        real_amount_display:  realConv.amount,
        real_pct: cellData?.real_pct != null ? Number(cellData.real_pct) : null,
        auto_real: isCapacity,
        projected_usd: projOrig,
        real_usd: realOrig,
        fx_missing: (projOrig > 0 && projConv.amount == null) || (realOrig != null && realConv.amount == null),
        status: cellData?.status || 'open',
        notes: cellData?.notes || null,
        closed_at: cellData?.closed_at || null,
        closed_by: cellData?.closed_by || null,
        updated_at: cellData?.updated_at || null,
        updated_by: cellData?.updated_by || null,
      };
    }

    return {
      contract: { ...c, auto_real: isCapacity },
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

  // Column totals + global
  const col_totals: Record<string, { projected_amount_display: number; real_amount_display: number; projected_usd: number; real_usd: number }> = {};
  for (const m of months) col_totals[m] = { projected_amount_display: 0, real_amount_display: 0, projected_usd: 0, real_usd: 0 };
  let global_proj = 0; let global_real = 0;
  for (const r of rowsOut) {
    for (const m of months) {
      const cell = r.cells[m] as Record<string, unknown> | null;
      if (!cell) continue;
      if (cell.projected_amount_display != null) {
        col_totals[m].projected_amount_display += cell.projected_amount_display as number;
        col_totals[m].projected_usd += cell.projected_amount_display as number;
        global_proj += cell.projected_amount_display as number;
      }
      if (cell.real_amount_display != null) {
        col_totals[m].real_amount_display += cell.real_amount_display as number;
        col_totals[m].real_usd += cell.real_amount_display as number;
        global_real += cell.real_amount_display as number;
      }
    }
  }

  return ok({
    months, rows: rowsOut, col_totals,
    display_currency: displayCurrency,
    fx_missing: missingRate,
    global_total: {
      projected_amount_display: global_proj,
      real_amount_display:      global_real,
      projected_usd: global_proj,
      real_usd:      global_real,
    },
  });
});

router.get('/api/revenue/plan/:contract_id', async (event) => {
  const qs = event.queryStringParameters || {};
  const periods = await revenueSvc.getByContract(event.pathParameters!.contract_id!, qs.from, qs.to);
  return ok(periods);
});

router.put('/api/revenue/plan/:contract_id', async (event, user) => {
  requireAdmin(user);
  const body = parseBody(event);
  const contractId = event.pathParameters!.contract_id!;
  const yyyymm = body.yyyymm as string;
  const period = await revenueSvc.updatePlan(contractId, yyyymm, body, user);
  return ok(period);
});

/* ──────────── Exchange Rates ──────────── */

router.get('/api/admin/exchange-rates', async (event) => {
  const qs = event.queryStringParameters || {};
  const from = String(qs.from || '').trim();
  const to = String(qs.to || '').trim();
  if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'from/to inválidos (formato YYYYMM)' }) };
  }
  const months = expandMonths(from, to);
  if (!months.length) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Rango de meses vacío' }) };
  }

  const wheres = ['yyyymm BETWEEN $1 AND $2'];
  const params: unknown[] = [from, to];
  if (qs.currency) {
    const ccy = String(qs.currency).toUpperCase();
    params.push(ccy);
    wheres.push(`currency = $${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT yyyymm, currency, usd_rate, notes, updated_at, updated_by
       FROM exchange_rates
      WHERE ${wheres.join(' AND ')}
      ORDER BY currency ASC, yyyymm ASC`,
    params,
  );

  const currencies = Array.from(new Set((rows as Record<string, unknown>[]).map(r => r.currency))).sort() as string[];
  const cells: Record<string, unknown> = {};
  for (const r of rows as Record<string, unknown>[]) {
    cells[`${r.currency}|${r.yyyymm}`] = {
      usd_rate: Number(r.usd_rate),
      notes: r.notes,
      updated_at: r.updated_at,
      updated_by: r.updated_by,
    };
  }

  return ok({ months, currencies, cells });
});

router.post('/api/admin/exchange-rates', async (event, user) => {
  requireAdmin(user);
  const body = parseBody(event);
  const rate = await exchangeRateRepo.upsert(body, user.id);

  await events.emit(db, {
    event_type: 'exchange_rate.upserted',
    entity_type: 'exchange_rate',
    entity_id: `${rate.yyyymm}:${rate.currency}`,
    actor_user_id: user.id,
    payload: { yyyymm: rate.yyyymm, currency: rate.currency, usd_rate: rate.usd_rate },
  });

  return created(rate);
});

router.put('/api/admin/exchange-rates/:yyyymm/:currency', async (event, user) => {
  requireAdmin(user);
  const body = parseBody(event);
  const yyyymm = event.pathParameters!.yyyymm!;
  const currency = event.pathParameters!.currency!;
  const rate = await exchangeRateRepo.upsert({ ...body, yyyymm, currency }, user.id);

  await events.emit(db, {
    event_type: 'exchange_rate.updated',
    entity_type: 'exchange_rate',
    entity_id: `${rate.yyyymm}:${rate.currency}`,
    actor_user_id: user.id,
    payload: { yyyymm: rate.yyyymm, currency: rate.currency, usd_rate: rate.usd_rate },
  });

  return ok(rate);
});

router.delete('/api/admin/exchange-rates/:yyyymm/:currency', async (event, user) => {
  requireAdmin(user);
  const yyyymm = event.pathParameters!.yyyymm!;
  const currency = event.pathParameters!.currency!;
  const rate = await exchangeRateRepo.remove(yyyymm, currency);
  if (!rate) {
    return ok({ error: 'Tasa no encontrada' });
  }

  await events.emit(db, {
    event_type: 'exchange_rate.deleted',
    entity_type: 'exchange_rate',
    entity_id: `${yyyymm}:${currency}`,
    actor_user_id: user.id,
    payload: { yyyymm, currency },
  });

  return message('Tasa eliminada');
});

/* ──────────── Budgets ──────────── */

router.get('/api/budgets', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, BUDGET_SORTABLE, { defaultField: 'period_year', defaultDir: 'desc', tieBreaker: 'b.id ASC' });
  const filters: BudgetFilters = {
    period_year: qs.period_year, period_quarter: qs.period_quarter,
    country: qs.country, owner_id: qs.owner_id,
    service_line: qs.service_line, status: qs.status,
  };
  return paginated(await budgetSvc.list({ page, limit, offset, filters, sort }));
});

router.get('/api/budgets/summary', async (event) => {
  const qs = event.queryStringParameters || {};
  const rows = await budgetSvc.summary({
    period_year: qs.period_year, period_quarter: qs.period_quarter,
    country: qs.country, service_line: qs.service_line,
  }) as Record<string, unknown>[];
  const totalTarget = rows.reduce((s, r) => s + Number(r.target_usd || 0), 0);
  const totalActual = rows.reduce((s, r) => s + Number(r.actual_usd || 0), 0);
  return ok({
    targets: [{ total_target: totalTarget }],
    actuals: [{ total_actual: totalActual }],
  });
});

router.get('/api/budgets/:id', async (event) => {
  return ok(await budgetSvc.getById(event.pathParameters!.id!));
});

router.post('/api/budgets', async (event, user) => {
  requireAdmin(user);
  const body = parseBody(event);
  return created(await budgetSvc.create(body, user));
});

router.put('/api/budgets/:id', async (event, user) => {
  requireAdmin(user);
  const body = parseBody(event);
  return ok(await budgetSvc.update(event.pathParameters!.id!, body, user));
});

router.delete('/api/budgets/:id', async (event, user) => {
  requireAdmin(user);
  await budgetSvc.remove(event.pathParameters!.id!, user);
  return message('Presupuesto eliminado');
});

/* ──────────── Revenue Period Update ──────────── */

router.put('/api/revenue/:contract_id/:yyyymm', async (event, user) => {
  requireAdmin(user);
  const { contract_id, yyyymm } = event.pathParameters!;
  if (!YYYYMM_RE.test(yyyymm!)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'yyyymm inválido' }) };
  const body = parseBody(event);

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const { rows: cRows } = await conn.query(`SELECT id, type, total_value_usd, original_currency FROM contracts WHERE id=$1 AND deleted_at IS NULL`, [contract_id]);
    if (!cRows.length) { await conn.query('ROLLBACK'); return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Contrato no encontrado' }) }; }
    const contract = cRows[0];
    const isProject = contract.type === 'project';

    let { rows: existing } = await conn.query(`SELECT * FROM revenue_periods WHERE contract_id=$1 AND yyyymm=$2 FOR UPDATE`, [contract_id, yyyymm]);
    if (!existing.length && (contract.type === 'capacity' || contract.type === 'resell')) {
      const { rows: created } = await conn.query(`INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, created_by, updated_by) VALUES ($1,$2,0,$3,$3) RETURNING *`, [contract_id, yyyymm, user.id]);
      existing = created;
    }
    if (!existing.length) { await conn.query('ROLLBACK'); return { statusCode: 409, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Aún no hay plan declarado para este mes.' }) }; }

    let finalRealPct = existing[0].real_pct != null ? Number(existing[0].real_pct) : null;
    let finalRealUsd = existing[0].real_usd != null ? Number(existing[0].real_usd) : null;

    if (isProject && Object.prototype.hasOwnProperty.call(body, 'real_pct')) {
      const v = body.real_pct == null ? null : Number(body.real_pct);
      if (v != null && (isNaN(v) || v < 0 || v > 1)) { await conn.query('ROLLBACK'); return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'real_pct debe estar entre 0 y 1' }) }; }
      finalRealPct = v; finalRealUsd = null;
      if (finalRealPct != null) {
        const { rows: otherRows } = await conn.query(`SELECT yyyymm, real_pct FROM revenue_periods WHERE contract_id=$1 AND yyyymm<>$2 AND real_pct IS NOT NULL ORDER BY yyyymm ASC`, [contract_id, yyyymm]);
        const merged = new Map(otherRows.map((r: any) => [String(r.yyyymm), Number(r.real_pct)]));
        merged.set(yyyymm!, finalRealPct);
        const sorted = [...merged.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i][1] < sorted[i-1][1] - 1e-6) { await conn.query('ROLLBACK'); return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: `Mes ${sorted[i][0]}: real acumulado no puede ser menor que ${sorted[i-1][0]}.`, code: 'real_pct_not_monotonic' }) }; }
        }
        const totalValue = Number(contract.total_value_usd || 0);
        let prevPct = 0;
        for (const [m, pct] of sorted) {
          const realUsd = (pct - prevPct) * totalValue;
          if (m === yyyymm) { finalRealUsd = realUsd; }
          else { await conn.query(`UPDATE revenue_periods SET real_usd=$3::numeric, updated_by=$4, updated_at=NOW() WHERE contract_id=$1 AND yyyymm=$2`, [contract_id, m, realUsd, user.id]); }
          prevPct = pct;
        }
      }
    } else if (!isProject) {
      if (Object.prototype.hasOwnProperty.call(body, 'real_usd')) finalRealUsd = body.real_usd == null ? null : Number(body.real_usd);
    }

    const finalNotes = body.notes != null ? body.notes : existing[0].notes;
    const { rows } = await conn.query(`UPDATE revenue_periods SET real_usd=$3::numeric, real_pct=$4::numeric, notes=$5, updated_by=$6, updated_at=NOW() WHERE contract_id=$1 AND yyyymm=$2 RETURNING *`, [contract_id, yyyymm, finalRealUsd, finalRealPct, finalNotes, user.id]);
    await conn.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1,'revenue_period_real_update','revenue_period',$2, jsonb_build_object('contract_id',$3::uuid,'yyyymm',$4::text,'real_usd',$5::numeric,'real_pct',$6::numeric)) ON CONFLICT DO NOTHING`, [user.id, contract_id, contract_id, yyyymm, rows[0].real_usd, rows[0].real_pct]).catch(() => {});
    await conn.query('COMMIT');
    return ok(rows[0]);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

/* ──────────── Revenue Period Close ──────────── */

router.post('/api/revenue/:contract_id/:yyyymm/close', async (event, user) => {
  requireAdmin(user);
  const { contract_id, yyyymm } = event.pathParameters!;
  if (!YYYYMM_RE.test(yyyymm!)) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'yyyymm inválido' }) };
  const body = parseBody(event);

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const { rows: cRows } = await conn.query(`SELECT id, type, total_value_usd FROM contracts WHERE id=$1 AND deleted_at IS NULL`, [contract_id]);
    if (!cRows.length) { await conn.query('ROLLBACK'); return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Contrato no encontrado' }) }; }
    const isProject = cRows[0].type === 'project';
    const totalValue = Number(cRows[0].total_value_usd || 0);

    let { rows: existing } = await conn.query(`SELECT * FROM revenue_periods WHERE contract_id=$1 AND yyyymm=$2 FOR UPDATE`, [contract_id, yyyymm]);
    if (!existing.length && cRows[0].type === 'capacity') {
      const { rows: created } = await conn.query(`INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, created_by, updated_by) VALUES ($1,$2,0,$3,$3) RETURNING *`, [contract_id, yyyymm, user.id]);
      existing = created;
    }
    if (!existing.length) { await conn.query('ROLLBACK'); return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Período no existe' }) }; }

    let newRealPct = existing[0].real_pct != null ? Number(existing[0].real_pct) : null;
    let newRealUsd = existing[0].real_usd != null ? Number(existing[0].real_usd) : null;
    if (isProject) {
      if (body.real_pct != null) { newRealPct = Number(body.real_pct); newRealUsd = newRealPct * totalValue; }
      else if (body.real_usd != null) { newRealUsd = Number(body.real_usd); }
    } else if (body.real_usd != null) { newRealUsd = Number(body.real_usd); }

    if (newRealUsd == null) { await conn.query('ROLLBACK'); return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: isProject ? 'real_pct es requerido' : 'real_usd es requerido' }) }; }

    const { rows } = await conn.query(`UPDATE revenue_periods SET status='closed', real_usd=$3::numeric, real_pct=$4::numeric, notes=COALESCE($5,notes), closed_at=NOW(), closed_by=$6, updated_by=$6, updated_at=NOW() WHERE contract_id=$1 AND yyyymm=$2 RETURNING *`, [contract_id, yyyymm, newRealUsd, newRealPct, body.notes || null, user.id]);
    await conn.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1,'revenue_period_close','revenue_period',$2, jsonb_build_object('contract_id',$3::uuid,'yyyymm',$4::text,'real_usd',$5::numeric,'real_pct',$6::numeric)) ON CONFLICT DO NOTHING`, [user.id, contract_id, contract_id, yyyymm, newRealUsd, newRealPct]).catch(() => {});
    await conn.query('COMMIT');
    return ok(rows[0]);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

/* ──────────── Capacity Projection ──────────── */

const MONTH_LABELS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

router.get('/api/revenue/capacity-projection', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const contract_id = qs.contract_id;
  if (!contract_id) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'contract_id es requerido' }) };

  const { rows: cRows } = await db.query(`SELECT id, name, type FROM contracts WHERE id=$1 AND deleted_at IS NULL`, [contract_id]);
  if (!cRows.length) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Contrato no encontrado' }) };
  const contract = cRows[0];
  if (contract.type !== 'capacity') return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: `El contrato no es de tipo capacity (es '${contract.type}')` }) };

  const { rows: asgRows } = await db.query(
    `SELECT a.id, a.start_date, a.end_date, a.client_rate, a.client_rate_currency, e.first_name||' '||e.last_name AS employee_name FROM assignments a LEFT JOIN employees e ON e.id=a.employee_id WHERE a.contract_id=$1 AND a.deleted_at IS NULL AND a.status NOT IN ('cancelled') AND a.client_rate IS NOT NULL`,
    [contract_id],
  );
  if (!asgRows.length) return ok({ contract_id, contract_name: contract.name, contract_type: 'capacity', months: [], grand_total: 0, currency_note: 'Sin asignaciones con tarifa.' });

  const asgIds = asgRows.map((a: any) => a.id);
  const rateHistoryByAsg = new Map<string, Array<{effective: Date; rate: number}>>();
  if (asgIds.length) {
    const { rows: rateRows } = await db.query(`SELECT assignment_id, effective_date, client_rate FROM assignment_rate_history WHERE assignment_id=ANY($1::uuid[]) ORDER BY assignment_id, effective_date ASC`, [asgIds]);
    for (const r of rateRows as any[]) {
      if (!rateHistoryByAsg.has(r.assignment_id)) rateHistoryByAsg.set(r.assignment_id, []);
      rateHistoryByAsg.get(r.assignment_id)!.push({ effective: new Date(r.effective_date), rate: Number(r.client_rate) });
    }
  }

  const today = new Date();
  const horizonEnd = new Date(today.getFullYear(), today.getMonth() + 12, 0);
  let rangeStart: Date | null = null; let rangeEnd: Date | null = null;
  for (const a of asgRows as any[]) {
    const s = new Date(a.start_date); const e = a.end_date ? new Date(a.end_date) : horizonEnd;
    if (!rangeStart || s < rangeStart) rangeStart = s;
    if (!rangeEnd || e > rangeEnd) rangeEnd = e;
  }

  const monthsMap = new Map<string, any>();
  let cur = new Date(rangeStart!.getFullYear(), rangeStart!.getMonth(), 1);
  const endMonth = new Date(rangeEnd!.getFullYear(), rangeEnd!.getMonth(), 1);

  while (cur <= endMonth) {
    const year = cur.getFullYear(); const month = cur.getMonth() + 1;
    const yyyymm = `${year}${String(month).padStart(2,'0')}`;
    const dim = new Date(year, month, 0).getDate();
    const monthStart = new Date(year, month-1, 1); const monthEndDay = new Date(year, month, 0);
    const assignmentRows: any[] = [];
    for (const a of asgRows as any[]) {
      const aStart = new Date(a.start_date); const aEnd = a.end_date ? new Date(a.end_date) : horizonEnd;
      if (aStart > monthEndDay || aEnd < monthStart) continue;
      const activeStart = aStart > monthStart ? aStart : monthStart;
      const activeEnd = aEnd < monthEndDay ? aEnd : monthEndDay;
      const history = rateHistoryByAsg.get(a.id);
      const hasHistory = !!(history && history.length > 0);
      const fallbackRate = Number(a.client_rate);
      let amount = 0;
      if (hasHistory && history!.length > 1) {
        let curDay = new Date(activeStart);
        while (curDay <= activeEnd) {
          const dayRate = rateForDate(history!, curDay) || fallbackRate;
          let streak = 1; const nextDay = new Date(curDay); nextDay.setDate(nextDay.getDate() + 1);
          while (nextDay <= activeEnd) { if ((rateForDate(history!, nextDay) || fallbackRate) !== dayRate) break; streak++; nextDay.setDate(nextDay.getDate() + 1); }
          amount += dayRate * streak / dim; curDay.setDate(curDay.getDate() + streak);
        }
      } else {
        const rate = hasHistory ? history![0].rate : fallbackRate;
        const daysActive = Math.round((activeEnd.getTime() - activeStart.getTime()) / 86400000) + 1;
        amount = rate * daysActive / dim;
      }
      assignmentRows.push({ assignment_id: a.id, employee_name: a.employee_name, client_rate: fallbackRate, client_rate_currency: a.client_rate_currency || 'USD', days_active: Math.round((activeEnd.getTime()-activeStart.getTime())/86400000)+1, days_in_month: dim, prorated_amount: parseFloat(amount.toFixed(4)) });
    }
    if (assignmentRows.length > 0) {
      const total = parseFloat(assignmentRows.reduce((s, r) => s + r.prorated_amount, 0).toFixed(4));
      monthsMap.set(yyyymm, { yyyymm, label: `${MONTH_LABELS_ES[month-1]} ${year}`, assignments: assignmentRows, total });
    }
    cur = new Date(year, month, 1);
  }

  const months = Array.from(monthsMap.values()).sort((a, b) => a.yyyymm.localeCompare(b.yyyymm));
  const grand_total = parseFloat(months.reduce((s, m) => s + m.total, 0).toFixed(4));
  return ok({ contract_id, contract_name: contract.name, contract_type: 'capacity', months, grand_total, currency_note: 'Montos en la moneda de cada asignación.' });
});

/* ──────────── Admin Settings ──────────── */

const SECRET_KEYS = new Set(['aws_secret_access_key', 'cron_secret']);

function redactSecrets(obj: Record<string, unknown>, reveal: boolean): Record<string, unknown> {
  if (reveal) return obj;
  const out = { ...obj };
  for (const k of SECRET_KEYS) { if (k in out && out[k]) out[k] = '••••••••'; }
  return out;
}

router.get('/api/admin/settings', async (event, user) => {
  requireSuperadmin(user);
  const { rows } = await db.query('SELECT key, value FROM app_settings ORDER BY key');
  const obj: Record<string, unknown> = {};
  for (const r of rows as any[]) obj[r.key] = r.value;
  const reveal = (event.queryStringParameters || {}).reveal === '1';
  return ok({ data: redactSecrets(obj, reveal) });
});

router.get('/api/admin/settings/:key', async (event, user) => {
  requireSuperadmin(user);
  const key = event.pathParameters!.key!;
  const { rows } = await db.query('SELECT value FROM app_settings WHERE key=$1', [key]);
  if (!rows.length) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Clave no encontrada' }) };
  const reveal = (event.queryStringParameters || {}).reveal === '1';
  const value = reveal || !SECRET_KEYS.has(key) ? rows[0].value : '••••••••';
  return ok({ key, value });
});

router.put('/api/admin/settings', async (event, user) => {
  requireSuperadmin(user);
  const updates = parseBody(event);
  const entries = Object.entries(updates);
  if (!entries.length) return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Sin claves para actualizar' }) };

  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    for (const [key, value] of entries) {
      await conn.query(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1,$2,NOW(),$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW(), updated_by=EXCLUDED.updated_by`, [String(key).trim(), value === null ? null : String(value), user.id]);
    }
    await conn.query('COMMIT');
    return ok({ ok: true, updated: entries.length });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

router.put('/api/admin/settings/:key', async (event, user) => {
  requireSuperadmin(user);
  const key = event.pathParameters!.key!;
  const body = parseBody(event);
  const value = body.value !== undefined ? body.value : null;
  await db.query(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1,$2,NOW(),$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW(), updated_by=EXCLUDED.updated_by`, [key, value === null ? null : String(value), user.id]);
  return ok({ ok: true, key });
});

/* ──────────── Lambda entry point ──────────── */

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
