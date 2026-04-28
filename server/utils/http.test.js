const { serverError, safeRollback } = require('./http');

function mkRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('serverError', () => {
  let originalConsole;
  beforeEach(() => {
    originalConsole = console.error;
    console.error = jest.fn();
  });
  afterEach(() => { console.error = originalConsole; });

  it('logs con contexto y responde 500 + payload uniforme', () => {
    const res = mkRes();
    const err = new Error('boom');
    serverError(res, 'GET /foo', err);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Error interno' });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toMatch(/GET \/foo failed:/);
  });

  it('no escribe respuesta si headers ya fueron enviados (no doble-send)', () => {
    const res = mkRes();
    res.headersSent = true;
    serverError(res, 'GET /foo', new Error('boom'));
    expect(res.statusCode).toBeNull();
    expect(res.body).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('tolera errores sin stack', () => {
    const res = mkRes();
    serverError(res, 'POST /bar', 'string error');
    expect(res.statusCode).toBe(500);
    expect(console.error).toHaveBeenCalled();
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

  it('logea el fallo si ROLLBACK lanza pero NO re-lanza', async () => {
    const conn = { query: jest.fn(async () => { throw new Error('conn perdida'); }) };
    await expect(safeRollback(conn, 'POST /assignments')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toMatch(/POST \/assignments ROLLBACK failed/);
  });
});
