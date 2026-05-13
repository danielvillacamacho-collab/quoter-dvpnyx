import jwt from 'jsonwebtoken';
import type { ApiResponse, AuthUser } from '../types';
import { ensureRuntimeConfig } from '../config/secrets';
import type { RouterEvent } from '../http/router';
import { error } from '../http/response';

type AuthenticatedHandler = (
  event: RouterEvent,
  user: AuthUser,
) => Promise<ApiResponse>;

export function withAuth(
  event: RouterEvent,
  handler: AuthenticatedHandler,
): Promise<ApiResponse> {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return Promise.resolve(error(401, { error: 'Token requerido' }));
  }

  return ensureRuntimeConfig().then(() => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser & { role: string; function?: string };
      const legacyRole = decoded.role as string;

      if (legacyRole === 'preventa' && !decoded.function) {
        decoded.function = 'preventa';
        decoded.role = 'member';
      }

      return handler(event, decoded as AuthUser);
    } catch {
      return error(401, { error: 'Token invalido o expirado' });
    }
  }).catch((err) => {
    console.error('[auth] runtime config failed:', err.message);
    return error(500, { error: 'Runtime configuration unavailable' });
  });
}
