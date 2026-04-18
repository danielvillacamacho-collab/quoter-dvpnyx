# Ambiente de Desarrollo — Onboarding

> **Objetivo**: iterar en features sin tocar producción.
>
> Tenemos dos niveles de "dev" complementarios:
>
> 1. **Local** (inmediato, sin AWS) — `docker-compose.dev.yml`.
> 2. **AWS Dev Stack** (requiere cuenta AWS aparte) — CDK `--context env=dev`.

---

## 1. Dev Local — listo para usar hoy mismo

Arranca en un comando sin configurar nada en AWS. Hot reload en cliente
y servidor.

```bash
docker compose -f docker-compose.dev.yml up --build
```

| URL                      | Qué es                                     |
|--------------------------|--------------------------------------------|
| http://localhost:3000    | React dev server (CRA) — recarga al salvar |
| http://localhost:4000    | Express API (nodemon reinicia al salvar)   |
| 127.0.0.1:55432          | Postgres 16 dev — sólo loopback            |

**Login inicial** (mismo superadmin que prod):
```
Email:    daniel@doublevpartners.com
Clave:    000000
```

El `docker-compose.dev.yml` tiene su propio `project name = dvpnyx-dev`,
sus propias networks y su propio volumen `pgdata-dev` — **imposible
colisionar con el compose de producción**.

### Flujo sugerido
```bash
git checkout develop                      # rama base de desarrollo
git checkout -b feat/mi-nueva-feature     # rama corta de trabajo
docker compose -f docker-compose.dev.yml up
# ... codear con hot reload ...
git commit && git push                    # PR a develop → CI corre tests
```

---

## 2. Dev en AWS — qué requiere acción humana

Los siguientes pasos requieren que alguien con permisos administre AWS y
GitHub. Son **one-time** y deberían tomar ~1 hora.

### 2.1 Crear la cuenta AWS de desarrollo
1. AWS Organizations → Create account → `dvpnyx-dev`.
2. IAM Identity Center → crear perfil con acceso `AdministratorAccess` para
   el equipo de plataforma (no para el resto).
3. Registrar el **Account ID** (12 dígitos).

### 2.2 Configurar el provider OIDC (una sola vez por cuenta)
```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

Crear el rol que GitHub Actions asumirá. Ejemplo de trust policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":  { "token.actions.githubusercontent.com:sub": "repo:danielvillacamacho-collab/quoter-dvpnyx:ref:refs/heads/develop" }
    }
  }]
}
```
Adjuntar `AdministratorAccess` inicialmente; reducir a least-privilege después.

### 2.3 Registrar el Account ID en `infra/cdk.json`
Editar en local (o PR):
```json
"dev": { "account": "XXXXXXXXXXXX", "region": "us-east-1", "domainName": "dev.quoter.doublevpartners.com" }
```

### 2.4 Registrar secrets en GitHub Actions
Settings → Secrets and variables → Actions → New repository secret:

| Secret                   | Valor                                              |
|--------------------------|----------------------------------------------------|
| `AWS_DEPLOY_ROLE_ARN`    | `arn:aws:iam::<ACCOUNT>:role/<role-name>`          |

### 2.5 Bootstrapping inicial de CDK (una vez por cuenta/región)
```bash
aws sso login --profile dvpnyx-dev
cd infra && npm install && npm run build
npx cdk bootstrap aws://<ACCOUNT>/us-east-1 --context env=dev
```

### 2.6 Crear el secret del token de Amplify (para que Amplify pueda leer el repo)
1. En GitHub, generar un PAT (classic) con scope `repo` o un fine-grained token
   con `contents:read` sobre este repo.
2. En la cuenta AWS dev:
   ```bash
   aws secretsmanager create-secret \
     --name dvpnyx/github/amplify-token \
     --secret-string '{"token":"ghp_xxx"}'
   ```

### 2.7 Primer deploy del stack de dev
Ir a GitHub → Actions → "AWS Infra (CDK)" → Run workflow:
- env: `dev`
- command: `diff` (revisa qué se va a crear)

Revisar el diff en los logs. Si se ve bien, volver a disparar con `deploy`.

### 2.8 Validar
```bash
curl -I https://dev.quoter.doublevpartners.com
# Esperado: 200 (Amplify) o redirect a HTTPS
```

---

## 3. Estrategia de ramas

```
main    ──► prod (EC2 actual + en el futuro AWS stack prod)
develop ──► AWS dev stack (cuando esté activado)
feat/*  ──► PR a develop → CI verde obligatorio antes de merge
```

| Rama      | Deploy destino                          | Auto-deploy      |
|-----------|-----------------------------------------|------------------|
| `main`    | Producción EC2 (`quoter.doublevpartners.com`) | Sí (deploy.yml) |
| `develop` | AWS Dev Stack (cuando se active)        | Sí (develop-ci + aws-infra) |
| `feat/*`  | Ninguno, sólo tests en CI               | No               |

## 4. Rollback en dev

Un error en dev **no** debe propagarse a producción. Reglas:

1. En `develop` se puede `git revert` libremente — el próximo deploy dev se sobreescribe.
2. Nunca fast-forward de develop → main sin PR y sin revisión.
3. `main` siempre se despliega a prod; si pasa algo, usar los runbooks en `docs/runbooks/ROLLBACK.md`.

## 5. FAQ

**¿Por qué no mergear develop directo a main?**
Porque se pierde la oportunidad de revisar el cambio agregado y el CI de PR
es la línea de defensa. Hacer PR aunque sean dos commits.

**¿Por qué separar la cuenta AWS dev?**
Blast radius: una mala configuración en dev no puede tocar prod (no comparten
VPC, ni IAM, ni BD, ni DNS).

**¿Qué hago si necesito datos reales en dev?**
Nunca copiar dump de prod a dev sin anonimizar (hay emails, nombres). Usar
`seed.js` que ya genera el dataset mínimo, o fabricar data de prueba.
