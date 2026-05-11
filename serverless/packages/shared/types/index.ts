export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'admin' | 'director' | 'lead' | 'member' | 'staff' | 'viewer' | 'external';
  function?: string;
  squad_id?: string;
  employee_id?: string;
}

export type Role = AuthUser['role'];

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface SortParams {
  field: string | null;
  dir: 'asc' | 'desc' | null;
  column: string | null;
  orderBy: string | null;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ListParams {
  page: number;
  limit: number;
  offset: number;
  filters: Record<string, string | undefined>;
  sort: SortParams;
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface EventPayload {
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string | null;
  payload?: Record<string, unknown>;
  ip_address?: string | null;
  user_agent?: string | null;
}
