import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
import { parsePagination, parseSort } from '@shared/http/pagination';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createQuotationRepository } from './repository';
import { createQuotationService } from './service';
import { SORTABLE } from './types';
import type { QuotationFilters } from './types';

const db = getPool();
const repo = createQuotationRepository(db);
const events = createEventEmitter();
const service = createQuotationService(repo, events, db);

const router = createRouter();

/* ------------------------------------------------------------------ */
/*  LIST                                                               */
/* ------------------------------------------------------------------ */
router.get('/api/quotations', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs, { defaultLimit: 100, maxLimit: 200 });
  const sort = parseSort(qs, SORTABLE, {
    defaultField: 'updated_at', defaultDir: 'desc', tieBreaker: 'q.id ASC',
  });
  const filters: QuotationFilters = {
    search: qs.search,
    type: qs.type,
    status: qs.status,
    client_id: qs.client_id,
    opportunity_id: qs.opportunity_id,
    created_by: user.function === 'preventa' ? user.id : undefined,
  };
  return paginated(await service.list({ page, limit, offset, filters, sort }));
});

/* ------------------------------------------------------------------ */
/*  DETAIL                                                             */
/* ------------------------------------------------------------------ */
router.get('/api/quotations/:id', async (event) => {
  return ok(await service.getById(event.pathParameters!.id!));
});

/* ------------------------------------------------------------------ */
/*  CREATE                                                             */
/* ------------------------------------------------------------------ */
router.post('/api/quotations', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return created(await service.create(body, user));
});

/* ------------------------------------------------------------------ */
/*  UPDATE                                                             */
/* ------------------------------------------------------------------ */
router.put('/api/quotations/:id', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await service.update(event.pathParameters!.id!, body, user));
});

/* ------------------------------------------------------------------ */
/*  DELETE                                                             */
/* ------------------------------------------------------------------ */
router.delete('/api/quotations/:id', async (event, user) => {
  requireAdmin(user);
  await service.softDelete(event.pathParameters!.id!, user);
  return message('Cotización eliminada');
});

/* ------------------------------------------------------------------ */
/*  CLONE                                                              */
/* ------------------------------------------------------------------ */
router.post('/api/quotations/:id/clone', async (event, user) => {
  return created(await service.clone(event.pathParameters!.id!, user));
});

/* ------------------------------------------------------------------ */
/*  EXPORT (placeholder)                                               */
/* ------------------------------------------------------------------ */
router.get('/api/quotations/:id/export', async (event) => {
  const qs = event.queryStringParameters || {};
  const format = (qs.format || 'xlsx').toLowerCase();

  if (format !== 'xlsx' && format !== 'pdf') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'format inválido — use xlsx o pdf' }),
    };
  }

  // Validate quotation exists
  const quot = await service.getById(event.pathParameters!.id!);

  // TODO: integrate quotation_export utility for XLSX/PDF generation
  return ok({
    message: `Export ${format} para cotización "${quot.project_name}" pendiente de implementación`,
    quotation_id: quot.id,
    format,
  });
});

/* ------------------------------------------------------------------ */
/*  Lambda entry point                                                 */
/* ------------------------------------------------------------------ */
export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
