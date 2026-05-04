const crypto = require('crypto');

// ── Error ID generator ──────────────────────────────────────────────
function generateErrorId() {
  return 'ERR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ── Postgres error detail extractor ─────────────────────────────────
function extractPgDetail(err) {
  if (!err || !err.code) return null;
  const detail = { pgCode: err.code };
  if (err.constraint) detail.constraint = err.constraint;
  if (err.column) detail.column = err.column;
  if (err.table) detail.table = err.table;
  if (err.detail) detail.pgDetail = err.detail;

  const PG_LABELS = {
    '23505': 'unique_violation',
    '23503': 'foreign_key_violation',
    '23502': 'not_null_violation',
    '23514': 'check_violation',
    '42703': 'undefined_column',
    '42P01': 'undefined_table',
    '42601': 'syntax_error',
    '08006': 'connection_failure',
    '57014': 'query_cancelled',
    '40001': 'serialization_failure',
  };
  if (PG_LABELS[err.code]) detail.pgLabel = PG_LABELS[err.code];

  return detail;
}

// ── Human-readable error summary from Postgres errors ───────────────
function humanSummary(err) {
  if (!err) return 'Error desconocido';
  const pg = extractPgDetail(err);
  if (!pg) return err.message || String(err);

  switch (pg.pgCode) {
    case '23505':
      return `Registro duplicado${pg.constraint ? ` (${pg.constraint})` : ''}${pg.pgDetail ? ': ' + pg.pgDetail : ''}`;
    case '23503':
      return `Referencia inválida — el registro relacionado no existe${pg.constraint ? ` (${pg.constraint})` : ''}`;
    case '23502':
      return `Campo obligatorio vacío${pg.column ? `: ${pg.column}` : ''}`;
    case '23514':
      return `Valor no permitido${pg.constraint ? ` (${pg.constraint})` : ''}`;
    case '42703':
      return `Columna no existe en la base de datos — posible migración pendiente`;
    case '42P01':
      return `Tabla no existe — posible migración pendiente`;
    default:
      return err.message || `Error de base de datos (${pg.pgCode})`;
  }
}

/**
 * Logs the error with full structured context and responds with an
 * actionable payload. The response includes enough information for a
 * human to locate the error in the logs without leaking raw SQL or
 * stack traces.
 *
 *   serverError(res, 'POST /opportunities', err)
 *   serverError(res, 'PUT /contracts/:id', err, { contractId: '...' })
 */
function serverError(res, where, err, extra) {
  const errorId = generateErrorId();
  const timestamp = new Date().toISOString();
  const pg = extractPgDetail(err);

  // ── structured log (stdout → Docker → CloudWatch) ───────────────
  const logEntry = {
    level: 'error',
    errorId,
    where,
    timestamp,
    message: err?.message || String(err),
    ...(pg && { pg }),
    ...(extra && { context: extra }),
    ...(res.req?.user?.id && { userId: res.req.user.id }),
    ...(res.req?.requestId && { requestId: res.req.requestId }),
    stack: err?.stack || null,
  };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(logEntry));

  if (!res.headersSent) {
    const status = (pg?.pgCode === '23505') ? 409
      : (pg?.pgCode === '23503' || pg?.pgCode === '23502') ? 400
      : 500;

    res.status(status).json({
      error: humanSummary(err),
      errorId,
      where,
      timestamp,
      ...(extra && { context: extra }),
    });
  }
}

/**
 * Safe transaction ROLLBACK — logs if the rollback itself fails.
 */
async function safeRollback(conn, where) {
  try {
    await conn.query('ROLLBACK');
  } catch (rollbackErr) {
    const errorId = generateErrorId();
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: 'error',
      errorId,
      where: `${where || 'transaction'} ROLLBACK`,
      message: rollbackErr?.message || String(rollbackErr),
      stack: rollbackErr?.stack || null,
      timestamp: new Date().toISOString(),
    }));
  }
}

module.exports = { serverError, safeRollback, extractPgDetail, humanSummary, generateErrorId };
