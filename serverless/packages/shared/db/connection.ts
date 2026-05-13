import { Pool } from 'pg';
import { ensureRuntimeConfig } from '../config/secrets';

let pool: Pool | null = null;

async function getRealPool(): Promise<Pool> {
  await ensureRuntimeConfig();

  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 1,
      idleTimeoutMillis: 120_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      console.error('[db] Pool error:', err.message);
      pool = null;
    });
  }
  return pool;
}

export function getPool(): Pool {
  return {
    query: async (...args: Parameters<Pool['query']>) => {
      const realPool = await getRealPool();
      return realPool.query(...args);
    },
    connect: async (...args: Parameters<Pool['connect']>) => {
      const realPool = await getRealPool();
      return realPool.connect(...args);
    },
    end: async (...args: Parameters<Pool['end']>) => {
      const realPool = await getRealPool();
      return realPool.end(...args);
    },
    on: (...args: Parameters<Pool['on']>) => {
      if (pool) pool.on(...args);
      return pool as Pool;
    },
  } as unknown as Pool;
}

export function resetPool(): void {
  if (pool) {
    pool.end().catch(() => {});
    pool = null;
  }
}
