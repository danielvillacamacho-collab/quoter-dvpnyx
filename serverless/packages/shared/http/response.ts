import type { ApiResponse, PaginatedResult } from '../types';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export function ok(body: unknown): ApiResponse {
  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function created(body: unknown): ApiResponse {
  return { statusCode: 201, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function noContent(): ApiResponse {
  return { statusCode: 204, headers: JSON_HEADERS, body: '' };
}

export function paginated<T>(result: PaginatedResult<T>): ApiResponse {
  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(result) };
}

export function error(statusCode: number, body: Record<string, unknown>): ApiResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function message(text: string): ApiResponse {
  return ok({ message: text });
}
