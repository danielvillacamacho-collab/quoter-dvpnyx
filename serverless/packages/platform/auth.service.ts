import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { LoginResult, UserPreferences } from './types';
import { ALLOWED_PREF_KEYS } from './types';
import { BadRequest, NotFound, Unauthorized } from '@shared/errors';

export interface AuthService {
  login(email: string, password: string): Promise<LoginResult>;
  changePassword(userId: string, currentPassword: string | undefined, newPassword: string): Promise<void>;
  getMe(userId: string): Promise<Record<string, unknown>>;
  updatePreferences(userId: string, body: Record<string, unknown>): Promise<{ preferences: Record<string, unknown> }>;
}

function sanitizePrefs(body: Record<string, unknown>): Partial<UserPreferences> {
  const out: Partial<UserPreferences> = {};
  if (!body || typeof body !== 'object') return out;
  for (const k of ALLOWED_PREF_KEYS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === 'scheme' && (v === 'light' || v === 'dark')) out.scheme = v;
    else if (k === 'accentHue' && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 360) {
      out.accentHue = Math.round(v);
    } else if (k === 'density' && typeof v === 'number' && Number.isFinite(v) && v >= 0.85 && v <= 1.2) {
      out.density = Number(v);
    }
  }
  return out;
}

export function createAuthService(db: Pool): AuthService {
  return {
    async login(email, password) {
      if (!email || !password) throw new BadRequest('Email y contraseña requeridos');

      const { rows } = await db.query(
        'SELECT * FROM users WHERE email=$1 AND active=true',
        [email.toLowerCase()],
      );
      if (!rows.length) throw new Unauthorized('Credenciales inválidas');

      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) throw new Unauthorized('Credenciales inválidas');

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role, function: user.function || null },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
      );

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          function: user.function || null,
          must_change_password: user.must_change_password,
        },
      };
    },

    async changePassword(userId, currentPassword, newPassword) {
      if (!newPassword || newPassword.length < 8) {
        throw new BadRequest('La contraseña debe tener al menos 8 caracteres');
      }
      const { rows } = await db.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
      if (!rows.length) throw new NotFound('Usuario', userId);

      if (currentPassword) {
        const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
        if (!valid) throw new Unauthorized('Contraseña actual incorrecta');
      }

      const hash = await bcrypt.hash(newPassword, 12);
      await db.query(
        'UPDATE users SET password_hash=$1, must_change_password=false, updated_at=NOW() WHERE id=$2',
        [hash, userId],
      );
    },

    async getMe(userId) {
      const { rows } = await db.query(
        'SELECT id, email, name, role, function, must_change_password, preferences FROM users WHERE id=$1',
        [userId],
      );
      if (!rows.length) throw new NotFound('Usuario', userId);
      const row = rows[0];
      row.preferences = row.preferences || {};

      let { rows: empRows } = await db.query(
        'SELECT id FROM employees WHERE user_id=$1 AND deleted_at IS NULL',
        [userId],
      );
      if (!empRows.length && row.email) {
        const { rows: match } = await db.query(
          `SELECT id FROM employees
            WHERE user_id IS NULL AND deleted_at IS NULL
              AND (LOWER(corporate_email)=$1 OR LOWER(personal_email)=$1)
            LIMIT 1`,
          [row.email.toLowerCase()],
        );
        if (match.length) {
          await db.query('UPDATE employees SET user_id=$1, updated_at=NOW() WHERE id=$2', [row.id, match[0].id]);
          empRows = match;
        }
      }
      row.has_employee = empRows.length > 0;
      return row;
    },

    async updatePreferences(userId, body) {
      const patch = sanitizePrefs(body);
      const { rows } = await db.query(
        `UPDATE users
           SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb,
               updated_at = NOW()
         WHERE id = $2
         RETURNING preferences`,
        [JSON.stringify(patch), userId],
      );
      if (!rows.length) throw new NotFound('Usuario', userId);
      return { preferences: rows[0].preferences || {} };
    },
  };
}
