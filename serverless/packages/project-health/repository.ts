import type { Pool, PoolClient } from 'pg';
import type {
  Baseline, WbsPackage, StatusReport, TrendPoint,
  PortfolioProject, CostForecast, AssignmentForecastDetail,
} from './types';
import * as evm from './evm-engine';

type DbClient = Pool | PoolClient;

export interface ProjectHealthRepository {
  /* ── Baseline ── */
  getActiveBaseline(contractId: string): Promise<(Baseline & { wbs: WbsPackage[] }) | null>;
  getActiveBaselineRow(contractId: string, client?: DbClient): Promise<Baseline | null>;
  hasActiveBaseline(contractId: string, client?: DbClient): Promise<boolean>;
  createBaseline(data: Record<string, unknown>, client: PoolClient): Promise<Baseline>;
  deactivateBaseline(baselineId: string, client: PoolClient): Promise<void>;
  getBaselineForUpdate(contractId: string, client: PoolClient): Promise<Baseline | null>;
  updateBaselineBacCost(baselineId: string, bacCost: number, client: PoolClient): Promise<void>;

  /* ── WBS ── */
  getWbsPackages(baselineId: string, client?: DbClient): Promise<WbsPackage[]>;
  getPhasePackages(baselineId: string, client?: DbClient): Promise<WbsPackage[]>;
  getRootWbsPackages(baselineId: string, client: PoolClient): Promise<WbsPackage[]>;
  createWbsPackage(data: Record<string, unknown>, client: PoolClient): Promise<WbsPackage>;
  updateWbsPackageCost(packageId: string, cost: number, client: PoolClient): Promise<void>;

  /* ── Status Reports ── */
  listStatusReports(contractId: string): Promise<StatusReport[]>;
  hasDuplicateReport(baselineId: string, cutoffDate: string, client: PoolClient): Promise<boolean>;
  createStatusReport(data: Record<string, unknown>, client: PoolClient): Promise<StatusReport>;
  insertWbsProgress(data: Record<string, unknown>, client: PoolClient): Promise<void>;

  /* ── Health / Cost Forecast ── */
  getHealth(contractId: string): Promise<Record<string, unknown> | null>;
  getCostForecast(contractId: string): Promise<CostForecast | null>;
  portfolioHealth(): Promise<{ projects: PortfolioProject[]; count: number }>;

  /* ── Contract helpers ── */
  loadContract(contractId: string, client?: DbClient): Promise<Record<string, unknown> | null>;

  /* ── Time / Cost helpers ── */
  getTimeEntriesByEmployee(contractId: string, cutoffDate: string, client?: DbClient): Promise<{ employee_id: string; hours: number }[]>;
  buildCostMap(employeeIds: string[], cutoffDate: string, client?: DbClient): Promise<Map<string, number>>;

  /* ── Quotation helpers ── */
  loadQuotationPhases(quotationId: string, client?: DbClient): Promise<Record<string, unknown>[]>;
  loadQuotationEpics(quotationId: string, client?: DbClient): Promise<Record<string, unknown>[]>;
  loadQuotationMilestones(quotationId: string, client?: DbClient): Promise<Record<string, unknown>[]>;
  loadPhaseAllocations(quotationId: string, client?: DbClient): Promise<Map<string, number>>;
  loadQuotation(quotationId: string, client?: DbClient): Promise<Record<string, unknown> | null>;
  loadQuotationLines(quotationId: string, client?: DbClient): Promise<Record<string, unknown>[]>;
  loadQuotationAllocations(quotationId: string, client?: DbClient): Promise<Record<string, unknown>[]>;
  loadParameters(client?: DbClient): Promise<Record<string, { key: string; value: number }[]>>;

  /* ── Revenue sync ── */
  upsertRevenuePeriod(contractId: string, yyyymm: string, realPct: number, userId: string, client: PoolClient): Promise<void>;
  getRevenuePeriods(contractId: string, client: PoolClient): Promise<{ yyyymm: string; real_pct: number }[]>;
  updateRevenueUsd(contractId: string, yyyymm: string, realUsd: number, client: PoolClient): Promise<void>;

  /* ── Assignments (for cost forecast) ── */
  getActiveAssignments(contractId: string, today: string): Promise<Record<string, unknown>[]>;

  /* ── All baselines (for backfill) ── */
  getAllBaselines(contractId: string, client?: DbClient): Promise<{ id: string; bac_cost_usd: number }[]>;
  getBaselineReports(baselineId: string, client?: DbClient): Promise<{ id: string; cutoff_date: string; computed_kpis: Record<string, unknown> }[]>;

  /* ── Contract status update ── */
  closeContract(contractId: string, client: PoolClient): Promise<void>;
}

export function createProjectHealthRepository(db: Pool): ProjectHealthRepository {
  function conn(c?: DbClient): DbClient {
    return c || db;
  }

  return {
    /* ──────────── Baseline ──────────── */

    async getActiveBaseline(contractId) {
      const { rows: [baseline] } = await db.query(
        `SELECT pb.*, u.name AS frozen_by_name
           FROM project_baselines pb
           LEFT JOIN users u ON u.id = pb.frozen_by
          WHERE pb.contract_id = $1 AND pb.is_active = true`,
        [contractId],
      );
      if (!baseline) return null;

      const { rows: wbs } = await db.query(
        'SELECT * FROM wbs_packages WHERE baseline_id = $1 ORDER BY sort_order',
        [baseline.id],
      );
      return { ...baseline, wbs };
    },

    async getActiveBaselineRow(contractId, client) {
      const { rows: [row] } = await conn(client).query(
        'SELECT * FROM project_baselines WHERE contract_id = $1 AND is_active = true',
        [contractId],
      );
      return row ?? null;
    },

    async hasActiveBaseline(contractId, client) {
      const { rows } = await conn(client).query(
        'SELECT id FROM project_baselines WHERE contract_id = $1 AND is_active = true',
        [contractId],
      );
      return rows.length > 0;
    },

    async createBaseline(data, client) {
      const { rows: [row] } = await client.query(
        `INSERT INTO project_baselines
           (contract_id, version, frozen_by, bac_cost_usd, bac_revenue_usd,
            planned_start, planned_end, measurement_method, snapshot, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          data.contract_id, data.version, data.frozen_by,
          data.bac_cost_usd, data.bac_revenue_usd,
          data.planned_start, data.planned_end,
          data.measurement_method, data.snapshot, data.reason,
        ],
      );
      return row;
    },

    async deactivateBaseline(baselineId, client) {
      await client.query(
        'UPDATE project_baselines SET is_active = false WHERE id = $1',
        [baselineId],
      );
    },

    async getBaselineForUpdate(contractId, client) {
      const { rows: [row] } = await client.query(
        'SELECT * FROM project_baselines WHERE contract_id = $1 AND is_active = true FOR UPDATE',
        [contractId],
      );
      return row ?? null;
    },

    async updateBaselineBacCost(baselineId, bacCost, client) {
      await client.query(
        'UPDATE project_baselines SET bac_cost_usd = $1 WHERE id = $2',
        [bacCost, baselineId],
      );
    },

    /* ──────────── WBS ──────────── */

    async getWbsPackages(baselineId, client) {
      const { rows } = await conn(client).query(
        'SELECT * FROM wbs_packages WHERE baseline_id = $1 ORDER BY sort_order',
        [baselineId],
      );
      return rows;
    },

    async getPhasePackages(baselineId, client) {
      const { rows } = await conn(client).query(
        `SELECT * FROM wbs_packages WHERE baseline_id = $1 AND kind = 'phase' ORDER BY sort_order`,
        [baselineId],
      );
      return rows;
    },

    async getRootWbsPackages(baselineId, client) {
      const { rows } = await client.query(
        'SELECT * FROM wbs_packages WHERE baseline_id = $1 AND parent_id IS NULL ORDER BY sort_order',
        [baselineId],
      );
      return rows;
    },

    async createWbsPackage(data, client) {
      const { rows: [row] } = await client.query(
        `INSERT INTO wbs_packages
           (baseline_id, parent_id, kind, source_id, name, sort_order, planned_hours,
            planned_cost_usd, weight_pct, planned_start, planned_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          data.baseline_id, data.parent_id ?? null, data.kind, data.source_id,
          data.name, data.sort_order, data.planned_hours,
          data.planned_cost_usd, data.weight_pct,
          data.planned_start, data.planned_end,
        ],
      );
      return row;
    },

    async updateWbsPackageCost(packageId, cost, client) {
      await client.query(
        'UPDATE wbs_packages SET planned_cost_usd = $1 WHERE id = $2',
        [cost, packageId],
      );
    },

    /* ──────────── Status Reports ──────────── */

    async listStatusReports(contractId) {
      const { rows: [baseline] } = await db.query(
        'SELECT id FROM project_baselines WHERE contract_id = $1 AND is_active = true',
        [contractId],
      );
      if (!baseline) return [];

      const { rows } = await db.query(
        `SELECT psr.*, u.name AS reported_by_name
           FROM project_status_reports psr
           LEFT JOIN users u ON u.id = psr.reported_by
          WHERE psr.baseline_id = $1
          ORDER BY psr.cutoff_date DESC`,
        [baseline.id],
      );
      return rows;
    },

    async hasDuplicateReport(baselineId, cutoffDate, client) {
      const { rows } = await client.query(
        'SELECT id FROM project_status_reports WHERE baseline_id = $1 AND cutoff_date = $2',
        [baselineId, cutoffDate],
      );
      return rows.length > 0;
    },

    async createStatusReport(data, client) {
      const { rows: [row] } = await client.query(
        `INSERT INTO project_status_reports
           (baseline_id, cutoff_date, reported_by, overall_health, narrative, risks, computed_kpis)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.baseline_id, data.cutoff_date, data.reported_by,
          data.overall_health, data.narrative ?? null,
          data.risks ? JSON.stringify(data.risks) : null,
          JSON.stringify(data.computed_kpis),
        ],
      );
      return row;
    },

    async insertWbsProgress(data, client) {
      await client.query(
        `INSERT INTO wbs_progress (status_report_id, wbs_package_id, percent_complete, evidence_url, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          data.status_report_id, data.wbs_package_id,
          data.percent_complete, data.evidence_url ?? null,
          data.notes ?? null,
        ],
      );
    },

    /* ──────────── Health ──────────── */

    async getHealth(contractId) {
      const contract = await this.loadContract(contractId);
      if (!contract) return null;
      if (contract.contract_subtype !== 'fixed_scope') return null;

      const { rows: [baseline] } = await db.query(
        'SELECT * FROM project_baselines WHERE contract_id = $1 AND is_active = true',
        [contractId],
      );
      if (!baseline) return null;

      const { rows: [latest] } = await db.query(
        `SELECT * FROM project_status_reports
          WHERE baseline_id = $1 ORDER BY cutoff_date DESC LIMIT 1`,
        [baseline.id],
      );

      const { rows: wbs } = await db.query(
        `SELECT wp.*, COALESCE(pr.percent_complete, 0) AS current_progress
           FROM wbs_packages wp
           LEFT JOIN LATERAL (
             SELECT wpr.percent_complete FROM wbs_progress wpr
             JOIN project_status_reports psr ON psr.id = wpr.status_report_id
             WHERE wpr.wbs_package_id = wp.id AND psr.baseline_id = $1
             ORDER BY psr.cutoff_date DESC LIMIT 1
           ) pr ON true
          WHERE wp.baseline_id = $1
          ORDER BY wp.sort_order`,
        [baseline.id],
      );

      const { rows: trend } = await db.query(
        `SELECT cutoff_date,
                (computed_kpis->>'cpi')::numeric AS cpi,
                (computed_kpis->>'spi')::numeric AS spi,
                overall_health
           FROM project_status_reports
          WHERE baseline_id = $1
          ORDER BY cutoff_date DESC LIMIT 12`,
        [baseline.id],
      );

      const kpis = latest?.computed_kpis || {};
      const health = latest
        ? { overall: latest.overall_health, drivers: kpis.health_drivers || [] }
        : { overall: 'green', drivers: [] };

      return {
        contract_id: contract.id,
        contract_name: contract.name,
        baseline: {
          id: baseline.id,
          version: baseline.version,
          frozen_at: baseline.frozen_at,
          bac_cost_usd: Number(baseline.bac_cost_usd),
          bac_revenue_usd: Number(baseline.bac_revenue_usd),
          planned_start: baseline.planned_start,
          planned_end: baseline.planned_end,
          measurement_method: baseline.measurement_method,
        },
        as_of: latest?.cutoff_date || new Date().toISOString().slice(0, 10),
        kpis,
        health,
        trend: (trend as TrendPoint[]).reverse(),
        wbs: wbs.map((w: WbsPackage & { current_progress?: number }) => ({
          id: w.id,
          kind: w.kind,
          name: w.name,
          weight_pct: Number(w.weight_pct),
          percent_complete: Number(w.current_progress ?? 0),
          planned_start: w.planned_start,
          planned_end: w.planned_end,
        })),
      };
    },

    /* ──────────── Cost Forecast ──────────── */

    async getCostForecast(contractId) {
      const contract = await this.loadContract(contractId);
      if (!contract) return null;

      const today = new Date().toISOString().slice(0, 10);

      // 1. AC executed
      const timeRows = await this.getTimeEntriesByEmployee(contractId, today);
      const empIdsAc = timeRows.map(r => r.employee_id);
      const costMapAc = await this.buildCostMap(empIdsAc, today);
      const acResult = evm.computeAC(
        timeRows.map(r => ({ employee_id: r.employee_id, hours: Number(r.hours) })),
        costMapAc,
      );

      // 2. Future staffing cost
      const assignments = await this.getActiveAssignments(contractId, today);
      const futureEmpIds = [...new Set(assignments.map((a: Record<string, unknown>) => a.employee_id as string))];
      const costMapFuture = await this.buildCostMap(futureEmpIds, today);

      let plannedFutureCost = 0;
      const futureDetails: AssignmentForecastDetail[] = [];
      for (const a of assignments) {
        const startFrom = a.start_date && (a.start_date as string) > today ? (a.start_date as string) : today;
        const endAt = (a.end_date as string) || (contract.end_date ? new Date(contract.end_date as string).toISOString().slice(0, 10) : null);
        if (!endAt) continue;
        const diffMs = new Date(endAt).getTime() - new Date(startFrom).getTime();
        const weeks = Math.max(0, diffMs / (7 * 24 * 3600 * 1000));
        const hourlyRate = costMapFuture.get(a.employee_id as string) || 0;
        const cost = Number(a.weekly_hours) * weeks * hourlyRate;
        plannedFutureCost += cost;
        futureDetails.push({
          employee_id: a.employee_id as string,
          weekly_hours: Number(a.weekly_hours),
          weeks_remaining: evm.round2(weeks) ?? 0,
          hourly_cost: evm.round2(hourlyRate) ?? 0,
          projected_cost: evm.round2(cost) ?? 0,
          has_cost_data: hourlyRate > 0,
        });
      }

      const eac_staffing = evm.round2(acResult.ac + plannedFutureCost) ?? 0;

      // 3. BAC from baseline
      const { rows: [baseline] } = await db.query(
        'SELECT bac_cost_usd, bac_revenue_usd FROM project_baselines WHERE contract_id = $1 AND is_active = true',
        [contractId],
      );
      const bacCost = baseline ? Number(baseline.bac_cost_usd) : null;
      const bacRevenue = baseline ? Number(baseline.bac_revenue_usd) : null;
      const variance = bacCost != null ? (evm.round2(bacCost - eac_staffing) ?? null) : null;

      return {
        contract_id: contractId,
        as_of: today,
        ac_executed: acResult.ac,
        ac_warnings: acResult.warnings,
        planned_future_cost: evm.round2(plannedFutureCost) ?? 0,
        eac_staffing,
        bac_cost: bacCost,
        bac_revenue: bacRevenue,
        variance_at_completion: variance,
        margin_projected: bacRevenue && eac_staffing ? (evm.round2(bacRevenue - eac_staffing) ?? null) : null,
        assignments_detail: futureDetails,
      };
    },

    /* ──────────── Portfolio Health ──────────── */

    async portfolioHealth() {
      const { rows } = await db.query(
        `SELECT c.id AS contract_id, c.name AS contract_name, c.status,
                cl.name AS client_name,
                pb.id AS baseline_id, pb.version, pb.bac_cost_usd, pb.bac_revenue_usd,
                pb.planned_start, pb.planned_end,
                psr.cutoff_date AS last_report_date,
                psr.overall_health,
                psr.computed_kpis
           FROM contracts c
           LEFT JOIN clients cl ON cl.id = c.client_id
           LEFT JOIN project_baselines pb ON pb.contract_id = c.id AND pb.is_active = true
           LEFT JOIN LATERAL (
             SELECT * FROM project_status_reports
              WHERE baseline_id = pb.id
              ORDER BY cutoff_date DESC LIMIT 1
           ) psr ON true
          WHERE c.contract_subtype = 'fixed_scope'
            AND c.deleted_at IS NULL
            AND c.status != 'completed'
          ORDER BY psr.overall_health DESC NULLS LAST, c.name`,
      );

      const projects: PortfolioProject[] = rows.map((r: Record<string, unknown>) => ({
        contract_id: r.contract_id as string,
        contract_name: r.contract_name as string,
        client_name: (r.client_name as string) || null,
        status: r.status as string,
        has_baseline: !!r.baseline_id,
        baseline_version: (r.version as number) ?? null,
        bac_cost_usd: r.bac_cost_usd ? Number(r.bac_cost_usd) : null,
        bac_revenue_usd: r.bac_revenue_usd ? Number(r.bac_revenue_usd) : null,
        planned_start: (r.planned_start as string) || null,
        planned_end: (r.planned_end as string) || null,
        last_report_date: (r.last_report_date as string) || null,
        overall_health: (r.overall_health as string) || null,
        kpis: (r.computed_kpis as Record<string, unknown>) || null,
      }));

      return { projects, count: projects.length };
    },

    /* ──────────── Contract helper ──────────── */

    async loadContract(contractId, client) {
      const { rows: [row] } = await conn(client).query(
        `SELECT c.id, c.name, c.type, c.contract_subtype, c.status, c.start_date, c.end_date,
                c.total_value_usd, c.winning_quotation_id, c.account_owner_id, c.client_id,
                c.original_currency
           FROM contracts c WHERE c.id = $1 AND c.deleted_at IS NULL`,
        [contractId],
      );
      return row ?? null;
    },

    /* ──────────── Time / Cost helpers ──────────── */

    async getTimeEntriesByEmployee(contractId, cutoffDate, client) {
      const { rows } = await conn(client).query(
        `SELECT te.employee_id, SUM(te.hours) AS hours
           FROM time_entries te
           JOIN assignments a ON a.id = te.assignment_id
          WHERE a.contract_id = $1
            AND te.work_date <= $2
            AND te.deleted_at IS NULL
          GROUP BY te.employee_id`,
        [contractId, cutoffDate],
      );
      return rows.map((r: Record<string, unknown>) => ({
        employee_id: r.employee_id as string,
        hours: Number(r.hours),
      }));
    },

    async buildCostMap(employeeIds, cutoffDate, client) {
      if (!employeeIds.length) return new Map();
      const period = cutoffDate.replace(/-/g, '').slice(0, 6);
      const { rows } = await conn(client).query(
        `SELECT DISTINCT ON (ec.employee_id)
                ec.employee_id, ec.cost_usd, e.weekly_capacity_hours
           FROM employee_costs ec
           JOIN employees e ON e.id = ec.employee_id
          WHERE ec.employee_id = ANY($1::uuid[])
            AND ec.period <= $2
          ORDER BY ec.employee_id, ec.period DESC`,
        [employeeIds, period],
      );
      const map = new Map<string, number>();
      for (const r of rows) {
        const monthlyHours = Number(r.weekly_capacity_hours || 40) * 4.333;
        const hourlyCost = monthlyHours > 0 ? Number(r.cost_usd) / monthlyHours : 0;
        map.set(r.employee_id, hourlyCost);
      }
      return map;
    },

    /* ──────────── Quotation helpers ──────────── */

    async loadQuotationPhases(quotationId, client) {
      const { rows } = await conn(client).query(
        'SELECT id, name, sort_order, weeks FROM quotation_phases WHERE quotation_id = $1 ORDER BY sort_order',
        [quotationId],
      );
      return rows;
    },

    async loadQuotationEpics(quotationId, client) {
      const { rows } = await conn(client).query(
        'SELECT id, name, sort_order, total_hours FROM quotation_epics WHERE quotation_id = $1 ORDER BY sort_order',
        [quotationId],
      );
      return rows;
    },

    async loadQuotationMilestones(quotationId, client) {
      const { rows } = await conn(client).query(
        'SELECT id, name, sort_order, expected_date FROM quotation_milestones WHERE quotation_id = $1 AND deleted_at IS NULL ORDER BY sort_order',
        [quotationId],
      );
      return rows;
    },

    async loadPhaseAllocations(quotationId, client) {
      const { rows } = await conn(client).query(
        'SELECT phase_id, SUM(weekly_hours) AS total_weekly FROM quotation_allocations WHERE quotation_id = $1 GROUP BY phase_id',
        [quotationId],
      );
      return new Map(rows.map((a: Record<string, unknown>) => [a.phase_id as string, Number(a.total_weekly)]));
    },

    async loadQuotation(quotationId, client) {
      const { rows: [row] } = await conn(client).query(
        'SELECT type, metadata, parameters_snapshot FROM quotations WHERE id = $1',
        [quotationId],
      );
      return row ?? null;
    },

    async loadQuotationLines(quotationId, client) {
      const { rows } = await conn(client).query(
        `SELECT sort_order, level, country, bilingual, stack, modality, cost_hour,
                hours_per_week, duration_months, quantity
           FROM quotation_lines WHERE quotation_id = $1 ORDER BY sort_order`,
        [quotationId],
      );
      return rows;
    },

    async loadQuotationAllocations(quotationId, client) {
      const { rows } = await conn(client).query(
        `SELECT qa.line_sort_order, qp.sort_order AS phase_sort, qa.weekly_hours
           FROM quotation_allocations qa
           JOIN quotation_phases qp ON qp.id = qa.phase_id
           WHERE qa.quotation_id = $1`,
        [quotationId],
      );
      return rows;
    },

    async loadParameters(client) {
      const { rows } = await conn(client).query(
        'SELECT category, key, value FROM parameters',
      );
      const params: Record<string, { key: string; value: number }[]> = {};
      for (const r of rows) {
        if (!params[r.category]) params[r.category] = [];
        params[r.category].push({ key: r.key, value: Number(r.value) });
      }
      return params;
    },

    /* ──────────── Revenue sync ──────────── */

    async upsertRevenuePeriod(contractId, yyyymm, realPct, userId, client) {
      await client.query(
        `INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, real_pct, created_by, updated_by)
         VALUES ($1, $2, 0, $3, $4, $4)
         ON CONFLICT (contract_id, yyyymm) DO UPDATE SET
           real_pct   = EXCLUDED.real_pct,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [contractId, yyyymm, realPct, userId],
      );
    },

    async getRevenuePeriods(contractId, client) {
      const { rows } = await client.query(
        `SELECT yyyymm, real_pct FROM revenue_periods
          WHERE contract_id = $1 AND real_pct IS NOT NULL
          ORDER BY yyyymm ASC`,
        [contractId],
      );
      return rows.map((r: Record<string, unknown>) => ({
        yyyymm: r.yyyymm as string,
        real_pct: Number(r.real_pct),
      }));
    },

    async updateRevenueUsd(contractId, yyyymm, realUsd, client) {
      await client.query(
        `UPDATE revenue_periods
            SET real_usd = $3::numeric, updated_at = NOW()
          WHERE contract_id = $1 AND yyyymm = $2`,
        [contractId, yyyymm, realUsd],
      );
    },

    /* ──────────── Assignments ──────────── */

    async getActiveAssignments(contractId, today) {
      const { rows } = await db.query(
        `SELECT a.employee_id, a.weekly_hours, a.start_date, a.end_date
           FROM assignments a
          WHERE a.contract_id = $1
            AND a.status IN ('active', 'planned')
            AND a.deleted_at IS NULL
            AND (a.end_date IS NULL OR a.end_date > $2)`,
        [contractId, today],
      );
      return rows;
    },

    /* ──────────── Backfill helpers ──────────── */

    async getAllBaselines(contractId, client) {
      const { rows } = await conn(client).query(
        'SELECT id, bac_cost_usd FROM project_baselines WHERE contract_id = $1 ORDER BY version',
        [contractId],
      );
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        bac_cost_usd: Number(r.bac_cost_usd),
      }));
    },

    async getBaselineReports(baselineId, client) {
      const { rows } = await conn(client).query(
        `SELECT psr.id, psr.cutoff_date, psr.computed_kpis
           FROM project_status_reports psr
          WHERE psr.baseline_id = $1
          ORDER BY psr.cutoff_date ASC`,
        [baselineId],
      );
      return rows as { id: string; cutoff_date: string; computed_kpis: Record<string, unknown> }[];
    },

    /* ──────────── Contract status ──────────── */

    async closeContract(contractId, client) {
      await client.query(
        "UPDATE contracts SET status = 'completed', updated_at = NOW() WHERE id = $1",
        [contractId],
      );
    },
  };
}
