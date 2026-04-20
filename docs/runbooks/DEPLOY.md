# Runbook: Deploy & Rollback

> **Modelo:** la imagen Docker se construye **en GitHub Actions** y se
> publica en `ghcr.io/danielvillacamacho-collab/dvpnyx-quoter-server`.
> El server (prod o dev) solo hace `docker compose pull` +
> `docker compose up -d`. El host no necesita Node, npm ni
> dependencias de build.

## Flujos automáticos

| Branch    | Workflow                          | Host             | Image tag                 |
|-----------|-----------------------------------|------------------|---------------------------|
| `main`    | `.github/workflows/deploy.yml`    | prod             | `<sha>` + `latest`        |
| `develop` | `.github/workflows/deploy-dev.yml`| dev              | `dev-<sha>` + `dev-latest`|

En ambos casos el pipeline:

1. Corre tests (solo prod; dev skippea para bajar latencia).
2. Log in a GHCR con el `GITHUB_TOKEN` (sin secrets adicionales).
3. Build + push de la imagen con `docker/build-push-action` + cache GHA.
4. SSH al host:
   - `git fetch/reset` para traer el `docker-compose.yml` + runbooks
     actualizados (el código real vive dentro de la imagen).
   - `docker login ghcr.io` con un token efímero.
   - `docker compose pull` → `docker compose run --rm server migrate.js`
     → `docker compose up -d server`.
   - Health check HTTP contra `/api/auth/login` por 90s.
   - Si falla el health → **auto-rollback** al tag previo de
     `~/deploy-history.log` (solo en prod).
5. Rotación: mantiene las 5 imágenes más recientes, purga el resto.

## Secrets de GitHub Actions

### Prod (ya configurados)
- `AWS_HOST`
- `AWS_USER`
- `AWS_SSH_KEY`

### Dev (pendientes — el Head de Infra los crea en Settings → Secrets → Actions)
- `AWS_HOST_DEV`
- `AWS_USER_DEV`
- `AWS_SSH_KEY_DEV`

`GITHUB_TOKEN` se auto-provisiona cada run; no hay que crear nada manual
para el registry.

## Setup del host (una vez)

Ambos hosts (prod y dev) necesitan solo esto:

```bash
# 1. Prerrequisitos — docker + docker-compose-plugin
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER   # logout/login

# 2. Clonar el repo (solo se usa para docker-compose.yml + runbooks)
cd ~
git clone git@github.com:danielvillacamacho-collab/quoter-dvpnyx.git
cd quoter-dvpnyx

# 3. Configurar .env (ver .env.example)
cp .env.example .env
nano .env
# Prod: DVPNYX_HOST=quoter.doublevpartners.com, sin Basic Auth
# Dev:  DVPNYX_HOST=dev.quoter.doublevpartners.com, con Basic Auth

# 4. Primera sincronización — dispara el workflow manualmente
# (Actions tab → "Deploy to AWS EC2 (dev)" → Run workflow) O sigue
# adelante con un pull manual:
docker login ghcr.io -u <github-username>  # (una vez, con PAT read:packages)
docker compose pull server
docker compose up -d
```

Si prefieres no guardar credenciales persistentes en el host, el flujo
CI hace login efímero con el `GITHUB_TOKEN` en cada deploy — en ese
caso salta el paso 4 manual y espera el primer push a `develop`/`main`.

## Rollback manual

```bash
ssh <host>
cd ~/dvpnyx-quoter
cat ~/deploy-history.log | tail -10     # encontrar el tag anterior
export IMAGE_TAG=<sha-anterior>
docker compose pull server
docker compose up -d server
```

El `docker-compose.yml` usa `${IMAGE_TAG:-latest}` por default, así que
exportar el SHA objetivo es suficiente — no hay que tocar archivos.

## Troubleshooting

- **"Invalid Host header"** — estás corriendo `docker-compose.dev.yml`
  (CRA dev server). Usa `docker-compose.yml` (imagen prod).
- **`docker compose pull` falla con 401** — el `docker login` en el host
  expiró. Para pulls manuales, regenera un PAT con scope `read:packages`.
  Los deploys automáticos no tienen este problema (login efímero cada run).
- **Health check timeout** — revisa logs con
  `docker compose logs server --tail=100`. Común: migrate.js cayó por
  DB constraint ya aplicada. En ese caso hacer el rollback al tag
  previo y levantar ticket.
