const { emitEvent, buildUpdatePayload } = require('./events');

describe('emitEvent', () => {
  const fakeClient = () => {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ id: 'evt-1', created_at: new Date().toISOString() }] };
      }),
    };
  };

  it('inserts into events with all required fields', async () => {
    const client = fakeClient();
    const result = await emitEvent(client, {
      event_type: 'quotation.created',
      entity_type: 'quotation',
      entity_id: 'q-1',
      actor_user_id: 'u-1',
      payload: { foo: 'bar' },
      ip_address: '1.2.3.4',
      user_agent: 'jest',
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO events/);
    expect(params[0]).toBe('quotation.created');
    expect(params[1]).toBe('quotation');
    expect(params[2]).toBe('q-1');
    expect(params[3]).toBe('u-1');
    expect(params[4]).toBe(JSON.stringify({ foo: 'bar' }));
    expect(params[5]).toBe('1.2.3.4');
    expect(params[6]).toBe('jest');
    expect(result.id).toBe('evt-1');
  });

  it('auto-pulls ip and user-agent from req when provided', async () => {
    const client = fakeClient();
    const req = { ip: '10.0.0.1', get: (h) => (h === 'user-agent' ? 'req-ua' : undefined) };
    await emitEvent(client, {
      event_type: 'x', entity_type: 'y', entity_id: 'z', req,
    });
    const params = client.query.mock.calls[0][1];
    expect(params[5]).toBe('10.0.0.1');
    expect(params[6]).toBe('req-ua');
  });

  it('returns null and does NOT throw when DB insert fails', async () => {
    const client = { query: jest.fn(async () => { throw new Error('boom'); }) };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await emitEvent(client, {
      event_type: 'x', entity_type: 'y', entity_id: 'z',
    });
    expect(out).toBeNull();
    spy.mockRestore();
  });

  it('warns and returns null when required fields are missing', async () => {
    const client = fakeClient();
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await emitEvent(client, { entity_type: 'x', entity_id: 'y' })).toBeNull();
    expect(await emitEvent(client, { event_type: 'a', entity_id: 'y' })).toBeNull();
    expect(await emitEvent(client, { event_type: 'a', entity_type: 'x' })).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('defaults payload to empty object', async () => {
    const client = fakeClient();
    await emitEvent(client, { event_type: 'x', entity_type: 'y', entity_id: 'z' });
    const params = client.query.mock.calls[0][1];
    expect(params[4]).toBe(JSON.stringify({}));
  });
});

describe('buildUpdatePayload', () => {
  it('returns only fields that changed', () => {
    const before = { name: 'Alice', status: 'open', count: 1 };
    const after  = { name: 'Alice', status: 'won',  count: 1 };
    const p = buildUpdatePayload(before, after, ['name', 'status', 'count']);
    expect(p.changed_fields).toEqual(['status']);
    expect(p.before).toEqual({ status: 'open' });
    expect(p.after).toEqual({ status: 'won' });
  });

  it('handles nullish before/after safely', () => {
    const p = buildUpdatePayload(null, { status: 'open' }, ['status']);
    expect(p.changed_fields).toEqual(['status']);
    expect(p.before.status).toBeNull();
    expect(p.after.status).toBe('open');
  });

  it('returns empty changed_fields when nothing changed', () => {
    const same = { a: 1, b: 2 };
    const p = buildUpdatePayload(same, same, ['a', 'b']);
    expect(p.changed_fields).toEqual([]);
  });
});
