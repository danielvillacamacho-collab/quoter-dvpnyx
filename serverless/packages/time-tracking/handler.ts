import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createTimeEntryRepository, createAllocationRepository } from './repository';
import { createTimeEntryService, createAllocationService } from './service';
import { ENTRY_SORTABLE } from './types';
import type { TimeEntryFilters, AllocationFilters } from './types';

const db = getPool();
const entryRepo = createTimeEntryRepository(db);
const allocRepo = createAllocationRepository(db);
const events = createEventEmitter();
const entryService = createTimeEntryService(entryRepo, events, db);
const allocService = createAllocationService(allocRepo, events, db);

const router = createRouter();

// ─── Time Entries ───

router.get('/api/time-entries', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, ENTRY_SORTABLE, { defaultField: 'work_date', defaultDir: 'desc', tieBreaker: 'te.id ASC' });
  const filters: TimeEntryFilters = {
    employee_id: qs.employee_id,
    assignment_id: qs.assignment_id,
    date_from: qs.date_from,
    date_to: qs.date_to,
    status: qs.status,
  };
  return paginated(await entryService.list({ page, limit, offset, filters, sort }, user));
});

router.get('/api/time-entries/:id', async (event, user) => {
  return ok(await entryService.getById(event.pathParameters!.id!, user));
});

router.post('/api/time-entries', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await entryService.create(body, user));
});

router.post('/api/time-entries/copy-week', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await entryService.copyWeek(body, user));
});

router.put('/api/time-entries/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await entryService.update(event.pathParameters!.id!, body, user));
});

router.delete('/api/time-entries/:id', async (event, user) => {
  await entryService.softDelete(event.pathParameters!.id!, user);
  return ok({ message: 'Entrada de tiempo eliminada' });
});

// ─── Weekly Allocations ───

router.get('/api/time-allocations', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const filters: AllocationFilters = {
    employee_id: qs.employee_id,
    assignment_id: qs.assignment_id,
    week_start_date: qs.week_start_date,
    date_from: qs.date_from,
    date_to: qs.date_to,
  };
  return ok(await allocService.list(filters, user));
});

router.put('/api/time-allocations/bulk', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await allocService.bulkUpsert(body, user));
});

export const handler = async (event: APIGatewayProxyEventV2) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
