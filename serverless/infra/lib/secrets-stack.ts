import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class SecretsStack extends Stack {
  public readonly jwtSecret: secretsmanager.ISecret;
  public readonly googleOAuthSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: 'quoter/jwt-secret',
      description: 'JWT signing secret for Quoter authentication',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    this.googleOAuthSecret = new secretsmanager.Secret(this, 'GoogleOAuthSecret', {
      secretName: 'quoter/google-oauth',
      description: 'Google OAuth client credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ client_id: 'REPLACE_ME' }),
        generateStringKey: 'client_secret',
      },
    });
  }
}
