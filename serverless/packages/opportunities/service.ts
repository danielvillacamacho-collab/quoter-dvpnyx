import type { Pool, PoolClient } from 'pg';
import type { PaginatedResult, AuthUser, SortParams } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { buildUpdatePayload } from '@shared/events/emitter';
import { NotFound, BadRequest, Conflict, Forbidden } from '@shared/errors';
import type {
  Opportunity, CreateOpportunityDTO, UpdateOpportunityDTO,
  ChangeStatusDTO, OpportunityFilters, KanbanResult,
} from './types';
import {
  VALID_STAGES, VALID_DEAL_TYPES, VALID_CONTRACT_TYPES,
  EDITABLE_FIELDS, STAGE_ORDER, TERMINAL_STAGES,
  isTerminal, isPostponed, isValidTransition, validNextStages,
  computeBooking, validateRevenueModel, validateFunding, validateLossReason,
  computeMargin, validateMarginInput,
  VALID_OUTCOME_REASONS, MARGIN_LOW_THRESHOLD,
  checkExitCriteria,
} from './types';
import type { OpportunityRepository } from './repository';

/* ------------------------------------------------------------------ */
/*  Service interface                                                  */
/* ------------------------------------------------------------------ */

export interface OpportunityService {
  list(params: {
    page: number; limit: number; offset: number;
    filters: OpportunityFilters; sort: SortParams; user: AuthUser;
  }): Promise<PaginatedResult<Opportunity>>;

  getById(id: string): Promise<Opportunity>;

  create(data: CreateOpportunityDTO, user: AuthUser): Promise<Opportunity>;

  update(id: string, data: UpdateOpportunityDTO, user: AuthUser): Promise<Opportunity>;

  softDelete(id: string, user: AuthUser): Promise<void>;

  changeStatus(id: string, data: ChangeStatusDTO, user: AuthUser): Promise<Opportunity & { warnings?: { code: string; message: string }[] }>;

  checkMargin(id: string, estimatedCostUsd: number | null | undefined, user: AuthUser): Promise<{
    margin_pct: number | null;
    estimated_cost_usd: number;
    booking_amount_usd: number;
    alert_fired: boolean;
  }>;

  kanban(params: { filters: OpportunityFilters; user: AuthUser }): Promise<KanbanResult>;

  lookup(params: { search?: string; client_id?: string; user: AuthUser }): Promise<{ id: string; name: string; client_name: string; status: string }[]>;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createOpportunityService(
  repo: OpportunityRepository,
  events: EventEmitter,
  db: Pool,
): OpportunityService {

  /** Resolve squad_id: body -> user -> default "DVPNYX Global" -> auto-create */
  async function resolveSquadId(squadIdBody: string | undefined, ownerId: string): Promise<string> {
    if (squadIdBody) return squadIdBody;

    // User's squad
    const { rows: userRows } = await db.query(
      `SELECT squad_id FROM users WHERE id=$1`, [ownerId],
    );
    if (userRows[0]?.squad_id) return userRows[0].squad_id;

    // Default squad
    const { rows: sRows } = await db.query(
      `SELECT id FROM squads
       WHERE deleted_at IS NULL AND active = true
       ORDER BY (LOWER(name) = LOWER('DVPNYX Global')) DESC, created_at ASC
       LIMIT 1`,
    );
    if (sRows[0]?.id) return sRows[0].id;

    // Auto-create
    const { rows: created } = await db.query(
      `INSERT INTO squads (name, description, active)
       VALUES ('DVPNYX Global', 'Squad por defecto (auto-creado)', true)
       RETURNING id`,
    );
    if (created[0]?.id) return created[0].id;

    throw new BadRequest('No se pudo resolver el squad por defecto. Contacta al administrador.');
  }

  /** Resolve country from override or client record */
  async function resolveCountry(countryOverride: string | undefined, clientId: string): Promise<string | null> {
    if (countryOverride) return countryOverride;
    const { rows } = await db.query(
      `SELECT country FROM clients WHERE id=$1 AND deleted_at IS NULL`, [clientId],
    );
    return rows[0]?.country || null;
  }

  return {
    /* ---- LIST ---- */
    async list(params) {
      return repo.findAll(params);
    },

    /* ---- GET BY ID ---- */
    async getById(id) {
      const opp = await repo.findById(id);
      if (!opp) throw new NotFound('Oportunidad', id);

      // Enrich with client nested object + quotations
      const row = opp as Record<string, unknown>;
      const client = row.client__id ? {
        id: row.client__id, name: row.client__name,
        country: row.client__country, tier: row.client__tier,
      } : null;
      delete row.client__id;
      delete row.client__name;
      delete row.client__country;
      delete row.client__tier;

      // Fetch related quotations
      const { rows: quotations } = await db.query(
        `SELECT q.id, q.project_name, q.type, q.status, q.created_at,
                GREATEST(
                  COALESCE((SELECT SUM(total) FROM quotation_lines WHERE quotation_id=q.id), 0),
                  COALESCE((SELECT SUM(amount) FROM quotation_milestones WHERE quotation_id=q.id AND deleted_at IS NULL), 0)
                )::numeric AS total_usd
         FROM quotations q WHERE q.opportunity_id=$1 ORDER BY q.created_at DESC`,
        [id],
      );

      return { ...opp, client, quotations } as Opportunity;
    },

    /* ---- CREATE ---- */
    async create(data, user) {
      if (!data.client_id) throw new BadRequest('client_id es requerido');
      if (!data.name || !String(data.name).trim()) throw new BadRequest('El nombre es requerido');

      // Validate client exists
      const { rows: clientRows } = await db.query(
        `SELECT id, active, country FROM clients WHERE id=$1 AND deleted_at IS NULL`,
        [data.client_id],
      );
      if (!clientRows.length) throw new BadRequest('Cliente no existe o está eliminado');

      // Revenue model normalization
      const revenue_type = data.revenue_type || 'one_time';
      let one_time_amount_usd = data.one_time_amount_usd ?? null;
      if (revenue_type === 'one_time' && one_time_amount_usd == null && !data.revenue_type) {
        one_time_amount_usd = data.booking_amount_usd ?? 0;
      }
      const funding_source = (data.funding_source as string) || 'client_direct';

      // Validate revenue model
      const revenueErr = validateRevenueModel({
        revenue_type,
        one_time_amount_usd,
        mrr_usd: data.mrr_usd ?? null,
        contract_length_months: data.contract_length_months ?? null,
      });
      if (revenueErr) throw new BadRequest(revenueErr);

      // Validate funding
      const fundingErr = validateFunding({
        funding_source,
        funding_amount_usd: data.funding_amount_usd ?? null,
      });
      if (fundingErr) throw new BadRequest(fundingErr);

      // Validate deal_type
      const deal_type = data.deal_type || 'new_business';
      if (!(VALID_DEAL_TYPES as readonly string[]).includes(deal_type)) {
        throw new BadRequest(`deal_type inválido: ${deal_type}`);
      }

      // Validate contract_type
      const contract_type = data.contract_type || null;
      if (contract_type && !(VALID_CONTRACT_TYPES as readonly string[]).includes(contract_type)) {
        throw new BadRequest(`contract_type inválido: ${contract_type}`);
      }

      const oppCountry = await resolveCountry(data.country, data.client_id);
      const ownerId = data.account_owner_id || user.id;
      const squadId = await resolveSquadId(data.squad_id, ownerId);
      const oppNumber = await repo.generateOpportunityNumber(oppCountry);

      const computedBooking = computeBooking({
        revenue_type,
        one_time_amount_usd,
        mrr_usd: data.mrr_usd ?? null,
        contract_length_months: data.contract_length_months ?? null,
      });

      const opp = await repo.create({
        client_id: data.client_id,
        name: String(data.name).trim(),
        description: data.description,
        account_owner_id: ownerId,
        presales_lead_id: data.presales_lead_id,
        squad_id: squadId,
        expected_close_date: data.expected_close_date,
        tags: data.tags,
        external_crm_id: data.external_crm_id,
        country: oppCountry,
        opportunity_number: oppNumber,
        revenue_type,
        one_time_amount_usd,
        mrr_usd: data.mrr_usd,
        contract_length_months: data.contract_length_months,
        champion_identified: data.champion_identified,
        economic_buyer_identified: data.economic_buyer_identified,
        funding_source,
        funding_amount_usd: data.funding_amount_usd,
        drive_url: data.drive_url,
        booking_amount_usd: computedBooking,
        deal_type,
        co_owner_id: data.co_owner_id,
        contract_type,
        context_client: data.context_client,
        context_scope: data.context_scope,
        context_pains: data.context_pains,
        context_requirements: data.context_requirements,
        context_politics: data.context_politics,
      }, user.id);

      await events.emit(db, {
        event_type: 'opportunity.created',
        entity_type: 'opportunity',
        entity_id: opp.id,
        actor_user_id: user.id,
        payload: {
          name: opp.name,
          client_id: opp.client_id,
          status: opp.status,
          opportunity_number: opp.opportunity_number,
        },
      });

      return opp;
    },

    /* ---- UPDATE ---- */
    async update(id, data, user) {
      const before = await repo.findById(id);
      if (!before) throw new NotFound('Oportunidad', id);

      if (data.name !== undefined && !String(data.name).trim()) {
        throw new BadRequest('El nombre no puede estar vacío');
      }

      // Validate revenue model changes (partial PATCH against existing)
      if (data.revenue_type != null
        || data.one_time_amount_usd !== undefined
        || data.mrr_usd !== undefined
        || data.contract_length_months !== undefined) {
        const merged = {
          revenue_type: data.revenue_type ?? before.revenue_type,
          one_time_amount_usd: data.one_time_amount_usd !== undefined ? data.one_time_amount_usd : before.one_time_amount_usd,
          mrr_usd: data.mrr_usd !== undefined ? data.mrr_usd : before.mrr_usd,
          contract_length_months: data.contract_length_months !== undefined
            ? data.contract_length_months : before.contract_length_months,
        };
        const revenueErr = validateRevenueModel(merged);
        if (revenueErr) throw new BadRequest(revenueErr);
      }

      // Validate funding changes
      if (data.funding_source != null || data.funding_amount_usd !== undefined) {
        const merged = {
          funding_source: data.funding_source ?? before.funding_source,
          funding_amount_usd: data.funding_amount_usd !== undefined ? data.funding_amount_usd : before.funding_amount_usd,
        };
        const fundingErr = validateFunding(merged);
        if (fundingErr) throw new BadRequest(fundingErr);
      }

      const after = await repo.update(id, data as Record<string, unknown>);
      if (!after) throw new NotFound('Oportunidad', id);

      await events.emit(db, {
        event_type: 'opportunity.updated',
        entity_type: 'opportunity',
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

    /* ---- SOFT DELETE ---- */
    async softDelete(id, user) {
      const quotCount = await repo.countQuotations(id);
      if (quotCount > 0) {
        throw new Conflict(
          `Esta oportunidad tiene ${quotCount} cotización(es). No puede eliminarse; cancélala si ya no aplica.`,
        );
      }

      const opp = await repo.softDelete(id);
      if (!opp) throw new NotFound('Oportunidad', id);

      await events.emit(db, {
        event_type: 'opportunity.deleted',
        entity_type: 'opportunity',
        entity_id: opp.id,
        actor_user_id: user.id,
        payload: { name: opp.name },
      });
    },

    /* ---- CHANGE STATUS (stage transitions with side effects) ---- */
    async changeStatus(id, data, user) {
      const newStatus = data.new_status;
      if (!(VALID_STAGES as readonly string[]).includes(newStatus)) {
        throw new BadRequest('Status inválido');
      }

      const conn = await db.connect();
      try {
        await conn.query('BEGIN');

        const current = await repo.findByIdForUpdate(id, conn);
        if (!current) {
          await conn.query('ROLLBACK');
          throw new NotFound('Oportunidad', id);
        }

        if (current.status === newStatus) {
          await conn.query('ROLLBACK');
          throw new BadRequest('La oportunidad ya está en ese estado');
        }

        if (!isValidTransition(current.status, newStatus)) {
          await conn.query('ROLLBACK');
          throw new Conflict(
            `Transición inválida: ${current.status} → ${newStatus}`,
            { valid_transitions: validNextStages(current.status) as unknown as Record<string, unknown> },
          );
        }

        // Exit criteria (soft validation on forward transitions)
        const canOverride = ['superadmin', 'admin'].includes(user.role);
        const overrideRequested = data.override_exit_criteria === true;
        const isForward = (STAGE_ORDER[newStatus] || 0) > (STAGE_ORDER[current.status] || 0);
        if (isForward && !isTerminal(newStatus) && !isPostponed(newStatus)
            && !(canOverride && overrideRequested)) {
          const exitGaps = checkExitCriteria(
            current as unknown as Record<string, unknown>,
            STAGE_ORDER[newStatus] || 0,
          );
          if (exitGaps.length > 0) {
            await conn.query('ROLLBACK');
            throw new BadRequest(
              JSON.stringify({
                error: 'Exit criteria no cumplidos para avanzar a esta etapa',
                exit_criteria_missing: exitGaps,
                can_override: canOverride,
              }),
            );
          }
        }

        // Stage-specific validations
        if (newStatus === 'closed_won' && !data.winning_quotation_id) {
          await conn.query('ROLLBACK');
          throw new BadRequest('winning_quotation_id es requerido al marcar ganada');
        }

        if (newStatus === 'closed_lost') {
          if (data.loss_reason != null) {
            const lossErr = validateLossReason({
              loss_reason: data.loss_reason,
              loss_reason_detail: data.loss_reason_detail,
            });
            if (lossErr) {
              await conn.query('ROLLBACK');
              throw new BadRequest(lossErr);
            }
          } else if (!data.outcome_reason
            || !(VALID_OUTCOME_REASONS as readonly string[]).includes(data.outcome_reason)) {
            await conn.query('ROLLBACK');
            throw new BadRequest('outcome_reason o loss_reason es requerido');
          }
        }

        if (newStatus === 'postponed') {
          if (!data.postponed_until_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.postponed_until_date))) {
            await conn.query('ROLLBACK');
            throw new BadRequest('postponed_until_date es requerido (formato YYYY-MM-DD) al postergar la oportunidad');
          }
          const today = new Date().toISOString().slice(0, 10);
          if (data.postponed_until_date <= today) {
            await conn.query('ROLLBACK');
            throw new BadRequest('postponed_until_date debe ser una fecha futura');
          }
        }

        // Side effects
        let quotationSideEffects: Record<string, unknown> | null = null;

        if (newStatus === 'closed_won') {
          const winning = await repo.findWinningQuotation(data.winning_quotation_id!, id, conn);
          if (!winning) {
            await conn.query('ROLLBACK');
            throw new BadRequest('winning_quotation_id no pertenece a esta oportunidad');
          }

          if (winning.status === 'sent') {
            await repo.promoteQuotation(winning.id as string, conn);
            quotationSideEffects = { promoted_to_approved: winning.id };
          }

          // Auto-create contract if none exists
          const existing = await repo.existingContract(id, conn);
          if (!existing) {
            const { rows: totalRow } = await conn.query(
              `SELECT COALESCE(SUM(total), 0)::numeric AS total
               FROM quotation_lines WHERE quotation_id=$1`,
              [winning.id],
            );
            const totalValueUsd = Number(totalRow[0].total || 0);
            const contractType = current.contract_type
              || (winning.type === 'fixed_scope' ? 'project' : 'capacity');
            const startDate = current.expected_close_date || new Date().toISOString().slice(0, 10);

            const contract = await repo.createContract({
              name: (winning.project_name as string) || current.name,
              client_id: current.client_id,
              opportunity_id: current.id,
              winning_quotation_id: winning.id,
              type: contractType,
              start_date: startDate,
              account_owner_id: current.account_owner_id,
              squad_id: current.squad_id,
              total_value_usd: totalValueUsd,
              original_currency: (winning.currency as string) || 'USD',
              created_by: user.id,
              metadata: { source_system: 'opportunity_won', auto_generated: true },
            }, conn);
            quotationSideEffects = {
              ...(quotationSideEffects || {}),
              contract_created: contract,
            };
          }
        }

        if (newStatus === 'closed_lost') {
          const rejectedIds = await repo.rejectSentQuotations(id, conn);
          quotationSideEffects = { rejected: rejectedIds };
        }

        // Compute update params
        const closingNow = TERMINAL_STAGES.has(newStatus as any);
        const outcomeValue = newStatus === 'closed_won' ? 'won'
          : newStatus === 'closed_lost' ? 'lost'
          : null;
        const clearPostponedFields = current.status === 'postponed' && newStatus !== 'postponed';

        const after = await repo.updateStatus(id, {
          new_status: newStatus,
          outcome_value: outcomeValue,
          outcome_reason: data.outcome_reason,
          outcome_notes: data.outcome_notes,
          winning_quotation_id: newStatus === 'closed_won' ? data.winning_quotation_id : null,
          closing_now: closingNow,
          clear_postponed: clearPostponedFields,
          postponed_until_date: newStatus === 'postponed' ? data.postponed_until_date : null,
          postponed_reason: newStatus === 'postponed' ? data.postponed_reason : null,
          loss_reason: newStatus === 'closed_lost' && data.loss_reason ? data.loss_reason : null,
          loss_reason_detail: newStatus === 'closed_lost' && data.loss_reason_detail
            ? String(data.loss_reason_detail).trim() : null,
        }, conn);

        if (!after) {
          await conn.query('ROLLBACK');
          throw new NotFound('Oportunidad', id);
        }

        // Emit events
        await events.emit(conn, {
          event_type: 'opportunity.status_changed',
          entity_type: 'opportunity',
          entity_id: after.id,
          actor_user_id: user.id,
          payload: { from: current.status, to: newStatus, side_effects: quotationSideEffects },
        });

        if (newStatus === 'closed_won') {
          await events.emit(conn, {
            event_type: 'opportunity.won',
            entity_type: 'opportunity',
            entity_id: after.id,
            actor_user_id: user.id,
            payload: { winning_quotation_id: data.winning_quotation_id },
          });
        } else if (newStatus === 'closed_lost') {
          await events.emit(conn, {
            event_type: 'opportunity.lost',
            entity_type: 'opportunity',
            entity_id: after.id,
            actor_user_id: user.id,
            payload: {
              reason: data.outcome_reason || data.loss_reason || null,
              notes: data.outcome_notes || null,
              loss_reason: data.loss_reason || null,
              loss_reason_detail: data.loss_reason_detail
                ? String(data.loss_reason_detail).trim() : null,
            },
          });
        } else if (newStatus === 'postponed') {
          await events.emit(conn, {
            event_type: 'opportunity.postponed',
            entity_type: 'opportunity',
            entity_id: after.id,
            actor_user_id: user.id,
            payload: {
              until_date: data.postponed_until_date,
              reason: data.postponed_reason || null,
              previous_status: current.status,
            },
          });
        } else if (current.status === 'postponed') {
          await events.emit(conn, {
            event_type: 'opportunity.reactivated',
            entity_type: 'opportunity',
            entity_id: after.id,
            actor_user_id: user.id,
            payload: {
              to: newStatus,
              was_postponed_until: current.postponed_until_date || null,
            },
          });
        }

        // Soft warnings
        const warnings: { code: string; message: string }[] = [];
        const fromOrder = STAGE_ORDER[current.status] || 0;
        const toOrder = STAGE_ORDER[newStatus] || 0;
        if (fromOrder > 0 && toOrder > 0 && fromOrder > toOrder
            && !isTerminal(newStatus) && !isPostponed(newStatus) && current.status !== 'postponed') {
          warnings.push({ code: 'backwards', message: `Movida hacia atrás: ${current.status} → ${newStatus}.` });
        }
        if (Number(after.booking_amount_usd || 0) === 0
            && ['proposal_validated', 'negotiation', 'verbal_commit', 'closed_won'].includes(newStatus)) {
          warnings.push({ code: 'amount_zero', message: 'El monto USD está en 0. Recomendado actualizarlo.' });
        }
        if (after.margin_pct != null
            && Number(after.margin_pct) < MARGIN_LOW_THRESHOLD
            && ['proposal_validated', 'negotiation', 'verbal_commit', 'closed_won'].includes(newStatus)) {
          warnings.push({
            code: 'a4_margin_low',
            message: `Alerta A4: margen de ${after.margin_pct}% está por debajo del umbral mínimo (${MARGIN_LOW_THRESHOLD}%). Revisa la cotización antes de avanzar.`,
          });
        }

        await conn.query('COMMIT');

        return { ...after, warnings };
      } catch (err) {
        await conn.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },

    /* ---- CHECK MARGIN ---- */
    async checkMargin(id, estimatedCostInput, user) {
      const inputErr = validateMarginInput({ estimated_cost_usd: estimatedCostInput });
      if (inputErr) throw new BadRequest(inputErr);

      const { rows: [opp] } = await db.query(
        `SELECT id, booking_amount_usd FROM opportunities WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      );
      if (!opp) throw new NotFound('Oportunidad', id);

      const booking = Number(opp.booking_amount_usd || 0);
      if (booking <= 0) {
        throw new BadRequest('booking_amount_usd debe ser > 0 para calcular margen. Actualiza el revenue model primero.');
      }

      let estimatedCost: number;
      if (estimatedCostInput != null) {
        estimatedCost = Number(estimatedCostInput);
      } else {
        estimatedCost = await repo.autoComputeCost(id);
      }

      const marginPct = computeMargin({ booking_amount_usd: booking, estimated_cost_usd: estimatedCost });

      const { rows: [updated] } = await db.query(
        `UPDATE opportunities
            SET estimated_cost_usd = $1,
                margin_pct         = $2,
                updated_at         = NOW()
          WHERE id=$3 AND deleted_at IS NULL
          RETURNING id, booking_amount_usd, estimated_cost_usd, margin_pct`,
        [estimatedCost, marginPct, id],
      );

      const alertFired = marginPct != null && marginPct < MARGIN_LOW_THRESHOLD;
      if (alertFired) {
        await events.emit(db, {
          event_type: 'opportunity.margin_low',
          entity_type: 'opportunity',
          entity_id: opp.id,
          actor_user_id: user.id,
          payload: {
            margin_pct: marginPct,
            booking_amount_usd: booking,
            estimated_cost_usd: estimatedCost,
            threshold: MARGIN_LOW_THRESHOLD,
          },
        });
      }

      return {
        margin_pct: updated.margin_pct,
        estimated_cost_usd: updated.estimated_cost_usd,
        booking_amount_usd: updated.booking_amount_usd,
        alert_fired: alertFired,
      };
    },

    /* ---- KANBAN ---- */
    async kanban(params) {
      return repo.kanban(params);
    },

    /* ---- LOOKUP ---- */
    async lookup(params) {
      return repo.lookup(params);
    },
  };
}
