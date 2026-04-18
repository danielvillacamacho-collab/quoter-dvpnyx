import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

interface Props extends cdk.StackProps {
  domainName: string;
}

/**
 * Amplify Hosting app for the React SPA with auto-build from GitHub `main`.
 *
 * NOTE: the GitHub access token is expected in Secrets Manager as
 * `dvpnyx/github/amplify-token`. Create it out-of-band (one-time) — we don't
 * commit tokens to IaC.
 *
 * During the migration (Fase 1) we attach only a Route 53 *alias record with
 * zero weight* so no traffic is sent to Amplify until we flip the weights.
 */
export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: props.domainName.split('.').slice(-2).join('.'),  // doublevpartners.com
    });

    const cert = new acm.Certificate(this, 'Cert', {
      domainName: props.domainName,
      subjectAlternativeNames: [`www.${props.domainName}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const app = new amplify.CfnApp(this, 'QuoterSpa', {
      name: 'dvpnyx-quoter-spa',
      repository: 'https://github.com/danielvillacamacho-collab/quoter-dvpnyx',
      oauthToken: cdk.SecretValue.secretsManager('dvpnyx/github/amplify-token').unsafeUnwrap(),
      buildSpec: `
version: 1
applications:
  - appRoot: client
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci || npm install
        build:
          commands:
            - REACT_APP_API_URL=$REACT_APP_API_URL npm run build
      artifacts:
        baseDirectory: build
        files: ['**/*']
      cache:
        paths: ['node_modules/**/*']
`.trim(),
      environmentVariables: [
        { name: 'REACT_APP_API_URL', value: 'https://api.placeholder/api' },
      ],
    });

    const branch = new amplify.CfnBranch(this, 'MainBranch', {
      appId: app.attrAppId,
      branchName: 'main',
      enableAutoBuild: true,
      stage: 'PRODUCTION',
    });

    new amplify.CfnDomain(this, 'CustomDomain', {
      appId: app.attrAppId,
      domainName: props.domainName.split('.').slice(-2).join('.'),
      subDomainSettings: [
        { prefix: props.domainName.split('.').slice(0, -2).join('.'), branchName: branch.branchName },
      ],
    });

    new cdk.CfnOutput(this, 'AmplifyAppId', { value: app.attrAppId });
    new cdk.CfnOutput(this, 'AmplifyDefaultDomain', { value: app.attrDefaultDomain });
    new cdk.CfnOutput(this, 'CertArn', { value: cert.certificateArn });
  }
}
