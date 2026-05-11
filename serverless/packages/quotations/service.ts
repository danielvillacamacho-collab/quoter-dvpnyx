import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser, SortParams } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { NotFound, BadRequest, Conflict } from '@shared/errors';
import { withTransaction } from '@shared/db/transaction';
import type {
  Quotation, CreateQuotationDTO, UpdateQuotationDTO, QuotationFilters,
} from './types';
import { VALID_TYPES, VALID_STATUSES } from './types';
import type { QuotationRepository } from './repository';
import { recalcStaffAugLines, detectLineDrift } from './calc';
import type { CalcParams } from './calc';

export interface QuotationService {
  list(params: {
    page: number; limit: number; offset: number;
    filters: QuotationFilters; sort: SortParams;
  }): Promise<PaginatedResult<Quotation>>;

  getById(id: string): Promise<Quotation>;
  create(data: CreateQuotationDTO, user: AuthUser): Promise<Quotation>;
  update(id: string, data: UpdateQuotationDTO, user: AuthUser): Promise<Quotation & { drift?: unknown }>;
  softDelete(id: string, user: AuthUser): Promise<void>;
  clone(id: string, user: AuthUser): Promise<Quotation>;
}

export function createQuotationService(
  repo: QuotationRepository,
  events: EventEmitter,
  db: Pool,
): QuotationService {
  return {
    /* ---------------------------------------------------------------- */
    /*  LIST                                                             */
    /* ---------------------------------------------------------------- */
    async list(params) {
      return repo.findAll(params);
    },

    /* ---------------------------------------------------------------- */
    /*  GET BY ID                                                        */
    /* ---------------------------------------------------------------- */
    async getById(id) {
      const quot = await repo.findById(id);
      if (!quot) throw new NotFound('Cotización', id);
      return quot;
    },

    /* ---------------------------------------------------------------- */
    /*  CREATE                                                           */
    /* ---------------------------------------------------------------- */
    async create(data, user) {
      if (!data.type || !(VALID_TYPES as readonly string[]).includes(data.type)) {
        throw new BadRequest('Tipo inválido — use staff_aug o fixed_scope');
      }
      if (!data.project_name?.trim()) {
        throw new BadRequest('project_name es requerido');
      }
      if (!data.client_id) throw new BadRequest('client_id es requerido');
      if (!data.opportunity_id) throw new BadRequest('opportunity_id es requerido');

      const quot = await withTransaction(async (conn) => {
        // Validate client exists
        const { rows: cRows } = await conn.query(
          'SELECT id, name FROM clients WHERE id=$1 AND deleted_at IS NULL',
          [data.client_id],
        );
        if (!cRows.length) throw new BadRequest('Cliente no existe o está eliminado');

        // Validate opportunity exists and belongs to client
        const { rows: oRows } = await conn.query(
          'SELECT id, name, client_id FROM opportunities WHERE id=$1 AND deleted_at IS NULL',
          [data.opportunity_id],
        );
        if (!oRows.length) throw new BadRequest('Oportunidad no existe o está eliminada');
        if (oRows[0].client_id !== data.client_id) {
          throw new Conflict('La oportunidad no pertenece al cliente indicado', {
            opportunity_client_id: oRows[0].client_id,
          });
        }

        const created = await repo.create(
          {
            ...data,
            project_name: data.project_name.trim(),
            client_name: data.client_name || cRows[0].name,
          },
          {
            lines: data.lines,
            phases: data.phases,
            epics: data.epics,
            milestones: data.milestones,
          },
          user.id,
          conn,
        );

        await events.emit(conn, {
          event_type: 'quotation.created',
          entity_type: 'quotation',
          entity_id: created.id,
          actor_user_id: user.id,
          payload: {
            type: data.type, project_name: data.project_name,
            client_id: data.client_id, opportunity_id: data.opportunity_id,
            status: created.status,
          },
        });

        return created;
      });

      return quot;
    },

    /* ---------------------------------------------------------------- */
    /*  UPDATE                                                           */
    /* ---------------------------------------------------------------- */
    async update(id, data, user) {
      if (data.status && !(VALID_STATUSES as readonly string[]).includes(data.status)) {
        throw new BadRequest('Estado inválido');
      }

      const result = await withTransaction(async (conn) => {
        // Load current state
        const { rows: [before] } = await conn.query(
          'SELECT id, type, status, parameters_snapshot FROM quotations WHERE id=$1 AND deleted_at IS NULL',
          [id],
        );
        if (!before) throw new NotFound('Cotización', id);

        const effectiveStatus = data.status ?? before.status;
        const isFirstLeavingDraft = before.status === 'draft'
          && (effectiveStatus === 'sent' || effectiveStatus === 'approved')
          && !before.parameters_snapshot;

        // Resolve calculation parameters
        let paramsForCalc: CalcParams | null = null;
        let capturedSnapshot: CalcParams | null = null;

        if (before.parameters_snapshot) {
          paramsForCalc = before.parameters_snapshot;
        } else if (isFirstLeavingDraft || (data.lines && before.type === 'staff_aug')) {
          paramsForCalc = await repo.loadParameters(conn) as CalcParams;
          if (isFirstLeavingDraft) capturedSnapshot = paramsForCalc;
        }

        // Server-side recalculation for staff_aug lines
        let canonicalLines = data.lines;
        let driftReport = null;

        if (data.lines && before.type === 'staff_aug' && paramsForCalc) {
          canonicalLines = recalcStaffAugLines(data.lines, paramsForCalc);
          driftReport = detectLineDrift(data.lines, canonicalLines, 0.01);

          if (driftReport.drifted) {
            await events.emit(conn, {
              event_type: 'quotation.calc_drift',
              entity_type: 'quotation',
              entity_id: id,
              actor_user_id: user.id,
              payload: {
                diffs: driftReport.diffs.slice(0, 20),
                total_drifted_fields: driftReport.diffs.length,
                used_snapshot: !!before.parameters_snapshot,
              },
            });
          }
        }

        const updatePayload: Record<string, unknown> = {
          project_name: data.project_name,
          client_name: data.client_name,
          commercial_name: data.commercial_name,
          preventa_name: data.preventa_name,
          status: data.status,
          discount_pct: data.discount_pct,
          notes: data.notes,
          metadata: data.metadata,
          parameters_snapshot: capturedSnapshot,
        };

        const quot = await repo.update(
          id,
          updatePayload,
          {
            lines: canonicalLines,
            phases: data.phases,
            epics: data.epics,
            milestones: data.milestones,
            allocation: data.metadata?.allocation as Record<string, Record<string, number>> | undefined,
          },
          conn,
        );
        if (!quot) throw new NotFound('Cotización', id);

        if (capturedSnapshot) {
          await events.emit(conn, {
            event_type: 'quotation.snapshot_captured',
            entity_type: 'quotation',
            entity_id: quot.id,
            actor_user_id: user.id,
            payload: { trigger_status: effectiveStatus, previous_status: before.status },
          });
        }

        await events.emit(conn, {
          event_type: 'quotation.updated',
          entity_type: 'quotation',
          entity_id: quot.id,
          actor_user_id: user.id,
          payload: { status: quot.status, project_name: quot.project_name },
        });

        return {
          ...quot,
          lines: canonicalLines,
          drift: driftReport,
        };
      });

      return result;
    },

    /* ---------------------------------------------------------------- */
    /*  SOFT DELETE                                                       */
    /* ---------------------------------------------------------------- */
    async softDelete(id, user) {
      const quot = await repo.softDelete(id);
      if (!quot) throw new NotFound('Cotización', id);

      await events.emit(db, {
        event_type: 'quotation.deleted',
        entity_type: 'quotation',
        entity_id: quot.id,
        actor_user_id: user.id,
        payload: { project_name: quot.project_name },
      });
    },

    /* ---------------------------------------------------------------- */
    /*  CLONE                                                            */
    /* ---------------------------------------------------------------- */
    async clone(id, user) {
      const cloned = await withTransaction(async (conn) => {
        const newq = await repo.clone(id, user.id, conn);
        if (!newq) throw new NotFound('Cotización', id);

        await events.emit(conn, {
          event_type: 'quotation.cloned',
          entity_type: 'quotation',
          entity_id: newq.id,
          actor_user_id: user.id,
          payload: { source_id: id, project_name: newq.project_name },
        });

        return newq;
      });

      return cloned;
    },
  };
}
