import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime, LayerVersion, Tracing } from 'aws-cdk-lib/aws-lambda';
import type { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { HttpMethod, HttpRoute, HttpRouteKey } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';

export interface RouteDefinition {
  path: string;
  methods: HttpMethod[];
}

export interface ModuleLambdaProps {
  moduleName: string;
  entry: string;
  routes: RouteDefinition[];
  httpApi: HttpApi;
  sharedLayer: LayerVersion;
  vpc: IVpc;
  securityGroup: ISecurityGroup;
  environment: Record<string, string>;
  memorySize?: number;
  timeout?: Duration;
  reservedConcurrency?: number;
}

export class ModuleLambda extends Construct {
  public readonly fn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ModuleLambdaProps) {
    super(scope, id);

    this.fn = new NodejsFunction(this, `fn-${props.moduleName}`, {
      entry: props.entry,
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout ?? Duration.seconds(29),
      tracing: Tracing.ACTIVE,
      layers: [props.sharedLayer],
      vpc: props.vpc,
      securityGroups: [props.securityGroup],
      reservedConcurrentExecutions: props.reservedConcurrency,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        MODULE_NAME: props.moduleName,
        ...props.environment,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['/opt/nodejs/*'],
        target: 'node20',
      },
    });

    const integration = new HttpLambdaIntegration(
      `${props.moduleName}-int`,
      this.fn,
    );

    for (const route of props.routes) {
      for (const method of route.methods) {
        const safePath = route.path.replace(/[{}:]/g, '').replace(/\//g, '-');
        new HttpRoute(this, `${props.moduleName}-${method}-${safePath}`, {
          httpApi: props.httpApi,
          routeKey: HttpRouteKey.with(route.path, method),
          integration,
        });
      }
    }
  }
}
