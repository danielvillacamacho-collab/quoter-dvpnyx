/**
 * Local Lambda invoker — simulates API Gateway events against real handlers.
 *
 * Usage:
 *   npx tsx scripts/invoke-local.ts clients GET /api/clients
 *   npx tsx scripts/invoke-local.ts clients GET /api/clients/uuid-here
 *   npx tsx scripts/invoke-local.ts clients POST /api/clients '{"name":"Acme"}'
 *   npx tsx scripts/invoke-local.ts crm GET /api/contacts
 *
 * Requires .env with DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET.
 * Generates a valid JWT for testing (admin role).
 */
import { config } from 'dotenv';
config({ path: '.env' });

import jwt from 'jsonwebtoken';

const [, , moduleName, method, path, bodyJson] = process.argv;

if (!moduleName || !method || !path) {
  console.error('Usage: npx tsx scripts/invoke-local.ts <module> <METHOD> <path> [body-json]');
  console.error('Example: npx tsx scripts/invoke-local.ts clients GET /api/clients');
  process.exit(1);
}

const token = jwt.sign(
  { id: 'local-test-user', email: 'admin@dvpnyx.com', name: 'Local Admin', role: 'admin' },
  process.env.JWT_SECRET || 'dev-secret',
  { expiresIn: '1h' },
);

const event = {
  rawPath: path,
  requestContext: {
    http: { method: method.toUpperCase(), path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' },
    requestId: 'local-' + Date.now(),
    time: new Date().toISOString(),
  },
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  queryStringParameters: Object.fromEntries(new URL(`http://localhost${path}`).searchParams),
  pathParameters: {},
  body: bodyJson || null,
  isBase64Encoded: false,
};

async function run() {
  const mod = await import(`../packages/${moduleName}/handler`);
  const start = Date.now();
  const result = await mod.handler(event);
  const elapsed = Date.now() - start;

  console.log(`\n─── ${method.toUpperCase()} ${path} → ${result.statusCode} (${elapsed}ms) ───\n`);

  try {
    const parsed = JSON.parse(result.body);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(result.body);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('Invocation failed:', err);
  process.exit(1);
});
