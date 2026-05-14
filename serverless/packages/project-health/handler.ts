import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created } from '@shared/http/response';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin, requireRole } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createProjectHealthRepository } from './repository';
import { createProjectHealthService } from './service';

const db = getPool();
const repo = createProjectHealthRepository(db);
const events = createEventEmitter();
const service = createProjectHealthService(repo, events, db);

const router = createRouter();

/* ── Portfolio-level (no :contract_id param) ── */

router.get('/api/projects/portfolio-health', async (_event, _user) => {
  return ok(await service.portfolioHealth());
});

/* ── Baseline Preview ── */

router.get('/api/projects/:contract_id/baseline-preview', async (event, user) => {
  requireRole('superadmin', 'admin', 'lead')(user);
  return ok(await service.getBaselinePreview(event.pathParameters!.contract_id!));
});

/* ── WBS ── */

router.get('/api/projects/:contract_id/wbs', async (event, _user) => {
  const { rows: [baseline] } = await db.query(
    'SELECT id FROM project_baselines WHERE contract_id=$1 AND is_active=true',
    [event.pathParameters!.contract_id!],
  );
  if (!baseline) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No hay baseline activo' }) };
  const { rows } = await db.query('SELECT * FROM wbs_packages WHERE baseline_id=$1 ORDER BY sort_order', [baseline.id]);
  return ok(rows);
});

/* ── Baseline ── */

router.get('/api/projects/:contract_id/baseline', async (event, _user) => {
  return ok(await service.getBaseline(event.pathParameters!.contract_id!));
});

router.post('/api/projects/:contract_id/baseline', async (event, user) => {
  requireRole('superadmin', 'admin', 'lead')(user);
  const body = JSON.parse(event.body || '{}');
  return created(
    await service.createBaseline(event.pathParameters!.contract_id!, body, user),
  );
});

/* ── Re-baseline ── */

router.post('/api/projects/:contract_id/baseline/rebase', async (event, user) => {
  requireRole('superadmin', 'admin', 'director')(user);
  const body = JSON.parse(event.body || '{}');
  return created(
    await service.rebase(event.pathParameters!.contract_id!, body, user),
  );
});

/* ── Status Reports ── */

router.get('/api/projects/:contract_id/status-reports', async (event, _user) => {
  return ok(await service.listStatusReports(event.pathParameters!.contract_id!));
});

router.post('/api/projects/:contract_id/status-reports', async (event, user) => {
  requireRole('superadmin', 'admin', 'lead')(user);
  const body = JSON.parse(event.body || '{}');
  return created(
    await service.submitStatusReport(event.pathParameters!.contract_id!, body, user),
  );
});

/* ── Health & Cost Forecast ── */

router.get('/api/projects/:contract_id/health', async (event, _user) => {
  return ok(await service.getHealth(event.pathParameters!.contract_id!));
});

router.get('/api/projects/:contract_id/cost-forecast', async (event, _user) => {
  return ok(await service.getCostForecast(event.pathParameters!.contract_id!));
});

/* ── Admin operations ── */

router.post('/api/projects/:contract_id/backfill-revenue', async (event, user) => {
  requireAdmin(user);
  return ok(
    await service.backfillRevenue(event.pathParameters!.contract_id!, user),
  );
});

router.post('/api/projects/:contract_id/backfill-bac-cost', async (event, user) => {
  requireAdmin(user);
  return ok(
    await service.backfillBacCost(event.pathParameters!.contract_id!, user),
  );
});

router.post('/api/projects/:contract_id/closeout', async (event, user) => {
  requireRole('superadmin', 'admin', 'director')(user);
  const body = JSON.parse(event.body || '{}');
  return ok(
    await service.closeout(event.pathParameters!.contract_id!, body.narrative || null, user),
  );
});

/* ── Lambda entry point ── */

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
