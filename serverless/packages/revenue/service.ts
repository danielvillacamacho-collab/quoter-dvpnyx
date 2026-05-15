import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser, SortParams } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { NotFound, BadRequest } from '@shared/errors';
import type { RevenuePeriod, RevenuePeriodWithContract, RevenueFilters, UpdateRevenuePlanDTO } from './types';
import type { RevenueRepository } from './repository';

const YYYYMM_RE = /^[0-9]{6}$/;

export interface RevenueService {
  list(params: {
    page: number; limit: number; offset: number;
    filters: RevenueFilters; sort: SortParams;
  }): Promise<PaginatedResult<RevenuePeriodWithContract>>;

  getByContract(contractId: string, from?: string, to?: string): Promise<RevenuePeriod[]>;

  updatePlan(
    contractId: string,
    yyyymm: string,
    data: UpdateRevenuePlanDTO,
    user: AuthUser,
  ): Promise<RevenuePeriod>;

  closePeriod(contractId: string, yyyymm: string, user: AuthUser): Promise<RevenuePeriod>;
}

export function createRevenueService(
  repo: RevenueRepository,
  events: EventEmitter,
  db: Pool,
): RevenueService {
  return {
    async list(params) {
      return repo.findAll(params);
    },

    async getByContract(contractId, from, to) {
      if (from && !YYYYMM_RE.test(from)) throw new BadRequest('Parámetro "from" inválido (formato YYYYMM)');
      if (to && !YYYYMM_RE.test(to))     throw new BadRequest('Parámetro "to" inválido (formato YYYYMM)');
      return repo.findByContract(contractId, from, to);
    },

    async updatePlan(contractId, yyyymm, data, user) {
      if (!YYYYMM_RE.test(yyyymm)) throw new BadRequest('Período inválido (formato YYYYMM)');

      // Validate contract exists
      const { rows } = await db.query(
        `SELECT id, type FROM contracts WHERE id = $1 AND deleted_at IS NULL`,
        [contractId],
      );
      if (!rows.length) throw new NotFound('Contrato', contractId);

      const period = await repo.upsert(contractId, yyyymm, {
        projected_usd: data.projected_usd,
        projected_pct: data.projected_pct,
        notes: data.notes,
      }, user.id);

      await events.emit(db, {
        event_type: 'revenue.plan_updated',
        entity_type: 'revenue_period',
        entity_id: `${contractId}:${yyyymm}`,
        actor_user_id: user.id,
        payload: { contract_id: contractId, yyyymm, ...data },
      });

      return period;
    },

    async closePeriod(contractId, yyyymm, user) {
      if (!YYYYMM_RE.test(yyyymm)) throw new BadRequest('Período inválido (formato YYYYMM)');

      const period = await repo.closePeriod(contractId, yyyymm, user.id);
      if (!period) throw new NotFound('Período de revenue abierto', `${contractId}:${yyyymm}`);

      await events.emit(db, {
        event_type: 'revenue.period_closed',
        entity_type: 'revenue_period',
        entity_id: `${contractId}:${yyyymm}`,
        actor_user_id: user.id,
        payload: { contract_id: contractId, yyyymm, real_usd: period.real_usd },
      });

      return period;
    },
  };
}
