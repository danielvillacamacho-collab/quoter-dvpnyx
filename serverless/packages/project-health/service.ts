import type { Pool, PoolClient } from 'pg';
import type { AuthUser } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { NotFound, BadRequest, Conflict } from '@shared/errors';
import { withTransaction } from '@shared/db/transaction';
import type { ProjectHealthRepository } from './repository';
import type {
  Baseline, WbsPackage, StatusReport, HealthKpis, HealthBadge,
  CostForecast, PortfolioProject,
  CreateBaselineDTO, RebaseDTO, SubmitStatusReportDTO,
} from './types';
import * as evm from './evm-engine';

export interface ProjectHealthService {
  getBaseline(contractId: string): Promise<{ baseline: Baseline; wbs: WbsPackage[] }>;
  createBaseline(contractId: string, data: CreateBaselineDTO, user: AuthUser): Promise<{ baseline: Baseline; wbs: WbsPackage[] }>;
  rebase(contractId: string, data: RebaseDTO, user: AuthUser): Promise<{ baseline: Baseline }>;
  submitStatusReport(contractId: string, data: SubmitStatusReportDTO, user: AuthUser): Promise<{
    report: StatusReport;
    computed_kpis: HealthKpis;
    health: HealthBadge;
    revenue_synced: { yyyymm: string; real_pct: number };
  }>;
  listStatusReports(contractId: string): Promise<StatusReport[]>;
  getHealth(contractId: string): Promise<Record<string, unknown>>;
  getCostForecast(contractId: string): Promise<CostForecast>;
  portfolioHealth(): Promise<{ projects: PortfolioProject[]; count: number }>;
  backfillRevenue(contractId: string, user: AuthUser): Promise<{ synced_count: number; details: unknown[] }>;
  backfillBacCost(contractId: string, user: AuthUser): Promise<Record<string, unknown>>;
  closeout(contractId: string, narrative: string | null, user: AuthUser): Promise<{ status: string; contract_id: string }>;
  getBaselinePreview(contractId: string): Promise<Record<string, unknown>>;
}

/* ── helpers ── */

function requireFixedScope(contract: Record<string, unknown>): void {
  if (contract.contract_subtype !== 'fixed_scope') {
    throw new BadRequest('Solo contratos fixed_scope soportan Project Health (EVM)');
  }
}

/**
 * Derive BAC Cost from a quotation (allocation matrix or V1 formula).
 * Mirrors server/routes/project_health.js computeQuotationCost.
 */
async function computeQuotationCost(
  repo: ProjectHealthRepository,
  quotationId: string,
  client?: PoolClient,
): Promise<{ totalCost: number; costProtected: number }> {
  const quot = await repo.loadQuotation(quotationId, client);
  if (!quot) return { totalCost: 0, costProtected: 0 };

  // Load parameters
  let params = quot.parameters_snapshot as Record<string, { key: string; value: number }[]> | null;
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { params = null; }
  }
  if (!params) {
    params = await repo.loadParameters(client);
  }

  const quotType = quot.type as string;

  if (quotType === 'project' || quotType === 'fixed_scope') {
    const lines = await repo.loadQuotationLines(quotationId, client);
    const phases = await repo.loadQuotationPhases(quotationId, client);

    // Enrich lines: recalculate cost_hour from params if 0
    // NOTE: calc module is server-only; we replicate the essential logic here.
    // In a full implementation, the calc module would be extracted to shared.
    // For now, we trust cost_hour values in DB.

    // Build allocation entries: relational first, then metadata JSONB
    let allocEntries: { lineIdx: number; phaseIdx: number; weeklyHours: number }[] = [];

    const relAllocs = await repo.loadQuotationAllocations(quotationId, client);
    if (relAllocs.length > 0) {
      allocEntries = relAllocs.map((r: Record<string, unknown>) => ({
        lineIdx: Number(r.line_sort_order),
        phaseIdx: Number(r.phase_sort),
        weeklyHours: Number(r.weekly_hours || 0),
      }));
    }

    // Fallback: metadata.allocation JSONB
    if (allocEntries.length === 0) {
      const meta = typeof quot.metadata === 'string'
        ? JSON.parse(quot.metadata as string)
        : (quot.metadata || {});
      const alloc = (meta as Record<string, unknown>).allocation;
      if (alloc && typeof alloc === 'object') {
        for (const [lineIdxStr, phaseMap] of Object.entries(alloc as Record<string, unknown>)) {
          if (!phaseMap || typeof phaseMap !== 'object') continue;
          for (const [phaseIdxStr, hoursRaw] of Object.entries(phaseMap as Record<string, unknown>)) {
            const hrs = Number(hoursRaw || 0);
            if (hrs > 0) {
              allocEntries.push({
                lineIdx: Number(lineIdxStr),
                phaseIdx: Number(phaseIdxStr),
                weeklyHours: hrs,
              });
            }
          }
        }
      }
    }

    // Compute totalCost from allocation: weeklyHours x weeks x cost_hour
    let totalCost = 0;
    for (const entry of allocEntries) {
      const line = lines.find((l: Record<string, unknown>) => l.sort_order === entry.lineIdx);
      const phase = phases.find((p: Record<string, unknown>) => p.sort_order === entry.phaseIdx);
      if (!line || !phase) continue;
      totalCost += entry.weeklyHours * Number(phase.weeks || 0) * Number(line.cost_hour || 0);
    }

    // Fallback: V1 staff-aug formula
    if (totalCost <= 0) {
      for (const line of lines) {
        totalCost += Number(line.cost_hour || 0) * Number(line.hours_per_week || 0) * 4.333
          * Number(line.duration_months || 1) * Number(line.quantity || 1);
      }
    }

    // NOTE: In the monolith, calc.calcProjectFinancials applies buffer + warranty.
    // Here we return totalCost as costProtected since the calc module is not yet shared.
    // This matches the backfill path behavior.
    return { totalCost, costProtected: totalCost };
  }

  // Staff-aug: V1 formula
  const lines = await repo.loadQuotationLines(quotationId, client);
  let totalCost = 0;
  for (const line of lines) {
    totalCost += Number(line.cost_hour || 0) * Number(line.hours_per_week || 0) * 4.333
      * Number(line.duration_months || 1) * Number(line.quantity || 1);
  }
  return { totalCost, costProtected: totalCost };
}

/**
 * Sync EVM progress -> revenue_periods (delta model).
 */
async function syncRevenueFromProgress(
  repo: ProjectHealthRepository,
  contractId: string,
  yyyymm: string,
  realPct: number,
  totalValueUsd: number,
  userId: string,
  client: PoolClient,
): Promise<void> {
  await repo.upsertRevenuePeriod(contractId, yyyymm, realPct, userId, client);

  const allMonths = await repo.getRevenuePeriods(contractId, client);
  let prevPct = 0;
  for (const m of allMonths) {
    const pct = Number(m.real_pct);
    const realUsd = (pct - prevPct) * totalValueUsd;
    await repo.updateRevenueUsd(contractId, m.yyyymm, realUsd, client);
    prevPct = pct;
  }
}

/* ── Service factory ── */

export function createProjectHealthService(
  repo: ProjectHealthRepository,
  events: EventEmitter,
  db: Pool,
): ProjectHealthService {
  return {
    /* ──────── getBaseline ──────── */
    async getBaseline(contractId) {
      const result = await repo.getActiveBaseline(contractId);
      if (!result) throw new NotFound('Baseline activo', contractId);
      const { wbs, ...baseline } = result;
      return { baseline: baseline as Baseline, wbs };
    },

    /* ──────── createBaseline ──────── */
    async createBaseline(contractId, data, user) {
      return withTransaction(async (client) => {
        const contract = await repo.loadContract(contractId, client);
        if (!contract) throw new NotFound('Contrato', contractId);
        requireFixedScope(contract);

        const exists = await repo.hasActiveBaseline(contractId, client);
        if (exists) {
          throw new Conflict('Ya existe un baseline activo. Usa re-baseline para crear una nueva version.');
        }

        if (!contract.winning_quotation_id) {
          throw new BadRequest('El contrato no tiene cotizacion ganadora. Asocia una antes de crear el baseline.');
        }

        const phases = await repo.loadQuotationPhases(contract.winning_quotation_id as string, client);
        if (!phases.length) {
          throw new BadRequest('La cotizacion no tiene fases definidas. Agrega al menos una fase antes de crear el baseline.');
        }

        const epics = await repo.loadQuotationEpics(contract.winning_quotation_id as string, client);
        const milestones = await repo.loadQuotationMilestones(contract.winning_quotation_id as string, client);
        const allocByPhase = await repo.loadPhaseAllocations(contract.winning_quotation_id as string, client);

        // BAC Revenue + Cost
        const bacRevenue = Number(contract.total_value_usd || 0);
        let bacCost: number;
        if (data.bac_cost_usd) {
          bacCost = Number(data.bac_cost_usd);
        } else {
          const quotCost = await computeQuotationCost(repo, contract.winning_quotation_id as string, client);
          bacCost = quotCost.costProtected;
        }

        if (bacRevenue <= 0) {
          throw new BadRequest('El contrato no tiene valor (total_value_usd). Edítalo primero desde el detalle del contrato.');
        }
        if (bacCost <= 0) {
          throw new BadRequest('No se pudo derivar BAC cost de la cotización. Verifica las líneas o envía bac_cost_usd manualmente.');
        }

        const plannedStart = contract.start_date
          ? new Date(contract.start_date as string).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const plannedEnd = contract.end_date
          ? new Date(contract.end_date as string).toISOString().slice(0, 10)
          : null;
        if (!plannedEnd) {
          throw new BadRequest('El contrato necesita fecha de fin para crear el baseline');
        }

        const measurementMethod = data.measurement_method || 'weighted_milestones';

        const baseline = await repo.createBaseline({
          contract_id: contractId,
          version: 1,
          frozen_by: user.id,
          bac_cost_usd: bacCost,
          bac_revenue_usd: bacRevenue,
          planned_start: plannedStart,
          planned_end: plannedEnd,
          measurement_method: measurementMethod,
          snapshot: JSON.stringify({
            phases: phases.map((p: Record<string, unknown>) => ({ id: p.id, name: p.name, weeks: p.weeks })),
          }),
          reason: data.reason || 'Baseline inicial al kick-off',
        }, client);

        // Weight distribution proportional to weeks
        const totalWeeks = phases.reduce((s: number, p: Record<string, unknown>) => s + (Number(p.weeks) || 1), 0);
        const endDate = new Date(plannedEnd);
        let cumulativeStart = new Date(plannedStart);
        const wbsPackages: WbsPackage[] = [];

        for (const phase of phases) {
          const phaseWeeks = Number(phase.weeks) || 1;
          const weight = evm.round4(phaseWeeks / totalWeeks) ?? 0;
          const phaseEnd = new Date(cumulativeStart);
          phaseEnd.setDate(phaseEnd.getDate() + phaseWeeks * 7 - 1);

          const startClamped = cumulativeStart > endDate ? endDate : cumulativeStart;
          const endClamped = phaseEnd > endDate ? endDate : phaseEnd;
          const finalEnd = endClamped < startClamped ? startClamped : endClamped;

          const weeklyHours = allocByPhase.get(phase.id as string) || 0;
          const plannedHours = weeklyHours * phaseWeeks;
          const plannedCostPhase = evm.round2(weight * bacCost) ?? 0;

          const wbs = await repo.createWbsPackage({
            baseline_id: baseline.id,
            kind: 'phase',
            source_id: phase.id,
            name: phase.name,
            sort_order: phase.sort_order,
            planned_hours: plannedHours,
            planned_cost_usd: plannedCostPhase,
            weight_pct: weight,
            planned_start: startClamped.toISOString().slice(0, 10),
            planned_end: finalEnd.toISOString().slice(0, 10),
          }, client);
          wbsPackages.push(wbs);

          cumulativeStart = new Date(finalEnd);
          cumulativeStart.setDate(cumulativeStart.getDate() + 1);
        }

        // Epics (children of first phase)
        for (const epic of epics) {
          const parentPhase = wbsPackages[0];
          await repo.createWbsPackage({
            baseline_id: baseline.id,
            parent_id: parentPhase?.id,
            kind: 'epic',
            source_id: epic.id,
            name: epic.name,
            sort_order: epic.sort_order,
            planned_hours: Number(epic.total_hours || 0),
            planned_cost_usd: 0,
            weight_pct: 0,
            planned_start: parentPhase?.planned_start || plannedStart,
            planned_end: parentPhase?.planned_end || plannedEnd,
          }, client);
        }

        // Milestones (weight_pct = 0)
        for (const ms of milestones) {
          const msDate = ms.expected_date
            ? new Date(ms.expected_date as string).toISOString().slice(0, 10)
            : plannedEnd;
          await repo.createWbsPackage({
            baseline_id: baseline.id,
            kind: 'milestone',
            source_id: ms.id,
            name: ms.name,
            sort_order: ms.sort_order,
            planned_hours: 0,
            planned_cost_usd: 0,
            weight_pct: 0,
            planned_start: msDate,
            planned_end: msDate,
          }, client);
        }

        await events.emit(client, {
          event_type: 'project.baseline_created',
          entity_type: 'project_baseline',
          entity_id: baseline.id,
          actor_user_id: user.id,
          payload: { contract_id: contractId, version: 1, bac_cost_usd: bacCost, bac_revenue_usd: bacRevenue },
        });

        return { baseline, wbs: wbsPackages };
      });
    },

    /* ──────── rebase ──────── */
    async rebase(contractId, data, user) {
      if (!data.reason || String(data.reason).trim().length < 30) {
        throw new BadRequest('reason debe tener al menos 30 caracteres para justificar el re-baseline');
      }

      return withTransaction(async (client) => {
        const contract = await repo.loadContract(contractId, client);
        if (!contract) throw new NotFound('Contrato', contractId);
        requireFixedScope(contract);

        if (contract.status === 'completed') {
          throw new Conflict('No se puede re-basear un proyecto cerrado');
        }

        const current = await repo.getBaselineForUpdate(contractId, client);
        if (!current) throw new NotFound('Baseline activo para re-basear');

        await repo.deactivateBaseline(current.id, client);

        const newVersion = current.version + 1;
        const bacCost = Number(data.bac_cost_usd || current.bac_cost_usd);
        const bacRevenue = Number(data.bac_revenue_usd || current.bac_revenue_usd);
        const newPlannedEnd = data.planned_end || current.planned_end;

        const newBaseline = await repo.createBaseline({
          contract_id: contractId,
          version: newVersion,
          frozen_by: user.id,
          bac_cost_usd: bacCost,
          bac_revenue_usd: bacRevenue,
          planned_start: current.planned_start,
          planned_end: newPlannedEnd,
          measurement_method: data.measurement_method || current.measurement_method,
          snapshot: current.snapshot,
          reason: data.reason.trim(),
        }, client);

        // Copy WBS packages to new baseline
        const oldWbs = await repo.getRootWbsPackages(current.id, client);
        for (const pkg of oldWbs) {
          await repo.createWbsPackage({
            baseline_id: newBaseline.id,
            kind: pkg.kind,
            source_id: pkg.source_id,
            name: pkg.name,
            sort_order: pkg.sort_order,
            planned_hours: pkg.planned_hours,
            planned_cost_usd: pkg.planned_cost_usd,
            weight_pct: pkg.weight_pct,
            planned_start: pkg.planned_start,
            planned_end: pkg.planned_end,
          }, client);
        }

        await events.emit(client, {
          event_type: 'project.rebaselined',
          entity_type: 'project_baseline',
          entity_id: newBaseline.id,
          actor_user_id: user.id,
          payload: {
            contract_id: contractId,
            old_version: current.version,
            new_version: newVersion,
            reason: data.reason.trim(),
          },
        });

        return { baseline: newBaseline };
      });
    },

    /* ──────── submitStatusReport ──────── */
    async submitStatusReport(contractId, data, user) {
      if (!data.cutoff_date) throw new BadRequest('cutoff_date es requerido');
      const cutoff = String(data.cutoff_date).slice(0, 10);

      return withTransaction(async (client) => {
        const contract = await repo.loadContract(contractId, client);
        if (!contract) throw new NotFound('Contrato', contractId);
        requireFixedScope(contract);

        if (contract.status === 'completed') {
          throw new Conflict('No se pueden reportar status en un proyecto cerrado');
        }

        const baseline = await repo.getActiveBaselineRow(contractId, client);
        if (!baseline) throw new NotFound('Baseline activo. Crea uno antes de reportar status.');

        // Validate cutoff
        const pStart = new Date(baseline.planned_start).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        if (cutoff < pStart || cutoff > today) {
          throw new BadRequest('cutoff_date fuera de rango');
        }

        // Check duplicate
        if (await repo.hasDuplicateReport(baseline.id, cutoff, client)) {
          throw new Conflict('Ya existe un status report para esta fecha');
        }

        // Load WBS phase packages
        const wbsPackages = await repo.getPhasePackages(baseline.id, client);

        // Build progress map
        const progressMap = new Map<string, { percent_complete: number; evidence_url?: string; notes?: string }>();
        if (Array.isArray(data.wbs_progress)) {
          for (const p of data.wbs_progress) {
            progressMap.set(p.wbs_package_id, p);
          }
        }

        // Merge WBS with progress
        const wbsWithProgress = wbsPackages.map(pkg => ({
          weight_pct: Number(pkg.weight_pct),
          planned_start: pkg.planned_start,
          planned_end: pkg.planned_end,
          percent_complete: progressMap.has(pkg.id) ? Number(progressMap.get(pkg.id)!.percent_complete || 0) : 0,
        }));

        const bacCost = Number(baseline.bac_cost_usd);
        const pEnd = new Date(baseline.planned_end).toISOString().slice(0, 10);

        // PV and EV
        const pv = evm.computePV(wbsWithProgress, bacCost, cutoff);
        const ev = evm.computeEV(wbsWithProgress, bacCost);

        // AC from time_entries
        const timeRows = await repo.getTimeEntriesByEmployee(contractId, cutoff, client);
        const empIds = timeRows.map(r => r.employee_id);
        const costMap = await repo.buildCostMap(empIds, cutoff, client);
        const acResult = evm.computeAC(
          timeRows.map(r => ({ employee_id: r.employee_id, hours: Number(r.hours) })),
          costMap,
        );

        // PV curve + Earned Schedule
        const pvCurve = evm.buildPvCurve(wbsWithProgress, bacCost, pStart, pEnd);
        const atDays = evm.diffDays(pStart, cutoff);

        // KPIs
        const kpis = evm.computeKpis({ pv, ev, ac: acResult.ac, bac: bacCost });
        const esResult = evm.computeEarnedSchedule(pvCurve, ev, atDays);

        const computedKpis = {
          pv: evm.round2(pv),
          ev: evm.round2(ev),
          ac: evm.round2(acResult.ac),
          ...kpis,
          ...esResult,
          ac_warnings: acResult.warnings,
          ac_coverage_pct: acResult.coverage_pct,
        } as HealthKpis;

        // Health badge
        const health = evm.computeHealthBadge(kpis.spi, kpis.cpi);
        const finalHealth = (data.overall_health as 'green' | 'yellow' | 'red') || health.overall;

        // Insert status report
        const report = await repo.createStatusReport({
          baseline_id: baseline.id,
          cutoff_date: cutoff,
          reported_by: user.id,
          overall_health: finalHealth,
          narrative: data.narrative,
          risks: data.risks,
          computed_kpis: computedKpis,
        }, client);

        // Insert wbs_progress records
        for (const pkg of wbsPackages) {
          const prog = progressMap.get(pkg.id);
          await repo.insertWbsProgress({
            status_report_id: report.id,
            wbs_package_id: pkg.id,
            percent_complete: prog ? Number(prog.percent_complete || 0) : 0,
            evidence_url: prog?.evidence_url,
            notes: prog?.notes,
          }, client);
        }

        // Health degradation event
        if (finalHealth === 'red') {
          await events.emit(client, {
            event_type: 'project.health_degraded',
            entity_type: 'project_status_report',
            entity_id: report.id,
            actor_user_id: user.id,
            payload: {
              contract_id: contractId,
              health: finalHealth,
              cpi: computedKpis.cpi,
              spi: computedKpis.spi,
              drivers: health.drivers,
            },
          });
        }

        // Bridge: EVM progress -> Revenue
        const globalProgress = bacCost > 0 ? (evm.round4(ev / bacCost) ?? 0) : 0;
        const revenueMonth = cutoff.replace(/-/g, '').slice(0, 6);
        const totalValue = Number(contract.total_value_usd || 0);
        if (totalValue > 0 && globalProgress >= 0) {
          await syncRevenueFromProgress(repo, contractId, revenueMonth, globalProgress, totalValue, user.id, client);
        }

        return {
          report,
          computed_kpis: computedKpis,
          health,
          revenue_synced: { yyyymm: revenueMonth, real_pct: globalProgress },
        };
      });
    },

    /* ──────── listStatusReports ──────── */
    async listStatusReports(contractId) {
      return repo.listStatusReports(contractId);
    },

    /* ──────── getHealth ──────── */
    async getHealth(contractId) {
      const result = await repo.getHealth(contractId);
      if (!result) throw new NotFound('Health data', contractId);
      return result;
    },

    /* ──────── getCostForecast ──────── */
    async getCostForecast(contractId) {
      const result = await repo.getCostForecast(contractId);
      if (!result) throw new NotFound('Contrato', contractId);
      return result;
    },

    /* ──────── portfolioHealth ──────── */
    async portfolioHealth() {
      return repo.portfolioHealth();
    },

    /* ──────── backfillRevenue ──────── */
    async backfillRevenue(contractId, user) {
      return withTransaction(async (client) => {
        const contract = await repo.loadContract(contractId, client);
        if (!contract) throw new NotFound('Contrato', contractId);

        const totalValue = Number(contract.total_value_usd || 0);
        if (totalValue <= 0) {
          throw new BadRequest('El contrato necesita total_value_usd > 0 para sincronizar revenue');
        }

        const baselines = await repo.getAllBaselines(contractId, client);
        if (!baselines.length) throw new NotFound('Baselines para este contrato');

        const synced: { cutoff_date: string; yyyymm: string; real_pct: number }[] = [];
        for (const bl of baselines) {
          const bacCost = Number(bl.bac_cost_usd);
          if (bacCost <= 0) continue;

          const reports = await repo.getBaselineReports(bl.id, client);
          for (const rpt of reports) {
            const kpis = rpt.computed_kpis || {};
            const evValue = Number((kpis as Record<string, unknown>).ev || 0);
            const globalPct = evm.round4(evValue / bacCost) ?? 0;
            const yyyymm = String(rpt.cutoff_date).replace(/-/g, '').slice(0, 6);

            await syncRevenueFromProgress(repo, contractId, yyyymm, globalPct, totalValue, user.id, client);
            synced.push({ cutoff_date: rpt.cutoff_date, yyyymm, real_pct: globalPct });
          }
        }

        return { synced_count: synced.length, details: synced };
      });
    },

    /* ──────── backfillBacCost ──────── */
    async backfillBacCost(contractId, user) {
      return withTransaction(async (client) => {
        const contract = await repo.loadContract(contractId, client);
        if (!contract) throw new NotFound('Contrato', contractId);
        if (!contract.winning_quotation_id) {
          throw new BadRequest('Sin cotización ganadora');
        }

        const quotCost = await computeQuotationCost(repo, contract.winning_quotation_id as string, client);
        if (quotCost.costProtected <= 0) {
          throw new BadRequest('Costo protegido derivado de la cotización es 0. Verifica cost_hour en las líneas y la matriz de allocations.');
        }

        const baseline = await repo.getBaselineForUpdate(contractId, client);
        if (!baseline) throw new NotFound('Baseline activo');

        const oldBac = Number(baseline.bac_cost_usd);
        await repo.updateBaselineBacCost(baseline.id, quotCost.costProtected, client);

        // Recalculate planned_cost_usd on WBS packages
        const wbs = await repo.getPhasePackages(baseline.id, client);
        for (const pkg of wbs) {
          const newCost = evm.round2(Number(pkg.weight_pct) * quotCost.costProtected) ?? 0;
          await repo.updateWbsPackageCost(pkg.id, newCost, client);
        }

        return {
          baseline_id: baseline.id,
          old_bac_cost: oldBac,
          new_bac_cost: quotCost.costProtected,
          total_cost_raw: quotCost.totalCost,
          wbs_updated: wbs.length,
        };
      });
    },

    /* ──────── getBaselinePreview ──────── */
    async getBaselinePreview(contractId) {
      const contract = await repo.loadContract(contractId);
      if (!contract) throw new NotFound('Contrato', contractId);
      const bacRevenue = Number(contract.total_value_usd || 0);
      let bacCostAuto = 0;
      let costProtected = 0;
      if (contract.winning_quotation_id) {
        const quotCost = await computeQuotationCost(repo, contract.winning_quotation_id as string);
        bacCostAuto = quotCost.costProtected;
        costProtected = quotCost.costProtected;
      }
      return {
        bac_revenue: bacRevenue,
        bac_cost_auto: bacCostAuto,
        cost_protected: costProtected,
        original_currency: contract.original_currency || 'USD',
        has_winning_quotation: !!contract.winning_quotation_id,
        needs_manual_cost: bacCostAuto <= 0,
      };
    },

    /* ──────── closeout ──────── */
    async closeout(contractId, narrative, user) {
      return withTransaction(async (client) => {
        const contract = await repo.loadContract(contractId, client);
        if (!contract) throw new NotFound('Contrato', contractId);
        requireFixedScope(contract);

        if (contract.status === 'completed') {
          throw new Conflict('El proyecto ya esta cerrado');
        }

        await repo.closeContract(contractId, client);

        await events.emit(client, {
          event_type: 'project.closed',
          entity_type: 'contract',
          entity_id: contractId,
          actor_user_id: user.id,
          payload: { contract_id: contractId, narrative },
        });

        return { status: 'completed', contract_id: contractId };
      });
    },
  };
}
