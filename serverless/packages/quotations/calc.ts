/**
 * Pure calculation engine for quotations — TypeScript port of server/utils/calc.js
 * and client/src/utils/calc.js.
 *
 * No DB access, no side-effects. All monetary values are plain numbers (USD).
 * Percentages are fractions (0.10 = 10%).
 */

import type { QuotationLine, QuotationPhase } from './types';

/* ------------------------------------------------------------------ */
/*  Parameter helpers                                                  */
/* ------------------------------------------------------------------ */

export interface ParamEntry {
  key: string;
  value: number | string;
}

export type CalcParams = Record<string, ParamEntry[]>;

function findParam(params: CalcParams, category: string, key: string): ParamEntry | undefined {
  return params[category]?.find((p) => p.key === key);
}

function numParam(params: CalcParams, category: string, key: string, fallback: number): number {
  const p = findParam(params, category, key);
  return p != null ? Number(p.value) : fallback;
}

/* ------------------------------------------------------------------ */
/*  Staff-aug primitives                                               */
/* ------------------------------------------------------------------ */

export function calcCostHour(
  level: number | null,
  country: string | null,
  bilingual: boolean,
  stack: string | null,
  params: CalcParams,
): number {
  if (!params || !level) return 0;
  const levelParam = findParam(params, 'level', `L${level}`);
  const geoParam = findParam(params, 'geo', country ?? '');
  const bilParam = findParam(params, 'bilingual', bilingual ? 'Sí' : 'No');
  const stackParam = findParam(params, 'stack', stack ?? '');
  const hoursMonth = numParam(params, 'project', 'hours_month', 160);
  if (!levelParam || !geoParam || !bilParam || !stackParam) return 0;
  return (Number(levelParam.value) / hoursMonth)
    * Number(geoParam.value)
    * Number(bilParam.value)
    * Number(stackParam.value);
}

export function calcRateHour(costHour: number, params: CalcParams, marginOverride?: number | null): number {
  const margin = marginOverride != null
    ? Number(marginOverride)
    : numParam(params, 'margin', 'talent', 0.35);
  return costHour / (1 - margin);
}

export function calcToolsCost(toolsKey: string | null, params: CalcParams): number {
  if (!toolsKey) return 0;
  const tool = findParam(params, 'tools', toolsKey);
  return tool ? Number(tool.value) : 0;
}

export function calcToolsRate(toolsCost: number, params: CalcParams): number {
  const margin = numParam(params, 'margin', 'tools', 0);
  return margin >= 1 ? toolsCost : toolsCost / (1 - margin);
}

export function calcModalityFactor(modality: string | null, params: CalcParams): number {
  if (!modality) return 1;
  const mod = findParam(params, 'modality', modality);
  return mod ? Number(mod.value) : 1;
}

/* ------------------------------------------------------------------ */
/*  Staff-aug line recalculation                                       */
/* ------------------------------------------------------------------ */

export function calcStaffAugLine(line: QuotationLine, params: CalcParams): QuotationLine {
  if (!line.level || !line.country || !line.stack) {
    return { ...line, cost_hour: 0, rate_hour: 0, rate_month: 0, total: 0 };
  }
  const modalityFactor = calcModalityFactor(line.modality, params);
  const baseCostHour = calcCostHour(line.level, line.country, line.bilingual, line.stack, params);
  const costHour = baseCostHour * modalityFactor;
  const rateHour = calcRateHour(costHour, params);
  const toolsCost = calcToolsCost(line.tools, params);
  const toolsRate = calcToolsRate(toolsCost, params);
  const rateMonth = rateHour * 160 + toolsRate;
  const total = rateMonth * (line.quantity || 1) * (line.duration_months || 1);
  return { ...line, cost_hour: costHour, rate_hour: rateHour, rate_month: rateMonth, total };
}

/**
 * Recalculate all outputs for an array of staff_aug lines.
 * Returns a new array; never mutates input.
 */
export function recalcStaffAugLines(lines: QuotationLine[], params: CalcParams): QuotationLine[] {
  return (lines || []).map((l) => calcStaffAugLine(l, params));
}

/**
 * Return the aggregate total of a staff_aug quotation, rounded to 2 decimals.
 */
export function sumStaffAugTotal(lines: QuotationLine[]): number {
  return (lines || []).reduce((s, l) => s + Number(l.total || 0), 0);
}

/**
 * Detect whether the client's claimed outputs drift from what the server
 * would compute. Returns a per-line diff report plus an overall flag.
 */
export function detectLineDrift(
  clientLines: QuotationLine[],
  serverLines: QuotationLine[],
  threshold = 0.01,
): { drifted: boolean; diffs: Array<{ line_index: number; field: string; client: number; server: number; delta: number }> } {
  const diffs: Array<{ line_index: number; field: string; client: number; server: number; delta: number }> = [];
  const n = Math.max((clientLines || []).length, (serverLines || []).length);
  for (let i = 0; i < n; i++) {
    const cl = (clientLines?.[i] || {}) as Record<string, unknown>;
    const sv = (serverLines?.[i] || {}) as Record<string, unknown>;
    for (const field of ['cost_hour', 'rate_hour', 'rate_month', 'total'] as const) {
      const cNum = Number(cl[field] || 0);
      const sNum = Number(sv[field] || 0);
      if (Math.abs(cNum - sNum) > threshold) {
        diffs.push({ line_index: i, field, client: cNum, server: sNum, delta: cNum - sNum });
      }
    }
  }
  return { drifted: diffs.length > 0, diffs };
}

/* ------------------------------------------------------------------ */
/*  Fixed-scope (project) calculations                                 */
/* ------------------------------------------------------------------ */

export function calcProjectCostHour(profile: QuotationLine, params: CalcParams): number {
  if (!profile) return 0;
  return calcCostHour(profile.level, profile.country, profile.bilingual, profile.stack, params);
}

export function calcProjectProfile(profile: QuotationLine, params: CalcParams): QuotationLine {
  const cost = calcProjectCostHour(profile, params);
  return { ...profile, cost_hour: cost, rate_hour: params ? calcRateHour(cost, params) : 0 };
}

export interface AllocationMatrix {
  [profileIdx: number]: { [phaseIdx: number]: number };
}

export interface AllocationResult {
  totalHours: number;
  totalCost: number;
  byProfile: Record<number, { hours: number; cost: number }>;
  byPhase: Record<number, { hrWeek: number; hours: number; cost: number }>;
}

/**
 * Walk the allocation matrix and produce totals per profile, per phase, and global.
 * allocation shape: { [profileIdx]: { [phaseIdx]: hoursPerWeek } }
 */
export function calcAllocation(
  lines: QuotationLine[],
  phases: QuotationPhase[],
  allocation: AllocationMatrix,
): AllocationResult {
  const byProfile: Record<number, { hours: number; cost: number }> = {};
  const byPhase: Record<number, { hrWeek: number; hours: number; cost: number }> = {};
  let totalHours = 0;
  let totalCost = 0;

  (lines || []).forEach((_, pIdx) => { byProfile[pIdx] = { hours: 0, cost: 0 }; });
  (phases || []).forEach((_, fIdx) => { byPhase[fIdx] = { hrWeek: 0, hours: 0, cost: 0 }; });

  (lines || []).forEach((profile, pIdx) => {
    (phases || []).forEach((phase, fIdx) => {
      const hw = Number(allocation?.[pIdx]?.[fIdx] || 0);
      const h = hw * Number(phase.weeks || 0);
      const c = h * Number(profile.cost_hour || 0);
      totalHours += h;
      totalCost += c;
      byProfile[pIdx].hours += h;
      byProfile[pIdx].cost += c;
      byPhase[fIdx].hrWeek += hw;
      byPhase[fIdx].hours += h;
      byPhase[fIdx].cost += c;
    });
  });

  return { totalHours, totalCost, byProfile, byPhase };
}

export interface ProjectFinancials {
  totalCost: number;
  buffer: number;
  warranty: number;
  margin: number;
  costWithBuffer: number;
  costProtected: number;
  salePrice: number;
}

export function calcProjectFinancials(totalCost: number, params: CalcParams): ProjectFinancials {
  const buffer = numParam(params, 'project', 'buffer', 0.10);
  const warranty = numParam(params, 'project', 'warranty', 0.05);
  const margin = numParam(params, 'project', 'min_margin', 0.50);
  const costWithBuffer = totalCost * (1 + buffer);
  const costProtected = costWithBuffer * (1 + warranty);
  const salePrice = margin >= 1 ? 0 : costProtected / (1 - margin);
  return { totalCost, buffer, warranty, margin, costWithBuffer, costProtected, salePrice };
}

export interface ProjectSummary extends AllocationResult, ProjectFinancials {
  discount: number;
  finalPrice: number;
  blendRateCost: number;
  blendRateSale: number;
  totalWeeks: number;
  realMargin: number;
}

/** Full financial cascade for a fixed-scope project. */
export function calcProjectSummary(
  lines: QuotationLine[],
  phases: QuotationPhase[],
  allocation: AllocationMatrix,
  discountPct: number | null,
  params: CalcParams | null,
): ProjectSummary {
  const alloc = calcAllocation(lines, phases, allocation);
  const fin = params
    ? calcProjectFinancials(alloc.totalCost, params)
    : {
        totalCost: alloc.totalCost, buffer: 0, warranty: 0, margin: 0,
        costWithBuffer: alloc.totalCost, costProtected: alloc.totalCost, salePrice: 0,
      };
  const discount = Number(discountPct || 0);
  const finalPrice = fin.salePrice * (1 - discount);
  const blendRateCost = alloc.totalHours > 0 ? alloc.totalCost / alloc.totalHours : 0;
  const blendRateSale = alloc.totalHours > 0 ? finalPrice / alloc.totalHours : 0;
  const totalWeeks = (phases || []).reduce((s, p) => s + Number(p.weeks || 0), 0);
  const realMargin = finalPrice > 0 ? (finalPrice - fin.costProtected) / finalPrice : 0;
  return { ...alloc, ...fin, discount, finalPrice, blendRateCost, blendRateSale, totalWeeks, realMargin };
}
