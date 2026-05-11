import crypto from 'crypto';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly errorId: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.errorId = 'ERR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  }
}

export class NotFound extends AppError {
  constructor(entity: string, id?: string) {
    super(
      id ? `${entity} no encontrado (${id})` : `${entity} no encontrado`,
      404,
      'not_found',
    );
    this.name = 'NotFound';
  }
}

export class BadRequest extends AppError {
  constructor(message: string) {
    super(message, 400, 'bad_request');
    this.name = 'BadRequest';
  }
}

export class Conflict extends AppError {
  constructor(message: string, public readonly extra?: Record<string, unknown>) {
    super(message, 409, 'conflict');
    this.name = 'Conflict';
  }
}

export class Forbidden extends AppError {
  constructor(message = 'Rol insuficiente para esta acción') {
    super(message, 403, 'forbidden');
    this.name = 'Forbidden';
  }
}

export class Unauthorized extends AppError {
  constructor(message = 'Token requerido') {
    super(message, 401, 'unauthorized');
    this.name = 'Unauthorized';
  }
}

const PG_LABELS: Record<string, string> = {
  '23505': 'unique_violation',
  '23503': 'foreign_key_violation',
  '23502': 'not_null_violation',
  '23514': 'check_violation',
  '42703': 'undefined_column',
  '42P01': 'undefined_table',
};

const PG_STATUS: Record<string, number> = {
  '23505': 409,
  '23503': 400,
  '23502': 400,
};

interface PgError extends Error {
  code?: string;
  constraint?: string;
  column?: string;
  table?: string;
  detail?: string;
}

export function humanSummary(err: PgError): string {
  if (!err?.code) return err?.message || 'Error desconocido';
  switch (err.code) {
    case '23505':
      return `Registro duplicado${err.constraint ? ` (${err.constraint})` : ''}${err.detail ? ': ' + err.detail : ''}`;
    case '23503':
      return `Referencia inválida — el registro relacionado no existe${err.constraint ? ` (${err.constraint})` : ''}`;
    case '23502':
      return `Campo obligatorio vacío${err.column ? `: ${err.column}` : ''}`;
    case '23514':
      return `Valor no permitido${err.constraint ? ` (${err.constraint})` : ''}`;
    default:
      return err.message || `Error de base de datos (${err.code})`;
  }
}

export function fromPgError(err: PgError): AppError {
  const status = (err.code && PG_STATUS[err.code]) || 500;
  const appErr = new AppError(humanSummary(err), status, err.code ? PG_LABELS[err.code] || 'db_error' : 'db_error');
  return appErr;
}

export function toErrorResponse(err: unknown, where: string) {
  const timestamp = new Date().toISOString();

  if (err instanceof AppError) {
    console.error(JSON.stringify({
      level: 'error', errorId: err.errorId, where, timestamp,
      message: err.message, code: err.code, statusCode: err.statusCode,
    }));
    return {
      statusCode: err.statusCode,
      body: { error: err.message, errorId: err.errorId, code: err.code, where, timestamp,
        ...((err as Conflict).extra || {}),
      },
    };
  }

  const pgErr = err as PgError;
  if (pgErr?.code && PG_LABELS[pgErr.code]) {
    const appErr = fromPgError(pgErr);
    console.error(JSON.stringify({
      level: 'error', errorId: appErr.errorId, where, timestamp,
      message: appErr.message, pgCode: pgErr.code, stack: pgErr.stack,
    }));
    return {
      statusCode: appErr.statusCode,
      body: { error: appErr.message, errorId: appErr.errorId, where, timestamp },
    };
  }

  const errorId = 'ERR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const message = (err as Error)?.message || String(err);
  console.error(JSON.stringify({
    level: 'error', errorId, where, timestamp, message,
    stack: (err as Error)?.stack || null,
  }));
  return {
    statusCode: 500,
    body: { error: 'Error interno del servidor', errorId, where, timestamp },
  };
}
