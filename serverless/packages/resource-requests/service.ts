import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { NotFound, BadRequest, Conflict } from '@shared/errors';
import type { ResourceRequest, CreateResourceRequestDTO, UpdateResourceRequestDTO, ResourceRequestFilters, Candidate } from './types';
import { VALID_LEVELS, VALID_PRIORITIES, VALID_STATUSES, EDITABLE_FIELDS } from './types';
import type { ResourceRequestRepository } from './repository';
import type { SortParams } from '@shared/types';
import { rankCandidates } from './candidate-matcher';

export interface ResourceRequestService {
  list(params: { page: number; limit: number; offset: number; filters: ResourceRequestFilters; sort: SortParams }): Promise<PaginatedResult<ResourceRequest>>;
  getById(id: string): Promise<ResourceRequest>;
  create(data: CreateResourceRequestDTO, user: AuthUser): Promise<ResourceRequest>;
  update(id: string, data: UpdateResourceRequestDTO, user: AuthUser): Promise<ResourceRequest>;
  softDelete(id: string, user: AuthUser): Promise<void>;
  getCandidates(id: string): Promise<Candidate[]>;
}

export function createResourceRequestService(
  repo: ResourceRequestRepository,
  events: EventEmitter,
  db: Pool,
): ResourceRequestService {
  function computeStatus(assignmentsCount: number, quantity: number): string {
    if (assignmentsCount === 0) return 'open';
    if (assignmentsCount >= quantity) return 'filled';
    return 'partially_filled';
  }

  return {
    async list(params) {
      return repo.findAll(params);
    },

    async getById(id) {
      const rr = await repo.findById(id);
      if (!rr) throw new NotFound('Requerimiento', id);
      return rr;
    },

    async create(data, user) {
      if (!data.contract_id) throw new BadRequest('contract_id es requerido');
      if (!data.role_title || !data.role_title.trim()) throw new BadRequest('role_title es requerido');
      if (!data.area_id) throw new BadRequest('area_id es requerido');
      if (!data.level) throw new BadRequest('level es requerido');
      if (!data.start_date) throw new BadRequest('start_date es requerido');

      if (!(VALID_LEVELS as readonly string[]).includes(data.level)) {
        throw new BadRequest(`Nivel inválido: ${data.level}`);
      }
      if (data.priority && !(VALID_PRIORITIES as readonly string[]).includes(data.priority)) {
        throw new BadRequest(`Prioridad inválida: ${data.priority}`);
      }
      if (data.quantity !== undefined && (data.quantity < 1 || !Number.isInteger(data.quantity))) {
        throw new BadRequest('quantity debe ser un entero >= 1');
      }
      if (data.weekly_hours !== undefined && (data.weekly_hours <= 0 || data.weekly_hours > 80)) {
        throw new BadRequest('weekly_hours debe estar entre 0 y 80');
      }

      const rr = await repo.create(
        { ...data, role_title: data.role_title.trim() },
        user.id,
      );

      await events.emit(db, {
        event_type: 'resource_request.created',
        entity_type: 'resource_request',
        entity_id: rr.id,
        actor_user_id: user.id,
        payload: { role_title: rr.role_title, contract_id: rr.contract_id, area_id: rr.area_id, level: rr.level },
      });

      return rr;
    },

    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Requerimiento', id);

      if (before.status === 'cancelled') {
        throw new Conflict('No se puede modificar un requerimiento cancelado');
      }

      if (data.level && !(VALID_LEVELS as readonly string[]).includes(data.level)) {
        throw new BadRequest(`Nivel inválido: ${data.level}`);
      }
      if (data.priority && !(VALID_PRIORITIES as readonly string[]).includes(data.priority)) {
        throw new BadRequest(`Prioridad inválida: ${data.priority}`);
      }
      if (data.status && !(VALID_STATUSES as readonly string[]).includes(data.status)) {
        throw new BadRequest(`Estado inválido: ${data.status}`);
      }
      if (data.quantity !== undefined && (data.quantity < 1 || !Number.isInteger(data.quantity))) {
        throw new BadRequest('quantity debe ser un entero >= 1');
      }

      // If quantity changed, recompute status based on current assignments
      let statusUpdate: string | undefined;
      if (data.quantity !== undefined && data.quantity !== before.quantity) {
        const assignmentsCount = await repo.countAssignments(id);
        statusUpdate = computeStatus(assignmentsCount, data.quantity);
      }

      const updateData: Record<string, unknown> = { ...data };
      if (statusUpdate && !data.status) {
        updateData.status = statusUpdate;
      }

      const after = await repo.update(id, updateData);
      if (!after) throw new NotFound('Requerimiento', id);

      // If status was explicitly set to cancelled, check it's valid
      if (data.status === 'cancelled') {
        await repo.updateStatus(id, 'cancelled');
      }

      await events.emit(db, {
        event_type: 'resource_request.updated',
        entity_type: 'resource_request',
        entity_id: after.id,
        actor_user_id: user.id,
        payload: buildUpdatePayload(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [...EDITABLE_FIELDS]),
      });

      return after;
    },

    async softDelete(id, user) {
      const assignmentsCount = await repo.countAssignments(id);
      if (assignmentsCount > 0) {
        throw new Conflict(
          `Este requerimiento tiene ${assignmentsCount} asignación(es) activa(s). Cancélalo en lugar de eliminarlo.`,
        );
      }

      const rr = await repo.softDelete(id);
      if (!rr) throw new NotFound('Requerimiento', id);

      await events.emit(db, {
        event_type: 'resource_request.deleted',
        entity_type: 'resource_request',
        entity_id: rr.id,
        actor_user_id: user.id,
        payload: { role_title: rr.role_title, contract_id: rr.contract_id },
      });
    },

    async getCandidates(id) {
      const request = await repo.findById(id);
      if (!request) throw new NotFound('Requerimiento', id);

      const rawCandidates = await repo.findCandidates(id);
      return rankCandidates(request, rawCandidates);
    },
  };
}
