#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { DatabaseStack } from '../lib/database-stack';
import { DnsStack } from '../lib/dns-stack';
import { SharedLayerStack } from '../lib/shared-layer-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

const ACCOUNT = '338287058401';
const REGION  = 'mx-central-1';
const DOMAIN  = 'forge.doublevpartners.com';

const env = { account: ACCOUNT, region: REGION };

// ── 1. Network ──────────────────────────────────────────────────
const network = new NetworkStack(app, 'QuoterNetwork', { env });

// ── 2. Secrets ──────────────────────────────────────────────────
const secrets = new SecretsStack(app, 'QuoterSecrets', { env });

// ── 3. Database ─────────────────────────────────────────────────
const database = new DatabaseStack(app, 'QuoterDatabase', {
  env,
  vpc: network.vpc,
});

// ── 4. DNS + Certificates ───────────────────────────────────────
const dns = new DnsStack(app, 'QuoterDns', {
  env,
  domainName: DOMAIN,
});

// ── 5. Shared Lambda Layer ──────────────────────────────────────
const layer = new SharedLayerStack(app, 'QuoterSharedLayer', { env });

// ── 6. API (15 Lambdas + API Gateway) ──────────────────────────
const api = new ApiStack(app, 'QuoterApi', {
  env,
  sharedLayer: layer.layer,
  vpc: network.vpc,
  lambdaSg: database.lambdaSg,
  rdsProxyEndpoint: database.proxy.endpoint,
  dbSecret: database.dbSecret,
  jwtSecret: secrets.jwtSecret,
  googleOAuthSecret: secrets.googleOAuthSecret,
  certificate: dns.apiCertificate,
  hostedZone: dns.hostedZone,
  domainName: `api.${DOMAIN}`,
  frontendDomain: DOMAIN,
});

// ── 7. Frontend (CloudFront + S3) ──────────────────────────────
const frontend = new FrontendStack(app, 'QuoterFrontend', {
  env,
  domainName: DOMAIN,
  hostedZone: dns.hostedZone,
  certificate: dns.cloudfrontCertificate,
  apiDomain: `api.${DOMAIN}`,
});

// ── Stack dependencies ─────────────────────────────────────────
database.addDependency(network);
api.addDependency(database);
api.addDependency(secrets);
api.addDependency(dns);
api.addDependency(layer);
frontend.addDependency(dns);

app.synth();
