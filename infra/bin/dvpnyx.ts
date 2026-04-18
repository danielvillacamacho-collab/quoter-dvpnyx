#!/usr/bin/env node
/**
 * DVPNYX CDK entry point.
 *
 * Creates the 4 stacks in order:
 *   1. NetworkStack    — VPC, subnets, security groups, endpoints
 *   2. DataStack       — Aurora Serverless v2 (Postgres) + KMS + Secrets Manager
 *   3. ApiStack        — Lambda (Express adapter) + API Gateway + WAF
 *   4. FrontendStack   — Amplify Hosting + Route 53 alias + ACM
 *
 * Run per environment: `cdk deploy --all --context env=dev`.
 */
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();
const envKey = app.node.tryGetContext('env') ?? 'dev';
const envs = app.node.tryGetContext('dvpnyx:envs');
const cfg = envs[envKey];
if (!cfg) throw new Error(`Unknown env: ${envKey}. Set with --context env=dev|prod`);

const env: cdk.Environment = { account: cfg.account, region: cfg.region };
const tags = { Project: 'dvpnyx-quoter', Environment: envKey, Owner: 'platform' };
const prefix = `Dvpnyx-${envKey}`;

const network = new NetworkStack(app, `${prefix}-Network`, { env, tags });

const data = new DataStack(app, `${prefix}-Data`, {
  env, tags,
  vpc: network.vpc,
  dbSecurityGroup: network.dbSecurityGroup,
});

new ApiStack(app, `${prefix}-Api`, {
  env, tags,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbSecret: data.dbSecret,
  dbCluster: data.dbCluster,
  domainName: cfg.domainName,
});

new FrontendStack(app, `${prefix}-Frontend`, {
  env, tags,
  domainName: cfg.domainName,
});
