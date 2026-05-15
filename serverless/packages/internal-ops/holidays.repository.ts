import type { Pool } from 'pg';
import type { Holiday, CreateHolidayDTO, UpdateHolidayDTO, HolidayFilters } from './types';
import { VALID_HOLIDAY_TYPES } from './types';
import { NotFound, BadRequest, Conflict } from '@shared/errors';

export interface HolidaysRepository {
  findAll(filters: HolidayFilters): Promise<{ data: Holiday[] }>;
  create(data: CreateHolidayDTO, createdBy: string): Promise<Holiday>;
  update(id: string, data: UpdateHolidayDTO): Promise<Holiday>;
  hardDelete(id: string): Promise<void>;
}

export function createHolidaysRepository(db: Pool): HolidaysRepository {
  return {
    async findAll(filters) {
      const wheres: string[] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.country) wheres.push(`h.country_id = ${add(String(filters.country).toUpperCase())}`);
      if (filters.year) {
        const y = parseInt(filters.year, 10);
        if (Number.isFinite(y)) wheres.push(`h.year = ${add(y)}`);
      }
      if (filters.from) wheres.push(`h.holiday_date >= ${add(filters.from)}::date`);
      if (filters.to) wheres.push(`h.holiday_date <= ${add(filters.to)}::date`);

      const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
      const { rows } = await db.query(
        `SELECT h.id, h.country_id, h.holiday_date, h.label, h.holiday_type,
                h.year, h.notes, h.created_at,
                c.label_es AS country_label
           FROM country_holidays h
           LEFT JOIN countries c ON c.id = h.country_id
           ${where}
           ORDER BY h.holiday_date ASC`,
        params,
      );
      return { data: rows };
    },

    async create(data, createdBy) {
      const countryId = String(data.country_id || '').toUpperCase();
      if (!countryId || countryId.length !== 2) throw new BadRequest('country_id inválido (ISO-2)');
      if (!data.holiday_date || !/^\d{4}-\d{2}-\d{2}$/.test(data.holiday_date)) {
        throw new BadRequest('holiday_date inválido (YYYY-MM-DD)');
      }
      if (!data.label || String(data.label).trim().length < 3) {
        throw new BadRequest('label requerido (>=3 chars)');
      }
      const type = data.holiday_type || 'national';
      if (!(VALID_HOLIDAY_TYPES as string[]).includes(type)) {
        throw new BadRequest(`holiday_type inválido (válidos: ${VALID_HOLIDAY_TYPES.join(',')})`);
      }
      const year = parseInt(data.holiday_date.slice(0, 4), 10);

      try {
        const { rows } = await db.query(
          `INSERT INTO country_holidays (country_id, holiday_date, label, holiday_type, year, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [countryId, data.holiday_date, String(data.label).trim(), type, year, data.notes || null, createdBy],
        );
        return rows[0];
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') throw new Conflict('Ya existe un festivo en esa fecha para ese país');
        if (pgErr.code === '23503') throw new BadRequest('country_id no existe en catálogo');
        throw err;
      }
    },

    async update(id, data) {
      const sets: string[] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (data.label !== undefined) {
        if (!data.label || String(data.label).trim().length < 3) throw new BadRequest('label inválido');
        sets.push(`label = ${add(String(data.label).trim())}`);
      }
      if (data.holiday_type !== undefined) {
        if (!(VALID_HOLIDAY_TYPES as string[]).includes(data.holiday_type)) {
          throw new BadRequest('holiday_type inválido');
        }
        sets.push(`holiday_type = ${add(data.holiday_type)}`);
      }
      if (data.holiday_date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.holiday_date)) throw new BadRequest('holiday_date inválido');
        sets.push(`holiday_date = ${add(data.holiday_date)}`);
        sets.push(`year = ${add(parseInt(data.holiday_date.slice(0, 4), 10))}`);
      }
      if (data.notes !== undefined) sets.push(`notes = ${add(data.notes)}`);

      if (sets.length === 0) throw new BadRequest('Sin campos para actualizar');
      sets.push(`updated_at = NOW()`);

      params.push(id);
      try {
        const { rows } = await db.query(
          `UPDATE country_holidays SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        if (!rows.length) throw new NotFound('Holiday', id);
        return rows[0];
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') throw new Conflict('Conflicto: otro festivo ya existe con esa fecha+país');
        throw err;
      }
    },

    async hardDelete(id) {
      const { rowCount } = await db.query(
        `DELETE FROM country_holidays WHERE id = $1`,
        [id],
      );
      if (!rowCount) throw new NotFound('Holiday', id);
    },
  };
}
