import type { Pool } from 'pg';
import type { Area } from './types';

export interface AreaRepository {
  findAll(filters: { active?: string }): Promise<Area[]>;
  findById(id: string): Promise<(Area & { active_employees_count: number }) | null>;
  create(data: Record<string, unknown>): Promise<Area>;
  update(id: string, data: Record<string, unknown>): Promise<Area | null>;
  hasActiveEmployees(id: string): Promise<boolean>;
  deactivate(id: string): Promise<Area | null>;
  activate(id: string): Promise<Area | null>;
}

export function createAreaRepository(db: Pool): AreaRepository {
  return {
    async findAll(filters) {
      const wheres: string[] = [];
      const params: unknown[] = [];
      if (filters.active !== undefined) {
        params.push(filters.active === 'true' || filters.active === '1');
        wheres.push(`active = $${params.length}`);
      }
      const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
      const { rows } = await db.query(
        `SELECT a.*, (SELECT COUNT(*)::int FROM employees e WHERE e.area_id=a.id AND e.status='active' AND e.deleted_at IS NULL) AS active_employees_count FROM areas a ${where} ORDER BY a.sort_order, a.name`,
        params,
      );
      return rows;
    },

    async findById(id) {
      const { rows } = await db.query(
        `SELECT a.*, (SELECT COUNT(*)::int FROM employees e WHERE e.area_id=a.id AND e.status='active' AND e.deleted_at IS NULL) AS active_employees_count FROM areas a WHERE a.id=$1`, [id]);
      return rows[0] ?? null;
    },

    async create(data) {
      const { rows } = await db.query(
        `INSERT INTO areas (key, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
        [data.key, data.name, data.description || null, data.sort_order ?? 0],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE areas SET key=COALESCE($1,key), name=COALESCE($2,name), description=COALESCE($3,description), sort_order=COALESCE($4,sort_order) WHERE id=$5 RETURNING *`,
        [data.key ?? null, data.name ?? null, data.description ?? null, data.sort_order ?? null, id],
      );
      return rows[0] ?? null;
    },

    async hasActiveEmployees(id) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM employees WHERE area_id=$1 AND status='active' AND deleted_at IS NULL`, [id]);
      return rows[0].cnt > 0;
    },

    async deactivate(id) {
      const { rows } = await db.query(`UPDATE areas SET active=false WHERE id=$1 RETURNING *`, [id]);
      return rows[0] ?? null;
    },

    async activate(id) {
      const { rows } = await db.query(`UPDATE areas SET active=true WHERE id=$1 RETURNING *`, [id]);
      return rows[0] ?? null;
    },
  };
}
