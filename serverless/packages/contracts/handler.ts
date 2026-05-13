import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createContractRepository } from './repository';
import { createKickOffService } from './kick-off.service';
import { createContractService } from './service';
import { SORTABLE } from './types';
import type { ContractFilters } from './types';
import type { ApiResponse } from '@shared/types';

const db = getPool();
const repo = createContractRepository(db);
const events = createEventEmitter();
const kickOffSvc = createKickOffService(db, events);
const service = createContractService(repo, kickOffSvc, events, db);

const router = createRouter();

/* -------- CSV helper (no shared util yet) -------- */
const CSV_COLUMNS = [
  { key: 'id',                header: 'ID' },
  { key: 'name',              header: 'Nombre' },
  { key: 'client_name',       header: 'Cliente' },
  { key: 'type',              header: 'Tipo' },
  { key: 'contract_subtype',  header: 'Subtipo' },
  { key: 'status',            header: 'Estado' },
  { key: 'start_date',        header: 'Inicio' },
  { key: 'end_date',          header: 'Fin' },
  { key: 'notes',             header: 'Notas' },
  { key: 'created_at',        header: 'Creado' },
] as const;

function escapeCsvField(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(',');
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((c) => escapeCsvField(row[c.key])).join(','),
  );
  return [header, ...lines].join('\r\n');
}

/* -------- LIST -------- */
router.get('/api/contracts', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
  const sort = parseSort(qs, SORTABLE, { defaultField: 'updated_at', defaultDir: 'desc', tieBreaker: 'c.id ASC' });
  const filters: ContractFilters = {
    search: qs.search, client_id: qs.client_id,
    type: qs.type, subtype: qs.subtype, status: qs.status, squad_id: qs.squad_id,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort }));
});

/* -------- EXPORT CSV -------- */
router.get('/api/contracts/export.csv', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const filters: ContractFilters = {
    search: qs.search, client_id: qs.client_id,
    type: qs.type, subtype: qs.subtype, status: qs.status,
  };
  const rows = await service.exportCsv(filters);
  const csv = toCsv(rows);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contratos.csv"',
      'Access-Control-Allow-Origin': '*',
    },
    body: csv,
  } as ApiResponse;
});

/* -------- CREATE FROM QUOTATION (admin+) -------- */
router.post('/api/contracts/from-quotation/:qid', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  return created(await service.createFromQuotation(event.pathParameters!.qid!, body, user));
});

/* -------- GET ONE -------- */
router.get('/api/contracts/:id', async (event, _user) => {
  return ok(await service.getById(event.pathParameters!.id!));
});

/* -------- CREATE (admin+) -------- */
router.post('/api/contracts', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  return created(await service.create(body, user));
});

/* -------- UPDATE (admin+) -------- */
router.put('/api/contracts/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

/* -------- SOFT DELETE (admin+) -------- */
router.delete('/api/contracts/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Contrato eliminado');
});

/* -------- STATUS TRANSITION (admin+) -------- */
router.put('/api/contracts/:id/status', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  return ok(await service.changeStatus(event.pathParameters!.id!, body.new_status, user));
});

/* -------- KICK-OFF -------- */
router.post('/api/contracts/:id/kick-off', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  const qs = event.queryStringParameters || {};
  const force = qs.force === '1' || body.force === true;
  const result = await service.kickOff(event.pathParameters!.id!, body.kick_off_date, user, force);
  return created(result);
});

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
