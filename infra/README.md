# DVPNYX — Infraestructura AWS (CDK)

> **Estado: SCAFFOLDING. No despliega nada a producción todavía.**
>
> Esta rama (`architecture/aws-modernization`) contiene la propuesta de
> modernización descrita en [`docs/DVPNYX_Arquitectura_AWS_Modernizada.docx`](../docs/DVPNYX_Arquitectura_AWS_Modernizada.docx).
> Ningún workflow se dispara automáticamente hasta activar explícitamente
> los `on:` en `.github/workflows/*.yml` (hoy están bajo `on: workflow_dispatch`).

## Stack target

| Capa            | Servicio                         |
|-----------------|----------------------------------|
| Frontend SPA    | AWS Amplify Hosting + CloudFront |
| API             | Lambda + API Gateway REST        |
| Base de datos   | Aurora Serverless v2 PostgreSQL  |
| Red             | VPC privada + NAT / VPC endpoints |
| Secretos        | Secrets Manager + KMS CMK        |
| Observabilidad  | CloudWatch Logs/Metrics + X-Ray  |
| CDN / Seguridad | CloudFront + AWS WAF             |
| DNS             | Route 53                         |

## Estructura CDK

```
infra/
├── bin/
│   └── dvpnyx.ts              # Entry point (envs dev/prod)
├── lib/
│   ├── network-stack.ts       # VPC, subnets, SGs
│   ├── data-stack.ts          # Aurora Serverless v2, Secrets Manager
│   ├── api-stack.ts           # Lambda + API Gateway + WAF
│   └── frontend-stack.ts      # Amplify Hosting + Route 53 alias
├── scripts/
│   ├── migrate-db.sh          # pg_dump → S3 → Aurora pg_restore
│   └── rollback-api.sh        # aws lambda update-alias al previo
├── cdk.json
└── package.json
```

## Cómo activar (en su momento, no ahora)

```bash
cd infra
npm install
npm run build
npx cdk bootstrap aws://<ACCOUNT>/<REGION>
npx cdk deploy DvpnyxNetworkStack-dev
# ...fase por fase
```

## Rollback quick-reference

| Fase               | Rollback                                              | Tiempo |
|--------------------|-------------------------------------------------------|--------|
| 1 (Frontend)       | Route 53: weight Amplify → 0                          | < 2 min |
| 2 (Aurora)         | .env DB_HOST → localhost, restart container           | 3–5 min |
| 3 (Lambda)         | Amplify env REACT_APP_API_URL → endpoint EC2, redeploy | 5 min |
| 4 (Retire EC2)     | Restore AMI snapshot → EC2 nueva, DNS                 | 30–45 min |

Ver `docs/runbooks/` para playbooks completos.
