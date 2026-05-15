import jwt from 'jsonwebtoken';
import type { ApiResponse, AuthUser } from '../types';
import { ensureRuntimeConfig } from '../config/secrets';
import { getPool } from '../db/connection';
import type { RouterEvent } from '../http/router';
import { error } from '../http/response';

type AuthenticatedHandler = (
  event: RouterEvent,
  user: AuthUser,
) => Promise<ApiResponse>;

// FIX-AUTH-01: after verifying the JWT signature, check DB to ensure the
// user is still active and not soft-deleted. Closes the 8h window where a
// valid token would work after account deactivation/deletion.
export async function withAuth(
  event: RouterEvent,
  handler: AuthenticatedHandler,
): Promise<ApiResponse> {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return error(401, { error: 'Token requerido' });
  }

  try {
    await ensureRuntimeConfig();

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser & { role: string; function?: string };
    const legacyRole = decoded.role as string;

    if (legacyRole === 'preventa' && !decoded.function) {
      decoded.function = 'preventa';
      decoded.role = 'member';
    }

    const db = getPool();
    const { rows } = await db.query(
      'SELECT active, deleted_at FROM users WHERE id=$1',
      [(decoded as AuthUser).id],
    );
    if (!rows.length || !rows[0].active || rows[0].deleted_at) {
      return error(401, { error: 'Token invalido o expirado' });
    }

    return handler(event, decoded as AuthUser);
  } catch (err: unknown) {
    if (err instanceof Error && err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
      console.error('[auth] error:', (err as Error).message);
    }
    return error(401, { error: 'Token invalido o expirado' });
  }
}
