# Runbook: Rollback por fase

> Antes de ejecutar cualquier rollback, abrir un incidente en Slack `#incidents`
> con `!inc start <título>` y postear en el hilo lo que se va a hacer.

## Fase 1 — Rollback de Frontend (Amplify → EC2)
**Cuándo:** errores de carga SPA, regresiones CSS/JS tras redeploy Amplify.
**Tiempo estimado:** < 2 min.

1. Abrir Route 53 → Hosted Zone `doublevpartners.com`.
2. Editar el registro A de `quoter.doublevpartners.com`.
3. Cambiar weight: Amplify=0, EC2=100.
4. Esperar propagación (TTL=60s).
5. Validar con `curl -I https://quoter.doublevpartners.com` (header `server:` debe decir `Traefik`).

## Fase 2 — Rollback de Base de Datos (Aurora → Postgres local)
**Cuándo:** la aplicación devuelve 500 o inconsistencias tras el cut-over a Aurora.
**Tiempo estimado:** 3–5 min si se detecta en < 30 min. Peor si se detecta tarde.

1. SSH al EC2.
2. Editar `~/dvpnyx-quoter/.env`: `DB_HOST=db` (vuelve al contenedor local).
3. `docker compose up -d server` (reinicia sólo el servicio app; DB local sigue intacta).
4. Validar `curl https://quoter.doublevpartners.com/api/health`.
5. Si hubo escrituras en Aurora durante la ventana: ver [DR](./DR.md) — pg_dump Aurora + pg_restore Postgres local.

## Fase 3 — Rollback de API (Lambda → Express en EC2)
**Cuándo:** Lambda con 5xx sostenidos o latencia p99 > 2s; alarma CloudWatch disparada.
**Tiempo estimado:** 5 min.

Opción A (automático por CodeDeploy): ya está configurado. Si se dispara auto-rollback, sólo confirmar:
```bash
aws lambda get-alias --function-name DvpnyxApiFunction --name stable
```
La versión debe ser la anterior a la liberada.

Opción B (manual):
1. Ejecutar `infra/scripts/rollback-api.sh DvpnyxApiFunction stable us-east-1`.
2. Para regresar a EC2 por completo: Amplify Console → env vars → `REACT_APP_API_URL` → endpoint EC2 → Redeploy.

## Fase 4 — Rollback tras retirar EC2
**Cuándo:** se descubre regresión 24–72h después de terminar EC2.
**Tiempo estimado:** 30–45 min.

1. EC2 Console → AMIs → `dvpnyx-quoter-prod-<fecha>` → Launch Instance.
2. Security group: abrir 80/443 y 22.
3. Elastic IP: asociar el antiguo o uno nuevo.
4. SSH + `cd ~/dvpnyx-quoter && docker compose up -d`.
5. Route 53: apuntar `quoter.doublevpartners.com` a la nueva IP.

## Rollback total del proyecto de modernización
Si se decide abortar la migración por completo:

1. Route 53: todo al EC2.
2. `infra/`: `cdk destroy --all --context env=prod` (borra WAF, Lambda, API GW, Amplify, **NO** Aurora — retained).
3. Aurora: exportar snapshot final, luego `aws rds delete-db-cluster --skip-final-snapshot false`.
4. Borrar la rama `architecture/aws-modernization`.
5. Post-mortem documentado en `docs/postmortems/`.
