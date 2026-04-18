/**
 * Lambda entry point (Fase 3 only). Not used by the EC2 deploy.
 *
 * Wraps the existing Express app with serverless-http so the same code
 * runs under API Gateway. The first invocation pulls DB + JWT creds from
 * Secrets Manager and caches them for the life of the container.
 *
 * Expected env vars (set by CDK ApiStack):
 *   DB_SECRET_ARN, JWT_SECRET_ARN, DB_HOST, DB_NAME
 *
 * IMPORTANT: require this file as the Lambda handler ("lambda.handler").
 * The Express app itself (index.js) stays untouched so the EC2 path keeps
 * working during migration.
 */
const serverless = require('serverless-http');
const { SecretsManagerClient, GetSecretValueCommand } =
  require('@aws-sdk/client-secrets-manager');

let cachedHandler;

async function loadSecret(client, arn) {
  const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  return JSON.parse(SecretString);
}

async function bootstrap() {
  const client = new SecretsManagerClient({});
  const [db, jwt] = await Promise.all([
    loadSecret(client, process.env.DB_SECRET_ARN),
    loadSecret(client, process.env.JWT_SECRET_ARN).catch(() => ({ password: process.env.JWT_SECRET })),
  ]);

  process.env.DB_HOST     = process.env.DB_HOST || db.host;
  process.env.DB_PORT     = String(db.port || 5432);
  process.env.DB_USER     = db.username;
  process.env.DB_PASSWORD = db.password;
  process.env.DB_NAME     = process.env.DB_NAME || db.dbname || 'dvpnyx_quoter';
  process.env.DB_SSL      = 'true';
  process.env.JWT_SECRET  = jwt.password || jwt.secret || process.env.JWT_SECRET;

  // Require AFTER env is populated — index.js reads process.env at module init
  const app = require('./index');
  cachedHandler = serverless(app, { binary: ['image/*', 'application/pdf'] });
}

exports.handler = async (event, context) => {
  if (!cachedHandler) await bootstrap();
  return cachedHandler(event, context);
};
