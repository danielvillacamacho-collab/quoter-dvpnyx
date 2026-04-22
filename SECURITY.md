# Security Policy

## Reporte de vulnerabilidades

**Si encontrás un bug de seguridad, NO abras un issue público en GitHub.**

Contactar directamente al Product Owner:
- **Daniel Villa Camacho** — GitHub `@danielvillacamacho-collab`
- Email privado: (completar con el equipo entrante)

Incluí en el reporte:
1. Descripción del issue.
2. Pasos para reproducir.
3. Impacto estimado (confidentiality / integrity / availability).
4. Sugerencia de fix si la tenés.

Respuesta esperada: **48 horas** para el acknowledge inicial; **7 días** para el plan de fix; **30 días** para el parche en producción (o justificación documentada).

---

## Scope

En scope:
- El código de este repositorio (client, server, infra).
- La infraestructura desplegada en `quoter.doublevpartners.com` y `dev.quoter.doublevpartners.com`.
- Dependencias de terceros en `package.json` (client y server).

Fuera de scope:
- Reporting automático de low-severity por scanners tipo OWASP ZAP / `npm audit` — preferimos que mandes un PR.
- Vulnerabilidades que requieran acceso físico al servidor o credenciales previamente comprometidas.
- Issues de DoS por volumen (ya hay rate-limiting básico).

---

## Modelo de amenazas (resumen)

### Authentication & authorization

- **Auth**: JWT emitido por `POST /api/auth/login`, expira en `JWT_EXPIRES_IN` (default `8h`).
- **Almacenamiento**: token en `localStorage` del navegador (`dvpnyx_token`). Consciente del trade-off vs httpOnly cookies — se eligió localStorage por simplicidad y porque toda la app vive bajo el mismo origen. **Cambiar a cookie httpOnly es una mejora pendiente.**
- **Middleware**: `server/middleware/auth.js` exporta `auth` (cualquier usuario autenticado) y `adminOnly` (role ≥ admin). Casi todas las rutas mutation-heavy van con `adminOnly`.
- **Password hashing**: bcrypt con cost factor 12 (`bcryptjs.hash(pw, 12)`).
- **Password reset**: hoy es reset por admin (`POST /users/:id/reset-password` genera una temporal). **No hay reset self-service por email** — pendiente.
- **Rate limiting**: global `/api/` = 200 req / 15 min; `/api/auth/login` = 10 req / 15 min.

### Datos sensibles

- **Campos PII en DB**: `users.email`, `users.name`, `employees.email`, `employees.first_name`, `employees.last_name`, `employees.city`, `clients.*`. No hay datos financieros de tarjetas ni SSN.
- **`users.password_hash`**: `SELECT password_hash` solo en el handler de login y change-password. **Nunca** se devuelve en una respuesta JSON. Verificado con `grep password_hash server/routes`.
- **Audit log** (`audit_log`): registra login y cambios críticos. No incluye plaintext passwords.
- **Backups**: workflow `backup-nightly.yml` vuelca la DB a S3. Cifrado en reposo por política de bucket (verificar en `infra/`).

### Transporte y headers

- HTTPS termina en Traefik (Let's Encrypt) — `http://` redirige a `https://`.
- `helmet()` habilitado en Express → setea `X-Content-Type-Options`, `X-DNS-Prefetch-Control`, `Strict-Transport-Security`, etc.
- CORS restringido a `CLIENT_URL` (default `http://localhost:3000` en dev).
- Cookies: hoy no se usan — todo por header `Authorization: Bearer <jwt>`.

### SQL / inyección

- **Queries parametrizadas**: todas las SELECT / INSERT / UPDATE usan `$1, $2, …` con `pool.query(sql, params)`. **Nunca** string interpolation. Auditado con `grep -E "pool\.query\([\"\`].*\\\${|pool\.query\([\"\`].*\\+"` → 0 matches en `server/routes/`.
- **JSONB merge** (`preferences`): usa `||` con allowlist + sanitización previa (`server/routes/auth.js :: sanitizePrefs`).
- **Bulk import**: parser valida tipos antes del INSERT, loguea errores con nombre del campo pero sin el valor plaintext.

### XSS / CSRF

- **XSS**: React escapea el DOM por default. No hay `dangerouslySetInnerHTML` en el código actual (auditado). Si se introduce, pasar por review.
- **CSRF**: API es stateless con JWT en header — **no es vulnerable a CSRF clásico**. Si se migra a cookies httpOnly, hay que agregar un token CSRF o `SameSite=strict`.

### Dependencias

- `npm audit` se recomienda correr como pre-release. Hoy **no está en el CI**. Agregarlo en el próximo sprint — comando sugerido:
  ```yaml
  - run: cd server && npm audit --production --audit-level=high
  - run: cd client && npm audit --production --audit-level=high
  ```
- Renovate / Dependabot: **no configurado**. Pendiente para el equipo entrante.

### Secretos en repo

- Verificado con `git grep -iE "(password|secret|api.?key).*=.*['\"]"` → 0 falsos positivos al cierre de la entrega.
- `.gitignore` filtra `.env`, `.env.*`, `*.pem`, `*.key`.
- Pre-commit hook de `gitleaks` / `trufflehog`: **no configurado**. Pendiente.

---

## Prácticas de deploy seguras

- **Secretos en prod** viven en variables de entorno del host EC2 (systemd / docker compose). Acceso SSH por llave por usuario, no compartida.
- **Rotación de JWT_SECRET**: rotarlo fuerza logout de todos los usuarios. Coordinar con el PO antes de hacerlo.
- **Backups**: `backup-nightly.yml` a S3. **Probar restore al menos 1 vez por trimestre** — runbook en `docs/runbooks/DR.md`.

---

## Checklist rápido para el equipo entrante

En el primer mes:

- [ ] Configurar Dependabot / Renovate para security updates.
- [ ] Agregar `npm audit` al CI como step (`--audit-level=high`).
- [ ] Evaluar migrar de `localStorage` a cookie `HttpOnly; Secure; SameSite=strict`.
- [ ] Configurar un gitleaks / trufflehog pre-commit o CI step.
- [ ] Probar el runbook de restore de backups y documentar el timing real.
- [ ] Definir política de rotación de `JWT_SECRET` (cada 90 días sugerido).
- [ ] Implementar self-service password reset con link por email (hoy solo admin reset).
- [ ] Decidir si agregar SSO (Google Workspace / Azure AD) — la mayoría del equipo DVP ya tiene Google Workspace.
- [ ] Sentry / Datadog para error tracking en prod (hoy `console.error` se pierde).
- [ ] MFA para usuarios admin / superadmin — hoy no hay.

---

*Este documento se revisa cada 6 meses como mínimo, o inmediatamente después de cualquier incidente de seguridad.*
