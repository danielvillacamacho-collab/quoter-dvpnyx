export const calcCostHour = (level, country, bilingual, stack, params) => {
  if (!params || !level) return 0;
  const levelParam = params.level?.find(p => p.key === `L${level}`);
  const geoParam = params.geo?.find(p => p.key === country);
  const bilParam = params.bilingual?.find(p => p.key === (bilingual ? 'Sí' : 'No'));
  const stackParam = params.stack?.find(p => p.key === stack);
  const hoursMonth = params.project?.find(p => p.key === 'hours_month')?.value || 160;
  if (!levelParam || !geoParam || !bilParam || !stackParam) return 0;
  return (Number(levelParam.value) / Number(hoursMonth)) * Number(geoParam.value) * Number(bilParam.value) * Number(stackParam.value);
};

export const calcRateHour = (costHour, params) => {
  const margin = params.margin?.find(p => p.key === 'talent')?.value || 0.35;
  return costHour / (1 - Number(margin));
};

export const calcToolsCost = (toolsKey, params) => {
  const tool = params.tools?.find(p => p.key === toolsKey);
  return tool ? Number(tool.value) : 0;
};

export const calcToolsRate = (toolsCost, params) => {
  const margin = params.margin?.find(p => p.key === 'tools')?.value || 0;
  return margin >= 1 ? toolsCost : toolsCost / (1 - Number(margin));
};

export const calcModalityFactor = (modality, params) => {
  const mod = params.modality?.find(p => p.key === modality);
  return mod ? Number(mod.value) : 1;
};

export const calcStaffAugLine = (line, params) => {
  if (!line.level || !line.country || !line.stack) return { ...line, cost_hour: 0, rate_hour: 0, rate_month: 0, total: 0 };
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

export const calcProjectFinancials = (totalCost, params) => {
  const buffer = params.project?.find(p => p.key === 'buffer')?.value || 0.10;
  const warranty = params.project?.find(p => p.key === 'warranty')?.value || 0.05;
  const margin = params.project?.find(p => p.key === 'min_margin')?.value || 0.50;
  const costWithBuffer = totalCost * (1 + Number(buffer));
  const costProtected = costWithBuffer * (1 + Number(warranty));
  const salePrice = Number(margin) >= 1 ? 0 : costProtected / (1 - Number(margin));
  return { totalCost, buffer: Number(buffer), warranty: Number(warranty), margin: Number(margin), costWithBuffer, costProtected, salePrice };
};

/* ========== PROJECT (FIXED SCOPE) HELPERS ========== */

/**
 * Cost/hour for a project profile — does NOT include modality factor
 * (en proyectos la dedicación ya se define por fase).
 */
export const calcProjectCostHour = (profile, params) => {
  if (!profile) return 0;
  return calcCostHour(profile.level, profile.country, profile.bilingual, profile.stack, params);
};

/** Enrich a profile object with recalculated cost_hour + rate_hour. */
export const calcProjectProfile = (profile, params) => {
  const cost = calcProjectCostHour(profile, params);
  return { ...profile, cost_hour: cost, rate_hour: params ? calcRateHour(cost, params) : 0 };
};

/**
 * Walk the allocation matrix and produce totals per profile, per phase, and global.
 * allocation shape: { [profileIdx]: { [phaseIdx]: hoursPerWeek } }
 */
export const calcAllocation = (lines, phases, allocation) => {
  const byProfile = {};
  const byPhase = {};
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
};

/** Full financial cascade for a fixed-scope project. */
export const calcProjectSummary = (lines, phases, allocation, discountPct, params) => {
  const alloc = calcAllocation(lines, phases, allocation);
  const fin = params ? calcProjectFinancials(alloc.totalCost, params) : { totalCost: alloc.totalCost, buffer: 0, warranty: 0, margin: 0, costWithBuffer: alloc.totalCost, costProtected: alloc.totalCost, salePrice: 0 };
  const discount = Number(discountPct || 0);
  const finalPrice = fin.salePrice * (1 - discount);
  const blendRateCost = alloc.totalHours > 0 ? alloc.totalCost / alloc.totalHours : 0;
  const blendRateSale = alloc.totalHours > 0 ? finalPrice / alloc.totalHours : 0;
  const totalWeeks = (phases || []).reduce((s, p) => s + Number(p.weeks || 0), 0);
  const realMargin = finalPrice > 0 ? (finalPrice - fin.costProtected) / finalPrice : 0;
  return { ...alloc, ...fin, discount, finalPrice, blendRateCost, blendRateSale, totalWeeks, realMargin };
};

export const formatUSD = (n) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
};

export const formatUSD2 = (n) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
};

export const formatPct = (n) => {
  if (n == null || isNaN(n)) return '—';
  return `${(Number(n) * 100).toFixed(1)}%`;
};

export const SPECIALTIES = ['Desarrollo','Infra & Seg','Testing','Product Mgmt','Project Mgmt','Data+AI','UX/UI','Análisis Func','DevOps/SRE'];
export const EMPTY_LINE = { specialty:'', role_title:'', level:null, country:'Colombia', bilingual:false, tools:'Básico', stack:'Especializada', modality:'Remoto', quantity:1, duration_months:6, hours_per_week:40, phase:'', cost_hour:0, rate_hour:0, rate_month:0, total:0 };

export const EMPTY_PROFILE = {
  specialty: '', role_title: '', level: null,
  country: 'Colombia', bilingual: false, stack: 'Especializada',
  cost_hour: 0, rate_hour: 0,
  // legacy fields kept so the row shape matches quotation_lines for persistence
  tools: '', modality: '', quantity: 1, duration_months: 0, hours_per_week: 0, phase: '',
  rate_month: 0, total: 0,
};

export const DEFAULT_PHASES = [
  { name: 'Planeación', weeks: 2, description: 'Discovery, arquitectura, plan de trabajo' },
  { name: 'Desarrollo', weeks: 10, description: 'Construcción iterativa del producto' },
  { name: 'QA / Estabilización', weeks: 2, description: 'Pruebas integrales y bug bash' },
  { name: 'Transferencia de Conocimiento', weeks: 1, description: 'Capacitación y handover' },
  { name: 'Garantía', weeks: 2, description: 'Soporte post-entrega' },
];

/** Color palette rotation for phase column headers (CSS variables). */
export const PHASE_COLORS = ['var(--purple-dark)', 'var(--teal-mid)', 'var(--orange)', 'var(--purple-mid)', 'var(--teal)', 'var(--purple-light)'];
