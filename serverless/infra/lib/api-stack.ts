import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  HttpApi,
  CorsHttpMethod,
  HttpMethod,
  DomainName,
} from 'aws-cdk-lib/aws-apigatewayv2';
import type { LayerVersion } from 'aws-cdk-lib/aws-lambda';
import type { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { ModuleLambda } from './constructs/module-lambda';
import * as path from 'path';

export interface ApiStackProps extends StackProps {
  sharedLayer: LayerVersion;
  vpc: IVpc;
  lambdaSg: ISecurityGroup;
  rdsProxyEndpoint: string;
  dbSecret: secretsmanager.ISecret;
  jwtSecret: secretsmanager.ISecret;
  googleOAuthSecret: secretsmanager.ISecret;
  certificate: acm.ICertificate;
  hostedZone: route53.IHostedZone;
  domainName: string;
  frontendDomain: string;
}

const pkg = (module: string) =>
  path.join(__dirname, `../../packages/${module}/handler.ts`);

export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ── Custom Domain ──────────────────────────────────────────────
    const apiDomain = new DomainName(this, 'ApiDomain', {
      domainName: props.domainName,
      certificate: props.certificate,
    });

    // ── HTTP API ───────────────────────────────────────────────────
    this.httpApi = new HttpApi(this, 'QuoterApi', {
      apiName: 'quoter-api',
      defaultDomainMapping: { domainName: apiDomain },
      corsPreflight: {
        allowOrigins: [
          `https://${props.frontendDomain}`,
        ],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: Duration.hours(1),
      },
    });

    // ── DNS Record for API ─────────────────────────────────────────
    new route53.ARecord(this, 'ApiAlias', {
      zone: props.hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayv2DomainProperties(
          apiDomain.regionalDomainName,
          apiDomain.regionalHostedZoneId,
        ),
      ),
    });

    // ── Shared Environment Variables ───────────────────────────────
    const env: Record<string, string> = {
      DB_HOST: props.rdsProxyEndpoint,
      DB_PORT: '5432',
      DB_NAME: 'quoter',
      DB_SSL: 'true',
      DB_SECRET_ARN: props.dbSecret.secretArn,
      JWT_SECRET_ARN: props.jwtSecret.secretArn,
      GOOGLE_OAUTH_SECRET_ARN: props.googleOAuthSecret.secretArn,
      NODE_ENV: 'production',
    };

    const common = {
      httpApi: this.httpApi,
      sharedLayer: props.sharedLayer,
      vpc: props.vpc,
      securityGroup: props.lambdaSg,
      environment: env,
    };

    const grantSecrets = (mod: ModuleLambda) => {
      props.dbSecret.grantRead(mod.fn);
      props.jwtSecret.grantRead(mod.fn);
    };

    // ── Module 1: Clients ──────────────────────────────────────────
    const clients = new ModuleLambda(this, 'Clients', {
      ...common, moduleName: 'clients', entry: pkg('clients'),
      routes: [
        { path: '/api/clients',                   methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/clients/{id}',              methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/clients/{id}/activate',     methods: [HttpMethod.POST] },
        { path: '/api/clients/{id}/deactivate',   methods: [HttpMethod.POST] },
      ],
    });
    grantSecrets(clients);

    // ── Module 2: CRM (Contacts + Activities) ──────────────────────
    const crm = new ModuleLambda(this, 'Crm', {
      ...common, moduleName: 'crm', entry: pkg('crm'),
      routes: [
        { path: '/api/contacts',                               methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/contacts/{id}',                          methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/contacts/by-client/{clientId}',          methods: [HttpMethod.GET] },
        { path: '/api/contacts/by-opportunity/{opportunityId}', methods: [HttpMethod.GET] },
        { path: '/api/contacts/opportunity-link',              methods: [HttpMethod.POST] },
        { path: '/api/contacts/opportunity-link/{id}',         methods: [HttpMethod.DELETE] },
        { path: '/api/activities',                              methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/activities/{id}',                         methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/activities/by-opportunity/{opportunityId}', methods: [HttpMethod.GET] },
        { path: '/api/activities/by-client/{clientId}',         methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(crm);

    // ── Module 3: Employees + Areas + Skills + Employee Costs ─────
    const employees = new ModuleLambda(this, 'Employees', {
      ...common, moduleName: 'employees', entry: pkg('employees'),
      routes: [
        { path: '/api/employees',                              methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/employees/lookup',                       methods: [HttpMethod.GET] },
        { path: '/api/employees/{id}',                         methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/employees/{id}/skills',                  methods: [HttpMethod.GET, HttpMethod.PUT] },
        { path: '/api/areas',                                  methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/areas/{id}',                             methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/skills',                                 methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/skills/{id}',                            methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        // Employee Costs (admin/superadmin only — salary PII)
        { path: '/api/employee-costs',                         methods: [HttpMethod.GET] },
        { path: '/api/employee-costs/bulk/commit',             methods: [HttpMethod.POST] },
        { path: '/api/employee-costs/copy-from-previous',      methods: [HttpMethod.POST] },
        { path: '/api/employee-costs/project-to-future',       methods: [HttpMethod.POST] },
        { path: '/api/employee-costs/lock/{period}',           methods: [HttpMethod.POST] },
        { path: '/api/employee-costs/unlock/{period}',         methods: [HttpMethod.POST] },
        { path: '/api/employee-costs/recalculate-usd/{period}', methods: [HttpMethod.POST] },
      ],
    });
    grantSecrets(employees);

    // ── Module 4: Opportunities ────────────────────────────────────
    const opportunities = new ModuleLambda(this, 'Opportunities', {
      ...common, moduleName: 'opportunities', entry: pkg('opportunities'),
      memorySize: 512,
      routes: [
        { path: '/api/opportunities',                        methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/opportunities/{id}',                   methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/opportunities/{id}/status',            methods: [HttpMethod.PUT] },
        { path: '/api/opportunities/{id}/check-margin',      methods: [HttpMethod.POST] },
        { path: '/api/opportunities/kanban',                 methods: [HttpMethod.GET] },
        { path: '/api/opportunities/check-alerts',           methods: [HttpMethod.POST] },
        { path: '/api/opportunities/lookup',                 methods: [HttpMethod.GET] },
        { path: '/api/opportunities/export.csv',             methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(opportunities);

    // ── Module 5: Quotations ───────────────────────────────────────
    const quotations = new ModuleLambda(this, 'Quotations', {
      ...common, moduleName: 'quotations', entry: pkg('quotations'),
      memorySize: 512,
      routes: [
        { path: '/api/quotations',           methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/quotations/{id}',      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/quotations/{id}/clone', methods: [HttpMethod.POST] },
        { path: '/api/quotations/{id}/export', methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(quotations);

    // ── Module 6: Contracts ────────────────────────────────────────
    const contracts = new ModuleLambda(this, 'Contracts', {
      ...common, moduleName: 'contracts', entry: pkg('contracts'),
      routes: [
        { path: '/api/contracts',                        methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/contracts/{id}',                   methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/contracts/{id}/kick-off',          methods: [HttpMethod.POST] },
        { path: '/api/contracts/{id}/status',            methods: [HttpMethod.PUT] },
        { path: '/api/contracts/from-quotation/{qid}',   methods: [HttpMethod.POST] },
        { path: '/api/contracts/export.csv',             methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(contracts);

    // ── Module 7: Resource Requests ────────────────────────────────
    const resourceRequests = new ModuleLambda(this, 'ResourceRequests', {
      ...common, moduleName: 'resource-requests', entry: pkg('resource-requests'),
      routes: [
        { path: '/api/resource-requests',                  methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/resource-requests/{id}',             methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/resource-requests/{id}/candidates',  methods: [HttpMethod.GET] },
        { path: '/api/resource-requests/{id}/cancel',      methods: [HttpMethod.POST] },
        // RM routes
        { path: '/api/rm/assignments',                     methods: [HttpMethod.GET] },
        { path: '/api/rm/assignments/bulk-assign',         methods: [HttpMethod.POST] },
        { path: '/api/rm/assignments/bulk-extend',         methods: [HttpMethod.POST] },
        { path: '/api/rm/assignments/bulk-end',            methods: [HttpMethod.POST] },
        { path: '/api/rm/assignments/{id}/lock',           methods: [HttpMethod.POST] },
        { path: '/api/rm/assignments/{id}/unlock',         methods: [HttpMethod.POST] },
        { path: '/api/rm/weekly-capacity',                 methods: [HttpMethod.GET] },
        { path: '/api/rm/actual-hours/export',             methods: [HttpMethod.GET] },
        { path: '/api/rm/dashboard',                       methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(resourceRequests);

    // ── Module 8: Assignments ──────────────────────────────────────
    const assignments = new ModuleLambda(this, 'Assignments', {
      ...common, moduleName: 'assignments', entry: pkg('assignments'),
      routes: [
        { path: '/api/assignments',                            methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/assignments/validate',                   methods: [HttpMethod.POST] },
        { path: '/api/assignments/export.csv',                 methods: [HttpMethod.GET] },
        { path: '/api/assignments/{id}',                       methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/assignments/{id}/rate-history',          methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/assignments/{id}/rate-history/{rateId}', methods: [HttpMethod.DELETE] },
      ],
    });
    grantSecrets(assignments);

    // ── Module 9: Capacity Planner ─────────────────────────────────
    const capacity = new ModuleLambda(this, 'Capacity', {
      ...common, moduleName: 'capacity', entry: pkg('capacity'),
      memorySize: 512,
      routes: [
        { path: '/api/capacity/planner', methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(capacity);

    // ── Module 10: Time Tracking ───────────────────────────────────
    const timeTracking = new ModuleLambda(this, 'TimeTracking', {
      ...common, moduleName: 'time-tracking', entry: pkg('time-tracking'),
      routes: [
        { path: '/api/time-entries',             methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/time-entries/{id}',        methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/time-entries/copy-week',   methods: [HttpMethod.POST] },
        { path: '/api/time-allocations',         methods: [HttpMethod.GET] },
        { path: '/api/time-allocations/bulk',    methods: [HttpMethod.PUT] },
      ],
    });
    grantSecrets(timeTracking);

    // ── Module 11: Revenue + Exchange Rates + Budgets ──────────────
    const revenue = new ModuleLambda(this, 'Revenue', {
      ...common, moduleName: 'revenue', entry: pkg('revenue'),
      routes: [
        { path: '/api/revenue',                            methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/revenue/plan/{contract_id}',         methods: [HttpMethod.GET, HttpMethod.PUT] },
        { path: '/api/revenue/capacity-projection',        methods: [HttpMethod.GET] },
        { path: '/api/revenue/{contract_id}/{yyyymm}',     methods: [HttpMethod.PUT] },
        { path: '/api/revenue/{contract_id}/{yyyymm}/close', methods: [HttpMethod.POST] },
        { path: '/api/admin/exchange-rates',               methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/admin/exchange-rates/{id}',          methods: [HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/admin/settings',                     methods: [HttpMethod.GET, HttpMethod.PUT] },
        { path: '/api/admin/settings/{key}',               methods: [HttpMethod.GET, HttpMethod.PUT] },
        { path: '/api/budgets',                            methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/budgets/{id}',                       methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/budgets/summary',                    methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(revenue);

    // ── Module 12: Project Health / EVM ────────────────────────────
    const projectHealth = new ModuleLambda(this, 'ProjectHealth', {
      ...common, moduleName: 'project-health', entry: pkg('project-health'),
      memorySize: 512,
      routes: [
        { path: '/api/projects/{contract_id}/baseline-preview',  methods: [HttpMethod.GET] },
        { path: '/api/projects/{contract_id}/wbs',               methods: [HttpMethod.GET] },
        { path: '/api/projects/{contract_id}/baseline',          methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/projects/{contract_id}/baseline/rebase',   methods: [HttpMethod.POST] },
        { path: '/api/projects/{contract_id}/status-reports',    methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/projects/{contract_id}/health',            methods: [HttpMethod.GET] },
        { path: '/api/projects/{contract_id}/cost-forecast',     methods: [HttpMethod.GET] },
        { path: '/api/projects/portfolio-health',                methods: [HttpMethod.GET] },
        { path: '/api/projects/{contract_id}/backfill-revenue',  methods: [HttpMethod.POST] },
        { path: '/api/projects/{contract_id}/backfill-bac-cost', methods: [HttpMethod.POST] },
        { path: '/api/projects/{contract_id}/closeout',          methods: [HttpMethod.POST] },
      ],
    });
    grantSecrets(projectHealth);

    // ── Module 13: Reports + Dashboard ─────────────────────────────
    const reports = new ModuleLambda(this, 'Reports', {
      ...common, moduleName: 'reports', entry: pkg('reports'),
      memorySize: 512,
      timeout: Duration.seconds(60),
      routes: [
        { path: '/api/reports/utilization',     methods: [HttpMethod.GET] },
        { path: '/api/reports/bench',           methods: [HttpMethod.GET] },
        { path: '/api/reports/pending-requests', methods: [HttpMethod.GET] },
        { path: '/api/reports/hiring-needs',    methods: [HttpMethod.GET] },
        { path: '/api/reports/coverage',        methods: [HttpMethod.GET] },
        { path: '/api/reports/time-compliance', methods: [HttpMethod.GET] },
        { path: '/api/reports/plan-vs-real',    methods: [HttpMethod.GET] },
        { path: '/api/reports/my-dashboard',    methods: [HttpMethod.GET] },
        { path: '/api/reports/v2/{type}',       methods: [HttpMethod.GET] },
        { path: '/api/dashboard/overview',      methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(reports);

    // ── Module 14: Platform ────────────────────────────────────────
    const platform = new ModuleLambda(this, 'Platform', {
      ...common, moduleName: 'platform', entry: pkg('platform'),
      routes: [
        // Auth — login & Google OAuth (no-auth routes, bypass JWT check)
        { path: '/api/auth/login',               methods: [HttpMethod.POST] },
        { path: '/api/auth/google',              methods: [HttpMethod.POST] },
        { path: '/api/auth/google-callback',     methods: [HttpMethod.POST] },
        { path: '/api/auth/me',                  methods: [HttpMethod.GET] },
        { path: '/api/auth/change-password',     methods: [HttpMethod.POST] },
        { path: '/api/auth/me/preferences',      methods: [HttpMethod.PUT] },
        // Users
        { path: '/api/users',                    methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/users/{id}',               methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/users/lookup',             methods: [HttpMethod.GET] },
        // Notifications
        { path: '/api/notifications',            methods: [HttpMethod.GET] },
        { path: '/api/notifications/unread-count', methods: [HttpMethod.GET] },
        { path: '/api/notifications/{id}/read',  methods: [HttpMethod.PUT] },
        { path: '/api/notifications/read-all',   methods: [HttpMethod.POST] },
        // Parameters
        { path: '/api/parameters',               methods: [HttpMethod.GET] },
        { path: '/api/parameters/{id}',          methods: [HttpMethod.PUT] },
        // Self-service profile (/api/me/*)
        { path: '/api/me/profile',               methods: [HttpMethod.GET, HttpMethod.PUT] },
        { path: '/api/me/assignments',           methods: [HttpMethod.GET] },
        { path: '/api/me/skills',                methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/me/skills/{skillId}',      methods: [HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/me/education',             methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/me/education/{id}',        methods: [HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/me/completeness',          methods: [HttpMethod.GET] },
        // Users — reset password
        { path: '/api/users/{id}/reset-password', methods: [HttpMethod.POST] },
        // Bulk import
        { path: '/api/bulk-import/entities',              methods: [HttpMethod.GET] },
        { path: '/api/bulk-import/templates/{entity}',    methods: [HttpMethod.GET] },
        { path: '/api/bulk-import/{entity}/preview',      methods: [HttpMethod.POST] },
        { path: '/api/bulk-import/{entity}/commit',       methods: [HttpMethod.POST] },
        // AI interactions
        { path: '/api/ai-interactions',                   methods: [HttpMethod.GET] },
        { path: '/api/ai-interactions/{id}',              methods: [HttpMethod.GET] },
        { path: '/api/ai-interactions/{id}/decision',     methods: [HttpMethod.POST] },
        // Search & health
        { path: '/api/search',                            methods: [HttpMethod.GET] },
        // Health (no-auth)
        { path: '/api/health',                            methods: [HttpMethod.GET] },
      ],
    });
    grantSecrets(platform);
    props.googleOAuthSecret.grantRead(platform.fn);

    // ── Module 15: Internal Ops ────────────────────────────────────
    const internalOps = new ModuleLambda(this, 'InternalOps', {
      ...common, moduleName: 'internal-ops', entry: pkg('internal-ops'),
      routes: [
        { path: '/api/internal-initiatives',                          methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/internal-initiatives/{id}',                     methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/novelties',                                     methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/novelties/_meta/types',                         methods: [HttpMethod.GET] },
        { path: '/api/novelties/{id}',                                methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE] },
        { path: '/api/novelties/{id}/cancel',                         methods: [HttpMethod.POST] },
        { path: '/api/novelties/calendar/{employee_id}',              methods: [HttpMethod.GET] },
        { path: '/api/idle-time',                                     methods: [HttpMethod.GET] },
        { path: '/api/idle-time/users/{employee_id}/periods/{yyyymm}', methods: [HttpMethod.GET] },
        { path: '/api/idle-time/recalculate',                         methods: [HttpMethod.POST] },
        { path: '/api/idle-time/initiative-cost-summary',             methods: [HttpMethod.GET] },
        { path: '/api/holidays',                                      methods: [HttpMethod.GET, HttpMethod.POST] },
        { path: '/api/holidays/{id}',                                 methods: [HttpMethod.PUT, HttpMethod.DELETE] },
      ],
    });
    grantSecrets(internalOps);

    // ── Outputs ────────────────────────────────────────────────────
    new CfnOutput(this, 'ApiUrl', { value: `https://${props.domainName}` });
    new CfnOutput(this, 'HttpApiId', { value: this.httpApi.httpApiId });
  }
}
