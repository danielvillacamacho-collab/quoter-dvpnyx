import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export class SharedLayerStack extends Stack {
  public readonly layer: LayerVersion;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.layer = new LayerVersion(this, 'SharedLayer', {
      layerVersionName: 'quoter-shared',
      description: 'Shared utilities: db, auth, http, errors, events, fx',
      compatibleRuntimes: [Runtime.NODEJS_20_X],
      code: Code.fromAsset(path.join(__dirname, '../../packages/shared'), {
        bundling: {
          image: Runtime.NODEJS_20_X.bundlingImage,
          command: [
            'bash', '-c', [
              'cp -r /asset-input/* /asset-output/nodejs/',
              'cd /asset-output/nodejs',
              'npm install --omit=dev pg jsonwebtoken 2>/dev/null || true',
            ].join(' && '),
          ],
          outputType: undefined,
        },
      }),
    });
  }
}
