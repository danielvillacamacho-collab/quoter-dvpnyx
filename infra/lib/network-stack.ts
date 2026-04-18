import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

/**
 * VPC with public + private-with-egress subnets across 2 AZs.
 *
 * Design choices (Well-Architected — Reliability + Security):
 *   - Aurora lives ONLY in private-isolated subnets, never reachable from the internet.
 *   - Lambda lives in private-with-egress subnets so it can reach Secrets Manager,
 *     CloudWatch, and (eventually) third-party APIs through a NAT Gateway.
 *   - VPC endpoints for Secrets Manager + CloudWatch save NAT costs and cut latency.
 *   - Security groups are defined here so other stacks can reference them.
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public',      subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private',     subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'db-isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // VPC endpoints (interface) to avoid routing every API call through NAT
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });
    this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });

    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      description: 'Aurora — only accepts traffic from Lambda SG',
      allowAllOutbound: false,
    });

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'Lambda egress; Aurora ingress targets this SG',
      allowAllOutbound: true,
    });

    this.dbSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Postgres access only from Lambda SG',
    );
  }
}
