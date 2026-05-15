import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { NotFound, BadRequest, Forbidden } from '@shared/errors';
import { isAtLeast, canSeeAll } from '@shared/auth/rbac';
import { withTransaction } from '@shared/db/transaction';
import type {
  TimeEntry, CreateTimeEntryDTO, UpdateTimeEntryDTO, CopyWeekDTO, TimeEntryFilters,
  WeeklyTimeAllocation, BulkAllocationDTO, AllocationFilters,
} from './types';
import { VALID_ENTRY_STATUSES, ENTRY_EDITABLE_FIELDS } from './types';
import type { TimeEntryRepository, AllocationRepository } from './repository';
import type { SortParams } from '@shared/types';

// ─── Time Entries Service ───

export interface TimeEntryService {
  list(params: { page: number; limit: number; offset: number; filters: TimeEntryFilters; sort: SortParams }, user: AuthUser): Promise<PaginatedResult<TimeEntry>>;
  getById(id: string, user: AuthUser): Promise<TimeEntry>;
  create(data: CreateTimeEntryDTO, user: AuthUser): Promise<TimeEntry>;
  update(id: string, data: UpdateTimeEntryDTO, user: AuthUser): Promise<TimeEntry>;
  softDelete(id: string, user: AuthUser): Promise<void>;
  copyWeek(data: CopyWeekDTO, user: AuthUser): Promise<TimeEntry[]>;
}

export function createTimeEntryService(
  repo: TimeEntryRepository,
  events: EventEmitter,
  db: Pool,
): TimeEntryService {
  /** Enforce RBAC: employees see own, leads see reports, admins see all */
  function enforceAccess(user: AuthUser, targetEmployeeId: string): void {
    if (canSeeAll(user)) return;
    if (user.employee_id === targetEmployeeId) return;
    if (isAtLeast(user, 'lead')) return; // leads can see their reports
    throw new Forbidden('No tienes permisos para ver este registro');
  }

  /** Enforce write access: only own entries unless admin */
  function enforceWriteAccess(user: AuthUser, targetEmployeeId: string): void {
    if (canSeeAll(user)) return;
    if (user.employee_id === targetEmployeeId) return;
    throw new Forbidden('Solo puedes modificar tus propias entradas de tiempo');
  }

  return {
    async list(params, user) {
      // Non-admins and non-leads can only see their own entries
      if (!canSeeAll(user) && !isAtLeast(user, 'lead')) {
        params.filters.employee_id = user.employee_id || user.id;
      }
      return repo.findAll(params);
    },

    async getById(id, user) {
      const entry = await repo.findById(id);
      if (!entry) throw new NotFound('Entrada de tiempo', id);
      enforceAccess(user, entry.employee_id);
      return entry;
    },

    async create(data, user) {
      if (!data.employee_id) throw new BadRequest('employee_id es requerido');
      if (!data.assignment_id) throw new BadRequest('assignment_id es requerido');
      if (!data.work_date) throw new BadRequest('work_date es requerido');
      if (!data.hours || data.hours <= 0 || data.hours > 24) {
        throw new BadRequest('hours debe estar entre 0 y 24');
      }
      if (data.status && !(VALID_ENTRY_STATUSES as readonly string[]).includes(data.status)) {
        throw new BadRequest(`Estado inválido: ${data.status}`);
      }

      enforceWriteAccess(user, data.employee_id);

      const entry = await repo.create(data as Record<string, unknown>, user.id);

      await events.emit(db, {
        event_type: 'time_entry.created',
        entity_type: 'time_entry',
        entity_id: entry.id,
        actor_user_id: user.id,
        payload: {
          employee_id: entry.employee_id,
          assignment_id: entry.assignment_id,
          work_date: entry.work_date,
          hours: entry.hours,
        },
      });

      return entry;
    },

    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Entrada de tiempo', id);

      // Only draft/rejected entries can be edited by the employee
      if (!canSeeAll(user)) {
        enforceWriteAccess(user, before.employee_id);
        if (before.status === 'approved') {
          throw new BadRequest('No se puede modificar una entrada aprobada');
        }
      }

      if (data.status && !(VALID_ENTRY_STATUSES as readonly string[]).includes(data.status)) {
        throw new BadRequest(`Estado inválido: ${data.status}`);
      }
      if (data.hours !== undefined && (data.hours <= 0 || data.hours > 24)) {
        throw new BadRequest('hours debe estar entre 0 y 24');
      }

      // Approval/rejection requires at least lead role
      if (data.status === 'approved' || data.status === 'rejected') {
        if (!isAtLeast(user, 'lead')) {
          throw new Forbidden('Solo leads o superiores pueden aprobar/rechazar entradas');
        }
        if (data.status === 'rejected' && !data.rejection_reason?.trim()) {
          throw new BadRequest('rejection_reason es requerido al rechazar');
        }
      }

      const updateData: Record<string, unknown> = { ...data };
      if (data.status === 'approved') {
        updateData.approved_by = user.id;
      }

      const after = await repo.update(id, updateData);
      if (!after) throw new NotFound('Entrada de tiempo', id);

      await events.emit(db, {
        event_type: 'time_entry.updated',
        entity_type: 'time_entry',
        entity_id: after.id,
        actor_user_id: user.id,
        payload: buildUpdatePayload(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          [...ENTRY_EDITABLE_FIELDS],
        ),
      });

      return after;
    },

    async softDelete(id, user) {
      const entry = await repo.findById(id);
      if (!entry) throw new NotFound('Entrada de tiempo', id);

      if (!canSeeAll(user)) {
        enforceWriteAccess(user, entry.employee_id);
        if (entry.status === 'approved') {
          throw new BadRequest('No se puede eliminar una entrada aprobada');
        }
      }

      const deleted = await repo.softDelete(id);
      if (!deleted) throw new NotFound('Entrada de tiempo', id);

      await events.emit(db, {
        event_type: 'time_entry.deleted',
        entity_type: 'time_entry',
        entity_id: deleted.id,
        actor_user_id: user.id,
        payload: {
          employee_id: deleted.employee_id,
          work_date: deleted.work_date,
          hours: deleted.hours,
        },
      });
    },

    async copyWeek(data, user) {
      if (!data.employee_id) throw new BadRequest('employee_id es requerido');
      if (!data.source_week_start) throw new BadRequest('source_week_start es requerido');
      if (!data.target_week_start) throw new BadRequest('target_week_start es requerido');
      if (data.source_week_start === data.target_week_start) {
        throw new BadRequest('La semana origen y destino no pueden ser iguales');
      }

      enforceWriteAccess(user, data.employee_id);

      const sourceEntries = await repo.findByEmployeeAndWeek(data.employee_id, data.source_week_start);
      if (sourceEntries.length === 0) {
        throw new BadRequest('No hay entradas en la semana origen');
      }

      // Calculate day offset between source and target week
      const sourceMon = new Date(data.source_week_start);
      const targetMon = new Date(data.target_week_start);
      const dayOffset = Math.round((targetMon.getTime() - sourceMon.getTime()) / 86400000);

      const newEntries = sourceEntries.map((entry) => {
        const sourceDate = new Date(entry.work_date);
        sourceDate.setDate(sourceDate.getDate() + dayOffset);
        return {
          employee_id: data.employee_id,
          assignment_id: entry.assignment_id,
          work_date: sourceDate.toISOString().slice(0, 10),
          hours: entry.hours,
          description: entry.description,
        };
      });

      const created = await withTransaction(async (client) => {
        return repo.bulkCreate(newEntries, user.id, client);
      });

      if (created.length > 0) {
        await events.emit(db, {
          event_type: 'time_entry.copy_week',
          entity_type: 'time_entry',
          entity_id: data.employee_id,
          actor_user_id: user.id,
          payload: {
            source_week: data.source_week_start,
            target_week: data.target_week_start,
            entries_copied: created.length,
          },
        });
      }

      return created;
    },
  };
}

// ─── Weekly Allocations Service ───

export interface AllocationService {
  list(filters: AllocationFilters, user: AuthUser): Promise<WeeklyTimeAllocation[]>;
  bulkUpsert(data: BulkAllocationDTO, user: AuthUser): Promise<WeeklyTimeAllocation[]>;
}

export function createAllocationService(
  repo: AllocationRepository,
  events: EventEmitter,
  db: Pool,
): AllocationService {
  return {
    async list(filters, user) {
      // Non-admins can only see their own allocations
      if (!canSeeAll(user) && !isAtLeast(user, 'lead')) {
        filters.employee_id = user.employee_id || user.id;
      }
      return repo.findAll(filters);
    },

    async bulkUpsert(data, user) {
      if (!data.employee_id) throw new BadRequest('employee_id es requerido');
      if (!data.allocations || data.allocations.length === 0) {
        throw new BadRequest('allocations no puede estar vacío');
      }

      // Only admins can modify other employees' allocations
      if (!canSeeAll(user) && user.employee_id !== data.employee_id) {
        throw new Forbidden('Solo puedes modificar tus propias asignaciones de tiempo');
      }

      // Validate each allocation
      for (const alloc of data.allocations) {
        if (!alloc.assignment_id) throw new BadRequest('assignment_id es requerido en cada allocation');
        if (!alloc.week_start_date) throw new BadRequest('week_start_date es requerido en cada allocation');
        if (alloc.pct < 0 || alloc.pct > 100) {
          throw new BadRequest('pct debe estar entre 0 y 100');
        }
      }

      const results = await withTransaction(async (client) => {
        return repo.bulkUpsert(data.employee_id, data.allocations, user.id, client);
      });

      await events.emit(db, {
        event_type: 'time_allocation.bulk_upsert',
        entity_type: 'weekly_time_allocation',
        entity_id: data.employee_id,
        actor_user_id: user.id,
        payload: {
          employee_id: data.employee_id,
          allocations_count: results.length,
        },
      });

      return results;
    },
  };
}
