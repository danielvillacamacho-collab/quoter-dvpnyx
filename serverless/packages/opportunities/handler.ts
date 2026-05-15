import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter, parseBody } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { Forbidden } from '@shared/errors';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createOpportunityRepository } from './repository';
import { createOpportunityService } from './service';
import { SORTABLE } from './types';
import type { OpportunityFilters } from './types';

const db = getPool();
const repo = createOpportunityRepository(db);
const events = createEventEmitter();
const service = createOpportunityService(repo, events, db);

const router = createRouter();

/* ---- LIST (RBAC-scoped) ---- */
router.get('/api/opportunities', async (event, user) => {
  if (user.role === 'external') throw new Forbidden('Acceso restringido para usuarios externos');

  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, SORTABLE, { defaultField: 'created_at', defaultDir: 'desc', tieBreaker: 'o.id ASC' });
  const filters: OpportunityFilters = {
    search: qs.search,
    client_id: qs.client_id,
    status: qs.status,
    stage: qs.stage,
    deal_type: qs.deal_type,
    contract_type: qs.contract_type,
    account_owner_id: qs.owner_id || qs.account_owner_id,
    squad_id: qs.squad_id,
    revenue_type: qs.revenue_type,
    funding_source: qs.funding_source,
    from_expected_close: qs.from_expected_close,
    to_expected_close: qs.to_expected_close,
    has_champion: qs.has_champion,
    has_economic_buyer: qs.has_economic_buyer,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort, user }));
});

/* ---- KANBAN ---- */
router.get('/api/opportunities/kanban', async (event, user) => {
  if (user.role === 'external') throw new Forbidden('Acceso restringido para usuarios externos');

  const qs = event.queryStringParameters || {};
  const filters: OpportunityFilters = {
    search: qs.search,
    client_id: qs.client_id,
    account_owner_id: qs.owner_id || qs.account_owner_id,
    squad_id: qs.squad_id,
    from_expected_close: qs.from_expected_close,
    to_expected_close: qs.to_expected_close,
  };
  return ok(await service.kanban({ filters, user }));
});

/* ---- EXPORT CSV ---- */
router.get('/api/opportunities/export.csv', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const wheres = ['o.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (qs.search) {
    const like = '%' + qs.search + '%';
    wheres.push(`(LOWER(o.name) LIKE LOWER(${add(like)}) OR LOWER(o.description) LIKE LOWER(${add(like)}))`);
  }
  if (qs.client_id) wheres.push(`o.client_id = ${add(qs.client_id)}`);
  if (qs.status)    wheres.push(`o.status = ${add(qs.status)}`);
  if (qs.owner_id)  wheres.push(`o.account_owner_id = ${add(qs.owner_id)}`);
  if (qs.from_expected_close) wheres.push(`o.expected_close_date >= ${add(qs.from_expected_close)}`);
  if (qs.to_expected_close)   wheres.push(`o.expected_close_date <= ${add(qs.to_expected_close)}`);

  const { rows } = await db.query(
    `SELECT o.id, o.name, o.status, o.outcome, o.outcome_reason,
            o.expected_close_date, o.closed_at, o.description, o.created_at,
            c.name AS client_name
       FROM opportunities o
       LEFT JOIN clients c ON c.id = o.client_id
      WHERE ${wheres.join(' AND ')}
      ORDER BY o.created_at DESC
      LIMIT 5000`,
    params,
  );

  const cols = [
    { key: 'id', header: 'ID' }, { key: 'name', header: 'Nombre' },
    { key: 'client_name', header: 'Cliente' }, { key: 'status', header: 'Estado' },
    { key: 'outcome', header: 'Resultado' }, { key: 'outcome_reason', header: 'Motivo' },
    { key: 'expected_close_date', header: 'Cierre esperado' },
    { key: 'closed_at', header: 'Cerrada' }, { key: 'description', header: 'Descripción' },
    { key: 'created_at', header: 'Creada' },
  ] as const;
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.map(c => c.header).join(','), ...rows.map((r: any) => cols.map(c => esc(r[c.key])).join(','))].join('\r\n');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="oportunidades.csv"', 'Access-Control-Allow-Origin': '*' },
    body: csv,
  };
});

/* ---- CHECK ALERTS (cron/manual, member+) ---- */
router.post('/api/opportunities/check-alerts', async (_event, user) => {
  const WRITE_ROLES = new Set(['superadmin', 'admin', 'lead', 'member']);
  if (!WRITE_ROLES.has(user.role)) throw new Forbidden('No tienes permisos para ejecutar el escaneo de alertas');

  const today = new Date().toISOString().slice(0, 10);
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const SEE_ALL = new Set(['superadmin', 'admin', 'director']);
  let scopeWhere = '';
  if (!SEE_ALL.has(user.role)) {
    if (user.role === 'lead' && (user as any).squad_id) scopeWhere = ` AND o.squad_id = ${add((user as any).squad_id)}`;
    else scopeWhere = ` AND (o.account_owner_id = ${add(user.id)} OR o.presales_lead_id = ${add(user.id)})`;
  }

  const { rows } = await db.query(
    `SELECT o.id, o.name, o.status, o.account_owner_id,
            o.last_stage_change_at, o.next_step, o.next_step_due_date,
            o.expected_close_date, o.champion_identified, o.economic_buyer_identified,
            EXTRACT(DAY FROM NOW() - o.last_stage_change_at)::int AS days_in_stage
       FROM opportunities o
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN ('closed_won','closed_lost','postponed')
        ${scopeWhere}
      ORDER BY o.last_stage_change_at ASC`,
    params,
  );

  const A3_STAGES = new Set(['solution_design', 'proposal_validated', 'negotiation', 'verbal_commit']);
  const createNotif = async (userId: string, type: string, title: string, body: string, oppId: string) => {
    try {
      const { rows: r } = await db.query(
        `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id)
         SELECT $1,$2,$3,$4,$5,'opportunity',$6
         WHERE NOT EXISTS (
           SELECT 1 FROM notifications WHERE user_id=$1 AND type=$2 AND entity_id=$6
             AND created_at > NOW() - INTERVAL '24 hours'
         ) RETURNING id`,
        [userId, type, title, body, `/opportunities/${oppId}`, oppId],
      );
      return r[0]?.id || null;
    } catch { return null; }
  };

  let created = 0;
  const details: { alert: string; opp_id: string }[] = [];

  for (const opp of rows as any[]) {
    const uid = opp.account_owner_id;
    if (!uid) continue;
    if (opp.days_in_stage != null && opp.days_in_stage >= 30) {
      const id = await createNotif(uid, 'opportunity_stale', `⚠ A1: Oportunidad estancada — ${opp.name}`, `Lleva ${opp.days_in_stage} días en "${opp.status}" sin cambio de etapa.`, opp.id);
      if (id) { created++; details.push({ alert: 'a1_stale', opp_id: opp.id }); }
    }
    if (opp.next_step_due_date && String(opp.next_step_due_date).slice(0, 10) < today) {
      const id = await createNotif(uid, 'next_step_overdue', `⚠ A2: Próximo paso vencido — ${opp.name}`, `El paso "${opp.next_step || 'sin definir'}" venció el ${String(opp.next_step_due_date).slice(0, 10)}.`, opp.id);
      if (id) { created++; details.push({ alert: 'a2_next_step', opp_id: opp.id }); }
    }
    if (A3_STAGES.has(opp.status)) {
      const gaps = [!opp.champion_identified && 'Champion', !opp.economic_buyer_identified && 'Economic Buyer'].filter(Boolean);
      if (gaps.length) {
        const id = await createNotif(uid, 'meddpicc_gap', `⚠ A3: Champion/EB pendiente — ${opp.name}`, `Falta identificar: ${gaps.join(', ')}.`, opp.id);
        if (id) { created++; details.push({ alert: 'a3_meddpicc', opp_id: opp.id }); }
      }
    }
    if (opp.expected_close_date) {
      const closeDate = String(opp.expected_close_date).slice(0, 10);
      const daysUntil = Math.ceil((new Date(closeDate).getTime() - new Date(today).getTime()) / 86400000);
      if (daysUntil >= 0 && daysUntil <= 7) {
        const id = await createNotif(uid, 'close_date_near', `⚠ A5: Cierre próximo — ${opp.name}`, `La fecha de cierre (${closeDate}) está dentro de los próximos 7 días.`, opp.id);
        if (id) { created++; details.push({ alert: 'a5_close_soon', opp_id: opp.id }); }
      }
    }
  }

  return ok({ checked: (rows as any[]).length, created, details });
});

/* ---- LOOKUP (lightweight for dropdowns) ---- */
router.get('/api/opportunities/lookup', async (event, user) => {
  const qs = event.queryStringParameters || {};
  return ok(await service.lookup({ search: qs.search, client_id: qs.client_id, user }));
});

/* ---- GET ONE ---- */
router.get('/api/opportunities/:id', async (event) => {
  return ok(await service.getById(event.pathParameters!.id!));
});

/* ---- CREATE ---- */
router.post('/api/opportunities', async (event, user) => {
  const body = parseBody(event);
  return created(await service.create(body, user));
});

/* ---- UPDATE ---- */
router.put('/api/opportunities/:id', async (event, user) => {
  const body = parseBody(event);
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

/* ---- SOFT DELETE (admin only) ---- */
router.delete('/api/opportunities/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Oportunidad eliminada');
});

/* ---- STATUS TRANSITION ---- */
router.put('/api/opportunities/:id/status', async (event, user) => {
  const body = parseBody(event);
  return ok(await service.changeStatus(event.pathParameters!.id!, body, user));
});

/* ---- CHECK MARGIN ---- */
router.post('/api/opportunities/:id/check-margin', async (event, user) => {
  const body = parseBody(event);
  return ok(await service.checkMargin(
    event.pathParameters!.id!,
    body.estimated_cost_usd ?? null,
    user,
  ));
});

/* ---- Lambda handler ---- */
export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
