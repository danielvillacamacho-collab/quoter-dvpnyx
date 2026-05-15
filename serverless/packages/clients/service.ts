import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { NotFound, BadRequest, Conflict } from '@shared/errors';
import type { Client, CreateClientDTO, UpdateClientDTO, ClientFilters } from './types';
import { VALID_TIERS, EDITABLE_FIELDS } from './types';
import type { ClientRepository } from './repository';
import type { SortParams } from '@shared/types';

export interface ClientService {
  list(params: { page: number; limit: number; offset: number; filters: ClientFilters; sort: SortParams }): Promise<PaginatedResult<Client>>;
  getById(id: string): Promise<Client>;
  create(data: CreateClientDTO, user: AuthUser): Promise<Client>;
  update(id: string, data: UpdateClientDTO, user: AuthUser): Promise<Client>;
  activate(id: string, user: AuthUser): Promise<Client>;
  deactivate(id: string, user: AuthUser): Promise<Client>;
  softDelete(id: string, user: AuthUser): Promise<void>;
}

function sanitizeTier(tier: unknown): string | null | undefined {
  if (tier === null || tier === undefined || tier === '') return null;
  return (VALID_TIERS as readonly string[]).includes(tier as string) ? (tier as string) : undefined;
}

export function createClientService(
  repo: ClientRepository,
  events: EventEmitter,
  db: Pool,
): ClientService {
  return {
    async list(params) {
      return repo.findAll(params);
    },

    async getById(id) {
      const client = await repo.findById(id);
      if (!client) throw new NotFound('Cliente', id);
      return client;
    },

    async create(data, user) {
      if (!data.name || !data.name.trim()) throw new BadRequest('El nombre es requerido');

      const cleanTier = sanitizeTier(data.tier);
      if (cleanTier === undefined) throw new BadRequest('Tier inválido');

      const dup = await repo.findByName(data.name);
      if (dup) {
        throw new Conflict('Ya existe un cliente con ese nombre', {
          hint: dup.name,
          existing_id: dup.id,
        });
      }

      const client = await repo.create({ ...data, name: data.name.trim(), tier: cleanTier }, user.id);

      await events.emit(db, {
        event_type: 'client.created',
        entity_type: 'client',
        entity_id: client.id,
        actor_user_id: user.id,
        payload: { name: client.name, country: client.country, tier: client.tier },
      });

      return client;
    },

    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Cliente', id);

      const tierClean = sanitizeTier(data.tier);
      if (data.tier !== undefined && tierClean === undefined) throw new BadRequest('Tier inválido');
      if (data.name !== undefined && !String(data.name).trim()) throw new BadRequest('El nombre no puede estar vacío');

      if (data.name && String(data.name).trim().toLowerCase() !== before.name.toLowerCase()) {
        const dup = await repo.findByName(data.name, id);
        if (dup) throw new Conflict('Ya existe un cliente con ese nombre');
      }

      const updateData = {
        ...data,
        name: data.name ? String(data.name).trim() : undefined,
        tier: tierClean,
      };

      const after = await repo.update(id, updateData);
      if (!after) throw new NotFound('Cliente', id);

      await events.emit(db, {
        event_type: 'client.updated',
        entity_type: 'client',
        entity_id: after.id,
        actor_user_id: user.id,
        payload: buildUpdatePayload(before, after, [...EDITABLE_FIELDS]),
      });

      return after;
    },

    async activate(id, user) {
      const client = await repo.activate(id);
      if (!client) throw new NotFound('Cliente', id);

      await events.emit(db, {
        event_type: 'client.activated',
        entity_type: 'client',
        entity_id: client.id,
        actor_user_id: user.id,
        payload: { name: client.name },
      });

      return client;
    },

    async deactivate(id, user) {
      const client = await repo.deactivate(id);
      if (!client) throw new NotFound('Cliente', id);

      await events.emit(db, {
        event_type: 'client.deactivated',
        entity_type: 'client',
        entity_id: client.id,
        actor_user_id: user.id,
        payload: { name: client.name },
      });

      return client;
    },

    async softDelete(id, user) {
      const { opps, ctrs } = await repo.countRelations(id);
      if (opps > 0 || ctrs > 0) {
        throw new Conflict(
          `Este cliente tiene ${opps} oportunidad(es) y ${ctrs} contrato(s). Desactívalo en lugar de eliminarlo para preservar la historia.`,
        );
      }

      const client = await repo.softDelete(id);
      if (!client) throw new NotFound('Cliente', id);

      await events.emit(db, {
        event_type: 'client.deleted',
        entity_type: 'client',
        entity_id: client.id,
        actor_user_id: user.id,
        payload: { name: client.name },
      });
    },
  };
}
