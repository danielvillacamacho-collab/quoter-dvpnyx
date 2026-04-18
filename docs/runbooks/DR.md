# Runbook: Disaster Recovery

## RTO / RPO objetivos

| Escenario                            | RTO    | RPO     |
|--------------------------------------|--------|---------|
| Falla de una AZ                      | < 1 min | 0       |
| Falla de la región primaria          | < 4 h   | < 15 min|
| Corrupción lógica (humano borra data)| < 30 min| < 5 min |

## Aurora — Point-in-Time Recovery (hasta 35 días atrás)

```bash
aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier <cluster> \
  --db-cluster-identifier <cluster>-restore \
  --restore-to-time 2026-04-18T10:30:00Z \
  --region us-east-1
```

Después: crear una instance Writer en el cluster restored, actualizar el
Secret `dvpnyx/db/credentials` con el nuevo endpoint, y forzar redeploy de
la Lambda para que lea el nuevo endpoint.

## AWS Backup — backup diario cross-region

AWS Backup (configurado en Fase 5) snapshotea Aurora todas las noches al
vault `dvpnyx-primary`. Copy job automático a `us-west-2` → `dvpnyx-dr`.

Restauración en región secundaria:
```bash
aws backup start-restore-job \
  --recovery-point-arn <arn> \
  --iam-role-arn <aws-backup-role> \
  --metadata file://restore-metadata.json \
  --region us-west-2
```

## Game day (trimestral)

1. Forzar failover manual: `aws rds failover-db-cluster --db-cluster-identifier <c>`.
2. Medir RTO real (debe ser < 60s).
3. Probar restauración PITR a un cluster nuevo en dev.
4. Documentar hallazgos en `docs/postmortems/gameday-<fecha>.md`.
