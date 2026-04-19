# 10 — Operations Runbook

Runbook operativo para V2. Procedimientos para despliegue, backup/restore, troubleshooting y monitoreo.

---

## Infraestructura

- **Host:** AWS EC2 (single node).
- **Orquestación:** Docker Compose.
- **Reverse proxy + TLS:** Traefik.
- **Dominio:** `quoter.doublevpartners.com` (posible rename — ver `00_README.md`).
- **Base de datos:** PostgreSQL 16 en contenedor con volumen persistente `postgres_data`.
- **CI/CD:** GitHub Actions.

Stack compose resumido:
```
services:
  traefik: (reverse proxy + let's encrypt)
  db: (postgres:16)
  server: (node:20 + express)
  client: (nginx con build estático)
```

---

## Despliegue

### Deploy estándar (sin migraciones)

```bash
cd /opt/dvpnyx
git pull origin main
docker compose build server client
docker compose up -d server client
docker compose exec server node -e "console.log(require('./package.json').version)"
```

Verificar:
```bash
curl -s https://quoter.doublevpartners.com/api/health
```
Debe responder `{ ok: true, version, git_sha }`.

### Deploy con migraciones

```bash
cd /opt/dvpnyx
git pull origin main

# Backup antes de migrar
./scripts/backup_db.sh

docker compose build server client

# Migración en contenedor efímero
docker compose run --rm server npm run migrate

# Validación
docker compose run --rm server npm run validate:migration

# Si todo OK, up
docker compose up -d server client
```

### Deploy V2 inicial (desde V1)

Ver `08_migration_plan.md` sección "Deployment flow recomendado". Resumen:
1. Notificar usuarios 24h antes.
2. Backup.
3. Pull de imágenes V2.
4. Ejecutar migration script.
5. Levantar contenedores.
6. Verificar.

---

## Backup

### Backup manual

Script: `/opt/dvpnyx/scripts/backup_db.sh`
```bash
#!/bin/bash
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/var/backups/dvpnyx
mkdir -p $BACKUP_DIR
docker compose exec -T db pg_dump -U dvpnyx dvpnyx | gzip > $BACKUP_DIR/dvpnyx_$TS.sql.gz
find $BACKUP_DIR -name "dvpnyx_*.sql.gz" -mtime +30 -delete
echo "Backup OK: $BACKUP_DIR/dvpnyx_$TS.sql.gz"
```

### Backup automático

Cron en el host:
```
0 2 * * * /opt/dvpnyx/scripts/backup_db.sh >> /var/log/dvpnyx-backup.log 2>&1
```
Ejecuta a las 02:00 hora local. Retiene 30 días.

### Backup offsite (recomendado)

Añadir al script:
```bash
aws s3 cp $BACKUP_DIR/dvpnyx_$TS.sql.gz s3://dvpnyx-backups/db/
```
Requiere IAM role o credenciales en el host.

---

## Restore

### Restore completo

```bash
cd /opt/dvpnyx
docker compose stop server

# Descomprimir backup
gunzip -k /var/backups/dvpnyx/dvpnyx_20260401_020000.sql.gz

# Drop + create + restore
docker compose exec -T db psql -U dvpnyx -d postgres -c "DROP DATABASE IF EXISTS dvpnyx;"
docker compose exec -T db psql -U dvpnyx -d postgres -c "CREATE DATABASE dvpnyx;"
docker compose exec -T db psql -U dvpnyx dvpnyx < /var/backups/dvpnyx/dvpnyx_20260401_020000.sql

docker compose start server
```

### Restore selectivo (una tabla)

```bash
# Extraer solo una tabla del backup
pg_restore -t quotations dvpnyx_20260401_020000.sql > quotations_only.sql
# Revisar contenido antes de importar
```

---

## Troubleshooting

### El servidor no responde

```bash
# Ver estado de contenedores
docker compose ps

# Ver logs de server
docker compose logs --tail=200 server

# Reiniciar server
docker compose restart server
```

### Base de datos con errores

```bash
# Logs db
docker compose logs --tail=200 db

# Conectarse para inspeccionar
docker compose exec db psql -U dvpnyx dvpnyx

# Verificar conexiones activas
SELECT * FROM pg_stat_activity;

# Verificar locks
SELECT * FROM pg_locks WHERE NOT granted;
```

### Migraciones fallidas

```bash
# Ver última migración aplicada
docker compose exec db psql -U dvpnyx dvpnyx -c "SELECT * FROM migrations ORDER BY run_on DESC LIMIT 10;"

# Correr migración manualmente con verbose
docker compose run --rm -e DEBUG=* server npm run migrate
```

### Traefik no emite certificado

```bash
docker compose logs traefik | grep -i acme
# Verificar que el puerto 80 y 443 estén abiertos en el security group
# Verificar que el dominio apunte a la IP correcta
```

### Usuario bloqueado / password olvidado

Reset por superadmin desde UI (`/admin/users/:id` → botón Reset password).

Si no hay superadmin disponible, conexión directa a DB:
```bash
docker compose exec db psql -U dvpnyx dvpnyx
# UPDATE users SET password_hash = '<new_bcrypt_hash>', must_change_password=true WHERE email='...';
```

Generar hash:
```bash
docker compose exec server node -e "console.log(require('bcrypt').hashSync('000000', 12))"
```

### Disco lleno

```bash
# Ver uso
df -h
du -sh /var/lib/docker/volumes/*
du -sh /var/backups/dvpnyx/

# Limpiar imágenes viejas
docker system prune -a --volumes

# Limpiar logs viejos de docker
truncate -s 0 $(docker inspect --format='{{.LogPath}}' $(docker ps -q))

# Limpiar backups viejos
find /var/backups/dvpnyx -name "*.gz" -mtime +30 -delete
```

---

## Monitoreo

### Health checks

- `GET /api/health` en servidor — responde `{ ok: true }`.
- Traefik chequea contenedores cada 30s.

### Externos (recomendado)

- UptimeRobot / Better Stack: HTTP check sobre `https://quoter.doublevpartners.com/api/health` cada 5 min.
- Alertas por email a Daniel + admin secundario.

### Logs

- `docker compose logs -f server` en vivo.
- Para persistir: configurar rsyslog o similar si se requiere (V2 no lo requiere).

### Métricas

- V2 no incluye Prometheus/Grafana. Métricas básicas via logs y endpoint health.
- Futuro: endpoint `/api/metrics` con request latency histogram.

---

## Secretos y variables de entorno

Archivo `.env` en `/opt/dvpnyx/`:
```
DB_HOST=db
DB_PORT=5432
DB_NAME=dvpnyx
DB_USER=dvpnyx
DB_PASSWORD=<strong_password>
JWT_SECRET=<random_32_bytes>
JWT_EXPIRES_IN=12h
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://quoter.doublevpartners.com
TZ=America/Bogota
APP_VERSION=2.0.0
```

Rotación de secretos:
- JWT_SECRET: al rotar, todos los tokens activos se invalidan (users deben re-login). Frecuencia: cada 6 meses o ante incidente.
- DB_PASSWORD: al rotar, coordinar con restart del server. Frecuencia: cada 6–12 meses.

---

## Actualizaciones de seguridad

### Librerías (npm)

```bash
cd /opt/dvpnyx/server
npm audit
npm audit fix
# Revisar breaking changes antes de producción
```

Frecuencia sugerida: quincenal.

### Imagen base

```bash
docker pull node:20-alpine
docker pull postgres:16
docker pull traefik:v2
docker compose build --no-cache
```

Frecuencia: mensual.

### Host OS

```bash
sudo apt update && sudo apt upgrade
sudo reboot  # si kernel se actualizó
```

---

## Operaciones frecuentes

### Crear usuario admin inicial

```bash
docker compose exec server node scripts/create_superadmin.js \
  --email daniel@doublevpartners.com \
  --name "Daniel" \
  --password "<temporal>"
```

### Resetear datos de desarrollo (solo staging)

```bash
docker compose exec server npm run reset:dev-data
```

### Exportar datos de una cotización (debug)

```bash
curl -s https://quoter.doublevpartners.com/api/quotations/<id> \
  -H "Authorization: Bearer <admin_token>" | jq '.' > quotation.json
```

### Reprocesar recálculo de todas las cotizaciones (tras cambio lógica)

```bash
docker compose exec server npm run recalc:all
```

---

## Mantenimiento planificado

### Ventana sugerida

- Domingos 23:00–00:00 hora Colombia (uso mínimo).
- Anunciar 48h antes via email + in-app banner.

### Checklist pre-mantenimiento

- [ ] Backup reciente (<24h) verificado.
- [ ] Rama destinada mergeada y buildeada.
- [ ] Tests verdes en CI.
- [ ] Staging probado.
- [ ] Plan de rollback documentado.
- [ ] Comunicación enviada.

### Checklist post-mantenimiento

- [ ] Health check OK.
- [ ] Smoke test manual (login, crear cotización, ver reportes).
- [ ] Logs sin errores en últimos 10 min.
- [ ] Notificar fin de ventana.

---

## Contactos

- **CEO / Product owner:** Daniel Delgado — daniel@doublevpartners.com.
- **Soporte interno:** (definir — TBD).
- **Proveedor de hosting:** AWS — cuenta corporativa DVPNYX.
- **Registrador del dominio:** (definir — TBD).

---

## Referencias

- `08_migration_plan.md` — plan de migración V1 → V2.
- `07_nonfunctional_requirements.md` — requerimientos de seguridad, performance.
- `03_data_model.md` — estructura de BD.
- `05_api_spec.md` — contrato de API.
