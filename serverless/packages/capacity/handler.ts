import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok } from '@shared/http/response';
import { withAuth } from '@shared/auth/middleware';
import { getPool } from '@shared/db/connection';
import { createCapacityRepository } from './repository';
import { createCapacityService } from './service';
import type { PlannerFilters } from './types';

const CONTRACT_COLORS = [
  '#7c3aed','#0ea5e9','#10b981','#f59e0b',
  '#ef4444','#8b5cf6','#06b6d4','#84cc16',
  '#f97316','#ec4899','#64748b','#a855f7',
];

function colorFor(contractId: string): string {
  if (!contractId) return CONTRACT_COLORS[0];
  let h = 0;
  for (let i = 0; i < contractId.length; i++) h = ((h << 5) - h + contractId.charCodeAt(i)) | 0;
  return CONTRACT_COLORS[Math.abs(h) % CONTRACT_COLORS.length];
}

function isoWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Parse `start` (ISO Monday) + `weeks` (integer) query params into
 * date_from / date_to filter values expected by the service.
 */
function parseDateRange(qs: Record<string, string | undefined>): { date_from: string; date_to: string } {
  // start param: ISO date of the first Monday to show.
  // weeks param: how many weeks to display (default 4, max 52).
  const weeksCount = Math.min(Math.max(Number(qs.weeks) || 4, 1), 52);

  let start: Date;
  if (qs.start && /^\d{4}-\d{2}-\d{2}$/.test(qs.start)) {
    start = new Date(qs.start + 'T00:00:00Z');
  } else {
    // Default to current Monday
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    start = d;
  }

  const date_from = start.toISOString().slice(0, 10);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + weeksCount * 7 - 1);
  const date_to = end.toISOString().slice(0, 10);

  return { date_from, date_to };
}

function transformPlannerResult(result: { employees: any[]; weeks: string[]; summary: any }) {
  const weekObjs = result.weeks.map((start: string, index: number) => {
    const w = isoWeekNumber(start);
    const d = new Date(start + 'T00:00:00');
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const short_label = `${MON[d.getUTCMonth()]}/${d.getUTCDate()}`;
    return { index, start_date: start, iso_week: w, label: `S${w}`, short_label };
  });

  const employees = result.employees.map((emp: any) => {
    const assignmentMap = new Map<string, any>();
    (emp.weeks as any[]).forEach((weekData: any, wi: number) => {
      for (const asg of weekData.assignments as any[]) {
        const id = asg.assignment_id;
        if (!assignmentMap.has(id)) {
          assignmentMap.set(id, {
            id,
            contract_id: asg.contract_id,
            contract_name: asg.contract_name,
            client_name: asg.client_name,
            role_title: asg.role_title,
            weekly_hours: asg.weekly_hours,
            status: asg.status,
            resource_request_id: asg.resource_request_id ?? null,
            color: colorFor(asg.contract_id),
            week_range: [wi, wi],
          });
        } else {
          const e = assignmentMap.get(id)!;
          e.week_range = [Math.min(e.week_range[0], wi), Math.max(e.week_range[1], wi)];
        }
      }
    });

    return {
      ...emp,
      id: emp.employee_id,
      full_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
      weekly: (emp.weeks as any[]).map((w: any) => ({
        week_index: w.week_index,
        hours: w.total_hours,
        utilization_pct: w.utilization_pct,
        bucket: w.bucket,
        actual_hours: 0,
      })),
      assignments: Array.from(assignmentMap.values()),
      inactive: emp.status !== 'active',
    };
  });

  return { ...result, weeks: weekObjs, employees };
}

const db = getPool();
const repo = createCapacityRepository(db);
const service = createCapacityService(repo);

const router = createRouter();

router.get('/api/capacity/planner', async (event, user) => {
  const qs = (event.queryStringParameters || {}) as Record<string, string | undefined>;

  const { date_from, date_to } = parseDateRange(qs);

  const filters: PlannerFilters = {
    date_from,
    date_to,
    contract_id: qs.contract_id,
    area_id: qs.area_id,
    level: qs.level,
    level_min: qs.level_min,
    level_max: qs.level_max,
    status: qs.status,
    employee_id: qs.employee_id,
    country: qs.country,
    search: qs.search,
  };

  const [plannerResult, { rows: requestRows }, totalActive] = await Promise.all([
    service.getPlanner(filters),
    db.query(
      `SELECT rr.id, rr.contract_id, rr.role_title, rr.level, rr.area_id, rr.weekly_hours,
              rr.start_date, rr.end_date, rr.quantity, rr.status,
              c.name AS contract_name, cl.name AS client_name, a.name AS area_name,
              COALESCE(filled.cnt, 0)::int AS filled_count
         FROM resource_requests rr
         JOIN contracts c ON c.id = rr.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN areas a ON a.id = rr.area_id
         LEFT JOIN (
           SELECT resource_request_id, COUNT(*)::int AS cnt
             FROM assignments
             WHERE deleted_at IS NULL AND status <> 'cancelled'
             GROUP BY resource_request_id
         ) filled ON filled.resource_request_id = rr.id
         WHERE rr.deleted_at IS NULL
           AND rr.status IN ('open', 'partially_filled')
           AND rr.start_date <= $1
           AND (rr.end_date IS NULL OR rr.end_date >= $2)
         ORDER BY rr.start_date, rr.level
         LIMIT 200`,
      [date_to, date_from],
    ),
    repo.countAllActive(),
  ]);

  const open_requests = (requestRows as Record<string, unknown>[]).map(rr => ({
    ...rr,
    weekly_hours: Number(rr.weekly_hours),
    quantity: Number(rr.quantity) || 1,
    filled_count: Number(rr.filled_count) || 0,
    missing: Math.max(0, (Number(rr.quantity) || 1) - (Number(rr.filled_count) || 0)),
  }));

  const transformed = transformPlannerResult(plannerResult);

  // Build the contracts list for the "Proyectos" view tab.
  const contractMap = new Map<string, { id: string; name: string; client_name: string; color: string }>();
  for (const emp of transformed.employees) {
    for (const asg of (emp as any).assignments || []) {
      if (asg.contract_id && !contractMap.has(asg.contract_id)) {
        contractMap.set(asg.contract_id, {
          id: asg.contract_id,
          name: asg.contract_name,
          client_name: asg.client_name,
          color: asg.color,
        });
      }
    }
  }
  for (const rr of open_requests) {
    const cid = rr.contract_id as string;
    if (cid && !contractMap.has(cid)) {
      contractMap.set(cid, {
        id: cid,
        name: rr.contract_name as string,
        client_name: rr.client_name as string,
        color: colorFor(cid),
      });
    }
  }

  // "Personas activas" = employees with at least one hour assigned in the period.
  const employeesWithLoad = transformed.employees.filter(
    (e: any) => !e.inactive && (e.weekly as any[]).some((w: any) => w.hours > 0),
  );

  // Global avg: flat sum/count over all (employee, week) pairs where hours > 0
  // (matches develop's aggregateMeta — each loaded week-slot counts equally)
  let utilSum = 0, utilCount = 0;
  for (const e of employeesWithLoad) {
    for (const w of (e.weekly as any[])) {
      if (w.hours > 0) { utilSum += w.utilization_pct; utilCount++; }
    }
  }
  const avgUtilPct = utilCount > 0 ? Math.round((utilSum / utilCount) * 10) / 10 : 0;

  const meta = {
    active_employees: employeesWithLoad.length,
    total_employees: totalActive,
    avg_utilization_pct: avgUtilPct,
    overbooked_count: employeesWithLoad.filter((e: any) => e.has_overbooked_week).length,
    open_request_count: open_requests.length,
  };

  // ── Enrich assignments with request_level ──────────────────────
  const rrIds = new Set<string>();
  for (const emp of transformed.employees) {
    for (const asg of (emp as any).assignments || []) {
      if (asg.resource_request_id) rrIds.add(asg.resource_request_id);
    }
  }

  const rrMap = new Map<string, { level: string; role_title: string }>();
  if (rrIds.size > 0) {
    const { rows: rrRows } = await db.query(
      `SELECT id, level, role_title FROM resource_requests WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [Array.from(rrIds)],
    );
    for (const r of rrRows as any[]) rrMap.set(r.id, { level: r.level, role_title: r.role_title });
  }

  // Enrich assignment objects with request_level for the frontend and alerts
  for (const emp of transformed.employees) {
    for (const asg of (emp as any).assignments || []) {
      if (asg.resource_request_id) {
        asg.request_level = rrMap.get(asg.resource_request_id)?.level ?? null;
      }
    }
  }

  // ── Alerts ──────────────────────────────────────────────────────
  const LEVEL_ORDER = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];
  const levelRank = (lvl: string | null | undefined): number | null => {
    if (!lvl) return null;
    const i = LEVEL_ORDER.indexOf(String(lvl).toUpperCase());
    return i === -1 ? null : i + 1;
  };

  const weekObjs = transformed.weeks as Array<{ index: number; label: string }>;

  const formatWeekRanges = (indices: number[]): string => {
    if (!indices.length) return '';
    const sorted = [...indices].sort((a, b) => a - b);
    const runs: [number, number][] = [];
    let rs = sorted[0], prev = sorted[0];
    for (let k = 1; k < sorted.length; k++) {
      if (sorted[k] === prev + 1) { prev = sorted[k]; continue; }
      runs.push([rs, prev]); rs = sorted[k]; prev = sorted[k];
    }
    runs.push([rs, prev]);
    return runs.map(([a, b]) => {
      const la = weekObjs[a]?.label; const lb = weekObjs[b]?.label;
      return a === b ? la : `${la}-${lb}`;
    }).filter(Boolean).join(', ');
  };

  const alerts: Array<{ type: string; severity: 'red' | 'amber'; message: string; employee_id?: string; request_id?: string }> = [];

  // 1. Overbooked weeks
  for (const e of transformed.employees) {
    const overWeeks: number[] = [];
    let peak = 0;
    for (const w of (e as any).weekly as any[]) {
      if (w.bucket === 'overbooked') {
        overWeeks.push(w.week_index);
        if (w.utilization_pct > peak) peak = w.utilization_pct;
      }
    }
    if (overWeeks.length) {
      const ranges = formatWeekRanges(overWeeks);
      alerts.push({
        type: 'overbooked',
        severity: 'red',
        employee_id: (e as any).employee_id,
        message: `${(e as any).full_name} sobre-asignado ${ranges} (${Math.round(peak)}%).`,
      });
    }
  }

  // 2. Level mismatches (employee under-leveled for the request)
  for (const e of transformed.employees) {
    const empRank = levelRank((e as any).level);
    if (empRank == null) continue;
    const fullName = (e as any).full_name;
    for (const asg of (e as any).assignments || []) {
      const reqRank = levelRank(asg.request_level);
      if (reqRank == null) continue;
      const gap = reqRank - empRank;
      if (gap <= 0) continue;
      if (gap >= 2) {
        const roleStr = asg.role_title ? ` "${asg.role_title}"` : '';
        alerts.push({
          type: 'level_mismatch',
          severity: 'red',
          employee_id: (e as any).employee_id,
          request_id: asg.resource_request_id,
          message: `${fullName} es ${(e as any).level}, la solicitud${roleStr} pide ${asg.request_level} (gap ${gap}).`,
        });
      } else {
        alerts.push({
          type: 'level_mismatch',
          severity: 'amber',
          employee_id: (e as any).employee_id,
          request_id: asg.resource_request_id,
          message: `${fullName} es ${(e as any).level}, la solicitud pide ${asg.request_level} (un nivel por debajo).`,
        });
      }
    }
  }

  // 3. Uncovered open requests
  for (const rr of open_requests) {
    if ((rr.missing as number) <= 0) continue;
    alerts.push({
      type: 'open_request',
      severity: 'amber',
      request_id: rr.id as string,
      message: `${rr.client_name || rr.contract_name}: ${rr.role_title} ${rr.level || ''} sin cubrir (${rr.missing} vacantes).`.replace(/\s+/g, ' ').trim(),
    });
  }

  // Sort: red first, then by type
  const sevRank: Record<string, number> = { red: 0, amber: 1 };
  const typeRank: Record<string, number> = { overbooked: 0, level_mismatch: 1, open_request: 2 };
  alerts.sort((x, y) => {
    const s = (sevRank[x.severity] ?? 9) - (sevRank[y.severity] ?? 9);
    return s !== 0 ? s : (typeRank[x.type] ?? 9) - (typeRank[y.type] ?? 9);
  });

  return ok({
    meta,
    weeks: transformed.weeks,
    employees: transformed.employees,
    contracts: Array.from(contractMap.values()),
    open_requests,
    alerts,
    summary: transformed.summary,
  });
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
