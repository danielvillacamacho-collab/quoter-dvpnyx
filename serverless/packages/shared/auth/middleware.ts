import jwt from 'jsonwebtoken';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ApiResponse, AuthUser } from '../types';
import { error } from '../http/response';

type AuthenticatedHandler = (
  event: APIGatewayProxyEventV2,
  user: AuthUser,
) => Promise<ApiResponse>;

export function withAuth(
  event: APIGatewayProxyEventV2,
  handler: AuthenticatedHandler,
): Promise<ApiResponse> {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return Promise.resolve(error(401, { error: 'Token requerido' }));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser & { role: string; function?: string };

    if (decoded.role === 'preventa' && !decoded.function) {
      decoded.function = 'preventa';
      decoded.role = 'member';
    }

    return handler(event, decoded as AuthUser);
  } catch {
    return Promise.resolve(error(401, { error: 'Token inválido o expirado' }));
  }
}
