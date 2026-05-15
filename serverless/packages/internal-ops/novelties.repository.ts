import type { Pool } from 'pg';
import type { PaginatedResult, AuthUser } from '@shared/types';
import type { Novelty, CreateNoveltyDTO, NoveltyFilters } from './types';
import { NotFound, BadRequest, Forbidden, Conflict } from '@shared/errors';

export interface NoveltiesRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: NoveltyFilters;
    user: AuthUser;
  }): Promise<PaginatedResult<Novelty>>;
  findById(id: string): Promise<Novelty | null>;
  create(data: CreateNoveltyDTO, actor: AuthUser): Promise<Novelty>;
  update(id: string, data: Partial<CreateNoveltyDTO>, actor: AuthUser): Promise<Novelty>;
  softDelete(id: string, actor: AuthUser): Promise<void>;
}

function isAdmin(user: AuthUser): boolean {
  return ['admin', 'superadmin'].includes(user.role);
}

function hasGlobalView(user: AuthUser): boolean {
  return isAdmin(user) || user.function === 'capacity_manager';
}

function canMutate(user: AuthUser): boolean {
  return hasGlobalView(user) || user.role === 'lead';
}

export function createNoveltiesRepository(db: Pool): NoveltiesRepository {
  return {
    async findAll({ page, limit, offset, filters, user }) {
      const wheres: string[] = ["n.status = 'approved'"];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.employee_id) {
        wheres.push(`n.employee_id = ${add(filters.employee_id)}`);
      } else if (!hasGlobalView(user)) {
        if (user.role === 'lead') {
          wheres.push(`(EXISTS (
            SELECT 1 FROM employees e2
             WHERE e2.id = n.employee_id
               AND (e2.user_id = ${add(user.id)} OR e2.manager_user_id = ${add(user.id)})
          ))`);
        } else {
          wheres.push(`(EXISTS (
            SELECT 1 FROM employees e2
             WHERE e2.id = n.employee_id AND e2.user_id = ${add(user.id)}
          ))`);
        }
      }

      if (filters.status) wheres.push(`n.status = ${add(filters.status)}`);
      if (filters.from) wheres.push(`n.end_date >= ${add(filters.from)}::date`);
      if (filters.to) wheres.push(`n.start_date <= ${add(filters.to)}::date`);

      const where = `WHERE ${wheres.join(' AND ')}`;
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM employee_novelties n ${where}`, params),
        db.query(
          `SELECT n.*,
                  (e.first_name || ' ' || e.last_name) AS employee_name,
                  nt.label_es AS novelty_type_label
             FROM employee_novelties n
             LEFT JOIN employees e ON e.id = n.employee_id
             LEFT JOIN novelty_types nt ON nt.id = n.novelty_type_id
             ${where}
             ORDER BY n.start_date DESC
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
        `SELECT n.*,
                (e.first_name || ' ' || e.last_name) AS employee_name,
                nt.label_es AS novelty_type_label
           FROM employee_novelties n
           LEFT JOIN employees e ON e.id = n.employee_id
           LEFT JOIN novelty_types nt ON nt.id = n.novelty_type_id
          WHERE n.id = $1 AND n.status = 'approved'`,
        [id],
      );
      return rows[0] ?? null;
    },

    async create(data, actor) {
      if (!canMutate(actor)) throw new Forbidden('Sin permisos para crear novedades');
      if (!data.employee_id) throw new BadRequest('employee_id requerido');
      if (!data.start_date || !data.end_date) throw new BadRequest('start_date y end_date requeridos');
      if (data.end_date < data.start_date) throw new BadRequest('end_date debe ser >= start_date');

      try {
        const { rows } = await db.query(
          `INSERT INTO employee_novelties
             (employee_id, novelty_type_id, start_date, end_date, status, reason, created_by, approved_by)
           VALUES ($1, $2, $3, $4, 'approved', $5, $6, $6)
           RETURNING *`,
          [data.employee_id, data.novelty_type_id || null, data.start_date, data.end_date,
           data.reason || null, actor.id],
        );
        return rows[0];
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505' || pgErr.code === 'P0001') {
          throw new Conflict('Solapamiento de novedades para este empleado en el rango indicado');
        }
        throw err;
      }
    },

    async update(id, data, actor) {
      if (!canMutate(actor)) throw new Forbidden('Sin permisos para editar novedades');

      const { rows: existing } = await db.query(
        `SELECT * FROM employee_novelties WHERE id = $1 AND status = 'approved'`,
        [id],
      );
      if (!existing.length) throw new NotFound('Novedad', id);

      const sets: string[] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (data.start_date !== undefined) sets.push(`start_date = ${add(data.start_date)}`);
      if (data.end_date !== undefined) sets.push(`end_date = ${add(data.end_date)}`);
      if (data.novelty_type_id !== undefined) sets.push(`novelty_type_id = ${add(data.novelty_type_id)}`);
      if (data.reason !== undefined) sets.push(`reason = ${add(data.reason)}`);

      if (sets.length === 0) throw new BadRequest('Sin campos para actualizar');
      sets.push(`updated_at = NOW()`);

      params.push(id);
      try {
        const { rows } = await db.query(
          `UPDATE employee_novelties SET ${sets.join(', ')} WHERE id = $${params.length} AND status = 'approved' RETURNING *`,
          params,
        );
        if (!rows.length) throw new NotFound('Novedad', id);
        return rows[0];
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505' || pgErr.code === 'P0001') {
          throw new Conflict('Solapamiento de novedades para este empleado');
        }
        throw err;
      }
    },

    async softDelete(id, actor) {
      if (!canMutate(actor)) throw new Forbidden('Sin permisos para eliminar novedades');

      const { rows } = await db.query(
        `UPDATE employee_novelties
            SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2
          WHERE id = $1 AND status = 'approved'
          RETURNING id`,
        [id, actor.id],
      );
      if (!rows.length) throw new NotFound('Novedad', id);
    },
  };
}
