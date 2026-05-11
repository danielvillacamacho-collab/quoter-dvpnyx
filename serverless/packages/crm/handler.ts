import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createContactRepository } from './contacts.repository';
import { createActivityRepository } from './activities.repository';
import { createContactService } from './contacts.service';
import { createActivityService } from './activities.service';
import { CONTACT_SORTABLE, ACTIVITY_SORTABLE } from './types';

const db = getPool();
const evts = createEventEmitter();
const contactSvc = createContactService(createContactRepository(db), evts, db);
const activitySvc = createActivityService(createActivityRepository(db), evts, db);

const router = createRouter();

// ── Contacts ────────────────────────────────────────────────────────
router.get('/api/contacts/by-client/:clientId', async (event) => {
  return ok({ data: await contactSvc.getByClient(event.pathParameters!.clientId!) });
});

router.get('/api/contacts/by-opportunity/:opportunityId', async (event) => {
  return ok({ data: await contactSvc.getByOpportunity(event.pathParameters!.opportunityId!) });
});

router.post('/api/contacts/opportunity-link', async (event) => {
  const body = JSON.parse(event.body || '{}');
  return created(await contactSvc.linkOpportunity(body));
});

router.delete('/api/contacts/opportunity-link/:id', async (event) => {
  await contactSvc.unlinkOpportunity(event.pathParameters!.id!);
  return message('Vínculo eliminado');
});

router.get('/api/contacts', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, CONTACT_SORTABLE, { defaultField: 'last_name', defaultDir: 'asc', tieBreaker: 'co.id ASC' });
  return paginated(await contactSvc.list({ page, limit, offset, filters: qs, sort }));
});

router.get('/api/contacts/:id', async (event) => ok(await contactSvc.getById(event.pathParameters!.id!)));

router.post('/api/contacts', async (event, user) => created(await contactSvc.create(JSON.parse(event.body || '{}'), user)));

router.put('/api/contacts/:id', async (event, user) => ok(await contactSvc.update(event.pathParameters!.id!, JSON.parse(event.body || '{}'), user)));

router.delete('/api/contacts/:id', async (event, user) => {
  requireAdmin(user);
  await contactSvc.softDelete(event.pathParameters!.id!, user);
  return message('Contacto eliminado');
});

// ── Activities ──────────────────────────────────────────────────────
router.get('/api/activities/by-opportunity/:opportunityId', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, ACTIVITY_SORTABLE, { defaultField: 'activity_date', defaultDir: 'desc', tieBreaker: 'a.id ASC' });
  return paginated(await activitySvc.getByOpportunity(event.pathParameters!.opportunityId!, { page, limit, offset, sort }));
});

router.get('/api/activities/by-client/:clientId', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, ACTIVITY_SORTABLE, { defaultField: 'activity_date', defaultDir: 'desc', tieBreaker: 'a.id ASC' });
  return paginated(await activitySvc.getByClient(event.pathParameters!.clientId!, { page, limit, offset, sort }));
});

router.get('/api/activities', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, ACTIVITY_SORTABLE, { defaultField: 'activity_date', defaultDir: 'desc', tieBreaker: 'a.id ASC' });
  return paginated(await activitySvc.list({ page, limit, offset, filters: qs, sort }));
});

router.get('/api/activities/:id', async (event) => ok(await activitySvc.getById(event.pathParameters!.id!)));
router.post('/api/activities', async (event, user) => created(await activitySvc.create(JSON.parse(event.body || '{}'), user)));
router.put('/api/activities/:id', async (event, user) => ok(await activitySvc.update(event.pathParameters!.id!, JSON.parse(event.body || '{}'), user)));

router.delete('/api/activities/:id', async (event, user) => {
  await activitySvc.softDelete(event.pathParameters!.id!, user);
  return message('Actividad eliminada');
});

export const handler = async (event: APIGatewayProxyEventV2) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
