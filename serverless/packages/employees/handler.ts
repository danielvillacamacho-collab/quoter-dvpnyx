import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated, error } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createEmployeeRepository } from './repository';
import { createAreaRepository } from './areas.repository';
import { createSkillRepository } from './skills.repository';
import { createEmployeeService } from './service';
import { EMPLOYEE_SORTABLE } from './types';
import { NotFound, Conflict } from '@shared/errors';

const db = getPool();
const evts = createEventEmitter();
const empSvc = createEmployeeService(createEmployeeRepository(db), evts, db);
const areaRepo = createAreaRepository(db);
const skillRepo = createSkillRepository(db);

const router = createRouter();

// ── Employees ───────────────────────────────────────────────────────
router.get('/api/employees/lookup', async (event) => {
  const qs = event.queryStringParameters || {};
  const includeTerminated = String(qs.include_terminated || '').toLowerCase() === 'true';
  const wheres = ['e.deleted_at IS NULL'];
  if (!includeTerminated) wheres.push(`e.status <> 'terminated'`);
  const { rows } = await db.query(
    `SELECT e.id, e.first_name, e.last_name, e.level, e.status,
            e.area_id, a.name AS area_name, e.weekly_capacity_hours
       FROM employees e
       LEFT JOIN areas a ON a.id = e.area_id
      WHERE ${wheres.join(' AND ')}
      ORDER BY e.last_name, e.first_name`,
  );
  return ok({ data: rows });
});
// ci-test-2026-05-14
router.get('/api/employees', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs, { maxLimit: 1000 });
  const sort = parseSort(qs, EMPLOYEE_SORTABLE, { defaultField: 'last_name', defaultDir: 'asc', tieBreaker: 'e.id ASC' });
  return paginated(await empSvc.list({ page, limit, offset, filters: qs, sort }));
});

router.get('/api/employees/:id', async (event) => ok(await empSvc.getById(event.pathParameters!.id!)));

router.post('/api/employees', async (event, user) => {
  requireAdmin(user);
  return created(await empSvc.create(JSON.parse(event.body || '{}'), user));
});

router.put('/api/employees/:id', async (event, user) => {
  requireAdmin(user);
  return ok(await empSvc.update(event.pathParameters!.id!, JSON.parse(event.body || '{}'), user));
});

router.delete('/api/employees/:id', async (event, user) => {
  requireAdmin(user);
  await empSvc.softDelete(event.pathParameters!.id!, user);
  return message('Empleado eliminado');
});

router.get('/api/employees/:id/skills', async (event) => ok({ data: await empSvc.getSkills(event.pathParameters!.id!) }));

/* Individual skill assignment (matches monolith POST /:id/skills) */
router.post('/api/employees/:id/skills', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const { skill_id, proficiency, years_experience, notes } = body;
  if (!skill_id) return error(400, { error: 'skill_id es requerido' });

  const VALID_PROFICIENCY = ['beginner', 'intermediate', 'advanced', 'expert'];
  if (proficiency && !VALID_PROFICIENCY.includes(proficiency)) return error(400, { error: 'proficiency inválido' });

  const { rows: sRows } = await db.query(`SELECT id, name, active FROM skills WHERE id=$1`, [skill_id]);
  if (!sRows.length) return error(400, { error: 'skill no existe' });
  if (!sRows[0].active) return error(400, { error: 'El skill está inactivo y no puede asignarse' });

  const { rows: eRows } = await db.query(`SELECT id FROM employees WHERE id=$1 AND deleted_at IS NULL`, [event.pathParameters!.id!]);
  if (!eRows.length) return error(404, { error: 'Empleado no encontrado' });

  try {
    const { rows } = await db.query(
      `INSERT INTO employee_skills (employee_id, skill_id, proficiency, years_experience, notes)
       VALUES ($1,$2,COALESCE($3,'intermediate'),$4,$5) RETURNING *`,
      [event.pathParameters!.id!, skill_id, proficiency || null, years_experience != null ? Number(years_experience) : null, notes || null],
    );
    return created(rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') return error(409, { error: 'Este empleado ya tiene ese skill asignado' });
    throw err;
  }
});

/* Individual skill update (matches monolith PUT /:id/skills/:skillId) */
router.put('/api/employees/:id/skills/:skillId', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const VALID_PROFICIENCY = ['beginner', 'intermediate', 'advanced', 'expert'];
  if (body.proficiency && !VALID_PROFICIENCY.includes(body.proficiency)) return error(400, { error: 'proficiency inválido' });

  const { rows } = await db.query(
    `UPDATE employee_skills SET
        proficiency      = COALESCE($1, proficiency),
        years_experience = COALESCE($2, years_experience),
        notes            = COALESCE($3, notes)
      WHERE employee_id=$4 AND skill_id=$5
      RETURNING *`,
    [body.proficiency ?? null, body.years_experience != null ? Number(body.years_experience) : null, body.notes ?? null, event.pathParameters!.id!, event.pathParameters!.skillId!],
  );
  if (!rows.length) return error(404, { error: 'Asignación no encontrada' });
  return ok(rows[0]);
});

/* Individual skill removal (matches monolith DELETE /:id/skills/:skillId) */
router.delete('/api/employees/:id/skills/:skillId', async (event, user) => {
  requireAdmin(user);
  const { rows } = await db.query(
    `DELETE FROM employee_skills WHERE employee_id=$1 AND skill_id=$2 RETURNING *`,
    [event.pathParameters!.id!, event.pathParameters!.skillId!],
  );
  if (!rows.length) return error(404, { error: 'Asignación no encontrada' });
  return message('Skill removido');
});

/* Bulk skill set (lambda-only helper, keep for any internal use) */
router.put('/api/employees/:id/skills', async (event, user) => {
  requireAdmin(user);
  const { skill_ids } = JSON.parse(event.body || '{}');
  return ok({ data: await empSvc.setSkills(event.pathParameters!.id!, skill_ids || [], user) });
});

// ── Areas ───────────────────────────────────────────────────────────
router.get('/api/areas', async (event) => {
  const qs = event.queryStringParameters || {};
  return ok({ data: await areaRepo.findAll({ active: qs.active }) });
});

router.get('/api/areas/:id', async (event) => {
  const area = await areaRepo.findById(event.pathParameters!.id!);
  if (!area) throw new NotFound('Área', event.pathParameters!.id!);
  return ok(area);
});

router.post('/api/areas', async (event, user) => {
  requireAdmin(user);
  return created(await areaRepo.create(JSON.parse(event.body || '{}')));
});

router.put('/api/areas/:id', async (event, user) => {
  requireAdmin(user);
  const area = await areaRepo.update(event.pathParameters!.id!, JSON.parse(event.body || '{}'));
  if (!area) throw new NotFound('Área', event.pathParameters!.id!);
  return ok(area);
});

router.delete('/api/areas/:id', async (event, user) => {
  requireAdmin(user);
  const hasEmps = await areaRepo.hasActiveEmployees(event.pathParameters!.id!);
  if (hasEmps) throw new Conflict('No se puede desactivar: tiene empleados activos');
  const area = await areaRepo.deactivate(event.pathParameters!.id!);
  if (!area) throw new NotFound('Área', event.pathParameters!.id!);
  return ok(area);
});

router.post('/api/areas/:id/deactivate', async (event, user) => {
  requireAdmin(user);
  const hasEmps = await areaRepo.hasActiveEmployees(event.pathParameters!.id!);
  if (hasEmps) throw new Conflict('No se puede desactivar: tiene empleados activos');
  const area = await areaRepo.deactivate(event.pathParameters!.id!);
  if (!area) return error(404, { error: 'Área no encontrada o ya inactiva' });
  return ok(area);
});

router.post('/api/areas/:id/activate', async (event, user) => {
  requireAdmin(user);
  const area = await areaRepo.activate(event.pathParameters!.id!);
  if (!area) return error(404, { error: 'Área no encontrada o ya activa' });
  return ok(area);
});

// ── Skills ──────────────────────────────────────────────────────────
router.get('/api/skills', async (event) => {
  const qs = event.queryStringParameters || {};
  return ok({ data: await skillRepo.findAll({ active: qs.active, category: qs.category, search: qs.search }) });
});

router.get('/api/skills/:id', async (event) => {
  const skill = await skillRepo.findById(event.pathParameters!.id!);
  if (!skill) throw new NotFound('Skill', event.pathParameters!.id!);
  return ok(skill);
});

router.post('/api/skills', async (event, user) => {
  requireAdmin(user);
  return created(await skillRepo.create(JSON.parse(event.body || '{}')));
});

router.put('/api/skills/:id', async (event, user) => {
  requireAdmin(user);
  const skill = await skillRepo.update(event.pathParameters!.id!, JSON.parse(event.body || '{}'));
  if (!skill) throw new NotFound('Skill', event.pathParameters!.id!);
  return ok(skill);
});

router.delete('/api/skills/:id', async (event, user) => {
  requireAdmin(user);
  const hasEmps = await skillRepo.hasEmployees(event.pathParameters!.id!);
  if (hasEmps) throw new Conflict('No se puede desactivar: tiene empleados asociados');
  const skill = await skillRepo.deactivate(event.pathParameters!.id!);
  if (!skill) throw new NotFound('Skill', event.pathParameters!.id!);
  return ok(skill);
});

router.post('/api/skills/:id/deactivate', async (event, user) => {
  requireAdmin(user);
  const hasEmps = await skillRepo.hasEmployees(event.pathParameters!.id!);
  if (hasEmps) throw new Conflict('No se puede desactivar: tiene empleados asociados');
  const skill = await skillRepo.deactivate(event.pathParameters!.id!);
  if (!skill) return error(404, { error: 'Skill no encontrado o ya inactivo' });
  return ok(skill);
});

router.post('/api/skills/:id/activate', async (event, user) => {
  requireAdmin(user);
  const skill = await skillRepo.activate(event.pathParameters!.id!);
  if (!skill) return error(404, { error: 'Skill no encontrado o ya activo' });
  return ok(skill);
});

// ── Employee Costs ───────────────────────────────────────────────
const PERIOD_RE = /^[0-9]{6}$/;

function previousPeriod(period: string): string {
  let y = Number(period.slice(0, 4));
  let m = Number(period.slice(4)) - 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}${String(m).padStart(2, '0')}`;
}

function convertToUsd(gross: number, currency: string, fxRate: number | null): { cost_usd: number | null; exchange_rate_used: number | null } {
  if (currency === 'USD') return { cost_usd: gross, exchange_rate_used: 1 };
  if (fxRate == null) return { cost_usd: null, exchange_rate_used: null };
  return { cost_usd: parseFloat((gross / fxRate).toFixed(4)), exchange_rate_used: fxRate };
}

async function resolveRatesBulk(db: ReturnType<typeof import('@shared/db/connection').getPool>, currencies: string[], period: string): Promise<Record<string, Array<{ period: string; rate: number }>>> {
  const fxByCcy: Record<string, Array<{ period: string; rate: number }>> = {};
  if (currencies.length === 0) return fxByCcy;
  const { rows } = await db.query(
    `SELECT yyyymm, currency, usd_rate FROM exchange_rates WHERE currency = ANY($1::varchar[]) AND yyyymm <= $2 ORDER BY yyyymm DESC`,
    [currencies, period],
  );
  for (const r of rows as Record<string, unknown>[]) {
    const ccy = r.currency as string;
    if (!fxByCcy[ccy]) fxByCcy[ccy] = [];
    fxByCcy[ccy].push({ period: r.yyyymm as string, rate: Number(r.usd_rate) });
  }
  return fxByCcy;
}

function pickRate(fxByCcy: Record<string, Array<{ period: string; rate: number }>>, ccy: string, period: string): { rate: number | null; fallback_period: string | null } {
  if (ccy === 'USD') return { rate: 1, fallback_period: null };
  const list = fxByCcy[ccy] || [];
  const direct = list.find(r => r.period === period);
  if (direct) return { rate: direct.rate, fallback_period: null };
  const fb = list[0];
  return fb ? { rate: fb.rate, fallback_period: fb.period } : { rate: null, fallback_period: null };
}

router.get('/api/employee-costs', async (event, user) => {
  requireAdmin(user);
  const qs = event.queryStringParameters || {};
  const d = new Date();
  const period = String(qs.period || `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`).trim();
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido (formato YYYYMM)' });

  const pFirst = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;
  const pLast = `(DATE '${pFirst}' + INTERVAL '1 month - 1 day')::date`;

  const [{ rows: employees }, { rows: costs }, { rows: params }] = await Promise.all([
    db.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.country, e.status,
              e.start_date, e.end_date, a.name AS area_name
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
        WHERE e.deleted_at IS NULL
          AND e.start_date <= ${pLast}
          AND (e.end_date IS NULL OR e.end_date >= DATE '${pFirst}')
          AND e.status IN ('active','on_leave','bench')
        ORDER BY e.first_name, e.last_name`,
    ),
    db.query(`SELECT * FROM employee_costs WHERE period = $1`, [period]),
    db.query(`SELECT key, value FROM parameters WHERE category IN ('cost_per_level','level_costs') ORDER BY key`),
  ]);

  const costsByEmp = new Map((costs as Record<string, unknown>[]).map(c => [c.employee_id as string, c]));
  const theoretical = new Map<string, number>();
  for (const p of params as Record<string, unknown>[]) {
    let lvl = String(p.key).trim().toUpperCase();
    if (/^[0-9]+$/.test(lvl)) lvl = `L${lvl}`;
    theoretical.set(lvl, Number(p.value));
  }

  const data = (employees as Record<string, unknown>[]).map(emp => {
    const cost = (costsByEmp.get(emp.id as string) || null) as Record<string, unknown> | null;
    const theoreticalUsd = theoretical.get(emp.level as string) ?? null;
    const costUsd = cost?.cost_usd != null ? Number(cost.cost_usd) : null;
    const delta = (cost && costUsd != null && theoreticalUsd)
      ? { delta: costUsd - theoreticalUsd, deltaPct: (costUsd - theoreticalUsd) / theoreticalUsd, zone: costUsd > theoreticalUsd * 1.1 ? 'above' : costUsd < theoreticalUsd * 0.9 ? 'below' : 'ok' }
      : { delta: null, deltaPct: null, zone: theoreticalUsd ? 'no_data' : 'no_baseline' };
    return { employee: emp, cost, theoretical_cost_usd: theoreticalUsd, delta };
  });

  const withCost = data.filter(d => d.cost).length;
  const totalCostUsd = data.reduce((s, d) => s + (d.cost?.cost_usd ? Number(d.cost.cost_usd) : 0), 0);
  const summary = {
    period, total_employees: data.length, with_cost: withCost,
    without_cost: data.length - withCost,
    total_cost_usd: totalCostUsd,
    avg_cost_usd: withCost > 0 ? Math.round((totalCostUsd / withCost) * 100) / 100 : 0,
    locked_count: data.filter(d => d.cost?.locked).length,
  };
  return ok({ period, data, summary });
});

// ── Employee Costs: Export ───────────────────────────────────────────
const EXPORT_HEADERS = ['Nombre', 'Nivel', 'Área', 'País', 'Moneda', 'Costo bruto', 'Costo USD', 'Teórico USD', 'Estado', 'Notas'];
const EXPORT_KEYS = ['nombre', 'nivel', 'area', 'pais', 'moneda', 'costo_bruto', 'costo_usd', 'teorico_usd', 'estado', 'notas'] as const;

router.get('/api/employee-costs/export', async (event, user) => {
  requireAdmin(user);
  const qs = event.queryStringParameters || {};
  const d = new Date();
  const period = String(qs.period || `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`).trim();
  const format = String(qs.format || 'csv').toLowerCase();

  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido (formato YYYYMM)' });
  if (!['csv', 'xlsx', 'pdf'].includes(format)) return error(400, { error: 'format debe ser csv, xlsx o pdf' });

  const pFirst = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;
  const pLast = `(DATE '${pFirst}' + INTERVAL '1 month - 1 day')::date`;
  const periodLabel = `${period.slice(0, 4)}-${period.slice(4, 6)}`;

  const [{ rows: employees }, { rows: costs }, { rows: params }] = await Promise.all([
    db.query(
      `SELECT e.id, e.first_name, e.last_name, e.level, e.country, a.name AS area_name
         FROM employees e
         LEFT JOIN areas a ON a.id = e.area_id
        WHERE e.deleted_at IS NULL
          AND e.start_date <= ${pLast}
          AND (e.end_date IS NULL OR e.end_date >= DATE '${pFirst}')
          AND e.status IN ('active','on_leave','bench')
        ORDER BY e.first_name, e.last_name`,
    ),
    db.query(`SELECT * FROM employee_costs WHERE period = $1`, [period]),
    db.query(`SELECT key, value FROM parameters WHERE category IN ('cost_per_level','level_costs') ORDER BY key`),
  ]);

  const costsByEmp = new Map((costs as Record<string, unknown>[]).map(c => [c.employee_id as string, c]));
  const theoretical = new Map<string, number>();
  for (const p of params as Record<string, unknown>[]) {
    let lvl = String(p.key).trim().toUpperCase();
    if (/^[0-9]+$/.test(lvl)) lvl = `L${lvl}`;
    theoretical.set(lvl, Number(p.value));
  }

  type ExportRow = Record<typeof EXPORT_KEYS[number], string>;
  const rows: ExportRow[] = (employees as Record<string, unknown>[]).map(emp => {
    const cost = costsByEmp.get(emp.id as string);
    const theoreticalUsd = theoretical.get(emp.level as string) ?? null;
    return {
      nombre: `${emp.first_name} ${emp.last_name}`,
      nivel: String(emp.level || ''),
      area: String(emp.area_name || ''),
      pais: String(emp.country || ''),
      moneda: cost ? String(cost.currency || '') : '',
      costo_bruto: cost?.gross_cost != null ? String(cost.gross_cost) : '',
      costo_usd: cost?.cost_usd != null ? String(cost.cost_usd) : '',
      teorico_usd: theoreticalUsd != null ? String(theoreticalUsd) : '',
      estado: cost?.locked ? 'Cerrado' : (cost ? 'Abierto' : 'Sin costo'),
      notas: cost ? String(cost.notes || '') : '',
    };
  });

  const filename = `costos-equipo-${period}`;
  const CORS = '*';

  // ── CSV ─────────────────────────────────────────────────────────────
  if (format === 'csv') {
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      EXPORT_HEADERS.map(esc).join(','),
      ...rows.map(r => EXPORT_KEYS.map(k => esc(r[k])).join(',')),
    ];
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
        'Access-Control-Allow-Origin': CORS,
      },
      body: '﻿' + lines.join('\r\n'),
    };
  }

  // ── XLSX ─────────────────────────────────────────────────────────────
  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DVPNYX Quoter';
    const ws = wb.addWorksheet(`Costos ${periodLabel}`);

    ws.columns = EXPORT_HEADERS.map((h, i) => ({
      header: h,
      key: EXPORT_KEYS[i],
      width: [22, 8, 16, 10, 9, 13, 13, 13, 10, 20][i],
    }));

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B46C1' } };
    headerRow.alignment = { vertical: 'middle' };

    rows.forEach(r => ws.addRow(EXPORT_KEYS.map(k => r[k])));

    // Freeze header and auto-filter
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + EXPORT_HEADERS.length)}1` };

    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
        'Access-Control-Allow-Origin': CORS,
      },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  }

  // ── PDF ──────────────────────────────────────────────────────────────
  const PDFDocument = (await import('pdfkit')).default;
  const COL_WIDTHS = [140, 44, 88, 55, 44, 68, 64, 64, 54, 111]; // sum = 732 for landscape A4
  const ROW_H = 15;
  const HEADER_H = 18;
  const PAGE_MARGIN = 30;
  const PAGE_HEIGHT = 595; // A4 landscape points
  const PAGE_WIDTH = 842;
  const TABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

  const pdfBuf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: PAGE_MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#6B46C1')
      .text(`Costos del equipo — ${periodLabel}`, PAGE_MARGIN, PAGE_MARGIN, { width: TABLE_WIDTH, align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor('#888888')
      .text(`Generado: ${new Date().toLocaleDateString('es')} · ${rows.length} empleados`, PAGE_MARGIN, undefined, { width: TABLE_WIDTH, align: 'center' });
    doc.moveDown(0.6);

    const drawHeaderRow = (y: number) => {
      let x = PAGE_MARGIN;
      EXPORT_HEADERS.forEach((h, i) => {
        doc.rect(x, y, COL_WIDTHS[i], HEADER_H).fill('#6B46C1');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7)
          .text(h, x + 2, y + 5, { width: COL_WIDTHS[i] - 4, lineBreak: false });
        x += COL_WIDTHS[i];
      });
      return y + HEADER_H;
    };

    let rowY = drawHeaderRow(doc.y);

    rows.forEach((r, ri) => {
      if (rowY + ROW_H > PAGE_HEIGHT - PAGE_MARGIN) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: PAGE_MARGIN });
        rowY = drawHeaderRow(PAGE_MARGIN);
      }
      const bg = ri % 2 === 0 ? '#F5F3FF' : '#FFFFFF';
      let x = PAGE_MARGIN;
      EXPORT_KEYS.forEach((k, i) => {
        doc.rect(x, rowY, COL_WIDTHS[i], ROW_H).fill(bg);
        doc.rect(x, rowY, COL_WIDTHS[i], ROW_H).stroke('#D1D5DB');
        doc.fillColor('#1a1a2e').font('Helvetica').fontSize(7)
          .text(r[k] || '—', x + 2, rowY + 4, { width: COL_WIDTHS[i] - 4, lineBreak: false, ellipsis: true });
        x += COL_WIDTHS[i];
      });
      rowY += ROW_H;
    });

    doc.end();
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
      'Access-Control-Allow-Origin': CORS,
    },
    body: pdfBuf.toString('base64'),
    isBase64Encoded: true,
  };
});

router.post('/api/employee-costs/bulk/commit', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const period = String(body.period || '');
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido (formato YYYYMM)' });
  const items: Record<string, unknown>[] = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return error(400, { error: 'items[] es requerido' });

  const empIds = [...new Set(items.map(i => i.employee_id as string).filter(Boolean))];
  const [{ rows: emps }, { rows: existing }] = await Promise.all([
    db.query(`SELECT id, start_date, end_date, status FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [empIds]),
    db.query(`SELECT * FROM employee_costs WHERE period = $1 AND employee_id = ANY($2::uuid[])`, [period, empIds]),
  ]);
  const empById = new Map((emps as Record<string, unknown>[]).map(e => [e.id as string, e]));
  const existingByEmp = new Map((existing as Record<string, unknown>[]).map(c => [c.employee_id as string, c as Record<string, unknown>]));

  const ccys = [...new Set(items.map(i => String(i.currency || '').toUpperCase()).filter(c => c && c !== 'USD'))];
  const fxByCcy = await resolveRatesBulk(db, ccys, period);

  const errors: unknown[] = [];
  const warnings: unknown[] = [];
  const pending: Array<{ item: Record<string, unknown>; currency: string; gross: number; conv: ReturnType<typeof convertToUsd>; existingRow?: Record<string, unknown> }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ctx = { index: i, employee_id: item.employee_id };
    if (!empById.has(item.employee_id as string)) { errors.push({ ...ctx, code: 'employee_not_found' }); continue; }
    const currency = String(item.currency || '').toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) { errors.push({ ...ctx, code: 'currency_invalid' }); continue; }
    const gross = Number(item.gross_cost);
    if (!Number.isFinite(gross) || gross < 0) { errors.push({ ...ctx, code: 'gross_cost_invalid' }); continue; }
    const existingRow = existingByEmp.get(item.employee_id as string);
    if (existingRow?.locked && user.role !== 'superadmin') { errors.push({ ...ctx, code: 'period_locked' }); continue; }
    const fx = pickRate(fxByCcy, currency, period);
    const conv = convertToUsd(gross, currency, fx.rate);
    if (currency !== 'USD' && fx.fallback_period) warnings.push({ ...ctx, code: 'fx_fallback_used', fallback_period: fx.fallback_period });
    if (currency !== 'USD' && fx.rate == null) warnings.push({ ...ctx, code: 'fx_missing' });
    pending.push({ item, currency, gross, conv, existingRow });
  }

  if (errors.length > 0) return error(400, { error: 'Hay errores en el payload — ningún cambio fue aplicado.', errors, warnings, applied: [] });

  const conn = await db.connect();
  const applied: unknown[] = [];
  try {
    await conn.query('BEGIN');
    for (const p of pending) {
      if (p.existingRow) {
        await conn.query(
          `UPDATE employee_costs SET currency=$1,gross_cost=$2,cost_usd=$3,exchange_rate_used=$4,notes=COALESCE($5,notes),updated_by=$6,updated_at=NOW() WHERE id=$7`,
          [p.currency, p.gross, p.conv.cost_usd, p.conv.exchange_rate_used, (p.item.notes as string) ?? null, user.id, p.existingRow.id],
        );
        applied.push({ employee_id: p.item.employee_id, action: 'updated', id: p.existingRow.id });
      } else {
        const { rows } = await conn.query(
          `INSERT INTO employee_costs (employee_id,period,currency,gross_cost,cost_usd,exchange_rate_used,notes,source,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$8) RETURNING id`,
          [p.item.employee_id, period, p.currency, p.gross, p.conv.cost_usd, p.conv.exchange_rate_used, (p.item.notes as string) || null, user.id],
        );
        applied.push({ employee_id: p.item.employee_id, action: 'created', id: rows[0].id });
      }
    }
    await conn.query('COMMIT');
    return ok({ period, total: items.length, errors: [], warnings, applied });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

router.post('/api/employee-costs/copy-from-previous', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const period = String(body.period || '');
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido (formato YYYYMM)' });
  const prev = previousPeriod(period);
  const pFirst = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;

  const [{ rows: activeEmps }, { rows: prevCosts }, { rows: alreadyN }] = await Promise.all([
    db.query(`SELECT id FROM employees WHERE deleted_at IS NULL AND status IN ('active','on_leave','bench') AND start_date <= (DATE '${pFirst}' + INTERVAL '1 month - 1 day')::date AND (end_date IS NULL OR end_date >= DATE '${pFirst}')`),
    db.query(`SELECT * FROM employee_costs WHERE period = $1`, [prev]),
    db.query(`SELECT employee_id FROM employee_costs WHERE period = $1`, [period]),
  ]);

  const activeIds = new Set((activeEmps as Record<string, unknown>[]).map(e => e.id as string));
  const alreadyByEmp = new Set((alreadyN as Record<string, unknown>[]).map(r => r.employee_id as string));
  const ccys = [...new Set((prevCosts as Record<string, unknown>[]).map(r => r.currency as string).filter(c => c !== 'USD'))];
  const fxByCcy = await resolveRatesBulk(db, ccys, period);

  const conn = await db.connect();
  let copied = 0; let skipped = 0; const warnings: unknown[] = [];
  try {
    await conn.query('BEGIN');
    for (const row of prevCosts as Record<string, unknown>[]) {
      if (!activeIds.has(row.employee_id as string)) { skipped++; continue; }
      if (alreadyByEmp.has(row.employee_id as string)) { skipped++; continue; }
      const fx = pickRate(fxByCcy, row.currency as string, period);
      const conv = convertToUsd(Number(row.gross_cost), row.currency as string, fx.rate);
      if (row.currency !== 'USD' && fx.fallback_period) warnings.push({ employee_id: row.employee_id, code: 'fx_fallback_used', fallback_period: fx.fallback_period });
      await conn.query(
        `INSERT INTO employee_costs (employee_id,period,currency,gross_cost,cost_usd,exchange_rate_used,notes,source,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'copy_from_prev',$8,$8)`,
        [row.employee_id, period, row.currency, row.gross_cost, conv.cost_usd, conv.exchange_rate_used, row.notes, user.id],
      );
      copied++;
    }
    await conn.query('COMMIT');
    return ok({ from_period: prev, to_period: period, copied, skipped, warnings });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

router.post('/api/employee-costs/lock/:period', async (event, user) => {
  requireAdmin(user);
  const period = event.pathParameters!.period!;
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido' });
  const { rows } = await db.query(
    `UPDATE employee_costs SET locked=true,locked_at=NOW(),locked_by=$2,updated_at=NOW() WHERE period=$1 AND locked=false RETURNING id`,
    [period, user.id],
  );
  return ok({ period, locked_count: rows.length });
});

router.post('/api/employee-costs/unlock/:period', async (event, user) => {
  if (user.role !== 'superadmin') return error(403, { error: 'Solo superadmin puede desbloquear períodos' });
  const period = event.pathParameters!.period!;
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido' });
  const { rows } = await db.query(
    `UPDATE employee_costs SET locked=false,locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE period=$1 AND locked=true RETURNING id`,
    [period],
  );
  return ok({ period, unlocked_count: rows.length });
});

router.post('/api/employee-costs/recalculate-usd/:period', async (event, user) => {
  requireAdmin(user);
  const period = event.pathParameters!.period!;
  if (!PERIOD_RE.test(period)) return error(400, { error: 'period inválido' });
  const { rows: openRows } = await db.query(
    `SELECT id, currency, gross_cost FROM employee_costs WHERE period=$1 AND locked=false AND currency <> 'USD'`,
    [period],
  );
  const ccys = [...new Set((openRows as Record<string, unknown>[]).map(r => r.currency as string))];
  const fxByCcy = await resolveRatesBulk(db, ccys, period);
  let updated = 0; let unchanged = 0;
  for (const row of openRows as Record<string, unknown>[]) {
    const fx = pickRate(fxByCcy, row.currency as string, period);
    if (fx.rate == null) { unchanged++; continue; }
    const costUsd = parseFloat((Number(row.gross_cost) / fx.rate).toFixed(4));
    await db.query(`UPDATE employee_costs SET cost_usd=$1,exchange_rate_used=$2,updated_at=NOW() WHERE id=$3`, [costUsd, fx.rate, row.id]);
    updated++;
  }
  return ok({ period, updated, unchanged });
});

// ── Employee Costs: Project to Future ───────────────────────────────

function addMonths(yyyymm: string, n: number): string | null {
  if (!/^[0-9]{6}$/.test(yyyymm)) return null;
  let year = parseInt(yyyymm.slice(0, 4), 10);
  let month = parseInt(yyyymm.slice(4, 6), 10) + n;
  while (month <= 0) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  return `${year}${String(month).padStart(2, '0')}`;
}

function periodsForward(start: string, count: number): string[] {
  if (!/^[0-9]{6}$/.test(start) || !Number.isInteger(count) || count < 1) return [];
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    cur = addMonths(cur, 1)!;
  }
  return out;
}

function monthOfDate(d: string | Date | null): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d as string);
  if (isNaN(dt.getTime())) return null;
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function employeeActiveInPeriod(emp: Record<string, unknown>, targetPeriod: string): boolean {
  const startMonth = monthOfDate(emp.start_date as string | null);
  const endMonth = monthOfDate(emp.end_date as string | null);
  if (startMonth && targetPeriod < startMonth) return false;
  if (endMonth && targetPeriod > endMonth) return false;
  return true;
}

router.post('/api/employee-costs/project-to-future', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const dryRun = body.dry_run === true;

  const monthsAhead = Number(body.months_ahead);
  if (!Number.isInteger(monthsAhead) || monthsAhead < 1 || monthsAhead > 12) {
    return error(400, { error: 'months_ahead debe ser entero entre 1 y 12' });
  }
  const growthPct = body.growth_pct != null ? Number(body.growth_pct) : 0;
  if (!Number.isFinite(growthPct) || growthPct < -50 || growthPct > 200) {
    return error(400, { error: 'growth_pct debe ser número entre -50 y 200' });
  }

  let basePeriod: string;
  if (body.base_period) {
    const bp = String(body.base_period).trim();
    if (!PERIOD_RE.test(bp)) return error(400, { error: 'base_period inválido (formato YYYYMM)' });
    basePeriod = bp;
  } else {
    const { rows } = await db.query(`SELECT period FROM employee_costs ORDER BY period DESC LIMIT 1`);
    if (!rows.length) {
      return error(400, { error: 'No hay ningún costo registrado para usar como base. Carga al menos un mes antes de proyectar.', code: 'no_base_period' });
    }
    basePeriod = rows[0].period as string;
  }

  const firstTarget = addMonths(basePeriod, 1);
  if (!firstTarget) return error(400, { error: 'base_period inválido' });
  const targetPeriods = periodsForward(firstTarget, monthsAhead);

  const { rows: baseCosts } = await db.query(
    `SELECT * FROM employee_costs WHERE period = $1`, [basePeriod],
  );
  if (!baseCosts.length) {
    return error(400, { error: `El período base ${basePeriod} no tiene costos registrados.`, code: 'base_period_empty' });
  }

  const empIds = (baseCosts as Record<string, unknown>[]).map(c => c.employee_id as string);
  const [{ rows: emps }, { rows: existingFuture }] = await Promise.all([
    db.query(
      `SELECT id, start_date, end_date, status FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [empIds],
    ),
    db.query(
      `SELECT employee_id, period, locked, source FROM employee_costs
        WHERE employee_id = ANY($1::uuid[]) AND period = ANY($2::varchar[])`,
      [empIds, targetPeriods],
    ),
  ]);

  const empById = new Map((emps as Record<string, unknown>[]).map(e => [e.id as string, e]));
  const existingByKey = new Map(
    (existingFuture as Record<string, unknown>[]).map(c => [`${c.employee_id}|${c.period}`, c]),
  );

  const currencies = [...new Set((baseCosts as Record<string, unknown>[]).map(c => c.currency as string).filter(c => c !== 'USD'))];
  const fxByCcy = await resolveRatesBulk(db, currencies, targetPeriods[targetPeriods.length - 1]);

  const monthlyGrowth = growthPct === 0 ? 1 : Math.pow(1 + growthPct / 100, 1 / 12);

  const warnings: unknown[] = [];
  const details: unknown[] = [];
  let created = 0, updated = 0, skippedExisting = 0, skippedLocked = 0, skippedInactive = 0;

  const conn = await db.connect();
  try {
    if (!dryRun) await conn.query('BEGIN');

    for (let mi = 0; mi < targetPeriods.length; mi++) {
      const targetPeriod = targetPeriods[mi];
      const factor = Math.pow(monthlyGrowth, mi + 1);

      for (const baseRow of baseCosts as Record<string, unknown>[]) {
        const emp = empById.get(baseRow.employee_id as string);
        if (!emp) continue;
        if (!employeeActiveInPeriod(emp, targetPeriod)) { skippedInactive++; continue; }

        const key = `${baseRow.employee_id}|${targetPeriod}`;
        const existing = existingByKey.get(key) as Record<string, unknown> | undefined;
        if (existing?.locked) { skippedLocked++; continue; }
        if (existing && existing.source !== 'projected') { skippedExisting++; continue; }

        const projectedGross = Math.round(Number(baseRow.gross_cost) * factor * 100) / 100;
        const fx = pickRate(fxByCcy, baseRow.currency as string, targetPeriod);
        const conv = convertToUsd(projectedGross, baseRow.currency as string, fx.rate);

        if (baseRow.currency !== 'USD' && fx.fallback_period) {
          warnings.push({ employee_id: baseRow.employee_id, target_period: targetPeriod, code: 'fx_fallback_used', fallback_period: fx.fallback_period });
        }
        if (baseRow.currency !== 'USD' && fx.rate == null) {
          warnings.push({ employee_id: baseRow.employee_id, target_period: targetPeriod, code: 'fx_missing' });
        }

        details.push({
          employee_id: baseRow.employee_id, period: targetPeriod,
          currency: baseRow.currency, gross_cost: projectedGross,
          cost_usd: conv.cost_usd, action: existing ? 'would_update' : 'would_create',
        });

        if (!dryRun) {
          if (existing) {
            await conn.query(
              `UPDATE employee_costs SET currency=$1,gross_cost=$2,cost_usd=$3,exchange_rate_used=$4,source='projected',updated_by=$5,updated_at=NOW() WHERE employee_id=$6 AND period=$7`,
              [baseRow.currency, projectedGross, conv.cost_usd, conv.exchange_rate_used, user.id, baseRow.employee_id, targetPeriod],
            );
            updated++;
          } else {
            const notes = growthPct === 0
              ? `Proyectado desde ${basePeriod}`
              : `Proyectado desde ${basePeriod} con +${growthPct}%/año`;
            await conn.query(
              `INSERT INTO employee_costs (employee_id,period,currency,gross_cost,cost_usd,exchange_rate_used,notes,source,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'projected',$8,$8)`,
              [baseRow.employee_id, targetPeriod, baseRow.currency, projectedGross, conv.cost_usd, conv.exchange_rate_used, notes, user.id],
            );
            created++;
          }
        }
      }
    }

    if (!dryRun) await conn.query('COMMIT');

    return ok({
      base_period: basePeriod,
      target_periods: targetPeriods,
      months_ahead: monthsAhead,
      growth_pct: growthPct,
      dry_run: dryRun,
      created: dryRun ? 0 : created,
      updated: dryRun ? 0 : updated,
      would_create: dryRun ? (details as any[]).filter(d => d.action === 'would_create').length : 0,
      would_update: dryRun ? (details as any[]).filter(d => d.action === 'would_update').length : 0,
      skipped_existing: skippedExisting,
      skipped_locked: skippedLocked,
      skipped_inactive: skippedInactive,
      warnings,
      details: dryRun ? details : undefined,
    });
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally { conn.release(); }
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
