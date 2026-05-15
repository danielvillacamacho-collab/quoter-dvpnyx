import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser, SortParams } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { NotFound, BadRequest } from '@shared/errors';
import type { Budget, CreateBudgetDTO, UpdateBudgetDTO, BudgetFilters, BudgetSummaryRow } from './types';
import { VALID_BUDGET_STATUSES, BUDGET_EDITABLE_FIELDS } from './types';
import type { BudgetRepository } from './budgets.repository';

export interface BudgetService {
  list(params: {
    page: number; limit: number; offset: number;
    filters: BudgetFilters; sort: SortParams;
  }): Promise<PaginatedResult<Budget>>;

  getById(id: string): Promise<Budget>;

  create(data: CreateBudgetDTO, user: AuthUser): Promise<Budget>;

  update(id: string, data: UpdateBudgetDTO, user: AuthUser): Promise<Budget>;

  remove(id: string, user: AuthUser): Promise<void>;

  summary(filters: { period_year?: string; period_quarter?: string; country?: string; service_line?: string }): Promise<BudgetSummaryRow[]>;
}

function validateBudgetData(data: CreateBudgetDTO | UpdateBudgetDTO, isCreate: boolean) {
  if (isCreate && !data.period_year) throw new BadRequest('period_year es requerido');
  if (isCreate && (data.target_usd === undefined || data.target_usd === null)) throw new BadRequest('target_usd es requerido');

  if (data.period_year !== undefined && (data.period_year < 2020 || data.period_year > 2099)) {
    throw new BadRequest('period_year fuera de rango (2020-2099)');
  }
  if (data.period_quarter !== undefined && data.period_quarter !== null && (data.period_quarter < 1 || data.period_quarter > 4)) {
    throw new BadRequest('period_quarter debe ser 1-4');
  }
  if (data.period_month !== undefined && data.period_month !== null && (data.period_month < 1 || data.period_month > 12)) {
    throw new BadRequest('period_month debe ser 1-12');
  }
  if (data.target_usd !== undefined && data.target_usd < 0) {
    throw new BadRequest('target_usd no puede ser negativo');
  }
  if (data.status !== undefined && !(VALID_BUDGET_STATUSES as readonly string[]).includes(data.status)) {
    throw new BadRequest(`Estado inválido. Valores válidos: ${VALID_BUDGET_STATUSES.join(', ')}`);
  }
}

export function createBudgetService(
  repo: BudgetRepository,
  events: EventEmitter,
  db: Pool,
): BudgetService {
  return {
    async list(params) {
      return repo.findAll(params);
    },

    async getById(id) {
      const budget = await repo.findById(id);
      if (!budget) throw new NotFound('Presupuesto', id);
      return budget;
    },

    async create(data, user) {
      validateBudgetData(data, true);

      const budget = await repo.create({ ...data }, user.id);

      await events.emit(db, {
        event_type: 'budget.created',
        entity_type: 'budget',
        entity_id: budget.id,
        actor_user_id: user.id,
        payload: { period_year: budget.period_year, period_quarter: budget.period_quarter, target_usd: budget.target_usd },
      });

      return budget;
    },

    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Presupuesto', id);

      validateBudgetData(data, false);

      const after = await repo.update(id, { ...data }, user.id);
      if (!after) throw new NotFound('Presupuesto', id);

      await events.emit(db, {
        event_type: 'budget.updated',
        entity_type: 'budget',
        entity_id: after.id,
        actor_user_id: user.id,
        payload: buildUpdatePayload(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          [...BUDGET_EDITABLE_FIELDS],
        ),
      });

      return after;
    },

    async remove(id, user) {
      const budget = await repo.remove(id);
      if (!budget) throw new NotFound('Presupuesto', id);

      await events.emit(db, {
        event_type: 'budget.deleted',
        entity_type: 'budget',
        entity_id: budget.id,
        actor_user_id: user.id,
        payload: { period_year: budget.period_year, target_usd: budget.target_usd },
      });
    },

    async summary(filters) {
      return repo.summary(filters);
    },
  };
}
