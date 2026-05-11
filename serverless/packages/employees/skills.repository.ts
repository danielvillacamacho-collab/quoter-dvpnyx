import type { Pool } from 'pg';
import type { Skill } from './types';

export interface SkillRepository {
  findAll(filters: { active?: string; category?: string; search?: string }): Promise<Skill[]>;
  findById(id: string): Promise<(Skill & { employees_count: number }) | null>;
  create(data: Record<string, unknown>): Promise<Skill>;
  update(id: string, data: Record<string, unknown>): Promise<Skill | null>;
  hasEmployees(id: string): Promise<boolean>;
  deactivate(id: string): Promise<Skill | null>;
  activate(id: string): Promise<Skill | null>;
}

export function createSkillRepository(db: Pool): SkillRepository {
  return {
    async findAll(filters) {
      const wheres: string[] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.active !== undefined) wheres.push(`s.active = ${add(filters.active === 'true' || filters.active === '1')}`);
      if (filters.category) wheres.push(`s.category = ${add(filters.category)}`);
      if (filters.search) wheres.push(`LOWER(s.name) LIKE LOWER(${add('%' + filters.search + '%')})`);

      const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
      const { rows } = await db.query(
        `SELECT s.*, (SELECT COUNT(*)::int FROM employee_skills es JOIN employees e ON e.id=es.employee_id WHERE es.skill_id=s.id AND e.deleted_at IS NULL) AS employees_count FROM skills s ${where} ORDER BY s.category NULLS LAST, s.name`,
        params,
      );
      return rows;
    },

    async findById(id) {
      const { rows } = await db.query(
        `SELECT s.*, (SELECT COUNT(*)::int FROM employee_skills es JOIN employees e ON e.id=es.employee_id WHERE es.skill_id=s.id AND e.deleted_at IS NULL) AS employees_count FROM skills s WHERE s.id=$1`, [id]);
      return rows[0] ?? null;
    },

    async create(data) {
      const { rows } = await db.query(
        `INSERT INTO skills (name, category, description) VALUES ($1,$2,$3) RETURNING *`,
        [data.name, data.category || null, data.description || null],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE skills SET name=COALESCE($1,name), category=COALESCE($2,category), description=COALESCE($3,description) WHERE id=$4 RETURNING *`,
        [data.name ?? null, data.category ?? null, data.description ?? null, id],
      );
      return rows[0] ?? null;
    },

    async hasEmployees(id) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM employee_skills es JOIN employees e ON e.id=es.employee_id WHERE es.skill_id=$1 AND e.deleted_at IS NULL`, [id]);
      return rows[0].cnt > 0;
    },

    async deactivate(id) {
      const { rows } = await db.query(`UPDATE skills SET active=false WHERE id=$1 RETURNING *`, [id]);
      return rows[0] ?? null;
    },

    async activate(id) {
      const { rows } = await db.query(`UPDATE skills SET active=true WHERE id=$1 RETURNING *`, [id]);
      return rows[0] ?? null;
    },
  };
}
