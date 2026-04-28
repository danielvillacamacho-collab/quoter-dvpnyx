/**
 * Helpers de respuesta HTTP estándar — para mantener consistencia entre
 * rutas y evitar el patrón "catch silencioso" que ya nos ha mordido en prod.
 *
 * El patrón típico era:
 *
 *   try { ... }
 *   catch (err) { res.status(500).json({ error: 'Error interno' }); }
 *
 * Sin `console.error`, no hay forma de debuguear cuál endpoint o query
 * falló. `serverError(res, where, err)` siempre logea con contexto y
 * responde un payload uniforme.
 */

/**
 * Responde 500 y logea el error con contexto. Pasar `where` como un
 * identificador legible (ej. 'GET /contracts', 'POST /assignments/bulk')
 * para que en logs sea inmediatamente claro qué endpoint reventó.
 */
function serverError(res, where, err) {
  // eslint-disable-next-line no-console
  console.error(`${where} failed:`, err && err.stack ? err.stack : err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Error interno' });
  }
}

/**
 * Hace ROLLBACK de la transacción, logueando si la propia ROLLBACK
 * falla (situación rara — DB caída, conn perdida — pero antes la
 * silenciábamos con `.catch(() => {})` y eso enmascaraba problemas).
 *
 * Uso:
 *   try { await conn.query('BEGIN'); ... }
 *   catch (err) {
 *     await safeRollback(conn, 'POST /assignments');
 *     serverError(res, 'POST /assignments', err);
 *   }
 *   finally { conn.release(); }
 */
async function safeRollback(conn, where) {
  try {
    await conn.query('ROLLBACK');
  } catch (rollbackErr) {
    // eslint-disable-next-line no-console
    console.error(`${where || 'transaction'} ROLLBACK failed:`, rollbackErr && rollbackErr.stack ? rollbackErr.stack : rollbackErr);
  }
}

module.exports = { serverError, safeRollback };
