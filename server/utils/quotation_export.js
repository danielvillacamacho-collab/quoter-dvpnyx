/*
 * Quotation export — xlsx and pdf generators for fixed-scope proyectos.
 *
 * Both generators take (quotation, params) where:
 *   quotation = { project_name, client_name, commercial_name, preventa_name,
 *                 discount_pct, lines[], phases[], epics[], milestones[],
 *                 metadata: { allocation, financial_overrides } }
 *   params    = canonical parameters grouped by category (as returned by
 *               loadCanonicalParams in routes/quotations.js)
 *
 * The XLSX exposes the internal cost breakdown (for ops / finance). The
 * PDF is a client-facing proposal — it deliberately OMITS cost_hour,
 * internal multipliers, and any cost/buffer/warranty numbers.
 *
 * Spec: `spec_editor_proyectos.docx` — Spec 2 (Export Excel + PDF).
 */

const DVP_PURPLE = 'FF56234D';
const DVP_TEAL = 'FF00D8D4';

/* ========================================================== *
 *                       CALCULATIONS                          *
 * Mirrored from client/src/utils/calc.js so the server can    *
 * produce authoritative numbers without a round-trip.         *
 * ========================================================== */

function getParam(params, category, key) {
  const arr = params?.[category] || [];
  const p = arr.find((x) => x.key === key);
  return p ? Number(p.value) : null;
}

function calcCostHour(profile, params) {
  if (!profile || !profile.level) return 0;
  const lv = getParam(params, 'level', `L${profile.level}`);
  const geo = getParam(params, 'geo', profile.country);
  const bil = getParam(params, 'bilingual', profile.bilingual ? 'Sí' : 'No');
  const stack = getParam(params, 'stack', profile.stack);
  const hoursMonth = getParam(params, 'project', 'hours_month') || 160;
  if (lv == null || geo == null || bil == null || stack == null) return 0;
  return (lv / hoursMonth) * geo * bil * stack;
}

function applyFinancialOverrides(params, overrides) {
  if (!params || !overrides) return params;
  const map = { buffer: 'buffer', warranty: 'warranty', margin: 'min_margin' };
  const project = (params.project || []).map((p) => {
    const k = Object.keys(map).find((mk) => map[mk] === p.key);
    if (k && overrides[k] != null && !isNaN(overrides[k])) {
      return { ...p, value: Number(overrides[k]) };
    }
    return p;
  });
  return { ...params, project };
}

function calcSummary(quotation, params) {
  const effective = applyFinancialOverrides(params, quotation?.metadata?.financial_overrides || {});
  const profiles = quotation.lines || [];
  const phases = quotation.phases || [];
  const allocation = quotation?.metadata?.allocation || {};

  // Enrich profiles with cost_hour from params
  const enriched = profiles.map((p) => ({ ...p, cost_hour: p.cost_hour || calcCostHour(p, effective) }));

  let totalHours = 0;
  let totalCost = 0;
  const byProfile = enriched.map((p, pIdx) => {
    let hours = 0;
    let cost = 0;
    phases.forEach((ph, fIdx) => {
      const hw = Number(allocation?.[pIdx]?.[fIdx] || 0);
      const h = hw * Number(ph.weeks || 0);
      const c = h * Number(p.cost_hour || 0);
      hours += h;
      cost += c;
    });
    totalHours += hours;
    totalCost += cost;
    return { ...p, hours, cost };
  });
  const byPhase = phases.map((ph, fIdx) => {
    let hrWeek = 0;
    let hours = 0;
    let cost = 0;
    enriched.forEach((p, pIdx) => {
      const hw = Number(allocation?.[pIdx]?.[fIdx] || 0);
      hrWeek += hw;
      hours += hw * Number(ph.weeks || 0);
      cost += hw * Number(ph.weeks || 0) * Number(p.cost_hour || 0);
    });
    return { ...ph, hrWeek, hours, cost };
  });

  const buffer = getParam(effective, 'project', 'buffer') || 0;
  const warranty = getParam(effective, 'project', 'warranty') || 0;
  const margin = getParam(effective, 'project', 'min_margin') || 0;
  const costWithBuffer = totalCost * (1 + buffer);
  const costProtected = costWithBuffer * (1 + warranty);
  const salePrice = margin >= 1 ? 0 : costProtected / (1 - margin);
  const discount = Number(quotation.discount_pct || 0);
  const finalPrice = salePrice * (1 - discount);
  const totalWeeks = phases.reduce((s, p) => s + Number(p.weeks || 0), 0);
  const blendRateSale = totalHours > 0 ? finalPrice / totalHours : 0;
  const realMargin = finalPrice > 0 ? (finalPrice - costProtected) / finalPrice : 0;

  return {
    profiles: byProfile, phases: byPhase,
    totalHours, totalCost, totalWeeks,
    buffer, warranty, margin,
    costWithBuffer, costProtected, salePrice, discount, finalPrice,
    blendRateSale, realMargin,
  };
}

/* ========================================================== *
 *                       XLSX GENERATOR                        *
 * ========================================================== */

async function generateXlsx(quotation, params) {
  // exceljs is an optional dep — require lazily so environments without it
  // still boot. The route handler already rejects with 503 if missing.
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DVPNYX Quoter';
  wb.created = new Date();

  const summary = calcSummary(quotation, params);

  const money = '"$"#,##0';
  const moneyDec = '"$"#,##0.00';
  const pct = '0%';

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DVP_PURPLE } };
  const headerFont = { color: { argb: 'FFFFFFFF' }, bold: true };

  /* ---------- Hoja 1: Resumen ---------- */
  const resumen = wb.addWorksheet('Resumen');
  resumen.columns = [
    { width: 32 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 },
  ];
  resumen.mergeCells('A1:E1');
  resumen.getCell('A1').value = 'DVPNYX — Propuesta de Proyecto';
  resumen.getCell('A1').font = { size: 18, bold: true, color: { argb: DVP_PURPLE } };
  resumen.getCell('A1').alignment = { horizontal: 'left' };
  resumen.addRow([]);

  const meta = [
    ['Proyecto', quotation.project_name || '—'],
    ['Cliente', quotation.client_name || '—'],
    ['Comercial', quotation.commercial_name || '—'],
    ['Pre-venta', quotation.preventa_name || '—'],
    ['Fecha', new Date().toISOString().slice(0, 10)],
  ];
  meta.forEach(([k, v]) => {
    const r = resumen.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  });
  resumen.addRow([]);

  // Team summary (ops view — includes internal cost/hr)
  resumen.addRow(['EQUIPO PROPUESTO']).font = { bold: true, color: { argb: DVP_PURPLE } };
  const teamHeader = resumen.addRow(['Rol', 'Especialidad', 'Nivel', 'Costo/Hr', 'Tarifa/Hr']);
  teamHeader.eachCell((c) => { c.fill = headerFill; c.font = headerFont; });
  (quotation.lines || []).forEach((l) => {
    const row = resumen.addRow([
      l.role_title || '—',
      l.specialty || '—',
      `L${l.level || '?'}`,
      Number(l.cost_hour || 0),
      Number(l.rate_hour || 0),
    ]);
    row.getCell(4).numFmt = moneyDec;
    row.getCell(5).numFmt = moneyDec;
  });
  resumen.addRow([]);

  // Cascade
  resumen.addRow(['CASCADA FINANCIERA']).font = { bold: true, color: { argb: DVP_PURPLE } };
  const cascade = [
    ['Costo base del equipo', summary.totalCost],
    [`(+) Buffer (${(summary.buffer * 100).toFixed(0)}%)`, summary.costWithBuffer - summary.totalCost],
    ['Subtotal con buffer', summary.costWithBuffer],
    [`(+) Garantía (${(summary.warranty * 100).toFixed(0)}%)`, summary.costProtected - summary.costWithBuffer],
    ['Costo protegido', summary.costProtected],
    [`Margen de contribución (${(summary.margin * 100).toFixed(0)}%)`, summary.salePrice - summary.costProtected],
    ['Precio de venta', summary.salePrice],
    [`Descuento (${(summary.discount * 100).toFixed(0)}%)`, -summary.salePrice * summary.discount],
    ['PRECIO FINAL', summary.finalPrice],
  ];
  cascade.forEach(([k, v], i) => {
    const r = resumen.addRow([k, v]);
    r.getCell(2).numFmt = money;
    if (k === 'PRECIO FINAL') {
      r.font = { bold: true, size: 14, color: { argb: DVP_TEAL } };
    }
  });
  resumen.addRow([]);
  resumen.addRow(['MÉTRICAS']).font = { bold: true, color: { argb: DVP_PURPLE } };
  resumen.addRow(['Total horas', summary.totalHours]);
  resumen.addRow(['Total semanas', summary.totalWeeks]);
  resumen.addRow(['Blend rate venta (USD/hr)', summary.blendRateSale]).getCell(2).numFmt = moneyDec;
  resumen.addRow(['Margen real', summary.realMargin]).getCell(2).numFmt = pct;

  /* ---------- Hoja 2: Asignación por fase ---------- */
  const asig = wb.addWorksheet('Asignación por fase');
  const asigHeaderCells = ['Perfil', 'Nivel', ...summary.phases.map((p) => `${p.name} (${p.weeks || 0} sem)`), 'Total hrs'];
  asig.columns = asigHeaderCells.map((_, i) => ({ width: i === 0 ? 28 : 18 }));
  const asigHead = asig.addRow(asigHeaderCells);
  asigHead.eachCell((c) => { c.fill = headerFill; c.font = headerFont; });
  summary.profiles.forEach((p) => {
    const cells = [p.role_title || '—', `L${p.level || '?'}`];
    (summary.phases).forEach((_, fIdx) => {
      const hw = Number(quotation?.metadata?.allocation?.[summary.profiles.indexOf(p)]?.[fIdx] || 0);
      const h = hw * Number(summary.phases[fIdx].weeks || 0);
      cells.push(h);
    });
    cells.push(p.hours);
    asig.addRow(cells);
  });
  // Totals row
  const totalCells = ['TOTAL', ''];
  summary.phases.forEach((ph) => totalCells.push(ph.hours));
  totalCells.push(summary.totalHours);
  const totRow = asig.addRow(totalCells);
  totRow.font = { bold: true };

  /* ---------- Hoja 3: Plan de pagos ---------- */
  if ((quotation.milestones || []).length > 0) {
    const pagos = wb.addWorksheet('Plan de pagos');
    pagos.columns = [{ width: 28 }, { width: 20 }, { width: 12 }, { width: 16 }, { width: 16 }];
    const h = pagos.addRow(['Hito', 'Fase', '% del total', 'Monto (USD)', 'Fecha esperada']);
    h.eachCell((c) => { c.fill = headerFill; c.font = headerFont; });
    quotation.milestones.forEach((m) => {
      const r = pagos.addRow([m.name || '—', m.phase || '—', Number(m.percentage || 0) / 100, Number(m.amount || 0), m.expected_date || '']);
      r.getCell(3).numFmt = pct;
      r.getCell(4).numFmt = money;
    });
    const tot = pagos.addRow([
      'TOTAL', '',
      quotation.milestones.reduce((s, m) => s + Number(m.percentage || 0), 0) / 100,
      quotation.milestones.reduce((s, m) => s + Number(m.amount || 0), 0), '',
    ]);
    tot.font = { bold: true };
    tot.getCell(3).numFmt = pct;
    tot.getCell(4).numFmt = money;
  }

  /* ---------- Hoja 4: Épicas ---------- */
  if ((quotation.epics || []).length > 0) {
    const epics = wb.addWorksheet('Épicas');
    const profiles = quotation.lines || [];
    const heads = ['Épica', 'Prioridad', ...profiles.map((p) => p.role_title || `P${profiles.indexOf(p) + 1}`), 'Total hrs'];
    epics.columns = heads.map((_, i) => ({ width: i === 0 ? 28 : 16 }));
    const h = epics.addRow(heads);
    h.eachCell((c) => { c.fill = headerFill; c.font = headerFont; });
    quotation.epics.forEach((e) => {
      const cells = [e.name || '—', e.priority || 'Media'];
      profiles.forEach((_, pIdx) => cells.push(Number(e.hours_by_profile?.[pIdx] || 0)));
      cells.push(Number(e.total_hours || 0));
      epics.addRow(cells);
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/* ========================================================== *
 *                       PDF GENERATOR                         *
 * Client-facing proposal — NO internal costs, multipliers, or *
 * buffer/warranty/margin detail. Only tarifa/hora (externa)   *
 * and precio final.                                           *
 * ========================================================== */

async function generatePdf(quotation, params) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const summary = calcSummary(quotation, params);
  const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
  const moneyDec = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

  /* ---------- Page 1: cover ---------- */
  doc.fillColor('#56234d').fontSize(28).font('Helvetica-Bold').text('DVPNYX', { align: 'center' });
  doc.moveDown(0.3);
  doc.fillColor('#666').fontSize(11).font('Helvetica').text('Unconventional People. Disruptive Tech.', { align: 'center' });
  doc.moveDown(6);
  doc.fillColor('#111').fontSize(22).font('Helvetica-Bold').text('Propuesta Comercial', { align: 'center' });
  doc.moveDown(0.6);
  doc.fontSize(18).font('Helvetica').text(quotation.project_name || '—', { align: 'center' });
  doc.moveDown(0.2);
  doc.fillColor('#666').fontSize(14).text(quotation.client_name || '—', { align: 'center' });
  doc.moveDown(4);
  doc.fillColor('#111').fontSize(11).font('Helvetica');
  doc.text(`Responsable comercial: ${quotation.commercial_name || '—'}`, { align: 'center' });
  doc.text(`Ingeniería de pre-venta: ${quotation.preventa_name || '—'}`, { align: 'center' });
  doc.moveDown(1);
  doc.fillColor('#999').fontSize(10).text(`Fecha: ${new Date().toISOString().slice(0, 10)}`, { align: 'center' });

  /* ---------- Page 2: executive summary ---------- */
  doc.addPage();
  doc.fillColor('#56234d').fontSize(16).font('Helvetica-Bold').text('Resumen Ejecutivo');
  doc.moveDown(0.6);
  doc.fillColor('#111').fontSize(11).font('Helvetica');
  doc.text('Este documento describe la propuesta comercial para el alcance del proyecto, el equipo propuesto y la inversión requerida.');
  doc.moveDown(1);

  doc.fillColor('#56234d').fontSize(13).font('Helvetica-Bold').text('Equipo propuesto');
  doc.moveDown(0.3);
  doc.fillColor('#111').fontSize(10).font('Helvetica');
  // Simple table (role · level · tarifa/hr) — NO cost_hour.
  const rowH = 18;
  const startX = doc.x;
  let y = doc.y;
  const cols = [
    { label: 'Rol', width: 210 },
    { label: 'Especialidad', width: 140 },
    { label: 'Nivel', width: 50 },
    { label: 'Tarifa/Hr', width: 90 },
  ];
  // Header
  doc.fillColor('#fff').rect(startX, y, cols.reduce((s, c) => s + c.width, 0), rowH).fill('#56234d').fillColor('#fff');
  let x = startX;
  cols.forEach((c) => {
    doc.text(c.label, x + 6, y + 4, { width: c.width - 12, continued: false });
    x += c.width;
  });
  y += rowH;
  (quotation.lines || []).forEach((l, i) => {
    if (y > 700) { doc.addPage(); y = 54; }
    if (i % 2 === 1) doc.fillColor('#f7f5fa').rect(startX, y, cols.reduce((s, c) => s + c.width, 0), rowH).fill();
    doc.fillColor('#111').font('Helvetica');
    let cx = startX;
    const vals = [l.role_title || '—', l.specialty || '—', `L${l.level || '?'}`, moneyDec(l.rate_hour || 0)];
    vals.forEach((v, j) => {
      doc.text(String(v), cx + 6, y + 4, { width: cols[j].width - 12 });
      cx += cols[j].width;
    });
    y += rowH;
  });
  doc.y = y;
  doc.moveDown(1);

  // Metrics (no internal cost)
  doc.fillColor('#56234d').fontSize(13).font('Helvetica-Bold').text('Métricas clave');
  doc.moveDown(0.3);
  doc.fillColor('#111').fontSize(11).font('Helvetica');
  const mets = [
    ['Total horas del proyecto', String(summary.totalHours)],
    ['Duración estimada', `${summary.totalWeeks} semanas`],
    ['Tarifa blend', `${moneyDec(summary.blendRateSale)} / hr`],
  ];
  mets.forEach(([k, v]) => {
    doc.font('Helvetica').text(`${k}: `, { continued: true }).font('Helvetica-Bold').text(v);
  });
  doc.moveDown(1);

  // Precio final destacado
  doc.fillColor('#00d8d4').fontSize(14).font('Helvetica-Bold').text('INVERSIÓN TOTAL');
  doc.fillColor('#111').fontSize(26).font('Helvetica-Bold').text(money(summary.finalPrice), { align: 'left' });
  if (summary.discount > 0) {
    doc.fillColor('#666').fontSize(10).font('Helvetica').text(`Incluye descuento negociado del ${(summary.discount * 100).toFixed(0)}%`);
  }

  /* ---------- Page 3: allocation matrix ---------- */
  if (summary.phases.length > 0 && summary.profiles.length > 0) {
    doc.addPage();
    doc.fillColor('#56234d').fontSize(16).font('Helvetica-Bold').text('Distribución por Fase');
    doc.moveDown(0.8);
    doc.fillColor('#111').fontSize(10).font('Helvetica');

    const colW = Math.min(70, Math.floor(468 / (summary.phases.length + 2)));
    const profW = 468 - colW * (summary.phases.length + 1);
    let ax = startX;
    let ay = doc.y;
    const h = rowH;

    // Header
    doc.fillColor('#56234d').rect(ax, ay, profW + colW * (summary.phases.length + 1), h).fill();
    doc.fillColor('#fff').font('Helvetica-Bold');
    doc.text('Perfil', ax + 6, ay + 4, { width: profW - 12 });
    let hx = ax + profW;
    summary.phases.forEach((ph) => {
      doc.text(`${ph.name}\n(${ph.weeks}s)`, hx + 4, ay + 2, { width: colW - 8, align: 'center' });
      hx += colW;
    });
    doc.text('Total h', hx + 4, ay + 4, { width: colW - 8, align: 'center' });
    ay += h;

    summary.profiles.forEach((p, pIdx) => {
      if (ay > 720) { doc.addPage(); ay = 54; }
      if (pIdx % 2 === 1) doc.fillColor('#f7f5fa').rect(ax, ay, profW + colW * (summary.phases.length + 1), h).fill();
      doc.fillColor('#111').font('Helvetica');
      doc.text(p.role_title || `Perfil ${pIdx + 1}`, ax + 6, ay + 4, { width: profW - 12 });
      let cx2 = ax + profW;
      summary.phases.forEach((ph, fIdx) => {
        const hw = Number(quotation?.metadata?.allocation?.[pIdx]?.[fIdx] || 0);
        const hours = hw * Number(ph.weeks || 0);
        doc.text(String(hours || '—'), cx2 + 4, ay + 4, { width: colW - 8, align: 'center' });
        cx2 += colW;
      });
      doc.font('Helvetica-Bold').text(String(p.hours), cx2 + 4, ay + 4, { width: colW - 8, align: 'center' });
      ay += h;
    });
    doc.y = ay;
  }

  /* ---------- Page 4: milestones (if any) ---------- */
  if ((quotation.milestones || []).length > 0) {
    doc.addPage();
    doc.fillColor('#56234d').fontSize(16).font('Helvetica-Bold').text('Plan de Pagos por Hitos');
    doc.moveDown(0.6);
    doc.fillColor('#111').fontSize(11).font('Helvetica');
    quotation.milestones.forEach((m, i) => {
      doc.font('Helvetica-Bold').text(`${i + 1}. ${m.name || `Hito ${i + 1}`}`);
      doc.font('Helvetica').text(`   Fase: ${m.phase || '—'}`);
      doc.text(`   ${m.percentage || 0}% — ${money(m.amount || 0)}`);
      if (m.expected_date) doc.text(`   Fecha esperada: ${String(m.expected_date).slice(0, 10)}`);
      doc.moveDown(0.4);
    });
  }

  doc.end();
  return finished;
}

function sanitizeFilenamePart(name) {
  return String(name || 'Proyecto')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'Proyecto';
}

function buildFilename(quotation, ext) {
  const date = new Date().toISOString().slice(0, 10);
  return `DVPNYX_Proyecto_${sanitizeFilenamePart(quotation.project_name)}_${date}.${ext}`;
}

module.exports = {
  generateXlsx,
  generatePdf,
  buildFilename,
  // exported for tests
  _internals: { calcSummary, calcCostHour, applyFinancialOverrides, sanitizeFilenamePart },
};
