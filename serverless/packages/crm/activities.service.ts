import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser, SortParams } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { NotFound, BadRequest, Forbidden } from '@shared/errors';
import type { Activity, CreateActivityDTO } from './types';
import { VALID_ACTIVITY_TYPES } from './types';
import type { ActivityRepository } from './activities.repository';

export interface ActivityService {
  list(params: { page: number; limit: number; offset: number; filters: Record<string, string | undefined>; sort: SortParams }): Promise<PaginatedResult<Activity>>;
  getById(id: string): Promise<Activity>;
  getByOpportunity(oppId: string, params: { page: number; limit: number; offset: number; sort: SortParams }): Promise<PaginatedResult<Activity>>;
  getByClient(clientId: string, params: { page: number; limit: number; offset: number; sort: SortParams }): Promise<PaginatedResult<Activity>>;
  create(data: CreateActivityDTO, user: AuthUser): Promise<Activity & { _warnings?: string[] }>;
  update(id: string, data: Partial<CreateActivityDTO>, user: AuthUser): Promise<Activity>;
  softDelete(id: string, user: AuthUser): Promise<void>;
}

export function createActivityService(repo: ActivityRepository, events: EventEmitter, db: Pool): ActivityService {
  return {
    async list(params) { return repo.findAll(params); },

    async getById(id) {
      const a = await repo.findById(id);
      if (!a) throw new NotFound('Actividad', id);
      return a;
    },

    async getByOpportunity(oppId, params) { return repo.findByOpportunity(oppId, params); },
    async getByClient(clientId, params) { return repo.findByClient(clientId, params); },

    async create(data, user) {
      if (!data.subject?.trim()) throw new BadRequest('El asunto (subject) es requerido');
      if (!data.activity_type || !(VALID_ACTIVITY_TYPES as readonly string[]).includes(data.activity_type)) {
        throw new BadRequest(`Tipo inválido. Valores permitidos: ${VALID_ACTIVITY_TYPES.join(', ')}`);
      }

      const warnings: string[] = [];
      if (!data.opportunity_id && !data.client_id) {
        warnings.push('Se recomienda vincular la actividad a un cliente o una oportunidad');
      }

      const activity = await repo.create({ ...data, subject: data.subject.trim() }, user.id);

      let resolvedClientId = data.client_id || null;
      if (!resolvedClientId && data.opportunity_id) {
        resolvedClientId = await repo.resolveClientFromOpportunity(data.opportunity_id);
      }
      if (resolvedClientId) {
        await repo.updateClientLastActivity(resolvedClientId);
      }

      await events.emit(db, {
        event_type: 'activity.created', entity_type: 'activity', entity_id: activity.id,
        actor_user_id: user.id, payload: { subject: activity.subject, activity_type: activity.activity_type },
      });

      const response = { ...activity } as Activity & { _warnings?: string[] };
      if (warnings.length) response._warnings = warnings;
      return response;
    },

    async update(id, data, user) {
      const existing = await repo.findById(id);
      if (!existing) throw new NotFound('Actividad', id);
      if (existing.user_id !== user.id && user.role !== 'admin' && user.role !== 'superadmin') {
        throw new Forbidden('Solo el creador o un admin puede editar esta actividad');
      }
      if (data.activity_type && !(VALID_ACTIVITY_TYPES as readonly string[]).includes(data.activity_type)) {
        throw new BadRequest(`Tipo inválido. Valores permitidos: ${VALID_ACTIVITY_TYPES.join(', ')}`);
      }
      if (data.subject !== undefined && !String(data.subject).trim()) {
        throw new BadRequest('El asunto no puede estar vacío');
      }

      const updated = await repo.update(id, { ...data, subject: data.subject ? String(data.subject).trim() : undefined });
      if (!updated) throw new NotFound('Actividad', id);

      await events.emit(db, {
        event_type: 'activity.updated', entity_type: 'activity', entity_id: updated.id,
        actor_user_id: user.id, payload: { subject: updated.subject, activity_type: updated.activity_type },
      });
      return updated;
    },

    async softDelete(id, user) {
      const existing = await repo.findById(id);
      if (!existing) throw new NotFound('Actividad', id);
      if (existing.user_id !== user.id && user.role !== 'admin' && user.role !== 'superadmin') {
        throw new Forbidden('Solo el creador o un admin puede eliminar esta actividad');
      }
      await repo.softDelete(id);
      await events.emit(db, {
        event_type: 'activity.deleted', entity_type: 'activity', entity_id: existing.id,
        actor_user_id: user.id, payload: { subject: existing.subject, activity_type: existing.activity_type },
      });
    },
  };
}
