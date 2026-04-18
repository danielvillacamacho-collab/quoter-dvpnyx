import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';

interface Props extends cdk.StackProps {
  vpc: ec2.IVpc;
  dbSecurityGroup: ec2.SecurityGroup;
}

/**
 * Aurora Serverless v2 (Postgres 16) cluster, Multi-AZ, encrypted with a
 * customer-managed KMS key. Credentials live in Secrets Manager with automatic
 * rotation every 90 days.
 *
 * Sizing: 0.5 ACU min → 4 ACU max. Scale up as usage grows.
 */
export class DataStack extends cdk.Stack {
  public readonly dbCluster: rds.DatabaseCluster;
  public readonly dbSecret: secrets.ISecret;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const cmk = new kms.Key(this, 'DbCmk', {
      alias: 'alias/dvpnyx/db',
      enableKeyRotation: true,
      description: 'CMK for Aurora + Secrets encryption',
    });

    const credentials = rds.Credentials.fromGeneratedSecret('dvpnyx_admin', {
      secretName: 'dvpnyx/db/credentials',
      encryptionKey: cmk,
    });

    this.dbCluster = new rds.DatabaseCluster(this, 'AuroraServerlessV2', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_2,
      }),
      credentials,
      defaultDatabaseName: 'dvpnyx_quoter',
      storageEncryptionKey: cmk,
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      writer: rds.ClusterInstance.serverlessV2('writer'),
      readers: [rds.ClusterInstance.serverlessV2('reader', { scaleWithWriter: true })],
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.dbSecurityGroup],
      backup: { retention: cdk.Duration.days(14), preferredWindow: '03:00-04:00' },
      cloudwatchLogsExports: ['postgresql'],
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.dbSecret = this.dbCluster.secret!;

    // Rotation every 90 days via AWS-managed single-user rotation Lambda
    this.dbSecret.addRotationSchedule('DbSecretRotation', {
      hostedRotation: secrets.HostedRotation.postgreSqlSingleUser({
        vpc: props.vpc,
        securityGroups: [props.dbSecurityGroup],
      }),
      automaticallyAfter: cdk.Duration.days(90),
    });

    new cdk.CfnOutput(this, 'DbEndpoint',  { value: this.dbCluster.clusterEndpoint.hostname });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn });
  }
}
