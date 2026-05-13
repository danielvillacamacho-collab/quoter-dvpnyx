import type { Pool } from 'pg';
import type { PaginatedResult, SortParams } from '@shared/types';
import type { Employee } from './types';

export interface EmployeeRepository {
  findAll(params: { page: number; limit: number; offset: number; filters: Record<string, string | undefined>; sort: SortParams }): Promise<PaginatedResult<Employee>>;
  findById(id: string): Promise<Employee | null>;
  lookup(): Promise<Pick<Employee, 'id' | 'first_name' | 'last_name' | 'area_id' | 'level' | 'status' | 'weekly_capacity_hours'>[]>;
  create(data: Record<string, unknown>): Promise<Employee>;
  update(id: string, data: Record<string, unknown>): Promise<Employee | null>;
  softDelete(id: string): Promise<Employee | null>;
  hasActiveAssignments(id: string): Promise<boolean>;
  getSkills(id: string): Promise<unknown[]>;
  setSkills(id: string, skillIds: string[]): Promise<void>;
}

export function createEmployeeRepository(db: Pool): EmployeeRepository {
  return {
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres = ['e.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.search) wheres.push(`(LOWER(e.first_name) LIKE LOWER(${add('%' + filters.search + '%')}) OR LOWER(e.last_name) LIKE LOWER(${add('%' + filters.search + '%')}) OR LOWER(e.corporate_email) LIKE LOWER(${add('%' + filters.search + '%')}))`);
      if (filters.area_id) wheres.push(`e.area_id = ${add(filters.area_id)}`);
      if (filters.status) wheres.push(`e.status = ${add(filters.status)}`);
      if (filters.level) wheres.push(`e.level = ${add(filters.level)}`);
      if (filters.country) wheres.push(`e.country = ${add(filters.country)}`);

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM employees e ${where}`, countParams),
        db.query(
          `SELECT e.*, a.name AS area_name, (SELECT COUNT(*)::int FROM employee_skills WHERE employee_id=e.id) AS skills_count
           FROM employees e LEFT JOIN areas a ON a.id = e.area_id
           ${where} ORDER BY ${sort.orderBy || 'e.last_name ASC'}
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
      ]);
      const total = countRes.rows[0].total;
      return { data: rowsRes.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
    },

    async findById(id) {
      const { rows } = await db.query(
        `SELECT e.*, a.name AS area_name FROM employees e LEFT JOIN areas a ON a.id = e.area_id WHERE e.id=$1 AND e.deleted_at IS NULL`, [id]);
      return rows[0] ?? null;
    },

    async lookup() {
      const { rows } = await db.query(
        `SELECT e.id, e.first_name, e.last_name, e.area_id, e.level, e.status, e.weekly_capacity_hours, a.name AS area_name
         FROM employees e LEFT JOIN areas a ON a.id = e.area_id
         WHERE e.deleted_at IS NULL AND e.status <> 'terminated'
         ORDER BY e.last_name, e.first_name`);
      return rows;
    },

    async create(data) {
      const { rows } = await db.query(
        `INSERT INTO employees (first_name, last_name, personal_email, corporate_email, country, city, area_id, level, seniority_label, employment_type, weekly_capacity_hours, languages, start_date, end_date, status, squad_id, manager_user_id, notes, tags, user_id, bio, linkedin_url, github_url, portfolio_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
        [data.first_name, data.last_name, data.personal_email || null, data.corporate_email || null, data.country || null, data.city || null, data.area_id || null, data.level || null, data.seniority_label || null, data.employment_type || 'fulltime', data.weekly_capacity_hours ?? 40, data.languages || null, data.start_date || null, data.end_date || null, data.status || 'active', data.squad_id || null, data.manager_user_id || null, data.notes || null, data.tags || null, data.user_id || null, data.bio || null, data.linkedin_url || null, data.github_url || null, data.portfolio_url || null],
      );
      return rows[0];
    },

    async update(id, data) {
      const { rows } = await db.query(
        `UPDATE employees SET
            first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name),
            personal_email=COALESCE($3,personal_email), corporate_email=COALESCE($4,corporate_email),
            country=COALESCE($5,country), city=COALESCE($6,city), area_id=COALESCE($7,area_id),
            level=COALESCE($8,level), seniority_label=COALESCE($9,seniority_label),
            employment_type=COALESCE($10,employment_type), weekly_capacity_hours=COALESCE($11,weekly_capacity_hours),
            languages=COALESCE($12,languages), start_date=COALESCE($13,start_date),
            end_date=COALESCE($14,end_date), status=COALESCE($15,status), squad_id=COALESCE($16,squad_id),
            manager_user_id=COALESCE($17,manager_user_id), notes=COALESCE($18,notes),
            tags=COALESCE($19,tags), user_id=COALESCE($20,user_id),
            bio=COALESCE($21,bio), linkedin_url=COALESCE($22,linkedin_url),
            github_url=COALESCE($23,github_url), portfolio_url=COALESCE($24,portfolio_url),
            updated_at=NOW()
          WHERE id=$25 AND deleted_at IS NULL RETURNING *`,
        [data.first_name||null,data.last_name||null,data.personal_email??null,data.corporate_email??null,data.country??null,data.city??null,data.area_id??null,data.level??null,data.seniority_label??null,data.employment_type??null,data.weekly_capacity_hours??null,data.languages??null,data.start_date??null,data.end_date??null,data.status??null,data.squad_id??null,data.manager_user_id??null,data.notes??null,data.tags??null,data.user_id??null,data.bio??null,data.linkedin_url??null,data.github_url??null,data.portfolio_url??null,id],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE employees SET deleted_at=NOW(), status='terminated', updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`, [id]);
      return rows[0] ?? null;
    },

    async hasActiveAssignments(id) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM assignments WHERE employee_id=$1 AND status IN ('planned','active') AND deleted_at IS NULL`, [id]);
      return rows[0].cnt > 0;
    },

    async getSkills(id) {
      const { rows } = await db.query(
        `SELECT s.*, es.proficiency FROM employee_skills es JOIN skills s ON s.id = es.skill_id WHERE es.employee_id = $1 ORDER BY s.category, s.name`, [id]);
      return rows;
    },

    async setSkills(id, skillIds) {
      await db.query(`DELETE FROM employee_skills WHERE employee_id = $1`, [id]);
      if (skillIds.length) {
        const values = skillIds.map((sid, i) => `($1, $${i + 2})`).join(', ');
        await db.query(`INSERT INTO employee_skills (employee_id, skill_id) VALUES ${values}`, [id, ...skillIds]);
      }
    },
  };
}
