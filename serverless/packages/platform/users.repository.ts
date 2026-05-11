import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { User, CreateUserDTO, UpdateUserDTO } from './types';
import { ASSIGNABLE_ROLES, VALID_FUNCTIONS } from './types';
import type { AuthUser } from '@shared/types';
import { NotFound, BadRequest, Forbidden, Conflict } from '@shared/errors';

export interface UsersRepository {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  lookup(fn?: string): Promise<{ id: string; name: string }[]>;
  create(data: CreateUserDTO, actor: AuthUser): Promise<User>;
  update(id: string, data: UpdateUserDTO, actor: AuthUser): Promise<User>;
  softDelete(id: string, actor: AuthUser): Promise<void>;
  resetPassword(id: string): Promise<void>;
}

export function createUsersRepository(db: Pool): UsersRepository {
  return {
    async findAll() {
      const { rows } = await db.query(
        `SELECT id, email, name, role, function, active, must_change_password, created_at
         FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      );
      return rows;
    },

    async findById(id) {
      const { rows } = await db.query(
        `SELECT id, email, name, role, function, active, must_change_password, created_at
         FROM users WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async lookup(fn) {
      const wheres = ['deleted_at IS NULL', 'active = true'];
      const params: unknown[] = [];
      if (fn && (VALID_FUNCTIONS as string[]).includes(fn)) {
        params.push(fn);
        wheres.push(`function = $${params.length}`);
      }
      const { rows } = await db.query(
        `SELECT id, name FROM users WHERE ${wheres.join(' AND ')} ORDER BY name ASC`,
        params,
      );
      return rows;
    },

    async create(data, actor) {
      if (!data.email || !data.name || !data.role) {
        throw new BadRequest('Email, nombre y rol son requeridos');
      }
      if (!(ASSIGNABLE_ROLES as string[]).includes(data.role)) {
        throw new BadRequest(`Rol inválido. Opciones: ${ASSIGNABLE_ROLES.join(', ')}`);
      }
      if (data.role === 'admin' && actor.role !== 'superadmin') {
        throw new Forbidden('Solo el superadmin puede crear administradores');
      }
      if (data.function && !(VALID_FUNCTIONS as string[]).includes(data.function)) {
        throw new BadRequest(`Función inválida. Opciones: ${VALID_FUNCTIONS.join(', ')}`);
      }

      const hash = await bcrypt.hash(data.password || '000000', 12);
      try {
        const { rows } = await db.query(
          `INSERT INTO users (email, password_hash, name, role, function)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, email, name, role, function, active, must_change_password, created_at`,
          [data.email.toLowerCase(), hash, data.name, data.role, data.function || null],
        );
        return rows[0];
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new Conflict('Email ya registrado');
        }
        throw err;
      }
    },

    async update(id, data, actor) {
      const { rows: [target] } = await db.query(
        'SELECT id, role FROM users WHERE id=$1 AND deleted_at IS NULL',
        [id],
      );
      if (!target) throw new NotFound('Usuario', id);

      if (data.role !== undefined) {
        if (!(ASSIGNABLE_ROLES as string[]).includes(data.role)) {
          throw new BadRequest(`Rol inválido. Opciones: ${ASSIGNABLE_ROLES.join(', ')}`);
        }
        if (actor.role !== 'superadmin') {
          throw new Forbidden('Solo el superadmin puede cambiar roles');
        }
        if (target.role === 'superadmin') {
          throw new Forbidden('No se puede cambiar el rol del superadmin');
        }
        if (target.id === actor.id) {
          throw new Forbidden('No puedes cambiar tu propio rol');
        }
      }

      if (data.function !== undefined && data.function !== null && !(VALID_FUNCTIONS as string[]).includes(data.function)) {
        throw new BadRequest(`Función inválida. Opciones: ${VALID_FUNCTIONS.join(', ')}`);
      }

      const { rows } = await db.query(
        `UPDATE users
         SET name     = COALESCE($1, name),
             role     = COALESCE($2, role),
             function = CASE WHEN $3::varchar IS NOT NULL THEN $3::varchar ELSE function END,
             active   = COALESCE($4, active),
             updated_at = NOW()
         WHERE id = $5
         RETURNING id, email, name, role, function, active, must_change_password, created_at`,
        [data.name ?? null, data.role ?? null, data.function ?? null, data.active ?? null, id],
      );
      return rows[0];
    },

    async softDelete(id, actor) {
      if (actor.role !== 'superadmin') {
        throw new Forbidden('Solo el superadmin puede eliminar usuarios');
      }
      if (id === actor.id) {
        throw new Forbidden('No puedes eliminarte a ti mismo');
      }

      const { rows: [target] } = await db.query(
        'SELECT id, email, role FROM users WHERE id=$1 AND deleted_at IS NULL',
        [id],
      );
      if (!target) throw new NotFound('Usuario', id);
      if (target.role === 'superadmin') {
        throw new Forbidden('No se puede eliminar al superadmin');
      }

      const { rows: [{ count }] } = await db.query(
        'SELECT COUNT(*)::int AS count FROM quotations WHERE created_by=$1',
        [id],
      );
      if (count > 0) {
        throw new Conflict(
          `Este usuario tiene ${count} cotización(es). Desactívalo en lugar de eliminarlo para preservar el historial.`,
        );
      }

      await db.query(
        'UPDATE users SET deleted_at = NOW(), active = false WHERE id = $1',
        [id],
      );
    },

    async resetPassword(id) {
      const hash = await bcrypt.hash('000000', 12);
      await db.query(
        'UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2',
        [hash, id],
      );
    },
  };
}
