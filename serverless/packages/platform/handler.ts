import bcrypt from 'bcryptjs';
import { AppError } from '@shared/errors';
import { createRouter, getEventMethod, getEventPath, type RouterEvent } from '@shared/http/router';
import { ok, created, message, error } from '@shared/http/response';
import { withAuth } from '@shared/auth/middleware';
import { requireAdmin, requireSuperadmin } from '@shared/auth/rbac';
import { getPool } from '@shared/db/connection';
import { createEventEmitter } from '@shared/events/emitter';
import { createAuthService } from './auth.service';
import { createUsersRepository } from './users.repository';
import { createNotificationsRepository } from './notifications.repository';
import { createEmployeeRepository } from '../employees/repository';
import { createEmployeeService } from '../employees/service';

const db = getPool();
const events = createEventEmitter();
const authService = createAuthService(db);
const usersRepo = createUsersRepository(db);
const notifRepo = createNotificationsRepository(db);
const empRepo = createEmployeeRepository(db);
const empService = createEmployeeService(empRepo, events, db);

const router = createRouter();

/* ==================================================================
 * AUTH — /api/auth/*
 * ================================================================== */

router.post('/api/auth/login', async (event, _user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await authService.login(body.email, body.password));
});

router.post('/api/auth/google', async (event, _user) => {
  const body = parseJsonBody(event);
  return ok(await authService.googleLogin(body.credential as string | undefined, getSourceIp(event)));
});

router.post('/api/auth/google-callback', async (event, _user) => {
  const credential = parseFormBody(event).get('credential') || undefined;
  try {
    const result = await authService.googleLogin(credential, getSourceIp(event));
    return redirect(`/login?google_token=${encodeURIComponent(result.token)}`);
  } catch (err) {
    return redirect(`/login?error=${encodeURIComponent(toGoogleCallbackError(err))}`);
  }
});

router.get('/api/auth/me', async (_event, user) => {
  return ok(await authService.getMe(user.id));
});

router.post('/api/auth/change-password', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  await authService.changePassword(user.id, body.current_password, body.new_password);
  return message('Contraseña actualizada');
});

router.put('/api/auth/me/preferences', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  return ok(await authService.updatePreferences(user.id, body));
});

/* ==================================================================
 * USERS — /api/users/*  (admin+, except /lookup)
 * ================================================================== */

router.get('/api/users/lookup', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  return ok(await usersRepo.lookup(qs.function));
});

router.get('/api/users', async (_event, user) => {
  requireAdmin(user);
  return ok(await usersRepo.findAll());
});

router.get('/api/users/:id', async (event, user) => {
  requireAdmin(user);
  const found = await usersRepo.findById(event.pathParameters!.id!);
  if (!found) return error(404, { error: 'Usuario no encontrado' });
  return ok(found);
});

router.post('/api/users', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const result = await usersRepo.create(body, user);

  await events.emit(db, {
    event_type: 'user.created',
    entity_type: 'user',
    entity_id: result.id,
    actor_user_id: user.id,
    payload: { email: result.email, role: result.role },
  });

  return created(result);
});

router.put('/api/users/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const result = await usersRepo.update(event.pathParameters!.id!, body, user);

  await events.emit(db, {
    event_type: 'user.updated',
    entity_type: 'user',
    entity_id: result.id,
    actor_user_id: user.id,
    payload: { name: result.name, role: result.role },
  });

  return ok(result);
});

router.delete('/api/users/:id', async (event, user) => {
  requireSuperadmin(user);
  await usersRepo.softDelete(event.pathParameters!.id!, user);

  await events.emit(db, {
    event_type: 'user.deleted',
    entity_type: 'user',
    entity_id: event.pathParameters!.id!,
    actor_user_id: user.id,
    payload: {},
  });

  return message('Usuario eliminado');
});

router.post('/api/users/:id/reset-password', async (event, user) => {
  requireAdmin(user);
  const hash = await bcrypt.hash('000000', 12);
  await db.query(
    'UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2',
    [hash, event.pathParameters!.id!],
  );
  return message('Contraseña reseteada a 000000');
});

/* ==================================================================
 * NOTIFICATIONS — /api/notifications/*
 * ================================================================== */

router.get('/api/notifications', async (event, user) => {
  const qs = event.queryStringParameters || {};
  const unreadOnly = qs.unread === 'true' || qs.unread === '1';
  return ok(await notifRepo.list(user.id, unreadOnly));
});

router.get('/api/notifications/unread-count', async (_event, user) => {
  return ok(await notifRepo.unreadCount(user.id));
});

router.put('/api/notifications/:id/read', async (event, user) => {
  return ok(await notifRepo.markRead(event.pathParameters!.id!, user.id));
});

router.post('/api/notifications/read-all', async (_event, user) => {
  return ok(await notifRepo.markAllRead(user.id));
});

/* ==================================================================
 * PARAMETERS — /api/parameters
 * ================================================================== */

router.get('/api/parameters', async (_event, _user) => {
  const { rows } = await db.query('SELECT * FROM parameters ORDER BY category, sort_order');
  const grouped: Record<string, unknown[]> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row);
  }
  return ok(grouped);
});

router.put('/api/parameters/:id', async (event, user) => {
  requireAdmin(user);
  const body = JSON.parse(event.body || '{}');
  const { value, label, note } = body;

  const { rows } = await db.query(
    'UPDATE parameters SET value=COALESCE($1,value), label=COALESCE($2,label), note=COALESCE($3,note), updated_at=NOW(), updated_by=$4 WHERE id=$5 RETURNING *',
    [value, label, note, user.id, event.pathParameters!.id!],
  );
  if (!rows.length) return error(404, { error: 'Parámetro no encontrado' });

  await events.emit(db, {
    event_type: 'parameter.updated',
    entity_type: 'parameter',
    entity_id: String(rows[0].id),
    actor_user_id: user.id,
    payload: { category: rows[0].category, key: rows[0].key, value },
  });

  return ok(rows[0]);
});

/* ==================================================================
 * SELF-SERVICE — /api/me/*
 * ================================================================== */

router.get('/api/me/profile', async (_event, user) => {
  const { rows: empRows } = await db.query(
    `SELECT e.id, e.first_name, e.last_name, e.personal_email, e.corporate_email,
            e.country, e.city, e.level, e.seniority_label, e.employment_type,
            e.weekly_capacity_hours, e.languages, e.start_date, e.status,
            e.bio, e.linkedin_url, e.github_url, e.portfolio_url,
            a.name AS area_name
       FROM employees e
       LEFT JOIN areas a ON a.id = e.area_id
      WHERE e.user_id = $1 AND e.deleted_at IS NULL`,
    [user.id],
  );
  if (!empRows.length) return error(404, { error: 'No tienes un perfil de empleado vinculado' });
  return ok(empRows[0]);
});

router.put('/api/me/profile', async (event, user) => {
  const body = JSON.parse(event.body || '{}');
  const { bio, linkedin_url, github_url, portfolio_url, languages, city } = body;
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });
  const { rows } = await db.query(
    `UPDATE employees SET
        bio           = COALESCE($1, bio),
        linkedin_url  = COALESCE($2, linkedin_url),
        github_url    = COALESCE($3, github_url),
        portfolio_url = COALESCE($4, portfolio_url),
        languages     = COALESCE($5, languages),
        city          = COALESCE($6, city),
        updated_at    = NOW()
      WHERE id = $7
      RETURNING id, bio, linkedin_url, github_url, portfolio_url, languages, city`,
    [
      bio ?? null,
      linkedin_url ?? null,
      github_url ?? null,
      portfolio_url ?? null,
      languages ? JSON.stringify(languages) : null,
      city ?? null,
      empId,
    ],
  );
  if (!rows.length) return error(404, { error: 'Empleado no encontrado' });
  return ok(rows[0]);
});

router.get('/api/me/assignments', async (_event, user) => {
  const { rows: empRows } = await db.query(
    'SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL',
    [user.id],
  );
  if (!empRows.length) return ok({ data: [] });

  const { rows } = await db.query(
    `SELECT a.*, c.name AS contract_name, cl.name AS client_name
       FROM assignments a
       LEFT JOIN contracts c ON c.id = a.contract_id
       LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE a.employee_id = $1 AND a.status IN ('planned','active') AND a.deleted_at IS NULL
      ORDER BY a.start_date`,
    [empRows[0].id],
  );
  return ok({ data: rows });
});

async function getEmployeeId(userId: string): Promise<string | null> {
  const { rows } = await db.query(
    'SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL',
    [userId],
  );
  return rows.length ? rows[0].id : null;
}

router.get('/api/me/skills', async (_event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const { rows } = await db.query(
    `SELECT es.id, es.skill_id, es.proficiency, es.years_experience, es.notes, es.created_at,
            s.name AS skill_name, s.category AS skill_category
       FROM employee_skills es
       JOIN skills s ON s.id = es.skill_id
      WHERE es.employee_id = $1
      ORDER BY s.category NULLS LAST, s.name`,
    [empId],
  );
  return ok({ data: rows });
});

router.post('/api/me/skills', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const body = JSON.parse(event.body || '{}');
  const { skill_id, proficiency, years_experience, notes } = body as Record<string, unknown>;
  if (!skill_id) return error(400, { error: 'skill_id es requerido' });

  const VALID_PROFICIENCY = ['beginner', 'intermediate', 'advanced', 'expert'];
  if (proficiency && !VALID_PROFICIENCY.includes(proficiency as string)) {
    return error(400, { error: 'proficiency inválido' });
  }

  const { rows: sRows } = await db.query('SELECT id, active FROM skills WHERE id=$1', [skill_id]);
  if (!sRows.length) return error(400, { error: 'Skill no existe' });
  if (!sRows[0].active) return error(400, { error: 'El skill está inactivo' });

  try {
    const { rows } = await db.query(
      `INSERT INTO employee_skills (employee_id, skill_id, proficiency, years_experience, notes)
        VALUES ($1, $2, COALESCE($3,'intermediate'), $4, $5) RETURNING *`,
      [empId, skill_id, proficiency || null,
       years_experience != null ? Number(years_experience) : null,
       notes || null],
    );
    return created(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') return error(409, { error: 'Ya tienes ese skill asignado' });
    throw e;
  }
});

router.delete('/api/me/skills/:skillId', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const { rows } = await db.query(
    'DELETE FROM employee_skills WHERE employee_id=$1 AND skill_id=$2 RETURNING *',
    [empId, event.pathParameters!.skillId!],
  );
  if (!rows.length) return error(404, { error: 'Skill no encontrado en tu perfil' });
  return ok({ message: 'Skill removido' });
});

router.get('/api/me/education', async (_event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const { rows } = await db.query(
    'SELECT * FROM employee_education WHERE employee_id=$1 ORDER BY start_year DESC NULLS LAST',
    [empId],
  );
  return ok({ data: rows });
});

router.post('/api/me/education', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const body = JSON.parse(event.body || '{}');
  const { institution, degree, field_of_study, start_year, end_year, description } = body;

  const { rows } = await db.query(
    `INSERT INTO employee_education
     (employee_id, institution, degree, field_of_study, start_year, end_year, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING *`,
    [empId, institution, degree, field_of_study, start_year ?? null, end_year ?? null, description ?? null],
  );

  await events.emit(db, {
    event_type: 'employee.education_created',
    entity_type: 'employee_education',
    entity_id: rows[0].id,
    actor_user_id: user.id,
    payload: { institution, degree },
  });

  return created(rows[0]);
});

router.put('/api/me/education/:id', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const body = JSON.parse(event.body || '{}');
  const { institution, degree, field_of_study, start_year, end_year, description } = body;

  const { rows } = await db.query(
    `UPDATE employee_education SET
     institution  = COALESCE($1, institution),
     degree       = COALESCE($2, degree),
     field_of_study = COALESCE($3, field_of_study),
     start_year   = COALESCE($4, start_year),
     end_year     = COALESCE($5, end_year),
     description  = COALESCE($6, description),
     updated_at   = NOW()
     WHERE id = $7 AND employee_id = $8
     RETURNING *`,
    [institution ?? null, degree ?? null, field_of_study ?? null, start_year ?? null, end_year ?? null, description ?? null, event.pathParameters!.id!, empId],
  );

  if (!rows.length) return error(404, { error: 'Educación no encontrada' });

  await events.emit(db, {
    event_type: 'employee.education_updated',
    entity_type: 'employee_education',
    entity_id: rows[0].id,
    actor_user_id: user.id,
    payload: { institution, degree },
  });

  return ok(rows[0]);
});

router.delete('/api/me/education/:id', async (event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const { rows } = await db.query(
    'DELETE FROM employee_education WHERE id=$1 AND employee_id=$2 RETURNING *',
    [event.pathParameters!.id!, empId],
  );

  if (!rows.length) return error(404, { error: 'Educación no encontrada' });

  await events.emit(db, {
    event_type: 'employee.education_deleted',
    entity_type: 'employee_education',
    entity_id: rows[0].id,
    actor_user_id: user.id,
    payload: { institution: rows[0].institution, degree: rows[0].degree },
  });

  return message('Educación eliminada');
});

router.get('/api/me/completeness', async (_event, user) => {
  const empId = await getEmployeeId(user.id);
  if (!empId) return error(404, { error: 'No tienes un perfil de empleado vinculado' });

  const emp = await empService.getById(empId);

  // Count skills and education
  const { rows: skills } = await db.query(
    'SELECT COUNT(*)::int AS cnt FROM employee_skills WHERE employee_id=$1',
    [empId],
  );
  const { rows: edu } = await db.query(
    'SELECT COUNT(*)::int AS cnt FROM employee_education WHERE employee_id=$1',
    [empId],
  );

  const checks = [
    { key: 'bio', done: !!emp.bio },
    { key: 'city', done: !!emp.city },
    { key: 'linkedin', done: !!emp.linkedin_url },
    { key: 'skills', done: skills[0].cnt >= 3 },
    { key: 'education', done: edu[0].cnt >= 1 },
    { key: 'languages', done: Array.isArray(emp.languages) && emp.languages.length > 0 },
  ];
  const done = checks.filter((c) => c.done).length;
  return ok({ pct: Math.round((done / checks.length) * 100), checks });
});

/* ==================================================================
 * BULK IMPORT — /api/bulk-import/*
 * ================================================================== */

const BULK_ENTITIES = ['areas', 'skills', 'clients', 'employees', 'employee-skills'];

const BULK_TEMPLATES: Record<string, { headers: string[]; examples: string[][] }> = {
  areas: {
    headers: ['key', 'name', 'description', 'sort_order', 'active'],
    examples: [
      ['devops_sre', 'DevOps / SRE', 'Especialidad combinada de plataforma y confiabilidad', '9', 'true'],
      ['data_engineering', 'Data Engineering', 'Diseño y mantenimiento de pipelines de datos', '10', 'true'],
    ],
  },
  skills: {
    headers: ['name', 'category', 'description', 'active'],
    examples: [
      ['React', 'framework', 'Frontend UI library', 'true'],
      ['dbt', 'data', 'SQL transformations', 'true'],
    ],
  },
  clients: {
    headers: ['name', 'legal_name', 'country', 'industry', 'tier', 'preferred_currency', 'notes', 'active'],
    examples: [
      ['Acme Corp', 'Acme S.A.', 'Colombia', 'Retail', 'mid_market', 'USD', 'Cliente referencia', 'true'],
    ],
  },
  employees: {
    headers: [
      'first_name', 'last_name', 'corporate_email', 'personal_email',
      'country', 'city', 'area_key', 'level', 'seniority_label',
      'employment_type', 'weekly_capacity_hours',
      'start_date', 'end_date', 'status', 'squad_name', 'notes',
    ],
    examples: [
      ['Ana', 'Lopez', 'ana.lopez@dvpnyx.com', '', 'Colombia', 'Bogotá',
        'development', 'L5', 'Semi Senior', 'fulltime', '40',
        '2026-01-15', '', 'active', 'DVPNYX Global', ''],
    ],
  },
  'employee-skills': {
    headers: ['corporate_email', 'skill_name', 'proficiency', 'years_experience', 'notes'],
    examples: [
      ['ana.lopez@dvpnyx.com', 'React', 'advanced', '4', ''],
      ['ana.lopez@dvpnyx.com', 'TypeScript', 'intermediate', '2', ''],
    ],
  },
};

function csvEscape(s: unknown): string {
  const v = String(s ?? '');
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

router.get('/api/bulk-import/entities', async (_event, user) => {
  requireAdmin(user);
  return ok({ entities: BULK_ENTITIES, templates: Object.keys(BULK_TEMPLATES) });
});

router.get('/api/bulk-import/templates/:entity', async (event, user) => {
  requireAdmin(user);
  const entity = event.pathParameters!.entity!;
  if (!BULK_ENTITIES.includes(entity)) return error(404, { error: 'Plantilla no encontrada' });
  const t = BULK_TEMPLATES[entity];
  if (!t) return error(404, { error: 'Plantilla no encontrada' });
  const lines = [t.headers.join(',')];
  for (const row of t.examples) lines.push(row.map(csvEscape).join(','));
  const csv = lines.join('\n') + '\n';
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="template_${entity}.csv"`,
      'Access-Control-Allow-Origin': '*',
    },
    body: csv,
  };
});

router.post('/api/bulk-import/:entity/preview', async (event, user) => {
  requireAdmin(user);
  const entity = event.pathParameters!.entity!;
  if (!BULK_ENTITIES.includes(entity)) return error(400, { error: `Entidad no soportada: "${entity}"` });
  return ok({ message: `Bulk import preview for ${entity} — not yet implemented in serverless` });
});

router.post('/api/bulk-import/:entity/commit', async (event, user) => {
  requireAdmin(user);
  const entity = event.pathParameters!.entity!;
  if (!BULK_ENTITIES.includes(entity)) return error(400, { error: `Entidad no soportada: "${entity}"` });
  return ok({ message: `Bulk import commit for ${entity} — not yet implemented in serverless` });
});

/* ==================================================================
 * AI INTERACTIONS — /api/ai-interactions/*
 * ================================================================== */

const AI_SORTABLE: Record<string, string> = {
  agent_name:      'agent_name',
  prompt_template: 'prompt_template',
  human_decision:  'human_decision',
  confidence:      'confidence',
  cost_usd:        'cost_usd',
  latency_ms:      'latency_ms',
  created_at:      'created_at',
  decided_at:      'decided_at',
};
const AI_VALID_DECISIONS = ['accepted', 'rejected', 'modified', 'ignored'];

function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

router.get('/api/ai-interactions', async (event, user) => {
  requireAdmin(user);
  const qs = event.queryStringParameters || {};
  const page = Math.max(1, Number(qs.page) || 1);
  const limit = Math.min(Math.max(Number(qs.limit) || 50, 1), 200);
  const offset = (page - 1) * limit;

  const wheres: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (qs.agent_name)      wheres.push(`agent_name = ${add(qs.agent_name)}`);
  if (qs.prompt_template) wheres.push(`prompt_template = ${add(qs.prompt_template)}`);
  if (qs.user_id) {
    if (!isValidUUID(qs.user_id)) return error(400, { error: 'user_id no es un UUID válido' });
    wheres.push(`user_id = ${add(qs.user_id)}`);
  }
  if (qs.entity_type) wheres.push(`entity_type = ${add(qs.entity_type)}`);
  if (qs.entity_id) {
    if (!isValidUUID(qs.entity_id)) return error(400, { error: 'entity_id no es un UUID válido' });
    wheres.push(`entity_id = ${add(qs.entity_id)}`);
  }
  if (qs.human_decision === 'pending') {
    wheres.push(`human_decision IS NULL`);
  } else if (qs.human_decision) {
    wheres.push(`human_decision = ${add(qs.human_decision)}`);
  }
  if (qs.from) wheres.push(`created_at >= ${add(qs.from)}::timestamptz`);
  if (qs.to)   wheres.push(`created_at <= ${add(qs.to)}::timestamptz`);

  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const sortField = AI_SORTABLE[qs.sort as string] || 'created_at';
  const sortDir = (qs.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderBy = `${sortField} ${sortDir}, id ASC`;

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM ai_interactions ${where}`, params),
    db.query(
      `SELECT id, agent_name, agent_version, prompt_template, prompt_template_version,
              user_id, entity_type, entity_id, confidence, human_decision,
              cost_usd, input_tokens, output_tokens, latency_ms, error,
              created_at, decided_at
         FROM ai_interactions
         ${where}
         ORDER BY ${orderBy}
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset],
    ),
  ]);

  return ok({
    data: rowsRes.rows,
    pagination: {
      page, limit,
      total: (countRes.rows[0] as { total: number }).total,
      pages: Math.ceil((countRes.rows[0] as { total: number }).total / limit) || 1,
    },
  });
});

router.get('/api/ai-interactions/:id', async (event, user) => {
  requireAdmin(user);
  const id = event.pathParameters!.id!;
  if (!isValidUUID(id)) return error(400, { error: 'id no es un UUID válido' });
  const { rows } = await db.query('SELECT * FROM ai_interactions WHERE id=$1', [id]);
  if (!rows.length) return error(404, { error: 'Interacción no encontrada' });
  return ok(rows[0]);
});

router.post('/api/ai-interactions/:id/decision', async (event, user) => {
  const id = event.pathParameters!.id!;
  if (!isValidUUID(id)) return error(400, { error: 'id no es un UUID válido' });

  const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const decision = String(body.decision || '').trim();
  const feedback = (body.feedback as string | undefined) || null;

  if (!AI_VALID_DECISIONS.includes(decision)) {
    return error(400, { error: `decision inválida (${AI_VALID_DECISIONS.join('|')})` });
  }

  const { rows } = await db.query(
    'SELECT user_id, human_decision FROM ai_interactions WHERE id=$1',
    [id],
  );
  if (!rows.length) return error(404, { error: 'Interacción no encontrada' });

  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  if (!isAdmin && (rows[0] as { user_id: string }).user_id !== user.id) {
    return error(403, { error: 'No puedes modificar la decisión de otra interacción' });
  }
  if ((rows[0] as { human_decision: string | null }).human_decision) {
    return error(409, {
      error: `Esta interacción ya tiene decisión registrada (${(rows[0] as { human_decision: string }).human_decision}).`,
      code: 'already_decided',
    });
  }

  const { rows: updated } = await db.query(
    `UPDATE ai_interactions
        SET human_decision = $2,
            human_feedback = $3,
            decided_at     = NOW()
      WHERE id = $1
      RETURNING id, human_decision`,
    [id, decision, feedback],
  );
  return ok(updated[0]);
});

/* ==================================================================
 * HEALTH — /api/health (NO AUTH)
 * ================================================================== */

router.get('/api/health', async (_event, _user) => {
  const version = process.env.APP_VERSION || '2.0.0-dev';
  const git_sha = (process.env.GIT_SHA || 'unknown').slice(0, 12);
  let dbStatus = 'down';
  try {
    await db.query('SELECT 1');
    dbStatus = 'up';
  } catch {
    /* health check — continue */
  }
  const isOk = dbStatus === 'up';
  return {
    statusCode: isOk ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ ok: isOk, version, git_sha, db: dbStatus }),
  };
});

/* ==================================================================
 * SEARCH — /api/search
 * ================================================================== */

router.get('/api/search', async (event, _user) => {
  const qs = event.queryStringParameters || {};
  const q = (qs.q || '').trim();
  if (q.length < 2) return ok({ query: q, total: 0, results: [] });

  const like = `%${q}%`;
  const limit = Math.min(Math.max(Number(qs.limit) || 5, 1), 10);

  const [clients, opportunities, contracts, employees, quotations] = await Promise.all([
    db.query(
      `SELECT id, name, country FROM clients
       WHERE deleted_at IS NULL AND (name ILIKE $1 OR COALESCE(legal_name,'') ILIKE $1)
       ORDER BY name LIMIT $2`,
      [like, limit],
    ),
    db.query(
      `SELECT id, name, status FROM opportunities
       WHERE deleted_at IS NULL AND name ILIKE $1
       ORDER BY name LIMIT $2`,
      [like, limit],
    ),
    db.query(
      `SELECT id, name, status FROM contracts
       WHERE deleted_at IS NULL AND name ILIKE $1
       ORDER BY name LIMIT $2`,
      [like, limit],
    ),
    db.query(
      `SELECT id, first_name, last_name, level FROM employees
       WHERE deleted_at IS NULL AND ((first_name || ' ' || last_name) ILIKE $1 OR COALESCE(corporate_email,'') ILIKE $1)
       ORDER BY last_name LIMIT $2`,
      [like, limit],
    ),
    db.query(
      `SELECT id, project_name, status FROM quotations
       WHERE project_name ILIKE $1 AND deleted_at IS NULL
       ORDER BY project_name LIMIT $2`,
      [like, limit],
    ),
  ]);

  const results = [
    ...clients.rows.map((r: Record<string, unknown>) => ({
      type: 'client', id: r.id, title: r.name, subtitle: (r.country as string) || 'Cliente', url: `/clients/${r.id}`,
    })),
    ...opportunities.rows.map((r: Record<string, unknown>) => ({
      type: 'opportunity', id: r.id, title: r.name, subtitle: r.status, url: `/opportunities/${r.id}`,
    })),
    ...contracts.rows.map((r: Record<string, unknown>) => ({
      type: 'contract', id: r.id, title: r.name, subtitle: r.status, url: `/contracts/${r.id}`,
    })),
    ...employees.rows.map((r: Record<string, unknown>) => ({
      type: 'employee', id: r.id, title: `${r.first_name} ${r.last_name}`, subtitle: r.level, url: `/employees/${r.id}`,
    })),
    ...quotations.rows.map((r: Record<string, unknown>) => ({
      type: 'quotation', id: r.id, title: r.project_name, subtitle: r.status, url: `/quotations/${r.id}`,
    })),
  ];

  return ok({ query: q, total: results.length, results });
});

/* ==================================================================
 * HANDLER — special handling for no-auth routes
 * ================================================================== */

/** Routes that bypass authentication. */
const NO_AUTH_ROUTES: { method: string; path: string }[] = [
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/google' },
  { method: 'POST', path: '/api/auth/google-callback' },
  { method: 'GET', path: '/api/health' },
];

function isNoAuthRoute(event: RouterEvent): boolean {
  const method = getEventMethod(event);
  const path = getEventPath(event);
  return NO_AUTH_ROUTES.some((r) => r.method === method && r.path === path);
}

/** Synthetic "anonymous" user for no-auth routes. */
const ANON_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'anonymous@system',
  name: 'Anonymous',
  role: 'viewer' as const,
};

function getRawBody(event: RouterEvent): string {
  const body = event.body || '';
  if ('isBase64Encoded' in event && event.isBase64Encoded) {
    return Buffer.from(body, 'base64').toString('utf8');
  }
  return body;
}

function parseJsonBody(event: RouterEvent): Record<string, unknown> {
  const raw = getRawBody(event);
  return raw ? JSON.parse(raw) : {};
}

function parseFormBody(event: RouterEvent): URLSearchParams {
  return new URLSearchParams(getRawBody(event));
}

function getSourceIp(event: RouterEvent): string | null {
  const context = event.requestContext as {
    identity?: { sourceIp?: string };
    http?: { sourceIp?: string };
  };
  return context.identity?.sourceIp || context.http?.sourceIp || null;
}

function redirect(location: string) {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      'Access-Control-Allow-Origin': '*',
    },
    body: '',
  };
}

function toGoogleCallbackError(err: unknown): string {
  if (err instanceof AppError) {
    if (err.code === 'google_not_configured') return 'google_not_configured';
    if (err.statusCode === 403) return 'domain_not_allowed';
    if (err.statusCode === 400) return 'missing_credential';
  }
  return 'google_auth_failed';
}

export const handler = async (event: RouterEvent) => {
  if (isNoAuthRoute(event)) {
    return router.resolve(event, ANON_USER);
  }
  return withAuth(event, (e, user) => router.resolve(e, user));
};
