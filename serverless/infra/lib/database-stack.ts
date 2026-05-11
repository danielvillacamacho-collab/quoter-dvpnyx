import { Stack, StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';

export interface DatabaseStackProps extends StackProps {
  vpc: ec2.IVpc;
}

export class DatabaseStack extends Stack {
  public readonly instance: rds.DatabaseInstance;
  public readonly proxy: rds.DatabaseProxy;
  public readonly lambdaSg: ec2.SecurityGroup;
  public readonly dbSecret: rds.DatabaseSecret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // ── Security Groups ─────────────────────────────────────────────
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: props.vpc,
      securityGroupName: 'quoter-rds-sg',
      description: 'Quoter RDS PostgreSQL',
    });

    const proxySg = new ec2.SecurityGroup(this, 'ProxySg', {
      vpc: props.vpc,
      securityGroupName: 'quoter-rds-proxy-sg',
      description: 'Quoter RDS Proxy',
    });

    this.lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: props.vpc,
      securityGroupName: 'quoter-lambda-sg',
      description: 'Quoter Lambda functions',
    });

    // Lambda → RDS Proxy → RDS
    proxySg.addIngressRule(this.lambdaSg, ec2.Port.tcp(5432), 'Lambda → RDS Proxy');
    dbSg.addIngressRule(proxySg, ec2.Port.tcp(5432), 'RDS Proxy → RDS');

    // ── RDS Credentials (auto-generated, stored in Secrets Manager) ─
    this.dbSecret = new rds.DatabaseSecret(this, 'DbCredentials', {
      secretName: 'quoter/db-credentials',
      username: 'quoter_admin',
    });

    // ── RDS PostgreSQL 16 ───────────────────────────────────────────
    this.instance = new rds.DatabaseInstance(this, 'QuoterDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      databaseName: 'quoter',
      multiAz: false,
      allocatedStorage: 50,
      maxAllocatedStorage: 200,
      storageEncrypted: true,
      backupRetention: Duration.days(7),
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:30-sun:05:30',
      removalPolicy: RemovalPolicy.SNAPSHOT,
      deletionProtection: true,
      publiclyAccessible: false,
      enablePerformanceInsights: true,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
      parameterGroup: new rds.ParameterGroup(this, 'PgParams', {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_4 }),
        parameters: {
          'shared_preload_libraries': 'pg_stat_statements',
          'log_min_duration_statement': '1000',
          'max_connections': '200',
        },
      }),
    });

    // ── RDS Proxy ───────────────────────────────────────────────────
    this.proxy = this.instance.addProxy('QuoterProxy', {
      dbProxyName: 'quoter-rds-proxy',
      secrets: [this.dbSecret],
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [proxySg],
      requireTLS: true,
      maxConnectionsPercent: 90,
      maxIdleConnectionsPercent: 10,
      idleClientTimeout: Duration.minutes(15),
      borrowTimeout: Duration.seconds(30),
    });
  }
}
