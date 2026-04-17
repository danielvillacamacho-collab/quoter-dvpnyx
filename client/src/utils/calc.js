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
