/**
 * Controlled migration runner for AWS/RDS deployments.
 *
 * Required confirmation:
 *   TARGET_ENV=dev MIGRATION_CONFIRM=migrate-dev npx tsx scripts/run-db-migration.ts
 *
 * Configuration can come from plain env vars or from Secrets Manager:
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET
 *   DB_SECRET_ARN, JWT_SECRET_ARN
 */
import { config } from 'dotenv';
config({ path: '.env' });

import { ensureRuntimeConfig } from '../packages/shared/config/secrets';

const targetEnv = process.env.TARGET_ENV || process.env.NODE_ENV || 'dev';
const expectedConfirmation = `migrate-${targetEnv}`;

if (process.env.MIGRATION_CONFIRM !== expectedConfirmation) {
  console.error(`Refusing to run migration. Set MIGRATION_CONFIRM=${expectedConfirmation}`);
  process.exit(2);
}

async function run() {
  process.env.DB_SSL ??= 'true';

  await ensureRuntimeConfig();

  console.log('[migration] target:', {
    env: targetEnv,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || '5432',
    db: process.env.DB_NAME,
    user: process.env.DB_USER,
    ssl: process.env.DB_SSL,
  });

  // Import after ensureRuntimeConfig(), because migrate.js creates its Pool at module load.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { migrate } = require('../../server/database/migrate.js');
  await migrate();
}

run().catch((err) => {
  console.error('[migration] failed:', err);
  process.exit(1);
});
