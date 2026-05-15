import { describe, it, expect } from 'vitest';
import { createRouter } from '../http/router';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { AuthUser } from '../types';

const user: AuthUser = { id: 'u1', email: 'a@b.com', name: 'Test', role: 'admin' };

function makeEvent(method: string, path: string, body?: string): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method } } as any,
    headers: {},
    queryStringParameters: {},
    pathParameters: {},
    body: body || null,
  } as any;
}

describe('createRouter', () => {
  it('matches exact path', async () => {
    const router = createRouter();
    router.get('/api/clients', async () => ({ statusCode: 200, headers: {}, body: '"ok"' }));
    const res = await router.resolve(makeEvent('GET', '/api/clients'), user);
    expect(res.statusCode).toBe(200);
  });

  it('extracts path parameters', async () => {
    const router = createRouter();
    let captured = '';
    router.get('/api/clients/:id', async (event) => {
      captured = event.pathParameters!.id!;
      return { statusCode: 200, headers: {}, body: '"ok"' };
    });
    await router.resolve(makeEvent('GET', '/api/clients/abc-123'), user);
    expect(captured).toBe('abc-123');
  });

  it('returns 404 for unmatched routes', async () => {
    const router = createRouter();
    const res = await router.resolve(makeEvent('GET', '/api/unknown'), user);
    expect(res.statusCode).toBe(404);
  });

  it('catches errors and returns structured response', async () => {
    const router = createRouter();
    router.get('/api/fail', async () => { throw new Error('boom'); });
    const res = await router.resolve(makeEvent('GET', '/api/fail'), user);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).errorId).toMatch(/^ERR-/);
  });
});
