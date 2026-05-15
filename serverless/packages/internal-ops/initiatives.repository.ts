import type { Pool, PoolClient } from 'pg';
import type { PaginatedResult } from '@shared/types';
import type { Initiative, InitiativeFilters, CreateInitiativeDTO } from './types';
import { INITIATIVE_TRANSITIONS } from './types';
import type { InitiativeStatus } from './types';
import { NotFound, BadRequest, Forbidden, Conflict } from '@shared/errors';
import type { AuthUser } from '@shared/types';

/* ----------- initiative_code generation (ported from server/utils/initiative_code.js) ----------- */

const AREA_CODE: Record<string, string> = {
  product:    'PROD',
  operations: 'OPER',
  hr:         'HR',
  finance:    'FIN',
  commercial: 'COMM',
  technology: 'TECH',
};

function areaCode(businessAreaId: string): string {
  return AREA_CODE[String(businessAreaId)] || 'XXXX';
}

function buildInitiativeCode(businessAreaId: string, year: number, seq: number): string {
  return `II-${areaCode(businessAreaId)}-${year}-${String(seq).padStart(5, '0')}`;
}

async function nextSequence(conn: PoolClient, businessAreaId: string, year: number): Promise<number> {
  const code = areaCode(businessAreaId);
  const prefix = `II-${code}-${year}-`;
  const { rows } = await conn.query(
    `SELECT initiative_code FROM internal_initiatives
      WHERE initiative_code LIKE $1
      ORDER BY initiative_code DESC LIMIT 1`,
    [`${prefix}%`],
  );
  if (rows.length === 0) return 1;
  const m = (rows[0].initiative_code as string).match(/-(\d{5})$/);
  if (!m) return 1;
  const parsed = parseInt(m[1], 10);
  return Number.isFinite(parsed) ? parsed + 1 : 1;
}

async function acquireSequenceLock(conn: PoolClient, businessAreaId: string, year: number): Promise<void> {
  const key = `II-${areaCode(businessAreaId)}-${year}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  await conn.query('SELECT pg_advisory_xact_lock($1::int)', [h | 0]);
}

export interface InitiativesRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: InitiativeFilters;
  }): Promise<PaginatedResult<Initiative>>;
  findById(id: string): Promise<Initiative | null>;
  create(data: CreateInitiativeDTO, actor: AuthUser, conn: PoolClient): Promise<Initiative>;
  update(id: string, data: Record<string, unknown>, actor: AuthUser, conn: PoolClient): Promise<Initiative>;
  transition(id: string, toStatus: InitiativeStatus, reason: string | null, actor: AuthUser, conn: PoolClient): Promise<Initiative>;
  softDelete(id: string, reason: string | null, actor: AuthUser, conn: PoolClient): Promise<void>;
}

export function createInitiativesRepository(db: Pool): InitiativesRepository {
  return {
    async findAll({ page, limit, offset, filters }) {
      const wheres = ['ii.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.business_area) wheres.push(`ii.business_area_id = ${add(filters.business_area)}`);
      if (filters.status) wheres.push(`ii.status = ${add(filters.status)}`);
      if (filters.operations_owner_id) wheres.push(`ii.operations_owner_id = ${add(filters.operations_owner_id)}`);
      if (filters.search) {
        const like = '%' + filters.search + '%';
        wheres.push(`(LOWER(ii.name) LIKE LOWER(${add(like)}) OR LOWER(ii.initiative_code) LIKE LOWER(${add(like)}))`);
      }

      const where = `WHERE ${wheres.join(' AND ')}`;
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM internal_initiatives ii ${where}`, params),
        db.query(
          `SELECT ii.*,
                  ba.label_es AS business_area_label,
                  u.name AS operations_owner_name,
                  COALESCE((
                    SELECT COUNT(*)::int
                      FROM internal_initiative_assignments
                     WHERE internal_initiative_id = ii.id
                       AND deleted_at IS NULL
                       AND status IN ('planned','active')
                  ), 0) AS assignments_count,
                  COALESCE((
                    SELECT SUM(iia.weekly_hours * COALESCE(iia.hourly_rate_usd, 0) *
                      GREATEST(0, (LEAST(CURRENT_DATE, COALESCE(iia.end_date, CURRENT_DATE)) - iia.start_date)::numeric / 7))
                    FROM internal_initiative_assignments iia
                    WHERE iia.internal_initiative_id = ii.id
                      AND iia.deleted_at IS NULL
                      AND iia.status IN ('active','ended')
                  ), 0)::numeric(18,2) AS consumed_usd,
                  COALESCE((
                    SELECT SUM(iia.weekly_hours *
                      GREATEST(0, (LEAST(CURRENT_DATE, COALESCE(iia.end_date, CURRENT_DATE)) - iia.start_date)::numeric / 7))
                    FROM internal_initiative_assignments iia
                    WHERE iia.internal_initiative_id = ii.id
                      AND iia.deleted_at IS NULL
                      AND iia.status IN ('active','ended')
                  ), 0)::numeric(18,2) AS hours_consumed
             FROM internal_initiatives ii
             LEFT JOIN business_areas ba ON ba.id = ii.business_area_id
             LEFT JOIN users u           ON u.id  = ii.operations_owner_id
             ${where}
             ORDER BY ii.created_at DESC
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...params, limit, offset],
        ),
      ]);

      const total = countRes.rows[0].total;
      return {
        data: rowsRes.rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      };
    },

    async findById(id) {
      const { rows } = await db.query(
        `SELECT ii.*,
                ba.label_es AS business_area_label,
                u.name AS operations_owner_name
           FROM internal_initiatives ii
           LEFT JOIN business_areas ba ON ba.id = ii.business_area_id
           LEFT JOIN users u           ON u.id  = ii.operations_owner_id
          WHERE ii.id = $1 AND ii.deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async create(data, actor, conn) {
      if (!data.name || String(data.name).trim().length < 5) {
        throw new BadRequest('name requerido (>=5 caracteres)');
      }
      if (!data.business_area_id) throw new BadRequest('business_area_id requerido');
      if (!Number.isFinite(data.budget_usd) || data.budget_usd < 0) {
        throw new BadRequest('budget_usd debe ser >= 0');
      }
      if (!data.operations_owner_id) throw new BadRequest('operations_owner_id requerido');

      const year = new Date().getFullYear();
      await acquireSequenceLock(conn, data.business_area_id, year);
      const seq = await nextSequence(conn, data.business_area_id, year);
      const initiative_code = buildInitiativeCode(data.business_area_id, year, seq);

      const { rows } = await conn.query(
        `INSERT INTO internal_initiatives
           (initiative_code, name, description, business_area_id, status,
            budget_usd, hours_estimated, start_date, target_end_date,
            operations_owner_id, source_system, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'active',
                 $5, $6, $7, $8,
                 $9, 'ui', $10, $10)
         RETURNING *`,
        [
          initiative_code,
          String(data.name).trim(), data.description || null, data.business_area_id,
          data.budget_usd, data.hours_estimated || 0, data.start_date, data.target_end_date || null,
          data.operations_owner_id, actor.id,
        ],
      );
      return rows[0];
    },

    async update(id, data, actor, conn) {
      const { rows: existRows } = await conn.query(
        `SELECT * FROM internal_initiatives WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!existRows.length) throw new NotFound('Iniciativa', id);
      const before = existRows[0];

      const isAdmin = ['admin', 'superadmin'].includes(actor.role);
      const isOwner = before.operations_owner_id === actor.id;
      if (!isAdmin && !isOwner) throw new Forbidden('Solo admin u operations_owner pueden editar');
      if (['completed', 'cancelled'].includes(before.status)) {
        throw new Conflict('Iniciativa terminal, no editable');
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (data.name !== undefined) sets.push(`name = ${add(String(data.name).trim())}`);
      if (data.description !== undefined) sets.push(`description = ${add(data.description)}`);
      if (data.business_area_id !== undefined) sets.push(`business_area_id = ${add(data.business_area_id)}`);
      if (data.budget_usd !== undefined) sets.push(`budget_usd = ${add(data.budget_usd)}`);
      if (data.hours_estimated !== undefined) sets.push(`hours_estimated = ${add(data.hours_estimated)}`);
      if (data.start_date !== undefined) sets.push(`start_date = ${add(data.start_date)}`);
      if (data.target_end_date !== undefined) sets.push(`target_end_date = ${add(data.target_end_date)}`);
      if (data.operations_owner_id !== undefined) {
        if (!isAdmin) throw new Forbidden('Cambiar owner requiere admin');
        sets.push(`operations_owner_id = ${add(data.operations_owner_id)}`);
      }

      if (sets.length === 0) throw new BadRequest('Sin campos para actualizar');
      sets.push(`updated_by = ${add(actor.id)}`);
      sets.push(`updated_at = NOW()`);

      params.push(id);
      const { rows } = await conn.query(
        `UPDATE internal_initiatives SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    },

    async transition(id, toStatus, reason, actor, conn) {
      const { rows } = await conn.query(
        `SELECT * FROM internal_initiatives WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!rows.length) throw new NotFound('Iniciativa', id);
      const before = rows[0];

      if (before.status === toStatus) throw new Conflict(`Ya está en estado ${toStatus}`);
      if (!INITIATIVE_TRANSITIONS[before.status as InitiativeStatus]?.has(toStatus)) {
        throw new Conflict(`Transición ${before.status} -> ${toStatus} no permitida`);
      }

      const setActualEnd = (toStatus === 'completed' || toStatus === 'cancelled') && before.actual_end_date == null;
      const { rows: updated } = await conn.query(
        `UPDATE internal_initiatives
            SET status = $1,
                actual_end_date = COALESCE(actual_end_date, ${setActualEnd ? 'CURRENT_DATE' : 'actual_end_date'}),
                updated_by = $2, updated_at = NOW()
          WHERE id = $3
          RETURNING *`,
        [toStatus, actor.id, id],
      );

      if (toStatus === 'completed' || toStatus === 'cancelled') {
        await conn.query(
          `UPDATE internal_initiative_assignments
              SET status = 'cancelled', updated_at = NOW(), updated_by = $1
            WHERE internal_initiative_id = $2
              AND deleted_at IS NULL
              AND status IN ('planned', 'active')`,
          [actor.id, id],
        );
      }

      return updated[0];
    },

    async softDelete(id, reason, actor, conn) {
      const { rows } = await conn.query(
        `SELECT id, status FROM internal_initiatives WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!rows.length) throw new NotFound('Iniciativa', id);

      const { rows: activeAssign } = await conn.query(
        `SELECT COUNT(*)::int AS n FROM internal_initiative_assignments
          WHERE internal_initiative_id = $1 AND deleted_at IS NULL AND status IN ('planned', 'active')`,
        [id],
      );
      if (activeAssign[0].n > 0) {
        throw new Conflict('La iniciativa tiene asignaciones activas. Termínelas antes de eliminar.');
      }

      await conn.query(
        `UPDATE internal_initiatives
            SET deleted_at = NOW(), deletion_reason = $1, updated_by = $2, updated_at = NOW()
          WHERE id = $3`,
        [reason, actor.id, id],
      );
    },
  };
}
