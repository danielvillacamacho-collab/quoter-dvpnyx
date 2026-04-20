/**
 * Canonical pricing math for the server (EX-2).
 *
 * This is a DIRECT PORT of client/src/utils/calc.js. The client performs
 * live recalculation while the user edits the UI, but on save the server
 * is the source of truth — it recomputes all outputs and persists
 * CANONICAL values, not what the client sent.
 *
 * **Invariant:** given the same parameter set + the same line/profile
 * inputs, this file MUST produce the same numbers as the client calc.js
 * to within 0.01 USD. This is enforced by calc.test.js (contract test).
 *
 * Conventions (matches the client):
 *  - `params` has shape { level, geo, bilingual, stack, tools, modality,
 *    project, margin } where each key is an array of { key, value }.
 *  - Monetary outputs are plain JS numbers (no currency conversion).
 *  - Percentages are fractions (0.10 = 10%), matching the DB's NUMERIC(5,4).
 */

const calcCostHour = (level, country, bilingual, stack, params) => {
  if (!params || !level) return 0;
  const levelParam = params.level?.find((p) => p.key === `L${level}`);
  const geoParam = params.geo?.find((p) => p.key === country);
  const bilParam = params.bilingual?.find((p) => p.key === (bilingual ? 'Sí' : 'No'));
  const stackParam = params.stack?.find((p) => p.key === stack);
  const hoursMonth = params.project?.find((p) => p.key === 'hours_month')?.value || 160;
  if (!levelParam || !geoParam || !bilParam || !stackParam) return 0;
  return (Number(levelParam.value) / Number(hoursMonth)) * Number(geoParam.value) * Number(bilParam.value) * Number(stackParam.value);
};

const calcRateHour = (costHour, params) => {
  const margin = params.margin?.find((p) => p.key === 'talent')?.value || 0.35;
  return costHour / (1 - Number(margin));
};

const calcToolsCost = (toolsKey, params) => {
  const tool = params.tools?.find((p) => p.key === toolsKey);
  return tool ? Number(tool.value) : 0;
};

const calcToolsRate = (toolsCost, params) => {
  const margin = params.margin?.find((p) => p.key === 'tools')?.value || 0;
  return Number(margin) >= 1 ? toolsCost : toolsCost / (1 - Number(margin));
};

const calcModalityFactor = (modality, params) => {
  const mod = params.modality?.find((p) => p.key === modality);
  return mod ? Number(mod.value) : 1;
};

const calcStaffAugLine = (line, params) => {
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
};

const calcProjectFinancials = (totalCost, params) => {
  const buffer = params.project?.find((p) => p.key === 'buffer')?.value || 0.10;
  const warranty = params.project?.find((p) => p.key === 'warranty')?.value || 0.05;
  const margin = params.project?.find((p) => p.key === 'min_margin')?.value || 0.50;
  const costWithBuffer = totalCost * (1 + Number(buffer));
  const costProtected = costWithBuffer * (1 + Number(warranty));
  const salePrice = Number(margin) >= 1 ? 0 : costProtected / (1 - Number(margin));
  return {
    totalCost, buffer: Number(buffer), warranty: Number(warranty), margin: Number(margin),
    costWithBuffer, costProtected, salePrice,
  };
};

/**
 * Recalculate all outputs for an array of staff_aug lines.
 * Returns a new array; never mutates input.
 */
const recalcStaffAugLines = (lines, params) => {
  return (lines || []).map((l) => calcStaffAugLine(l, params));
};

/**
 * Return the aggregate total of a staff_aug quotation, rounded to 2 decimals.
 */
const sumStaffAugTotal = (lines) => {
  return (lines || []).reduce((s, l) => s + Number(l.total || 0), 0);
};

/**
 * Detect whether the client's claimed outputs drift from what the server
 * would compute. Returns a per-line diff report plus an overall flag.
 * `threshold` is in USD (default 0.01).
 */
const detectLineDrift = (clientLines, serverLines, threshold = 0.01) => {
  const diffs = [];
  const n = Math.max((clientLines || []).length, (serverLines || []).length);
  for (let i = 0; i < n; i++) {
    const cl = clientLines?.[i] || {};
    const sv = serverLines?.[i] || {};
    for (const field of ['cost_hour', 'rate_hour', 'rate_month', 'total']) {
      const cNum = Number(cl[field] || 0);
      const sNum = Number(sv[field] || 0);
      if (Math.abs(cNum - sNum) > threshold) {
        diffs.push({ line_index: i, field, client: cNum, server: sNum, delta: cNum - sNum });
      }
    }
  }
  return { drifted: diffs.length > 0, diffs };
};

module.exports = {
  calcCostHour,
  calcRateHour,
  calcToolsCost,
  calcToolsRate,
  calcModalityFactor,
  calcStaffAugLine,
  calcProjectFinancials,
  recalcStaffAugLines,
  sumStaffAugTotal,
  detectLineDrift,
};
