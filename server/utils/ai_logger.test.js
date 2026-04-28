const { run, recordDecision } = require('./ai_logger');

function mkPool() {
  const queries = [];
  const responses = [];
  return {
    queries,
    queueResponse(rows) { responses.push({ rows }); },
    queueError(msg) { responses.push(new Error(msg)); },
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      const next = responses.shift();
      if (!next) return { rows: [{ id: 'auto-id' }] };
      if (next instanceof Error) throw next;
      return next;
    }),
  };
}

const baseArgs = (override = {}) => ({
  agent: { name: 'claude-sonnet-4.5', version: '20251015' },
  template: { name: 'candidate_ranking', version: 3 },
  userId: 'user-1',
  entity: { type: 'resource_request', id: 'rr-1' },
  input: { foo: 'bar' },
  ...override,
});

describe('ai_logger.run', () => {
  it('inserta una row con todos los campos cuando call() pasa', async () => {
    const pool = mkPool();
    pool.queueResponse([{ id: 'int-1' }]);
    const out = await run({
      pool,
      ...baseArgs(),
      call: async (input) => ({
        output: { ranked: [1, 2] },
        confidence: 0.85,
        costUsd: 0.0123,
        inputTokens: 1200,
        outputTokens: 250,
      }),
    });
    expect(out.output.ranked).toEqual([1, 2]);
    expect(out.__interactionId).toBe('int-1');
    expect(pool.queries).toHaveLength(1);
    const params = pool.queries[0].params;
    expect(params[0]).toBe('claude-sonnet-4.5');
    expect(params[2]).toBe('candidate_ranking');
    expect(params[3]).toBe(3);
    expect(params[4]).toBe('user-1');
    expect(params[5]).toBe('resource_request');
    expect(params[9]).toBe(0.85);
    expect(params[10]).toBeCloseTo(0.0123);
    expect(params[11]).toBe(1200);
    expect(params[12]).toBe(250);
    expect(params[13]).toBeGreaterThanOrEqual(0); // latency_ms
    expect(params[14]).toBeNull(); // error
  });

  it('si call() lanza, registra error y re-lanza', async () => {
    const pool = mkPool();
    pool.queueResponse([{ id: 'int-err' }]);
    await expect(run({
      pool,
      ...baseArgs(),
      call: async () => { throw new Error('rate limit'); },
    })).rejects.toThrow('rate limit');
    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0].params[14]).toBe('rate limit');
  });

  it('si la inserción a ai_interactions falla, NO rompe el flujo (sólo loguea)', async () => {
    const pool = mkPool();
    pool.queueError('connection lost');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await run({
      pool,
      ...baseArgs(),
      call: async () => ({ output: 'ok' }),
    });
    expect(out.output).toBe('ok');
    expect(out.__interactionId).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('valida argumentos requeridos', async () => {
    const pool = mkPool();
    await expect(run({ pool, agent: { name: 'x' } })).rejects.toThrow();
    await expect(run({ pool, agent: { name: 'x', version: '1' }, template: { name: 't' } })).rejects.toThrow();
    await expect(run({ pool, agent: { name: 'x', version: '1' }, template: { name: 't', version: 1 } })).rejects.toThrow('call');
  });

  it('omite confidence/cost si no son numbers finitos', async () => {
    const pool = mkPool();
    pool.queueResponse([{ id: 'x' }]);
    await run({
      pool,
      ...baseArgs(),
      call: async () => ({ output: 'ok', confidence: 'no-finite', costUsd: NaN }),
    });
    const params = pool.queries[0].params;
    expect(params[9]).toBeNull();  // confidence
    expect(params[10]).toBeNull(); // cost
  });
});

describe('recordDecision', () => {
  it('valida la decisión', async () => {
    const pool = mkPool();
    await expect(recordDecision(pool, 'id-1', 'foo')).rejects.toThrow('decision inválido');
  });
  it('actualiza la row y devuelve el resultado', async () => {
    const pool = mkPool();
    pool.queueResponse([{ id: 'i1', human_decision: 'accepted' }]);
    const out = await recordDecision(pool, 'i1', 'accepted', 'good suggestion');
    expect(out.human_decision).toBe('accepted');
    expect(pool.queries[0].params).toEqual(['i1', 'accepted', 'good suggestion']);
  });
  it('null si interactionId es falsy', async () => {
    const pool = mkPool();
    expect(await recordDecision(pool, null, 'accepted')).toBeNull();
    expect(pool.queries).toHaveLength(0);
  });
});
