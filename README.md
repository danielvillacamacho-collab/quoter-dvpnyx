# DVPNYX Cotizador — Web Application

Aplicación web para cotización de servicios de Staff Augmentation y Proyectos de Alcance Fijo.

## Quick start

### Desarrollo local (un comando, sin AWS)
```bash
docker compose -f docker-compose.dev.yml up --build
# → cliente: http://localhost:3000
# → API:     http://localhost:4000
# → DB:      127.0.0.1:55432
```

### Documentación funcional
- [`docs/DVPNYX_Cotizador_Documentacion_Funcional.docx`](docs/DVPNYX_Cotizador_Documentacion_Funcional.docx) — sistema actual + historias de usuario
- [`docs/DVPNYX_Arquitectura_AWS_Modernizada.docx`](docs/DVPNYX_Arquitectura_AWS_Modernizada.docx) — propuesta de modernización AWS
- [`docs/ONBOARDING_DEV.md`](docs/ONBOARDING_DEV.md) — setup de ambiente de desarrollo
- [`docs/runbooks/`](docs/runbooks/) — playbooks de rollback y DR

### Branching
| Rama      | Destino                                     | CI/CD             |
|-----------|---------------------------------------------|-------------------|
| `main`    | Producción EC2 (`quoter.doublevpartners.com`) | `deploy.yml` auto |
| `develop` | AWS Dev Stack (cuando se active)            | `develop-ci.yml`  |
| `feat/*`  | Ninguno (sólo tests en PR)                  | `develop-ci.yml`  |


## Arquitectura

```
dvpnyx-quoter/
├── client/          # React SPA (CRA)
│   ├── public/
│   └── src/
│       ├── App.js           # Rutas, contexto, todas las páginas
│       └── utils/
│           ├── api.js        # Cliente HTTP
│           └── calc.js       # Motor de cálculo (replica lógica Excel)
├── server/          # Express API
│   ├── index.js             # Entry point
│   ├── database/
│   │   ├── pool.js          # Conexión PostgreSQL
│   │   ├── migrate.js       # Esquema de base de datos
│   │   └── seed.js          # Datos iniciales + admin
│   ├── middleware/
│   │   └── auth.js          # JWT + roles
│   └── routes/
│       ├── auth.js          # Login, cambio de clave
│       ├── users.js         # CRUD usuarios (admin)
│       ├── parameters.js    # CRUD parámetros (admin)
│       └── quotations.js    # CRUD cotizaciones
├── docker-compose.yml
├── Dockerfile
└── README.md
```

## Roles y Permisos

| Rol | Cotizar | Ver historial | Editar parámetros | Gestionar usuarios |
|-----|---------|--------------|-------------------|-------------------|
| **superadmin** | ✅ | Todas | ✅ | ✅ (puede crear admins) |
| **admin** | ✅ | Todas | ✅ | ✅ (solo preventa) |
| **preventa** | ✅ | Solo propias | ❌ | ❌ |

## Credenciales iniciales

```
Email:    daniel@doublevpartners.com
Clave:    000000 (se debe cambiar en primer login)
```

---

## Despliegue en AWS

### Opción A: Docker Compose en EC2 (más simple)

#### 1. Lanzar EC2

- AMI: Amazon Linux 2023
- Tipo: t3.medium (mínimo)
- Security Group: abrir puertos 80, 443, 22
- Almacenamiento: 30 GB gp3

#### 2. Instalar Docker

```bash
sudo yum update -y
sudo yum install -y docker git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

#### 3. Clonar y configurar

```bash
git clone <tu-repo> dvpnyx-quoter
cd dvpnyx-quoter

# Crear archivo de variables de entorno
cat > .env << EOF
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
CLIENT_URL=https://cotizador.dvpnyx.com
EOF
```

#### 4. Levantar

```bash
docker-compose up -d --build

# Ejecutar migraciones y seed (primera vez)
docker-compose exec server node database/migrate.js
docker-compose exec server node database/seed.js
```

#### 5. Configurar NGINX como reverse proxy (con SSL)

```bash
sudo yum install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/conf.d/dvpnyx.conf << 'EOF'
server {
    listen 80;
    server_name cotizador.dvpnyx.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo systemctl start nginx
sudo certbot --nginx -d cotizador.dvpnyx.com
```

---

### Opción B: ECS + RDS (producción enterprise)

#### 1. RDS PostgreSQL

```bash
aws rds create-db-instance \
  --db-instance-identifier dvpnyx-quoter-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16 \
  --master-username dvpnyx \
  --master-user-password $(openssl rand -hex 16) \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxx \
  --db-name dvpnyx_quoter \
  --backup-retention-period 7 \
  --storage-encrypted
```

#### 2. ECR (Container Registry)

```bash
aws ecr create-repository --repository-name dvpnyx-quoter

# Build y push
aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker build -t dvpnyx-quoter .
docker tag dvpnyx-quoter:latest <account>.dkr.ecr.<region>.amazonaws.com/dvpnyx-quoter:latest
docker push <account>.dkr.ecr.<region>.amazonaws.com/dvpnyx-quoter:latest
```

#### 3. ECS Fargate

Crear Task Definition con las variables de entorno apuntando a RDS:

```json
{
  "family": "dvpnyx-quoter",
  "containerDefinitions": [{
    "name": "app",
    "image": "<account>.dkr.ecr.<region>.amazonaws.com/dvpnyx-quoter:latest",
    "portMappings": [{ "containerPort": 4000 }],
    "environment": [
      { "name": "DB_HOST", "value": "<rds-endpoint>" },
      { "name": "DB_PORT", "value": "5432" },
      { "name": "DB_NAME", "value": "dvpnyx_quoter" },
      { "name": "DB_USER", "value": "dvpnyx" },
      { "name": "NODE_ENV", "value": "production" }
    ],
    "secrets": [
      { "name": "DB_PASSWORD", "valueFrom": "arn:aws:ssm:...:parameter/dvpnyx/db-password" },
      { "name": "JWT_SECRET", "valueFrom": "arn:aws:ssm:...:parameter/dvpnyx/jwt-secret" }
    ],
    "memory": 512,
    "cpu": 256
  }]
}
```

#### 4. ALB + Route53

- Crear Application Load Balancer
- Target group apuntando al servicio ECS
- Certificate Manager para SSL
- Route53: cotizador.dvpnyx.com → ALB

---

## Desarrollo Local

```bash
# 1. Instalar dependencias
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 2. PostgreSQL local (o usar Docker)
docker run -d --name pg-dvpnyx -p 5432:5432 \
  -e POSTGRES_DB=dvpnyx_quoter \
  -e POSTGRES_USER=dvpnyx \
  -e POSTGRES_PASSWORD=devpassword \
  postgres:16-alpine

# 3. Configurar .env
cp server/.env.example server/.env
# Editar con las credenciales locales

# 4. Migrar y seedear
npm run db:migrate
npm run db:seed

# 5. Correr en desarrollo
npm run dev
# → Server en http://localhost:4000
# → Client en http://localhost:3000
```

## Seguridad Implementada

- **Autenticación JWT** con expiración configurable (default 8h)
- **Bcrypt** para hash de contraseñas (12 rounds)
- **Rate limiting**: 200 req/15min general, 10 req/15min en login
- **Helmet** para headers de seguridad
- **CORS** configurado por variable de entorno
- **Cambio de contraseña obligatorio** en primer login
- **Audit log** de todas las acciones (login, CRUD, cambios de parámetros)
- **Roles jerárquicos**: superadmin > admin > preventa
- **Prepared statements** en todas las queries SQL (previene SQL injection)
- **Validación de entrada** en todas las rutas

## Variables de Entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `DB_HOST` | Host de PostgreSQL | `localhost` |
| `DB_PORT` | Puerto de PostgreSQL | `5432` |
| `DB_NAME` | Nombre de la base de datos | `dvpnyx_quoter` |
| `DB_USER` | Usuario de PostgreSQL | `dvpnyx` |
| `DB_PASSWORD` | Contraseña de PostgreSQL | — |
| `JWT_SECRET` | Secreto para firmar tokens | — |
| `JWT_EXPIRES_IN` | Tiempo de vida del token | `8h` |
| `PORT` | Puerto del servidor | `4000` |
| `NODE_ENV` | Ambiente | `development` |
| `CLIENT_URL` | URL del cliente (CORS) | `http://localhost:3000` |
