import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

type SecretValue = Record<string, unknown>;

let loadPromise: Promise<void> | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function applyIfMissing(name: string, value: unknown): void {
  if (process.env[name] || value === undefined || value === null || value === '') return;
  process.env[name] = String(value);
}

function parseSecretPayload(secret: { SecretString?: string; SecretBinary?: Uint8Array }): SecretValue {
  const raw = secret.SecretString
    ?? (secret.SecretBinary ? Buffer.from(secret.SecretBinary).toString('utf8') : '');

  if (!raw) return {};

  try {
    return JSON.parse(raw) as SecretValue;
  } catch {
    return { secret: raw };
  }
}

async function readSecret(secretId: string): Promise<SecretValue> {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  return parseSecretPayload(response);
}

async function loadRuntimeConfig(): Promise<void> {
  const dbSecretArn = process.env.DB_SECRET_ARN;
  if (dbSecretArn && (!process.env.DB_USER || !process.env.DB_PASSWORD)) {
    const db = await readSecret(dbSecretArn);
    applyIfMissing('DB_USER', db.username ?? db.user);
    applyIfMissing('DB_PASSWORD', db.password);
    applyIfMissing('DB_HOST', db.host);
    applyIfMissing('DB_PORT', db.port);
    applyIfMissing('DB_NAME', db.dbname ?? db.database ?? db.name);
  }

  const jwtSecretArn = process.env.JWT_SECRET_ARN;
  if (jwtSecretArn && !process.env.JWT_SECRET) {
    const jwt = await readSecret(jwtSecretArn);
    applyIfMissing('JWT_SECRET', jwt.password ?? jwt.secret ?? jwt.jwt_secret ?? jwt.JWT_SECRET);
  }

  const googleOAuthSecretArn = process.env.GOOGLE_OAUTH_SECRET_ARN;
  if (googleOAuthSecretArn && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
    const google = await readSecret(googleOAuthSecretArn);
    applyIfMissing('GOOGLE_CLIENT_ID', google.client_id ?? google.GOOGLE_CLIENT_ID);
    applyIfMissing('GOOGLE_CLIENT_SECRET', google.client_secret ?? google.GOOGLE_CLIENT_SECRET);
  }

  required('DB_HOST');
  required('DB_NAME');
  required('DB_USER');
  required('DB_PASSWORD');
  required('JWT_SECRET');
}

export function ensureRuntimeConfig(): Promise<void> {
  if (!loadPromise) {
    loadPromise = loadRuntimeConfig().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

export function resetRuntimeConfigForTests(): void {
  loadPromise = null;
}
