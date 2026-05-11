import type { AuthUser, Role } from '../types';
import { Forbidden } from '../errors';

const ROLE_HIERARCHY: Record<Role, number> = {
  superadmin: 100,
  admin: 90,
  director: 80,
  lead: 70,
  member: 60,
  staff: 50,
  viewer: 40,
  external: 10,
};

export const SEE_ALL_ROLES = new Set<Role>(['superadmin', 'admin', 'director']);
export const WRITE_ROLES = new Set<Role>(['superadmin', 'admin', 'director', 'lead', 'member']);

export function requireRole(...allowed: Role[]) {
  return (user: AuthUser): void => {
    if (!allowed.includes(user.role)) {
      throw new Forbidden();
    }
  };
}

export function requireAdmin(user: AuthUser): void {
  if (!['admin', 'superadmin'].includes(user.role)) {
    throw new Forbidden('Acceso solo para administradores');
  }
}

export function requireSuperadmin(user: AuthUser): void {
  if (user.role !== 'superadmin') {
    throw new Forbidden('Acceso solo para superadmin');
  }
}

export function isAtLeast(user: AuthUser, minRole: Role): boolean {
  return (ROLE_HIERARCHY[user.role] || 0) >= (ROLE_HIERARCHY[minRole] || 0);
}

export function canSeeAll(user: AuthUser): boolean {
  return SEE_ALL_ROLES.has(user.role);
}
