# Despliegue Serverless — DVPNYX Quoter

Guía de referencia para desplegar la infraestructura serverless desde cero y entender el flujo de CI/CD automático.

> Código de infraestructura Terraform: **[Double-VPartners/quoter-infraestructura-terraform](https://github.com/Double-VPartners/quoter-infraestructura-terraform)**

---

## Arquitectura

```
GitHub (main)
     │
     ├── serverless/packages/** ──► deploy-lambdas.yml ──► Lambda (15 módulos)
     │                                                          │
     └── client/**             ──► frontend.yml        ──► S3 + CloudFront

                          API Gateway REST
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
         platform          employees        reports   ... (15 funciones)
              │                │
              └────────────────┘
                       │
                  RDS Proxy ──► Aurora Serverless v2 (PostgreSQL)
                  AWS Secrets Manager (JWT, OAuth, DB)
```

### Componentes provisioned por Terraform

| Componente | Descripción |
|---|---|
| VPC + Subnets | Red privada con NAT Gateway en `mx-central-1` |
| Aurora Serverless v2 | PostgreSQL, 0.5–1 ACU, en subnets privadas |
| RDS Proxy | Pooling de conexiones para las Lambdas |
| 15 funciones Lambda | Un módulo por dominio de negocio (Node 20) |
| API Gateway REST | Punto de entrada único → enruta por prefijo de ruta |
| S3 (frontend) | Bucket para el build de React |
| CloudFront | CDN con WAFv2 adjunto, origen S3 + API GW |
| Secrets Manager | JWT secret (auto), Google OAuth (manual), DB credentials (auto) |
| Route53 + ACM | DNS y certificados SSL para `api.<dominio>` y `<dominio>` |

---

## 1. Primer despliegue (desde cero)

### Pre-requisitos

- AWS CLI configurado con permisos de administrador
- Terraform >= 1.0
- Node 20 + npm
- Acceso al repo de infraestructura: `github.com/Double-VPartners/quoter-infraestructura-terraform`

### Paso 1 — Compilar los ZIPs de las Lambdas

Los ZIPs deben existir **antes** de correr `terraform apply`. Terraform los lee del disco para calcular el hash y subirlos.

```powershell
# Desde la raíz del repo de la aplicación
cd serverless
.\scripts\package-lambdas.ps1 -OutDir "C:\ruta\al\repo\terraform\src"
```

Esto genera un ZIP por módulo en `src/` del repo de Terraform:

```
src/
  assignments.zip
  capacity.zip
  clients.zip
  contracts.zip
  crm.zip
  employees.zip
  internal-ops.zip
  opportunities.zip
  platform.zip
  project-health.zip
  quotations.zip
  reports.zip
  resource-requests.zip
  revenue.zip
  time-tracking.zip
```

### Paso 2 — Provisionar infraestructura con Terraform

```bash
# Clonar repo de infraestructura
git clone https://github.com/Double-VPartners/quoter-infraestructura-terraform
cd quoter-infraestructura-terraform/environments/development

# Inicializar backend (S3: dvpnyx-quoter-terraform-state)
terraform init

# Revisar qué se va a crear
terraform plan

# Aplicar
terraform apply
```

Terraform crea **todo** en un solo apply: red, base de datos, lambdas, API Gateway, CloudFront, DNS, secretos.

### Paso 3 — Actualizar el secreto de Google OAuth (manual)

Terraform crea el secreto con valores placeholder. Hay que actualizarlos manualmente en la consola de AWS o con CLI:

```bash
aws secretsmanager put-secret-value \
  --secret-id "quoter/google-oauth-development" \
  --secret-string '{
    "GOOGLE_CLIENT_ID": "tu-client-id.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "tu-client-secret",
    "CLIENT_URI": "https://tudominio.com",
    "GOOGLE_ALLOWED_DOMAIN": "doublevpartners.com"
  }'
```

El JWT secret y las credenciales de la base de datos los genera Terraform automáticamente.

### Paso 4 — Correr migraciones de base de datos

```bash
# Obtener credenciales desde Secrets Manager
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "quoter/db-credentials-development" \
  --query SecretString --output text)

PGHOST=$(echo $SECRET | jq -r .host)
PGUSER=$(echo $SECRET | jq -r .username)
PGPASSWORD=$(echo $SECRET | jq -r .password)

# Correr migraciones
cd server
PGHOST=$PGHOST PGUSER=$PGUSER PGPASSWORD=$PGPASSWORD \
PGDATABASE=quoterdb PGSSLMODE=require \
node database/migrate.js
```

Las migraciones son **idempotentes** — se pueden correr múltiples veces sin riesgo.

### Paso 5 — Desplegar el frontend

```bash
cd client
REACT_APP_GOOGLE_CLIENT_ID="duenunnwndjeowciofe.apps.googleusercontent" npm run build

# Subir a S3 (el nombre del bucket lo da Terraform output)
aws s3 sync build/ s3://$(terraform output -raw frontend_bucket_name) --delete

# Invalidar CloudFront
aws cloudfront create-invalidation \
  --distribution-id $(terraform output -raw cloudfront_distribution_id) \
  --paths "/*"
```

---

## 2. CI/CD automatizado

Una vez provisionada la infraestructura, los deploys posteriores los maneja GitHub Actions automáticamente.

### `deploy-lambdas.yml` — Actualización de código Lambda

**Trigger:** push a `main` con cambios en `serverless/packages/**`

**Qué hace:**

```
1. Detecta qué módulos cambiaron (git diff con el commit anterior)
2. Si cambió packages/shared/ → rebuilda TODOS los módulos (shared afecta a todos)
3. Compila solo los módulos afectados en paralelo (esbuild → index.js → ZIP)
4. Sube cada ZIP a S3 con el SHA del commit como nombre:
     s3://dvpnyx-quoter-terraform-state/lambdas/development/<módulo>/<git-sha>.zip
5. Llama a aws lambda update-function-code para cada función afectada
6. Espera confirmación de que la actualización completó
```

**Nombre de las funciones en AWS:**
```
{PROJECT_NAME}-{módulo}-{TF_ENVIRONMENT}

Ejemplo: quoter-assignments-development
```

Los valores de `PROJECT_NAME` y `TF_ENVIRONMENT` se configuran en las primeras líneas del workflow y deben coincidir exactamente con los valores de `var.project_name` y `var.environment` en Terraform.

---

### `frontend.yml` — Deploy del frontend

**Trigger:** push a `main` con cambios en `client/**`

**Qué hace:**
```
1. npm ci + npm run build
2. aws s3 sync → sube build/ al bucket S3
3. CloudFront invalidation (/* para que los cambios sean inmediatos)
```

---

## 3. Secrets requeridos en GitHub

Ir a **Settings → Secrets and variables → Actions** y agregar:

### Para `deploy-lambdas.yml`

| Secret | Descripción |
|---|---|
| `AWS_LAMBDA_ACCESS_KEY_ID` | Access Key de IAM con permisos `lambda:UpdateFunctionCode` y `s3:PutObject` en `dvpnyx-quoter-terraform-state` |
| `AWS_LAMBDA_SECRET_ACCESS_KEY` | Secret Key correspondiente |

### Para `frontend.yml`

| Secret | Descripción |
|---|---|
| `AWS_ACCESS_KEY_ID` | Access Key con permisos `s3:PutObject`, `s3:DeleteObject`, `cloudfront:CreateInvalidation` |
| `AWS_SECRET_ACCESS_KEY` | Secret Key correspondiente |
| `CLOUDFRONT_DISTRIBUTION_ID_DEV` | ID de la distribución CloudFront (sale del `terraform output`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (se inyecta en el build de React) |

### Permisos mínimos IAM para el usuario de CI

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode", "lambda:GetFunction"],
      "Resource": "arn:aws:lambda:mx-central-1:*:function:quoter-*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::dvpnyx-quoter-terraform-state/lambdas/*"
    }
  ]
}
```

---

## 4. Deploy manual de lambdas

### Forzar un módulo específico

Desde **GitHub → Actions → Deploy Lambda Functions → Run workflow**:

- **Módulos:** escribir `assignments,employees` para deployar solo esos
- **Deploy all:** activar el checkbox para rebuildar y desplegar los 15 módulos

### Rollback de una lambda a una versión anterior

Cada deploy guarda el ZIP en S3 con el SHA del commit. Para hacer rollback:

```bash
# Ver ZIPs disponibles para un módulo
aws s3 ls s3://dvpnyx-quoter-terraform-state/lambdas/development/assignments/

# Rollback al SHA anterior
aws lambda update-function-code \
  --function-name quoter-assignments-development \
  --s3-bucket dvpnyx-quoter-terraform-state \
  --s3-key lambdas/development/assignments/<sha-anterior>.zip \
  --publish
```

---

## 5. Cambios de infraestructura

Si necesitas cambiar configuración de infraestructura (memoria de una Lambda, variables de entorno, nuevas rutas en API Gateway, etc.) eso va por Terraform, no por el CI:

```bash
cd quoter-infraestructura-terraform/environments/development

# Revisar cambios antes de aplicar
terraform plan

# Aplicar
terraform apply
```

> Los cambios de **código** van por CI (`deploy-lambdas.yml`).
> Los cambios de **infraestructura** van por `terraform apply`.
> Nunca mezclar los dos flujos.

---

## 6. Módulos Lambda

| Módulo | Rutas API | Memoria | Timeout |
|---|---|---|---|
| `platform` | `/auth`, `/users`, `/notifications`, `/me`, `/bulk-import`, `/ai-interactions` | 512 MB | 29s |
| `clients` | `/clients` | 256 MB | 29s |
| `crm` | `/contacts`, `/activities` | 256 MB | 29s |
| `employees` | `/employees`, `/areas`, `/skills`, `/employee-costs` | 256 MB | 29s |
| `opportunities` | `/opportunities` | 512 MB | 29s |
| `quotations` | `/quotations` | 512 MB | 29s |
| `contracts` | `/contracts` | 256 MB | 29s |
| `resource-requests` | `/resource-requests`, `/rm` | 256 MB | 29s |
| `assignments` | `/assignments` | 256 MB | 29s |
| `capacity` | `/capacity` | 512 MB | 29s |
| `time-tracking` | `/time-entries`, `/time-allocations` | 256 MB | 29s |
| `revenue` | `/revenue`, `/admin`, `/budgets` | 256 MB | 29s |
| `project-health` | `/projects` | 512 MB | 29s |
| `reports` | `/reports`, `/dashboard` | 512 MB | 60s |
| `internal-ops` | `/internal-initiatives`, `/novelties`, `/idle-time`, `/holidays` | 256 MB | 29s |

**Nombre en AWS:** `{project_name}-{módulo}-{environment}`
Ejemplo: `quoter-assignments-development`

---

## 7. Secretos gestionados por Terraform

| Secreto en Secrets Manager | Generado por | Acción requerida |
|---|---|---|
| `quoter/db-credentials-development` | Terraform (auto) | Ninguna |
| `quoter/jwt-secret-development` | Terraform (auto) | Ninguna |
| `quoter/google-oauth-development` | Terraform (placeholder) | **Actualizar manualmente** con credenciales reales de Google |

Las Lambdas acceden a los secretos en runtime vía `DB_SECRET_ARN`, `JWT_SECRET_ARN` y `GOOGLE_OAUTH_SECRET_ARN` inyectados como variables de entorno por Terraform.
