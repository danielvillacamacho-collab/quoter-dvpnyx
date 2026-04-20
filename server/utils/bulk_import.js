/**
 * Bulk-import validators and committers for V2 entities.
 *
 * Design:
 *   - Each entity declares a validator that turns a RAW parsed-CSV row
 *     into either { ok: true, value: <clean record> } or
 *     { ok: false, error: '<human reason>' }. No side effects.
 *   - Each entity declares a committer that runs inside a pg transaction
 *     and returns `{ status, id, reason }`. Statuses:
 *       • `created` — inserted new row
 *       • `updated` — upserted existing row
 *       • `skipped` — duplicate / conflict, left existing intact
 *       • `error`   — validation or DB error
 *   - The runner (`runBulkImport`) wires them together, runs in a single
 *     transaction, emits events, and produces a per-row report.
 *   - `dryRun = true` runs validators only (no DB writes) so the UI can
 *     show preview + errors before the operator commits.
 *
 * IMPORTANT: any hard error aborts the whole transaction (all-or-nothing).
 * Row-level "skipped" results do NOT abort — they're expected when
 * bulk-importing a spreadsheet that may overlap existing data.
 */

const { emitEvent } = require('./events');

/* =======================================================================
 * Small validation helpers
 * ======================================================================= */

const notEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const asBool = (v, def = true) => {
  if (!notEmpty(v)) return def;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sí', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return def;
};
const asInt = (v) => {
  if (!notEmpty(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};
const asNumeric = (v) => {
  if (!notEmpty(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asDate = (v) => {
  if (!notEmpty(v)) return null;
  // Accept YYYY-MM-DD; loose-parse anything Date.parse handles and re-format.
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};
const oneOf = (v, options) => options.includes(v);
const asLevel = (v) => {
  if (!notEmpty(v)) return null;
  const s = String(v).trim().toUpperCase();
  if (/^L\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return `L${s}`;
  return null;
};

/* =======================================================================
 * Entity validators
 * Each takes a row object (headers lowercased) and returns
 *   { ok: true, value }  OR  { ok: false, error }
 * ======================================================================= */

const VALIDATORS = {
  /* -------- Áreas -------- */
  areas(row) {
    if (!notEmpty(row.key))  return { ok: false, error: 'Columna "key" requerida' };
    if (!notEmpty(row.name)) return { ok: false, error: 'Columna "name" requerida' };
    const key = String(row.key).trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z0-9_]+$/.test(key)) return { ok: false, error: 'key sólo debe tener letras/números/guión_bajo' };
    const sort = asInt(row.sort_order);
    return {
      ok: true,
      value: {
        key,
        name: String(row.name).trim(),
        description: notEmpty(row.description) ? String(row.description).trim() : null,
        sort_order: sort !== null ? sort : 0,
        active: asBool(row.active, true),
      },
    };
  },

  /* -------- Skills -------- */
  skills(row) {
    if (!notEmpty(row.name)) return { ok: false, error: 'Columna "name" requerida' };
    const category = notEmpty(row.category) ? String(row.category).trim().toLowerCase() : null;
    if (category && !['language', 'framework', 'cloud', 'data', 'ai', 'tool', 'methodology', 'soft'].includes(category)) {
      return { ok: false, error: `Categoría inválida: "${category}"` };
    }
    return {
      ok: true,
      value: {
        name: String(row.name).trim(),
        category,
        description: notEmpty(row.description) ? String(row.description).trim() : null,
        active: asBool(row.active, true),
      },
    };
  },

  /* -------- Clientes -------- */
  clients(row) {
    if (!notEmpty(row.name)) return { ok: false, error: 'Columna "name" requerida' };
    const tier = notEmpty(row.tier) ? String(row.tier).trim().toLowerCase() : null;
    if (tier && !['enterprise', 'mid_market', 'smb'].includes(tier)) {
      return { ok: false, error: `Tier inválido: "${tier}" (usa enterprise|mid_market|smb)` };
    }
    const currency = notEmpty(row.preferred_currency)
      ? String(row.preferred_currency).trim().toUpperCase().slice(0, 3)
      : 'USD';
    return {
      ok: true,
      value: {
        name: String(row.name).trim(),
        legal_name: notEmpty(row.legal_name) ? String(row.legal_name).trim() : null,
        country: notEmpty(row.country) ? String(row.country).trim() : null,
        industry: notEmpty(row.industry) ? String(row.industry).trim() : null,
        tier,
        preferred_currency: currency,
        notes: notEmpty(row.notes) ? String(row.notes) : null,
        active: asBool(row.active, true),
      },
    };
  },

  /* -------- Empleados -------- */
  employees(row) {
    if (!notEmpty(row.first_name)) return { ok: false, error: '"first_name" requerido' };
    if (!notEmpty(row.last_name))  return { ok: false, error: '"last_name" requerido' };
    if (!notEmpty(row.country))    return { ok: false, error: '"country" requerido' };
    if (!notEmpty(row.area_key))   return { ok: false, error: '"area_key" requerido' };
    const level = asLevel(row.level);
    if (!level) return { ok: false, error: `"level" inválido ("${row.level}") — usa L1..L11` };
    if (!notEmpty(row.start_date)) return { ok: false, error: '"start_date" requerido (YYYY-MM-DD)' };
    const startDate = asDate(row.start_date);
    if (!startDate) return { ok: false, error: `"start_date" con formato inválido ("${row.start_date}")` };
    const endDate = notEmpty(row.end_date) ? asDate(row.end_date) : null;
    if (notEmpty(row.end_date) && !endDate) return { ok: false, error: `"end_date" con formato inválido` };

    const cap = asNumeric(row.weekly_capacity_hours);
    if (cap !== null && (cap < 1 || cap > 80)) {
      return { ok: false, error: `weekly_capacity_hours fuera de rango 1-80 (${cap})` };
    }
    const employmentType = (String(row.employment_type || 'fulltime')).trim().toLowerCase();
    if (!oneOf(employmentType, ['fulltime', 'parttime', 'contractor'])) {
      return { ok: false, error: `employment_type inválido: "${employmentType}"` };
    }
    const status = (String(row.status || 'active')).trim().toLowerCase();
    if (!oneOf(status, ['active', 'on_leave', 'bench', 'terminated'])) {
      return { ok: false, error: `status inválido: "${status}"` };
    }

    return {
      ok: true,
      value: {
        first_name: String(row.first_name).trim(),
        last_name: String(row.last_name).trim(),
        corporate_email: notEmpty(row.corporate_email) ? String(row.corporate_email).trim().toLowerCase() : null,
        personal_email: notEmpty(row.personal_email) ? String(row.personal_email).trim().toLowerCase() : null,
        country: String(row.country).trim(),
        city: notEmpty(row.city) ? String(row.city).trim() : null,
        area_key: String(row.area_key).trim().toLowerCase(),
        level,
        seniority_label: notEmpty(row.seniority_label) ? String(row.seniority_label).trim() : null,
        employment_type: employmentType,
        weekly_capacity_hours: cap !== null ? cap : 40,
        start_date: startDate,
        end_date: endDate,
        status,
        squad_name: notEmpty(row.squad_name) ? String(row.squad_name).trim() : null,
        notes: notEmpty(row.notes) ? String(row.notes) : null,
      },
    };
  },

  /* -------- Employee ↔ Skill links -------- */
  'employee-skills'(row) {
    if (!notEmpty(row.corporate_email)) return { ok: false, error: '"corporate_email" requerido' };
    if (!notEmpty(row.skill_name))      return { ok: false, error: '"skill_name" requerido' };
    const proficiency = (String(row.proficiency || 'intermediate')).trim().toLowerCase();
    if (!oneOf(proficiency, ['beginner', 'intermediate', 'advanced', 'expert'])) {
      return { ok: false, error: `proficiency inválido: "${proficiency}"` };
    }
    const years = asNumeric(row.years_experience);
    if (years !== null && (years < 0 || years > 60)) {
      return { ok: false, error: `years_experience fuera de rango 0-60` };
    }
    return {
      ok: true,
      value: {
        corporate_email: String(row.corporate_email).trim().toLowerCase(),
        skill_name: String(row.skill_name).trim(),
        proficiency,
        years_experience: years,
        notes: notEmpty(row.notes) ? String(row.notes).slice(0, 200) : null,
      },
    };
  },
};

/* =======================================================================
 * Entity committers (use a pg client bound to an active transaction)
 * Return { status, id?, reason? }
 * ======================================================================= */

const COMMITTERS = {
  async areas(client, v, ctx) {
    // INSERT .. ON CONFLICT DO NOTHING so re-imports are idempotent.
    const { rows } = await client.query(
      `INSERT INTO areas (key, name, description, sort_order, active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (key) DO UPDATE SET
         name       = EXCLUDED.name,
         description= COALESCE(EXCLUDED.description, areas.description),
         sort_order = EXCLUDED.sort_order,
         active     = EXCLUDED.active
       RETURNING id, (xmax = 0) AS inserted`,
      [v.key, v.name, v.description, v.sort_order, v.active],
    );
    const status = rows[0].inserted ? 'created' : 'updated';
    await emitEvent(client, {
      event_type: `area.${status === 'created' ? 'created' : 'updated'}`,
      entity_type: 'area',
      entity_id: rows[0].id.toString(),  // areas.id is SERIAL
      actor_user_id: ctx.userId,
      payload: { key: v.key, source: 'bulk_import' },
    });
    return { status, id: rows[0].id };
  },

  async skills(client, v, ctx) {
    // Skills.id is SERIAL and the unique index is on LOWER(name); we must
    // SELECT-then-INSERT/UPDATE because ON CONFLICT requires a real unique
    // constraint (not a partial index on an expression).
    const existing = await client.query(
      `SELECT id FROM skills WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [v.name],
    );
    if (existing.rows.length) {
      const id = existing.rows[0].id;
      await client.query(
        `UPDATE skills SET
           category   = COALESCE($1, category),
           description= COALESCE($2, description),
           active     = $3
         WHERE id=$4`,
        [v.category, v.description, v.active, id],
      );
      await emitEvent(client, {
        event_type: 'skill.updated',
        entity_type: 'skill',
        entity_id: id.toString(),
        actor_user_id: ctx.userId,
        payload: { name: v.name, source: 'bulk_import' },
      });
      return { status: 'updated', id };
    }
    const { rows } = await client.query(
      `INSERT INTO skills (name, category, description, active)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [v.name, v.category, v.description, v.active],
    );
    await emitEvent(client, {
      event_type: 'skill.created',
      entity_type: 'skill',
      entity_id: rows[0].id.toString(),
      actor_user_id: ctx.userId,
      payload: { name: v.name, source: 'bulk_import' },
    });
    return { status: 'created', id: rows[0].id };
  },

  async clients(client, v, ctx) {
    // Unique index on LOWER(name) WHERE deleted_at IS NULL → same SELECT-first pattern.
    const existing = await client.query(
      `SELECT id FROM clients WHERE LOWER(name)=LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [v.name],
    );
    if (existing.rows.length) {
      const id = existing.rows[0].id;
      await client.query(
        `UPDATE clients SET
           legal_name         = COALESCE($1, legal_name),
           country            = COALESCE($2, country),
           industry           = COALESCE($3, industry),
           tier               = COALESCE($4, tier),
           preferred_currency = $5,
           notes              = COALESCE($6, notes),
           active             = $7,
           updated_at         = NOW()
         WHERE id=$8`,
        [v.legal_name, v.country, v.industry, v.tier, v.preferred_currency, v.notes, v.active, id],
      );
      await emitEvent(client, {
        event_type: 'client.updated',
        entity_type: 'client',
        entity_id: id,
        actor_user_id: ctx.userId,
        payload: { name: v.name, source: 'bulk_import' },
      });
      return { status: 'updated', id };
    }
    const { rows } = await client.query(
      `INSERT INTO clients (name, legal_name, country, industry, tier, preferred_currency, notes, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [v.name, v.legal_name, v.country, v.industry, v.tier, v.preferred_currency, v.notes, v.active, ctx.userId],
    );
    await emitEvent(client, {
      event_type: 'client.created',
      entity_type: 'client',
      entity_id: rows[0].id,
      actor_user_id: ctx.userId,
      payload: { name: v.name, source: 'bulk_import' },
    });
    return { status: 'created', id: rows[0].id };
  },

  async employees(client, v, ctx) {
    // Resolve area_key → area_id (fail row with an error if area doesn't exist).
    const area = await client.query(
      `SELECT id FROM areas WHERE key=$1 AND active=true LIMIT 1`,
      [v.area_key],
    );
    if (!area.rows.length) {
      return { status: 'error', reason: `Área "${v.area_key}" no existe en el catálogo` };
    }
    const areaId = area.rows[0].id;

    // Resolve squad_name → squad_id if provided (optional).
    let squadId = null;
    if (v.squad_name) {
      const sq = await client.query(
        `SELECT id FROM squads WHERE LOWER(name)=LOWER($1) AND deleted_at IS NULL LIMIT 1`,
        [v.squad_name],
      );
      if (!sq.rows.length) {
        return { status: 'error', reason: `Squad "${v.squad_name}" no existe` };
      }
      squadId = sq.rows[0].id;
    }

    // Duplicate detection: (corporate_email when present) OR (first_name, last_name, country).
    if (v.corporate_email) {
      const dup = await client.query(
        `SELECT id FROM employees
          WHERE LOWER(corporate_email)=LOWER($1) AND deleted_at IS NULL
          LIMIT 1`,
        [v.corporate_email],
      );
      if (dup.rows.length) {
        return { status: 'skipped', id: dup.rows[0].id, reason: 'corporate_email ya existe' };
      }
    } else {
      const dup = await client.query(
        `SELECT id FROM employees
          WHERE LOWER(first_name)=LOWER($1) AND LOWER(last_name)=LOWER($2)
            AND country=$3 AND deleted_at IS NULL
          LIMIT 1`,
        [v.first_name, v.last_name, v.country],
      );
      if (dup.rows.length) {
        return { status: 'skipped', id: dup.rows[0].id, reason: 'Nombre+país ya existe' };
      }
    }

    const { rows } = await client.query(
      `INSERT INTO employees
        (first_name, last_name, corporate_email, personal_email, country, city,
         area_id, level, seniority_label, employment_type, weekly_capacity_hours,
         start_date, end_date, status, squad_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        v.first_name, v.last_name, v.corporate_email, v.personal_email, v.country, v.city,
        areaId, v.level, v.seniority_label, v.employment_type, v.weekly_capacity_hours,
        v.start_date, v.end_date, v.status, squadId, v.notes, ctx.userId,
      ],
    );
    await emitEvent(client, {
      event_type: 'employee.created',
      entity_type: 'employee',
      entity_id: rows[0].id,
      actor_user_id: ctx.userId,
      payload: { first_name: v.first_name, last_name: v.last_name, source: 'bulk_import' },
    });
    return { status: 'created', id: rows[0].id };
  },

  async 'employee-skills'(client, v, ctx) {
    const emp = await client.query(
      `SELECT id FROM employees WHERE LOWER(corporate_email)=LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [v.corporate_email],
    );
    if (!emp.rows.length) {
      return { status: 'error', reason: `Empleado con email "${v.corporate_email}" no encontrado` };
    }
    const sk = await client.query(
      `SELECT id FROM skills WHERE LOWER(name)=LOWER($1) LIMIT 1`,
      [v.skill_name],
    );
    if (!sk.rows.length) {
      return { status: 'error', reason: `Skill "${v.skill_name}" no existe en el catálogo` };
    }
    const employeeId = emp.rows[0].id;
    const skillId = sk.rows[0].id;

    const existing = await client.query(
      `SELECT id FROM employee_skills WHERE employee_id=$1 AND skill_id=$2 LIMIT 1`,
      [employeeId, skillId],
    );
    if (existing.rows.length) {
      await client.query(
        `UPDATE employee_skills SET
           proficiency=$1, years_experience=$2, notes=COALESCE($3,notes)
         WHERE id=$4`,
        [v.proficiency, v.years_experience, v.notes, existing.rows[0].id],
      );
      await emitEvent(client, {
        event_type: 'employee.skill_updated',
        entity_type: 'employee',
        entity_id: employeeId,
        actor_user_id: ctx.userId,
        payload: { skill: v.skill_name, proficiency: v.proficiency, source: 'bulk_import' },
      });
      return { status: 'updated', id: existing.rows[0].id };
    }
    const { rows } = await client.query(
      `INSERT INTO employee_skills (employee_id, skill_id, proficiency, years_experience, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [employeeId, skillId, v.proficiency, v.years_experience, v.notes],
    );
    await emitEvent(client, {
      event_type: 'employee.skill_added',
      entity_type: 'employee',
      entity_id: employeeId,
      actor_user_id: ctx.userId,
      payload: { skill: v.skill_name, proficiency: v.proficiency, source: 'bulk_import' },
    });
    return { status: 'created', id: rows[0].id };
  },
};

const ENTITIES = Object.keys(VALIDATORS);

/**
 * Validate every row and optionally commit inside a transaction.
 *
 * @param {object}    params
 * @param {string}    params.entity     One of ENTITIES.
 * @param {object[]}  params.rows       Raw parsed-CSV row objects.
 * @param {object}    params.pool       pg Pool.
 * @param {string}    params.userId     Actor user id.
 * @param {boolean}   params.dryRun     If true, only validate — no writes.
 * @returns {Promise<{entity, total, counts, report}>}
 */
async function runBulkImport({ entity, rows, pool, userId, dryRun = false }) {
  if (!ENTITIES.includes(entity)) {
    throw Object.assign(new Error(`Entidad no soportada: "${entity}"`), { status: 400 });
  }
  const validator = VALIDATORS[entity];
  const committer = COMMITTERS[entity];

  const report = [];
  const counts = { total: rows.length, created: 0, updated: 0, skipped: 0, error: 0 };

  // Validate first (no DB)
  const validated = rows.map((row, i) => {
    const r = validator(row);
    if (!r.ok) {
      counts.error++;
      return { row_number: i + 2, status: 'error', reason: r.error };  // +2 because row 1 is header
    }
    return { row_number: i + 2, status: 'valid', value: r.value };
  });

  if (dryRun) {
    // Keep a preview (cap at 50 entries) + full counts
    for (const v of validated) {
      if (v.status === 'valid') report.push({ row_number: v.row_number, status: 'preview', value: v.value });
      else report.push({ row_number: v.row_number, status: 'error', reason: v.reason });
    }
    return { entity, total: counts.total, counts, report: report.slice(0, 50), dry_run: true };
  }

  // Commit inside a transaction. Any thrown error rolls back everything.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const v of validated) {
      if (v.status === 'error') {
        report.push({ row_number: v.row_number, status: 'error', reason: v.reason });
        continue;
      }
      try {
        const res = await committer(client, v.value, { userId });
        counts[res.status] = (counts[res.status] || 0) + 1;
        report.push({ row_number: v.row_number, ...res });
      } catch (err) {
        counts.error++;
        report.push({ row_number: v.row_number, status: 'error', reason: err.message });
      }
    }

    // Audit the import event itself
    await emitEvent(client, {
      event_type: 'bulk_import.committed',
      entity_type: entity,
      entity_id: '00000000-0000-0000-0000-000000000000',
      actor_user_id: userId,
      payload: { entity, counts, total: counts.total },
    });

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }

  return { entity, total: counts.total, counts, report };
}

module.exports = { runBulkImport, VALIDATORS, COMMITTERS, ENTITIES };
