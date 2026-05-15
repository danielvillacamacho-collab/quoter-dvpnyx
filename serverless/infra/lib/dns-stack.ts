import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface DnsStackProps extends StackProps {
  domainName: string;
}

export class DnsStack extends Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly apiCertificate: acm.ICertificate;
  public readonly cloudfrontCertificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    // ── Hosted Zone ─────────────────────────────────────────────────
    this.hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
      zoneName: props.domainName,
    });

    // ── ACM Certificate (regional — for API Gateway) ────────────────
    this.apiCertificate = new acm.Certificate(this, 'ApiCert', {
      domainName: `api.${props.domainName}`,
      subjectAlternativeNames: [`*.${props.domainName}`],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // ── ACM Certificate (us-east-1 — required for CloudFront) ──────
    // CloudFront REQUIRES certificates in us-east-1 regardless of
    // where the stack deploys. We use DnsValidatedCertificate which
    // creates a cross-region certificate.
    this.cloudfrontCertificate = new acm.DnsValidatedCertificate(this, 'CfCert', {
      domainName: props.domainName,
      subjectAlternativeNames: [`*.${props.domainName}`],
      hostedZone: this.hostedZone,
      region: 'us-east-1',
    });
  }
}
