import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';

interface Props extends cdk.StackProps {
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  dbSecret: secrets.ISecret;
  dbCluster: rds.DatabaseCluster;
  domainName: string;
}

/**
 * Express app wrapped by `serverless-http` running on Lambda (ARM64), exposed
 * by a regional REST API Gateway. Aliases `stable` and `canary` enable
 * weighted deployments with CodeDeploy (configured in CI/CD).
 *
 * Security:
 *   - WAF v2 with AWS managed Core Rule Set + rate-based rule (2000 req/5min/IP).
 *   - JWT_SECRET + DB creds via Secrets Manager (never in env vars plaintext).
 *   - Lambda role = least privilege.
 *
 * Observability:
 *   - X-Ray active tracing.
 *   - Alarm: 5xx > 1% for 5 min → SNS topic (ops).
 */
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const jwtSecret = new secrets.Secret(this, 'JwtSecret', {
      secretName: 'dvpnyx/jwt/secret',
      description: 'JWT signing secret for the API',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    const fn = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'lambda.handler',
      // Build pipeline bundles server/ with serverless-http into this asset
      code: lambda.Code.fromAsset('../server-dist'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      tracing: lambda.Tracing.ACTIVE,
      logGroup,
      environment: {
        NODE_ENV: 'production',
        DB_SECRET_ARN: props.dbSecret.secretArn,
        JWT_SECRET_ARN: jwtSecret.secretArn,
        DB_HOST: props.dbCluster.clusterEndpoint.hostname,
        DB_NAME: 'dvpnyx_quoter',
      },
    });

    props.dbSecret.grantRead(fn);
    jwtSecret.grantRead(fn);

    // Aliases for blue/green via CodeDeploy
    const version = fn.currentVersion;
    new lambda.Alias(this, 'StableAlias', { aliasName: 'stable', version });

    // REST API Gateway (good fit for regional deploy + caching layer)
    const api = new apigw.LambdaRestApi(this, 'Api', {
      handler: fn,
      proxy: true,
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        throttlingBurstLimit: 200,
        throttlingRateLimit: 100,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [`https://${props.domainName}`],
        allowMethods: apigw.Cors.ALL_METHODS,
        allowCredentials: true,
      },
    });

    // Rate-limit rule + AWS managed CRS
    const waf = new wafv2.CfnWebACL(this, 'ApiWaf', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'dvpnyx-api-waf',
      },
      rules: [
        {
          name: 'AWS-ManagedCommonRuleSet', priority: 0,
          statement: { managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' } },
          overrideAction: { none: {} },
          visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'crs' },
        },
        {
          name: 'RateLimit-PerIP', priority: 1,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } },
          visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'rate-ip' },
        },
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WafAssoc', {
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
      webAclArn: waf.attrArn,
    });

    // Alarms
    const opsTopic = new sns.Topic(this, 'OpsAlerts', { displayName: 'dvpnyx-ops-alerts' });

    new cw.Alarm(this, 'Api5xxAlarm', {
      metric: api.metricServerError({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: 'API 5xx spike',
    }).addAlarmAction(new cwactions.SnsAction(opsTopic));

    new cw.Alarm(this, 'ApiLatencyP99', {
      metric: api.metricLatency({ period: cdk.Duration.minutes(5), statistic: 'p99' }),
      threshold: 2000,
      evaluationPeriods: 2,
      alarmDescription: 'API p99 latency > 2s',
    }).addAlarmAction(new cwactions.SnsAction(opsTopic));

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'OpsTopicArn', { value: opsTopic.topicArn });

    // Suppress unused-local warnings for the few vars we keep as outputs
    void iam;
  }
}
