/* ------------------------------------------------------------------ */
/* Platform — auth, users, notifications, parameters                   */
/* ------------------------------------------------------------------ */

export type Role = 'superadmin' | 'admin' | 'director' | 'lead' | 'member' | 'staff' | 'viewer' | 'external';

export type UserFunction =
  | 'comercial' | 'preventa' | 'capacity_manager' | 'delivery_manager'
  | 'project_manager' | 'fte_tecnico' | 'people' | 'finance' | 'pmo' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  function: UserFunction | null;
  active: boolean;
  must_change_password: boolean;
  preferences: Record<string, unknown>;
  google_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  has_employee?: boolean;
}

export interface CreateUserDTO {
  email: string;
  name: string;
  role: Role;
  function?: UserFunction | null;
  password?: string;
}

export interface UpdateUserDTO {
  name?: string;
  role?: Role;
  function?: UserFunction | null;
  active?: boolean;
}

export interface LoginResult {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    function: string | null;
    must_change_password: boolean;
  };
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Parameter {
  id: string;
  category: string;
  key: string;
  value: string;
  label: string | null;
  note: string | null;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
}

export interface UserPreferences {
  scheme?: 'light' | 'dark';
  accentHue?: number;
  density?: number;
}

export const ASSIGNABLE_ROLES: Role[] = ['admin', 'lead', 'member', 'viewer'];

export const VALID_FUNCTIONS: UserFunction[] = [
  'comercial', 'preventa', 'capacity_manager', 'delivery_manager',
  'project_manager', 'fte_tecnico', 'people', 'finance', 'pmo', 'admin',
];

export const ALLOWED_PREF_KEYS = ['scheme', 'accentHue', 'density'] as const;
