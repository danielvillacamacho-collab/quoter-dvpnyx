import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createRouter } from '@shared/http/router';
import { ok, created, message, paginated } from '@shared/http/response';
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
router.get('/api/employees', async (event) => {
  const qs = event.queryStringParameters || {};
  const { page, limit, offset } = parsePagination(qs);
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

export const handler = async (event: APIGatewayProxyEvent) => {
  return withAuth(event, (e, user) => router.resolve(e, user));
};
