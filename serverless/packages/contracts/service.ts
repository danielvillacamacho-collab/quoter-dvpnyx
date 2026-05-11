import type { Pool, PoolClient } from 'pg';
import type { PaginatedResult, AuthUser, SortParams } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { withTransaction } from '@shared/db/transaction';
import { NotFound, BadRequest, Conflict } from '@shared/errors';
import type {
  Contract, CreateContractDTO, UpdateContractDTO, ContractFilters,
} from './types';
import {
  VALID_TYPES, VALID_CURRENCIES, CONTRACT_STATES, TRANSITIONS, TERMINAL_STATES,
  EDITABLE_FIELDS, normalizeStatus, validateSubtype,
} from './types';
import type { ContractRepository } from './repository';
import type { KickOffService, KickOffResult } from './kick-off.service';

export interface ContractService {
  list(params: { page: number; limit: number; offset: number; filters: ContractFilters; sort: SortParams }): Promise<PaginatedResult<Contract>>;
  getById(id: string): Promise<Contract>;
  create(data: CreateContractDTO, user: AuthUser): Promise<Contract>;
  update(id: string, data: UpdateContractDTO, user: AuthUser): Promise<Contract>;
  softDelete(id: string, user: AuthUser): Promise<void>;
  changeStatus(id: string, newStatusRaw: string, user: AuthUser): Promise<Record<string, unknown>>;
  kickOff(contractId: string, kickOffDate: string, user: AuthUser, force?: boolean): Promise<KickOffResult>;
  createFromQuotation(quotationId: string, body: Record<string, unknown>, user: AuthUser): Promise<Contract>;
  exportCsv(filters: ContractFilters): Promise<Record<string, unknown>[]>;
}

export function createContractService(
  repo: ContractRepository,
  kickOffSvc: KickOffService,
  events: EventEmitter,
  db: Pool,
): ContractService {
  /** Resolve squad_id: explicit -> user's squad -> default "DVPNYX Global" -> auto-create. */
  async function resolveSquadId(explicitId: string | undefined, userId: string): Promise<string> {
    if (explicitId) return explicitId;

    const { rows: uRows } = await db.query(`SELECT squad_id FROM users WHERE id = $1`, [userId]);
    if (uRows[0]?.squad_id) return uRows[0].squad_id;

    const { rows: sRows } = await db.query(
      `SELECT id FROM squads
         WHERE deleted_at IS NULL AND active = true
         ORDER BY (LOWER(name) = LOWER('DVPNYX Global')) DESC, created_at ASC
         LIMIT 1`,
    );
    if (sRows[0]?.id) return sRows[0].id;

    const { rows: createdRows } = await db.query(
      `INSERT INTO squads (name, description, active)
         VALUES ('DVPNYX Global', 'Squad por defecto (auto-creado)', true)
         RETURNING id`,
    );
    if (createdRows[0]?.id) return createdRows[0].id;

    throw new BadRequest('No se pudo resolver el squad por defecto. Contacta al administrador.');
  }

  return {
    async list(params) {
      return repo.findAll(params);
    },

    async getById(id) {
      const contract = await repo.findById(id);
      if (!contract) throw new NotFound('Contrato', id);
      return contract;
    },

    async create(data, user) {
      if (!data.name || !String(data.name).trim()) throw new BadRequest('name es requerido');
      if (!data.client_id) throw new BadRequest('client_id es requerido');
      if (!data.type) throw new BadRequest('type es requerido');
      if (!(VALID_TYPES as readonly string[]).includes(data.type)) {
        throw new BadRequest('type inválido (capacity|project|resell)');
      }
      if (!data.start_date) throw new BadRequest('start_date es requerido');

      const subtypeCheck = validateSubtype(data.type, data.contract_subtype ?? null, { required: true });
      if (!subtypeCheck.ok) throw new BadRequest(subtypeCheck.error);

      /* Referential checks */
      const { rows: cRows } = await db.query(
        `SELECT id, name FROM clients WHERE id=$1 AND deleted_at IS NULL`, [data.client_id],
      );
      if (!cRows.length) throw new BadRequest('Cliente no existe');

      if (data.opportunity_id) {
        const { rows: oRows } = await db.query(
          `SELECT id, client_id FROM opportunities WHERE id=$1 AND deleted_at IS NULL`, [data.opportunity_id],
        );
        if (!oRows.length) throw new BadRequest('Oportunidad no existe');
        if (oRows[0].client_id !== data.client_id) {
          throw new Conflict('La oportunidad no pertenece al cliente indicado');
        }
      }

      if (data.winning_quotation_id) {
        const { rows: qRows } = await db.query(
          `SELECT id, opportunity_id FROM quotations WHERE id=$1`, [data.winning_quotation_id],
        );
        if (!qRows.length) throw new BadRequest('winning_quotation_id no existe');
        if (data.opportunity_id && qRows[0].opportunity_id && qRows[0].opportunity_id !== data.opportunity_id) {
          throw new Conflict('La cotización ganadora no pertenece a la oportunidad indicada');
        }
      }

      if (data.total_value_usd !== undefined) {
        const v = Number(data.total_value_usd);
        if (Number.isNaN(v) || v < 0) throw new BadRequest('total_value_usd debe ser un número >= 0');
      }
      if (data.original_currency !== undefined && !(VALID_CURRENCIES as readonly string[]).includes(data.original_currency)) {
        throw new BadRequest(`original_currency debe ser uno de: ${VALID_CURRENCIES.join(', ')}`);
      }

      const squadId = await resolveSquadId(data.squad_id, user.id);

      const contract = await repo.create(
        {
          ...data,
          name: String(data.name).trim(),
          contract_subtype: subtypeCheck.value,
          account_owner_id: data.account_owner_id || user.id,
          squad_id: squadId,
        },
        user.id,
      );

      await events.emit(db, {
        event_type: 'contract.created',
        entity_type: 'contract',
        entity_id: contract.id,
        actor_user_id: user.id,
        payload: {
          name: contract.name, type: contract.type, contract_subtype: contract.contract_subtype,
          client_id: contract.client_id, opportunity_id: contract.opportunity_id, status: contract.status,
        },
      });

      return contract;
    },

    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Contrato', id);

      if (data.name !== undefined && !String(data.name).trim()) throw new BadRequest('name no puede estar vacío');
      if (data.type && !(VALID_TYPES as readonly string[]).includes(data.type)) {
        throw new BadRequest('type inválido');
      }

      /* Subtype coherence */
      const effectiveType = data.type || before.type;
      const subtypeProvided = Object.prototype.hasOwnProperty.call(data, 'contract_subtype');
      const typeChanged = !!data.type && data.type !== before.type;

      let resolvedSubtype = before.contract_subtype;
      if (subtypeProvided || typeChanged) {
        const candidateSubtype = subtypeProvided
          ? (data.contract_subtype ?? null)
          : (typeChanged ? null : before.contract_subtype);
        const required = typeChanged
          ? effectiveType !== 'resell'
          : (effectiveType === 'capacity' || effectiveType === 'project') &&
            before.contract_subtype != null;
        const check = validateSubtype(effectiveType, candidateSubtype, { required });
        if (!check.ok) throw new BadRequest(check.error);
        resolvedSubtype = check.value;
      }

      /* total_value_usd / original_currency */
      if (data.total_value_usd !== undefined) {
        const v = Number(data.total_value_usd);
        if (Number.isNaN(v) || v < 0) throw new BadRequest('total_value_usd debe ser un número >= 0');
      }
      if (data.original_currency !== undefined && !(VALID_CURRENCIES as readonly string[]).includes(data.original_currency)) {
        throw new BadRequest(`original_currency debe ser uno de: ${VALID_CURRENCIES.join(', ')}`);
      }

      const after = await repo.update(id, {
        ...data,
        name: data.name ? String(data.name).trim() : null,
        contract_subtype: resolvedSubtype,
      });
      if (!after) throw new NotFound('Contrato', id);

      await events.emit(db, {
        event_type: 'contract.updated',
        entity_type: 'contract',
        entity_id: after.id,
        actor_user_id: user.id,
        payload: buildUpdatePayload(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [...EDITABLE_FIELDS]),
      });

      return after;
    },

    async softDelete(id, user) {
      const { active_assignments, open_requests } = await repo.countDependencies(id);
      if (active_assignments > 0 || open_requests > 0) {
        throw new Conflict(
          `Contrato con ${active_assignments} asignación(es) activa(s) y ${open_requests} solicitud(es) abiertas. Complétalo o cancélalo antes de eliminar.`,
          { active_assignments, open_requests },
        );
      }

      const contract = await repo.softDelete(id);
      if (!contract) throw new NotFound('Contrato', id);

      await events.emit(db, {
        event_type: 'contract.deleted',
        entity_type: 'contract',
        entity_id: contract.id,
        actor_user_id: user.id,
        payload: { name: contract.name },
      });
    },

    async changeStatus(id, newStatusRaw, user) {
      const newStatus = normalizeStatus(newStatusRaw);
      if (!(CONTRACT_STATES as readonly string[]).includes(newStatus)) {
        throw new BadRequest('Status inválido');
      }

      return withTransaction(async (conn: PoolClient) => {
        const { rows: [current] } = await conn.query(
          `SELECT * FROM contracts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id],
        );
        if (!current) throw new NotFound('Contrato', id);
        if (current.status === newStatus) throw new BadRequest('El contrato ya está en ese estado');

        const allowed = TRANSITIONS[current.status];
        if (!allowed || !allowed.has(newStatus)) {
          throw new Conflict(
            `Transición inválida: ${current.status} → ${newStatus}`,
            { valid_transitions: Array.from(allowed || []) },
          );
        }

        /* Side effects on terminal transitions */
        let endedAssignments: string[] = [];
        let cancelledAssignments: string[] = [];
        let cancelledRequests: string[] = [];

        if (newStatus === 'completed') {
          const { rows: active } = await conn.query(
            `UPDATE assignments SET status='ended', end_date=COALESCE(end_date, NOW()::date), updated_at=NOW()
               WHERE contract_id=$1 AND status='active' RETURNING id`, [id],
          );
          endedAssignments = active.map((r: Record<string, unknown>) => r.id as string);

          const { rows: plan } = await conn.query(
            `UPDATE assignments SET status='cancelled', updated_at=NOW()
               WHERE contract_id=$1 AND status='planned' RETURNING id`, [id],
          );
          cancelledAssignments = plan.map((r: Record<string, unknown>) => r.id as string);

          const { rows: reqs } = await conn.query(
            `UPDATE resource_requests SET status='cancelled', updated_at=NOW()
               WHERE contract_id=$1 AND status IN ('open','partially_filled') RETURNING id`, [id],
          );
          cancelledRequests = reqs.map((r: Record<string, unknown>) => r.id as string);
        } else if (newStatus === 'cancelled') {
          const { rows: asg } = await conn.query(
            `UPDATE assignments SET status='cancelled', updated_at=NOW()
               WHERE contract_id=$1 AND status IN ('planned','active') RETURNING id`, [id],
          );
          cancelledAssignments = asg.map((r: Record<string, unknown>) => r.id as string);

          const { rows: reqs } = await conn.query(
            `UPDATE resource_requests SET status='cancelled', updated_at=NOW()
               WHERE contract_id=$1 AND status IN ('open','partially_filled') RETURNING id`, [id],
          );
          cancelledRequests = reqs.map((r: Record<string, unknown>) => r.id as string);
        }

        const after = await repo.updateStatus(id, newStatus, conn);

        await events.emit(conn, {
          event_type: 'contract.status_changed',
          entity_type: 'contract',
          entity_id: id,
          actor_user_id: user.id,
          payload: {
            from: current.status, to: newStatus,
            ended_assignments: endedAssignments.length,
            cancelled_assignments: cancelledAssignments.length,
            cancelled_requests: cancelledRequests.length,
          },
        });

        if (TERMINAL_STATES.has(newStatus)) {
          await events.emit(conn, {
            event_type: newStatus === 'completed' ? 'contract.completed' : 'contract.cancelled',
            entity_type: 'contract',
            entity_id: id,
            actor_user_id: user.id,
            payload: {
              ended_assignments: endedAssignments,
              cancelled_assignments: cancelledAssignments,
              cancelled_requests: cancelledRequests,
            },
          });
        }

        return {
          ...after,
          ended_assignments: endedAssignments.length,
          cancelled_assignments: cancelledAssignments.length,
          cancelled_requests: cancelledRequests.length,
        };
      });
    },

    async kickOff(contractId, kickOffDate, user, force) {
      return kickOffSvc.kickOff(contractId, kickOffDate, user, force);
    },

    async createFromQuotation(quotationId, body, user) {
      const q = await repo.getWinningQuotation(quotationId);
      if (!q) throw new NotFound('Cotización', quotationId);

      const clientId = (body.client_id || q.client_id || q.opp_client_id) as string | undefined;
      if (!clientId) {
        throw new BadRequest(
          'La cotización no está vinculada a ningún cliente. Vincula la cotización a un cliente/oportunidad antes de convertir, o pasa client_id en el body.',
        );
      }

      const contractType = (body.type as string) || (q.type === 'fixed_scope' ? 'project' : 'capacity');
      if (!(VALID_TYPES as readonly string[]).includes(contractType)) {
        throw new BadRequest('type inválido (capacity|project|resell)');
      }

      const subtypeCheck = validateSubtype(contractType, (body.contract_subtype as string) ?? null, { required: false });
      if (!subtypeCheck.ok) throw new BadRequest(subtypeCheck.error);

      /* Verify client */
      const { rows: cRows } = await db.query(
        `SELECT id, name FROM clients WHERE id=$1 AND deleted_at IS NULL`, [clientId],
      );
      if (!cRows.length) throw new BadRequest('Cliente no existe');

      const squadId = await resolveSquadId(undefined, user.id);
      const startDate = (body.start_date as string) || new Date().toISOString().slice(0, 10);
      const contractName = (body.name && String(body.name).trim())
        || (q.project_name as string)
        || `Contrato ${String(q.id).slice(0, 8)}`;

      const { rows } = await db.query(
        `INSERT INTO contracts
           (name, client_id, opportunity_id, winning_quotation_id, type, contract_subtype,
            start_date, end_date, account_owner_id, squad_id, created_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, 'planned')
         RETURNING *`,
        [
          contractName, clientId, (q.opportunity_id as string) || null, q.id, contractType,
          subtypeCheck.value, startDate, (body.end_date as string) || null, user.id, squadId,
        ],
      );
      const contract = rows[0];

      await events.emit(db, {
        event_type: 'contract.created_from_quotation',
        entity_type: 'contract',
        entity_id: contract.id,
        actor_user_id: user.id,
        payload: {
          quotation_id: q.id, project_name: q.project_name,
          contract_id: contract.id, contract_name: contract.name, type: contractType,
          contract_subtype: subtypeCheck.value,
        },
      });

      return contract;
    },

    async exportCsv(filters) {
      return repo.findAllForExport(filters);
    },
  };
}
