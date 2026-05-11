import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser, SortParams } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { NotFound, BadRequest } from '@shared/errors';
import type { Contact, CreateContactDTO, OpportunityLink } from './types';
import { VALID_SENIORITIES, VALID_DEAL_ROLES, CONTACT_EDITABLE_FIELDS } from './types';
import type { ContactRepository } from './contacts.repository';

export interface ContactService {
  list(params: { page: number; limit: number; offset: number; filters: Record<string, string | undefined>; sort: SortParams }): Promise<PaginatedResult<Contact>>;
  getById(id: string): Promise<Contact>;
  getByClient(clientId: string): Promise<Contact[]>;
  getByOpportunity(opportunityId: string): Promise<unknown[]>;
  create(data: CreateContactDTO, user: AuthUser): Promise<Contact>;
  update(id: string, data: Partial<CreateContactDTO>, user: AuthUser): Promise<Contact>;
  softDelete(id: string, user: AuthUser): Promise<void>;
  linkOpportunity(data: OpportunityLink): Promise<unknown>;
  unlinkOpportunity(id: string): Promise<void>;
}

function sanitizeSeniority(val: unknown): string | null | undefined {
  if (val === null || val === undefined || val === '') return null;
  return (VALID_SENIORITIES as readonly string[]).includes(val as string) ? (val as string) : undefined;
}

export function createContactService(repo: ContactRepository, events: EventEmitter, db: Pool): ContactService {
  return {
    async list(params) { return repo.findAll(params); },

    async getById(id) {
      const c = await repo.findById(id);
      if (!c) throw new NotFound('Contacto', id);
      return c;
    },

    async getByClient(clientId) { return repo.findByClient(clientId); },
    async getByOpportunity(oppId) { return repo.findByOpportunity(oppId); },

    async create(data, user) {
      if (!data.first_name?.trim()) throw new BadRequest('first_name es requerido');
      if (!data.last_name?.trim()) throw new BadRequest('last_name es requerido');
      if (!data.client_id) throw new BadRequest('client_id es requerido');

      const cleanSeniority = sanitizeSeniority(data.seniority);
      if (cleanSeniority === undefined) throw new BadRequest('Seniority inválido');

      const contact = await repo.create({ ...data, first_name: data.first_name.trim(), last_name: data.last_name.trim(), seniority: cleanSeniority }, user.id);

      await events.emit(db, {
        event_type: 'contact.created', entity_type: 'contact', entity_id: contact.id,
        actor_user_id: user.id,
        payload: { first_name: contact.first_name, last_name: contact.last_name, client_id: contact.client_id },
      });

      return contact;
    },

    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Contacto', id);

      const senClean = sanitizeSeniority(data.seniority);
      if (data.seniority !== undefined && senClean === undefined) throw new BadRequest('Seniority inválido');
      if (data.first_name !== undefined && !String(data.first_name).trim()) throw new BadRequest('first_name no puede estar vacío');
      if (data.last_name !== undefined && !String(data.last_name).trim()) throw new BadRequest('last_name no puede estar vacío');

      const after = await repo.update(id, { ...data, seniority: senClean });
      if (!after) throw new NotFound('Contacto', id);

      await events.emit(db, {
        event_type: 'contact.updated', entity_type: 'contact', entity_id: after.id,
        actor_user_id: user.id, payload: buildUpdatePayload(before, after, [...CONTACT_EDITABLE_FIELDS]),
      });
      return after;
    },

    async softDelete(id, user) {
      const contact = await repo.softDelete(id);
      if (!contact) throw new NotFound('Contacto', id);
      await events.emit(db, {
        event_type: 'contact.deleted', entity_type: 'contact', entity_id: contact.id,
        actor_user_id: user.id, payload: { first_name: contact.first_name, last_name: contact.last_name },
      });
    },

    async linkOpportunity(data) {
      if (!data.opportunity_id || !data.contact_id || !data.deal_role) throw new BadRequest('opportunity_id, contact_id y deal_role son requeridos');
      if (!(VALID_DEAL_ROLES as readonly string[]).includes(data.deal_role)) throw new BadRequest('deal_role inválido');
      return repo.linkOpportunity(data);
    },

    async unlinkOpportunity(id) {
      const ok = await repo.unlinkOpportunity(id);
      if (!ok) throw new NotFound('Vínculo', id);
    },
  };
}
