import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createRevenueRepository } from './repository';
import { createRevenueService } from './service';
import { createExchangeRateRepository } from './exchange-rates.repository';
import { createBudgetRepository } from './budgets.repository';
import { createBudgetService } from './budgets.service';
import { REVENUE_SORTABLE, EXCHANGE_RATE_SORTABLE, BUDGET_SORTABLE } from './types';
import type { RevenueFilters, BudgetFilters } from './types';

const db = getPool();
const events = createEventEmitter();

const revenueRepo = createRevenueRepository(db);
const revenueSvc = createRevenueService(revenueRepo, events, db);

const exchangeRateRepo = createExchangeRateRepository(db);

const budgetRepo = createBudgetRepository(db);
const budgetSvc = createBudgetService(budgetRepo, events, db);

const router = createRouter();

/* ──────────── Revenue ──────────── */

router.get('/api/revenue', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, REVENUE_SORTABLE, { defaultField: 'yyyymm', defaultDir: 'desc', tieBreaker: 'c.name ASC' });
  const filters: RevenueFilters = {
    from: qs.from, to: qs.to, type: qs.type,
    owner_id: qs.owner_id, country: qs.country,
    display_currency: qs.display_currency,
  };
  return paginated(await revenueSvc.list({ page, limit, offset, filters, sort }));
});

router.get('/api/revenue/plan/:contract_id', async (event) => {
  const qs = event.queryStringParameters || {};
  const periods = await revenueSvc.getByContract(event.pathParameters!.contract_id!, qs.from, qs.to);
  return ok(periods);
});

router.put('/api/revenue/plan/:contract_id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const contractId = event.pathParameters!.contract_id!;
  const yyyymm = body.yyyymm as string;
  const period = await revenueSvc.updatePlan(contractId, yyyymm, body, user);
  return ok(period);
});

/* ──────────── Exchange Rates ──────────── */

router.get('/api/admin/exchange-rates', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, EXCHANGE_RATE_SORTABLE, { defaultField: 'yyyymm', defaultDir: 'desc', tieBreaker: 'er.currency ASC' });
  const filters = { from: qs.from, to: qs.to, currency: qs.currency };
  return paginated(await exchangeRateRepo.findAll({ page, limit, offset, filters, sort }));
});

router.post('/api/admin/exchange-rates', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
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

router.put('/api/admin/exchange-rates/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  // id format: yyyymm-currency (e.g. 202605-COP)
  const [yyyymm, currency] = (event.pathParameters!.id! || '').split('-');
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

router.delete('/api/admin/exchange-rates/:id', async (event, user) => {
  requireAdmin(user);
  const [yyyymm, currency] = (event.pathParameters!.id! || '').split('-');
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
  const summary = await budgetSvc.summary({
    period_year: qs.period_year, period_quarter: qs.period_quarter,
    country: qs.country, service_line: qs.service_line,
  });
  return ok(summary);
});

router.get('/api/budgets/:id', async (event) => {
  return ok(await budgetSvc.getById(event.pathParameters!.id!));
});

router.post('/api/budgets', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  return created(await budgetSvc.create(body, user));
});

router.put('/api/budgets/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  return ok(await budgetSvc.update(event.pathParameters!.id!, body, user));
});

router.delete('/api/budgets/:id', async (event, user) => {
  requireAdmin(user);
  await budgetSvc.remove(event.pathParameters!.id!, user);
  return message('Presupuesto eliminado');
});

/* ──────────── Lambda entry point ──────────── */

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
