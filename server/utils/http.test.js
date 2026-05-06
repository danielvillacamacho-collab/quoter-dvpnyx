const { serverError, safeRollback, extractPgDetail, humanSummary, generateErrorId } = require('./http');

function mkRes(opts = {}) {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    req: { requestId: 'abc123', user: opts.user || null },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function parseLog() {
  return JSON.parse(console.error.mock.calls[0][0]);
}

describe('generateErrorId', () => {
  it('returns ERR- prefix with 8 hex chars', () => {
    const id = generateErrorId();
    expect(id).toMatch(/^ERR-[0-9A-F]{8}$/);
  });
});

describe('extractPgDetail', () => {
  it('returns null for non-PG errors', () => {
    expect(extractPgDetail(new Error('boom'))).toBeNull();
    expect(extractPgDetail(null)).toBeNull();
  });

  it('extracts code, constraint, column, table', () => {
    const err = { code: '23505', constraint: 'uq_email', column: 'email', table: 'users', detail: 'Key (email)=(x) already exists.' };
    const detail = extractPgDetail(err);
    expect(detail.pgCode).toBe('23505');
    expect(detail.pgLabel).toBe('unique_violation');
    expect(detail.constraint).toBe('uq_email');
    expect(detail.column).toBe('email');
    expect(detail.table).toBe('users');
    expect(detail.pgDetail).toBe('Key (email)=(x) already exists.');
  });
});

describe('humanSummary', () => {
  it('returns message for non-PG errors', () => {
    expect(humanSummary(new Error('boom'))).toBe('boom');
  });

  it('returns friendly text for unique_violation', () => {
    expect(humanSummary({ code: '23505', constraint: 'uq_email' })).toMatch(/Registro duplicado.*uq_email/);
  });

  it('returns friendly text for not_null_violation', () => {
    expect(humanSummary({ code: '23502', column: 'name' })).toMatch(/Campo obligatorio.*name/);
  });
});

describe('serverError', () => {
  let originalConsole;
  beforeEach(() => {
    originalConsole = console.error;
    console.error = jest.fn();
  });
  afterEach(() => { console.error = originalConsole; });

  it('logs structured JSON and responds with errorId + where', () => {
    const res = mkRes();
    const err = new Error('boom');
    serverError(res, 'GET /foo', err);
    expect(res.statusCode).toBe(500);
    expect(res.body.errorId).toMatch(/^ERR-/);
    expect(res.body.where).toBe('GET /foo');
    expect(res.body.error).toBe('boom');
    expect(res.body.timestamp).toBeDefined();
    expect(console.error).toHaveBeenCalledTimes(1);
    const log = parseLog();
    expect(log.level).toBe('error');
    expect(log.where).toBe('GET /foo');
    expect(log.message).toBe('boom');
    expect(log.requestId).toBe('abc123');
  });

  it('returns 409 for unique_violation', () => {
    const res = mkRes();
    const err = { code: '23505', constraint: 'uq_email', message: 'duplicate key', detail: 'Key (email)=(x@y.com) already exists.' };
    serverError(res, 'POST /users', err);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Registro duplicado/);
    const log = parseLog();
    expect(log.pg.pgCode).toBe('23505');
    expect(log.pg.pgLabel).toBe('unique_violation');
  });

  it('returns 400 for foreign_key_violation', () => {
    const res = mkRes();
    const err = { code: '23503', constraint: 'fk_client', message: 'fk violation' };
    serverError(res, 'POST /opportunities', err);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Referencia inválida/);
  });

  it('includes extra context when provided', () => {
    const res = mkRes();
    serverError(res, 'PUT /contracts/:id', new Error('fail'), { contractId: '42' });
    expect(res.body.context).toEqual({ contractId: '42' });
    const log = parseLog();
    expect(log.context).toEqual({ contractId: '42' });
  });

  it('includes userId when req.user is present', () => {
    const res = mkRes({ user: { id: 7 } });
    serverError(res, 'GET /foo', new Error('boom'));
    const log = parseLog();
    expect(log.userId).toBe(7);
  });

  it('no escribe respuesta si headers ya fueron enviados (no doble-send)', () => {
    const res = mkRes();
    res.headersSent = true;
    serverError(res, 'GET /foo', new Error('boom'));
    expect(res.statusCode).toBeNull();
    expect(res.body).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('tolera errores sin stack (string error)', () => {
    const res = mkRes();
    serverError(res, 'POST /bar', 'string error');
    expect(res.statusCode).toBe(500);
    expect(console.error).toHaveBeenCalled();
    const log = parseLog();
    expect(log.message).toBe('string error');
    expect(log.stack).toBeNull();
  });
});

describe('safeRollback', () => {
  let originalConsole;
  beforeEach(() => {
    originalConsole = console.error;
    console.error = jest.fn();
  });
  afterEach(() => { console.error = originalConsole; });

  it('llama conn.query("ROLLBACK") y no lanza si todo va bien', async () => {
    const conn = { query: jest.fn(async () => ({ rows: [] })) };
    await expect(safeRollback(conn, 'foo')).resolves.toBeUndefined();
    expect(conn.query).toHaveBeenCalledWith('ROLLBACK');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logea structured JSON si ROLLBACK lanza pero NO re-lanza', async () => {
    const conn = { query: jest.fn(async () => { throw new Error('conn perdida'); }) };
    await expect(safeRollback(conn, 'POST /assignments')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
    const log = parseLog();
    expect(log.level).toBe('error');
    expect(log.where).toBe('POST /assignments ROLLBACK');
    expect(log.message).toBe('conn perdida');
    expect(log.errorId).toMatch(/^ERR-/);
  });
});
