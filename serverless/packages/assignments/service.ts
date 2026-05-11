import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { NotFound, BadRequest, Conflict } from '@shared/errors';
import type { Assignment, CreateAssignmentDTO, UpdateAssignmentDTO, AssignmentFilters, ValidationResult } from './types';
import { VALID_STATUSES, EDITABLE_FIELDS } from './types';
import type { AssignmentRepository } from './repository';
import type { SortParams } from '@shared/types';
import { validateAssignment } from './validation-engine';

export interface AssignmentService {
  list(params: { page: number; limit: number; offset: number; filters: AssignmentFilters; sort: SortParams }): Promise<PaginatedResult<Assignment>>;
  getById(id: string): Promise<Assignment>;
  create(data: CreateAssignmentDTO, user: AuthUser): Promise<Assignment>;
  update(id: string, data: UpdateAssignmentDTO, user: AuthUser): Promise<Assignment>;
  softDelete(id: string, user: AuthUser): Promise<void>;
  validate(data: CreateAssignmentDTO): Promise<ValidationResult>;
  exportCsv(filters: AssignmentFilters): Promise<string>;
}

export function createAssignmentService(
  repo: AssignmentRepository,
  events: EventEmitter,
  db: Pool,
): AssignmentService {
  function computeRequestStatus(assignmentsCount: number, quantity: number): string {
    if (assignmentsCount === 0) return 'open';
    if (assignmentsCount >= quantity) return 'filled';
    return 'partially_filled';
  }

  async function syncRequestStatus(requestId: string): Promise<void> {
    const request = await repo.getRequestContext(requestId);
    if (!request || request.status === 'cancelled') return;
    const count = await repo.countActiveForRequest(requestId);
    const newStatus = computeRequestStatus(count, request.quantity);
    if (newStatus !== request.status) {
      await repo.updateRequestStatus(requestId, newStatus);
    }
  }

  async function runValidation(data: CreateAssignmentDTO): Promise<ValidationResult> {
    const employee = await repo.getEmployeeContext(data.employee_id);
    if (!employee) throw new NotFound('Empleado', data.employee_id);

    const request = await repo.getRequestContext(data.resource_request_id);
    if (!request) throw new NotFound('Requerimiento', data.resource_request_id);

    const existingAssignments = await repo.getEmployeeAssignments(data.employee_id);

    return validateAssignment(
      employee, request, data.weekly_hours,
      data.start_date, data.end_date || null,
      existingAssignments,
    );
  }

  return {
    async list(params) {
      return repo.findAll(params);
    },

    async getById(id) {
      const asg = await repo.findById(id);
      if (!asg) throw new NotFound('Asignación', id);
      return asg;
    },

    async create(data, user) {
      if (!data.resource_request_id) throw new BadRequest('resource_request_id es requerido');
      if (!data.employee_id) throw new BadRequest('employee_id es requerido');
      if (!data.contract_id) throw new BadRequest('contract_id es requerido');
      if (!data.weekly_hours || data.weekly_hours <= 0 || data.weekly_hours > 80) {
        throw new BadRequest('weekly_hours debe estar entre 0 y 80');
      }
      if (!data.start_date) throw new BadRequest('start_date es requerido');

      // Run validation
      const validation = await runValidation(data);

      if (!validation.valid) {
        // Check if force override is requested
        if (data.force) {
          // Only CAPACITY_EXCEEDED can be force-overridden
          const nonOverridableErrors = validation.errors.filter((e) => e.code !== 'CAPACITY_EXCEEDED');
          if (nonOverridableErrors.length > 0) {
            throw new Conflict(
              `Errores no sobreescribibles: ${nonOverridableErrors.map((e) => e.message).join('; ')}`,
            );
          }
          if (!data.override_reason || data.override_reason.trim().length < 10) {
            throw new BadRequest('override_reason es requerido (mínimo 10 caracteres) cuando se usa force:true');
          }
        } else {
          throw new Conflict(
            `Validación fallida: ${validation.errors.map((e) => e.message).join('; ')}`,
          );
        }
      }

      const createData: Record<string, unknown> = {
        resource_request_id: data.resource_request_id,
        employee_id: data.employee_id,
        contract_id: data.contract_id,
        weekly_hours: data.weekly_hours,
        start_date: data.start_date,
        end_date: data.end_date || null,
        role_title: data.role_title || null,
        notes: data.notes || null,
      };

      // Store override info if forced
      if (data.force && data.override_reason) {
        createData.override_reason = data.override_reason.trim();
        createData.override_checks = validation.checks;
        createData.override_author_id = user.id;
        createData.override_at = new Date().toISOString();
      }

      const asg = await repo.create(createData, user.id);

      // Sync resource request status
      await syncRequestStatus(data.resource_request_id);

      await events.emit(db, {
        event_type: 'assignment.created',
        entity_type: 'assignment',
        entity_id: asg.id,
        actor_user_id: user.id,
        payload: {
          employee_id: asg.employee_id,
          contract_id: asg.contract_id,
          resource_request_id: asg.resource_request_id,
          weekly_hours: asg.weekly_hours,
          forced: !!data.force,
          validation_warnings: validation.warnings.length,
        },
      });

      return asg;
    },

    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Asignación', id);

      if (before.status === 'cancelled') {
        throw new Conflict('No se puede modificar una asignación cancelada');
      }

      if (data.status && !(VALID_STATUSES as readonly string[]).includes(data.status)) {
        throw new BadRequest(`Estado inválido: ${data.status}`);
      }
      if (data.weekly_hours !== undefined && (data.weekly_hours <= 0 || data.weekly_hours > 80)) {
        throw new BadRequest('weekly_hours debe estar entre 0 y 80');
      }

      const after = await repo.update(id, data);
      if (!after) throw new NotFound('Asignación', id);

      // Sync resource request status if status changed
      if (data.status && data.status !== before.status) {
        await syncRequestStatus(before.resource_request_id);
      }

      await events.emit(db, {
        event_type: 'assignment.updated',
        entity_type: 'assignment',
        entity_id: after.id,
        actor_user_id: user.id,
        payload: buildUpdatePayload(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          [...EDITABLE_FIELDS],
        ),
      });

      return after;
    },

    async softDelete(id, user) {
      const asg = await repo.findById(id);
      if (!asg) throw new NotFound('Asignación', id);

      const deleted = await repo.softDelete(id);
      if (!deleted) throw new NotFound('Asignación', id);

      // Sync resource request status
      await syncRequestStatus(asg.resource_request_id);

      await events.emit(db, {
        event_type: 'assignment.deleted',
        entity_type: 'assignment',
        entity_id: deleted.id,
        actor_user_id: user.id,
        payload: {
          employee_id: deleted.employee_id,
          contract_id: deleted.contract_id,
          resource_request_id: deleted.resource_request_id,
        },
      });
    },

    async validate(data) {
      return runValidation(data);
    },

    async exportCsv(filters) {
      return repo.exportCsv(filters);
    },
  };
}
