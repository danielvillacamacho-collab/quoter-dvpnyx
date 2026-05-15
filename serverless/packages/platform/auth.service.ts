import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import type { LoginResult, UserPreferences } from './types';
import { ALLOWED_PREF_KEYS } from './types';
import { AppError, BadRequest, Forbidden, NotFound, Unauthorized } from '@shared/errors';
import { ensureRuntimeConfig } from '@shared/config/secrets';

export interface AuthService {
  login(email: string, password: string): Promise<LoginResult>;
  googleLogin(credential: string | undefined, ipAddress?: string | null): Promise<LoginResult>;
  changePassword(userId: string, currentPassword: string | undefined, newPassword: string): Promise<void>;
  getMe(userId: string): Promise<Record<string, unknown>>;
  updatePreferences(userId: string, body: Record<string, unknown>): Promise<{ preferences: Record<string, unknown> }>;
}

interface GoogleIdentity {
  googleId: string;
  email: string;
  name: string;
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

function buildLoginResult(user: Record<string, unknown>): LoginResult {
  const signOptions: SignOptions = { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as SignOptions['expiresIn'] };
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      function: user.function || null,
    },
    process.env.JWT_SECRET!,
    signOptions,
  );

  return {
    token,
    user: {
      id: String(user.id),
      email: String(user.email),
      name: String(user.name),
      role: String(user.role),
      function: (user.function as string | null) || null,
      must_change_password: Boolean(user.must_change_password),
    },
  };
}

async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  await ensureRuntimeConfig();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new AppError('Google OAuth no configurado', 500, 'google_not_configured');
  }

  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Unauthorized('Token de Google invalido');
  }

  const allowedDomain = (process.env.GOOGLE_ALLOWED_DOMAIN || '').trim().toLowerCase();
  if (allowedDomain && String(payload.hd || '').toLowerCase() !== allowedDomain) {
    throw new Forbidden(`Solo se permite acceso con cuentas de ${allowedDomain}`);
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
  };
}

export function createAuthService(db: Pool): AuthService {
  return {
    async login(email, password) {
      if (!email || !password) throw new BadRequest('Email y contrasena requeridos');

      const { rows } = await db.query(
        'SELECT * FROM users WHERE email=$1 AND active=true AND deleted_at IS NULL',
        [email.toLowerCase()],
      );
      if (!rows.length) throw new Unauthorized('Credenciales invalidas');

      const user = rows[0];
      if (!user.password_hash) throw new Unauthorized('Credenciales invalidas');
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) throw new Unauthorized('Credenciales invalidas');

      return buildLoginResult(user);
    },

    async googleLogin(credential, ipAddress) {
      if (!credential) throw new BadRequest('Token de Google requerido');
      const identity = await verifyGoogleCredential(credential);

      let user: Record<string, unknown> | null = null;
      const byGoogle = await db.query(
        'SELECT * FROM users WHERE google_id=$1 AND active=true AND deleted_at IS NULL',
        [identity.googleId],
      );
      if (byGoogle.rows.length) {
        user = byGoogle.rows[0];
      }

      if (!user) {
        const byEmail = await db.query(
          'SELECT * FROM users WHERE LOWER(email)=$1 AND active=true AND deleted_at IS NULL',
          [identity.email],
        );
        if (byEmail.rows.length) {
          const linked = await db.query(
            'UPDATE users SET google_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [identity.googleId, byEmail.rows[0].id],
          );
          user = linked.rows[0];
        }
      }

      if (!user) {
        const employee = await db.query(
          `SELECT id, first_name, last_name, corporate_email, personal_email
             FROM employees
            WHERE deleted_at IS NULL
              AND (LOWER(corporate_email)=$1 OR LOWER(personal_email)=$1)
            LIMIT 1`,
          [identity.email],
        );

        if (employee.rows.length) {
          // FIX-AUTH-04: wrap INSERT user + UPDATE employee in a transaction
          // so a failed link doesn't leave an orphan user row.
          const conn = await db.connect();
          try {
            await conn.query('BEGIN');
            const displayName = identity.name || `${employee.rows[0].first_name} ${employee.rows[0].last_name}`.trim();
            const created = await conn.query(
              `INSERT INTO users (email, name, role, active, google_id, must_change_password)
               VALUES ($1, $2, 'staff', true, $3, false)
               RETURNING *`,
              [identity.email, displayName, identity.googleId],
            );
            const createdUser = created.rows[0] as Record<string, unknown>;
            await conn.query('UPDATE employees SET user_id=$1, updated_at=NOW() WHERE id=$2', [createdUser.id, employee.rows[0].id]);
            await conn.query('COMMIT');
            user = createdUser;
          } catch (err) {
            await conn.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            conn.release();
          }
        }
      }

      if (!user) {
        throw new Forbidden('No existe una cuenta asociada a este correo');
      }

      await db.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, changes, ip_address)
         VALUES ($1, 'google_login', 'user', $1, $2::jsonb, $3)`,
        [user.id, JSON.stringify({ email: identity.email }), ipAddress || null],
      ).catch(() => undefined);

      return buildLoginResult(user);
    },

    async changePassword(userId, currentPassword, newPassword) {
      if (!newPassword || newPassword.length < 8) {
        throw new BadRequest('La contrasena debe tener al menos 8 caracteres');
      }
      const { rows } = await db.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
      if (!rows.length) throw new NotFound('Usuario', userId);

      if (currentPassword) {
        const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
        if (!valid) throw new Unauthorized('Contrasena actual incorrecta');
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
          // FIX-AUTH-06: audit trail for automatic user↔employee link.
          await db.query(
            `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
               VALUES ($1, 'auto_link_employee', 'employee', $2, $3)`,
            [row.id, match[0].id, JSON.stringify({ user_email: row.email })],
          ).catch(() => undefined);
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
