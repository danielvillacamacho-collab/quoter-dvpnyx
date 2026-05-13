import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser, SortParams } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { NotFound, BadRequest, Conflict } from '@shared/errors';
import type { Employee } from './types';
import { VALID_LEVELS, VALID_STATUSES, VALID_EMPLOYMENT_TYPES, EMPLOYEE_EDITABLE_FIELDS } from './types';
import type { EmployeeRepository } from './repository';

export interface EmployeeService {
  list(params: { page: number; limit: number; offset: number; filters: Record<string, string | undefined>; sort: SortParams }): Promise<PaginatedResult<Employee>>;
  getById(id: string): Promise<Employee>;
  lookup(): Promise<unknown[]>;
  create(data: Record<string, unknown>, user: AuthUser): Promise<Employee>;
  update(id: string, data: Record<string, unknown>, user: AuthUser): Promise<Employee>;
  softDelete(id: string, user: AuthUser): Promise<void>;
  getSkills(id: string): Promise<unknown[]>;
  setSkills(id: string, skillIds: string[], user: AuthUser): Promise<unknown[]>;
}

export function createEmployeeService(repo: EmployeeRepository, events: EventEmitter, db: Pool): EmployeeService {
  return {
    async list(params) { return repo.findAll(params); },

    async getById(id) {
      const e = await repo.findById(id);
      if (!e) throw new NotFound('Empleado', id);
      return e;
    },

    async lookup() { return repo.lookup(); },

    async create(data, user) {
      if (!data.first_name || !String(data.first_name).trim()) throw new BadRequest('first_name es requerido');
      if (!data.last_name || !String(data.last_name).trim()) throw new BadRequest('last_name es requerido');
      if (data.level && !(VALID_LEVELS as readonly string[]).includes(String(data.level))) throw new BadRequest('Level inválido');
      if (data.status && !(VALID_STATUSES as readonly string[]).includes(String(data.status))) throw new BadRequest('Status inválido');
      if (data.employment_type && !(VALID_EMPLOYMENT_TYPES as readonly string[]).includes(String(data.employment_type))) throw new BadRequest('Tipo de empleo inválido');

      const emp = await repo.create(data);
      await events.emit(db, {
        event_type: 'employee.created', entity_type: 'employee', entity_id: emp.id,
        actor_user_id: user.id, payload: { first_name: emp.first_name, last_name: emp.last_name },
      });
      return emp;
    },

    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Empleado', id);
      if (data.level && !(VALID_LEVELS as readonly string[]).includes(String(data.level))) throw new BadRequest('Level inválido');
      if (data.status && !(VALID_STATUSES as readonly string[]).includes(String(data.status))) throw new BadRequest('Status inválido');

      const after = await repo.update(id, data);
      if (!after) throw new NotFound('Empleado', id);

      await events.emit(db, {
        event_type: 'employee.updated', entity_type: 'employee', entity_id: after.id,
        actor_user_id: user.id, payload: buildUpdatePayload(before as Record<string, unknown>, after as Record<string, unknown>, [...EMPLOYEE_EDITABLE_FIELDS]),
      });
      return after;
    },

    async softDelete(id, user) {
      const hasActive = await repo.hasActiveAssignments(id);
      if (hasActive) throw new Conflict('Este empleado tiene asignaciones activas. Termínalas antes de eliminarlo.');

      const emp = await repo.softDelete(id);
      if (!emp) throw new NotFound('Empleado', id);

      await events.emit(db, {
        event_type: 'employee.deleted', entity_type: 'employee', entity_id: emp.id,
        actor_user_id: user.id, payload: { first_name: emp.first_name, last_name: emp.last_name },
      });
    },

    async getSkills(id) { return repo.getSkills(id); },

    async setSkills(id, skillIds, user) {
      await repo.setSkills(id, skillIds);
      await events.emit(db, {
        event_type: 'employee.skills_updated', entity_type: 'employee', entity_id: id,
        actor_user_id: user.id, payload: { skill_ids: skillIds },
      });
      return repo.getSkills(id);
    },
  };
}
