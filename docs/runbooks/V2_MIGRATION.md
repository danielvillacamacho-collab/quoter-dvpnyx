# Runbook: Migración V1 → V2 en producción

> El DDL (tablas nuevas, ALTERS, seeds de catálogos) corre **automáticamente**
> en el próximo deploy vía `server/database/migrate.js`. No requiere acción.
>
> El **data migration** (crear squad default, clientes/oportunidades legacy,
> migrar allocation a tabla, etc.) es **manual y se corre UNA sola vez**
> cuando el equipo de infra lo decida.

## Precondiciones

1. Deploy reciente (commit con el nuevo `migrate.js` mergeado a `main`).
2. Pipeline verde en GitHub Actions.
3. **Backup fresco** de la BD de producción (<24h).
4. Ventana de mantenimiento anunciada (~15 min).

## Backup antes de migrar

```bash
ssh ec2-user@quoter.doublevpartners.com
cd ~/dvpnyx-quoter
TS=$(date +%Y%m%d_%H%M%S)
docker compose exec -T db pg_dump -U dvpnyx dvpnyx_quoter | gzip > ~/backup_pre_v2_$TS.sql.gz
ls -lh ~/backup_pre_v2_$TS.sql.gz
```

Copiar fuera del host si es posible (`aws s3 cp` a un bucket propio).

## Ejecutar el data migration

El DDL ya debió correr en el último deploy. Verificar:

```bash
docker compose exec db psql -U dvpnyx dvpnyx_quoter -c "\dt" | grep -E "clients|opportunities|employees|events"
```

Deberían listarse esas tablas. Si no, correr primero:

```bash
docker compose run --rm server sh -c "cd server && node database/migrate.js"
```

Ahora el data migration (idempotente — se puede re-correr sin daño):

```bash
docker compose run --rm server sh -c "cd server && node database/migrate_v2_data.js"
```

Output esperado (ejemplo):
```
V2 data migration completed:
{
  "defaultSquadId": "…uuid…",
  "usersGivenSquad": 8,
  "preventaRolesMigrated": 5,
  "legacyClientsCreated": 12,
  "legacyOpportunitiesCreated": 27,
  "allocationsMigrated": 84,
  "auditLogEventsCopied": 412
}
```

## Validar

```bash
docker compose run --rm server sh -c "cd server && node database/validate_v2_migration.js"
```

Todos los checks deben salir ✅. Si alguno sale ❌, detener la migración y
restaurar (ver rollback).

## Rollback

Si algo sale mal y detectamos en < 30 min:

```bash
# Restaurar la BD desde el backup
docker compose stop server
gunzip -c ~/backup_pre_v2_<TS>.sql.gz | \
  docker compose exec -T db psql -U dvpnyx dvpnyx_quoter

# Revertir git a commit previo si el código nuevo rompe algo
cd ~/dvpnyx-quoter
git reset --hard <sha_previo>
docker compose up -d --build server
```

Detección tardía (>1h con escrituras nuevas): contactar Daniel para decidir
si se acepta el data loss o si se intenta un merge selectivo.

## Post-migración — trabajo manual opcional

Ver spec `docs/specs/v2/08_migration_plan.md` § "Post-migración":

1. Re-clasificar clientes "Legacy — …" a clientes reales.
2. Consolidar oportunidades legacy duplicadas.
3. Importar empleados vía `/api/employees/bulk-import` (CSV).
4. Crear squads específicos (LATAM Nearshore, Enterprise USA) y mover usuarios.
5. Ajustar función por usuario en `/admin/users`.

Todo esto puede hacerse por UI en horario normal, sin downtime.
