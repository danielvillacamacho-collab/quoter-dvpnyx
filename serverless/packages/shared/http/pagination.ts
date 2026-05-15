import type { PaginationParams, SortParams } from '../types';

export function parsePagination(
  query: Record<string, string | undefined> | null,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): PaginationParams {
  const { defaultLimit = 25, maxLimit = 100 } = opts;
  const raw = query || {};
  const page = Math.max(parseFiniteInt(raw.page, 1), 1);
  const limit = Math.min(Math.max(parseFiniteInt(raw.limit, defaultLimit), 1), maxLimit);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function parseFiniteInt(input: string | undefined | null, fallback = 0): number {
  if (input == null || input === '') return fallback;
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

const VALID_DIR_TOKENS: Record<string, 'asc' | 'desc'> = {
  asc: 'asc', ascending: 'asc', up: 'asc', a: 'asc',
  desc: 'desc', descending: 'desc', down: 'desc', d: 'desc',
};

export function parseSort(
  query: Record<string, string | undefined> | null,
  sortable: Record<string, string>,
  opts: {
    defaultField?: string;
    defaultDir?: 'asc' | 'desc';
    nullsLast?: boolean;
    tieBreaker?: string;
  } = {},
): SortParams {
  const { defaultField, defaultDir = 'desc', nullsLast = true, tieBreaker } = opts;
  const raw = query || {};

  const requestedField = (raw.sort || '').trim();
  const requestedDir = (raw.dir || raw.order || '').trim().toLowerCase();

  let field: string | null = null;
  if (requestedField && Object.prototype.hasOwnProperty.call(sortable, requestedField)) {
    field = requestedField;
  } else if (defaultField && Object.prototype.hasOwnProperty.call(sortable, defaultField)) {
    field = defaultField;
  }

  if (!field) return { field: null, dir: null, column: null, orderBy: null };

  const dir = VALID_DIR_TOKENS[requestedDir] || defaultDir;
  const column = sortable[field];
  const sqlDir = dir === 'asc' ? 'ASC' : 'DESC';
  const nullsClause = nullsLast ? ' NULLS LAST' : '';
  const orderBy = `${column} ${sqlDir}${nullsClause}${tieBreaker ? ', ' + tieBreaker : ''}`;

  return { field, dir, column, orderBy };
}
