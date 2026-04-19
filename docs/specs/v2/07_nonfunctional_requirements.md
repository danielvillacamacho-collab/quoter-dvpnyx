# 07 — Requerimientos No Funcionales

## Seguridad

### Autenticación
- JWT con expiración configurable (default 12 horas).
- Refresh tokens opcionales en V2 (si complejiza, diferir).
- Contraseña temporal default `000000` solo para onboarding; fuerza `must_change_password=true` que bloquea acceso al sistema hasta cambiarla.
- Hash de contraseñas con bcrypt, cost factor 12.
- Password policy: mínimo 8 caracteres, al menos 1 letra y 1 número. No reutilizar última contraseña.

### Autorización
- Capability bundle en backend middleware, aplicado por endpoint.
- `req.user` populated con rol + función + squad después de JWT decode.
- Chequeo de scope: ej. `Member` solo edita cotizaciones de su squad.
- Never trust client. Todo chequeo de permiso ocurre en servidor.

### Protección de datos
- HTTPS obligatorio en producción (Traefik con Let's Encrypt).
- Cookies `HttpOnly`, `Secure`, `SameSite=Lax` si se usan.
- Secretos (JWT secret, DB password) solo por env vars; nunca en git.
- `.env.example` con placeholders.
- Logs no deben contener contraseñas ni tokens.

### Inyección y XSS
- Prepared statements en TODA consulta SQL (pg con parámetros).
- Validación y sanitización de inputs en backend con librería (joi/zod).
- Encoding automático en React (cuidar con `dangerouslySetInnerHTML`; prohibido salvo excepción documentada).

### Rate limiting
- `express-rate-limit` o equivalente.
- Default: 100 req/min unauth, 600 req/min auth.
- Especial: login 10 intentos/15 min por IP.

### Audit
- Cada acción crítica dispara un evento en tabla `events`.
- Log estructurado (JSON) enviado a stdout, consumido por Docker logs.
- Acciones admin registran actor, target, before/after.

### Soft delete
- Todas las tablas con soft delete preservan el registro; hard delete solo por superadmin con confirmación extra.
- No exponer registros soft-deleted en endpoints normales.

### Datos personales
- En V2 no se implementan flujos GDPR completos (minimal scope para empresa LATAM).
- Preparar endpoint `GET /api/users/:id/export-data` como placeholder (no obligatorio implementar ahora).

---

## Performance

### Objetivos
- Login: p95 < 500 ms.
- Dashboard: p95 < 1 s (con caché).
- Reportes sobre ≤100k filas: p95 < 2 s.
- Lista con 25 ítems paginada: p95 < 300 ms.
- Guardado de cotización con recálculo: p95 < 800 ms.

### Técnicas
- Índices en BD: en toda FK + en campos de búsqueda frecuente (name, status, deleted_at).
- Índices compuestos para filtros combinados (ej. `(squad_id, status, deleted_at)`).
- Vistas materializadas para reportes pesados (refresh cada 15 min, configurable).
- Paginación SQL con `LIMIT/OFFSET` (en V2 es suficiente; si >10k páginas, migrar a cursor-based).
- Code splitting frontend por ruta.
- Lazy loading de componentes pesados (tablas grandes, gráficos).

### Caché
- React Query con staleTime 1–5 min según endpoint.
- ETag o `Cache-Control` en endpoints readonly donde aplique.

---

## Observabilidad

### Logs
- Servidor: JSON estructurado a stdout (`{ level, message, ts, req_id, user_id, duration_ms, ... }`).
- Requisitos mínimos en cada request: timestamp, método, path, status, latencia, user_id si auth, request_id.
- Frontend: errores enviados a servidor via `POST /api/client-error` con stack trace y contexto.

### Métricas
- Endpoint `GET /api/metrics` (Prometheus-compatible) — reservado; implementar solo si tiempo.
- KPIs internos: # requests/min, latencia p50/p95, % errores.

### Traza
- No es prioridad V2. Dejar hooks (`x-request-id` header) para futuro OpenTelemetry.

### Alertas
- Con el setup actual (EC2 + Traefik) no hay paging automático.
- En V2 basta con healthcheck público (`/api/health`) y monitoreo externo si Daniel configura uptimerobot o similar.

---

## Disponibilidad y resiliencia

- Single-node despliegue en EC2 con Docker Compose — aceptable para V2.
- Healthcheck del contenedor server con Traefik.
- PostgreSQL con backup automático diario (cron + `pg_dump` a S3 o volumen persistido).
- Restore documentado en `10_operations_runbook.md`.
- RTO objetivo: 2 horas. RPO: 24 horas (backup diario).

---

## Accesibilidad (WCAG 2.1 AA objetivo)

- Contraste mínimo 4.5:1 en texto normal.
- Tab order lógico en todas las pantallas.
- Labels `<label for>` en todos los inputs.
- Mensajes de error asociados via `aria-describedby`.
- Estados de loading/success/error anunciados con `aria-live`.
- No depender solo de color (combinar con iconos/texto).

---

## Internacionalización

- Solo español en V2. Archivos `src/locales/es.js` con todos los strings.
- Fechas, números, monedas formateadas con `Intl` API (no locale-hardcoded).

---

## Responsive

- Desktop-first (rango principal 1280–1920 px).
- Tablet usable con sidebar colapsado (breakpoint 1024 px).
- Mobile (<640 px) limitado: time tracking y lectura de listas. No edición de entidades complejas.

---

## Compatibilidad de navegadores

- Chrome, Firefox, Edge, Safari (última y penúltima versión).
- No IE.

---

## Calidad de código

### Backend
- ESLint con config compartida (ya existe en V1).
- Prettier para formato consistente.
- Naming: `camelCase` en código, `snake_case` en BD, `kebab-case` en URLs.
- Sin `console.log` en producción; usar logger estructurado.
- Error handling centralizado (middleware `errorHandler`).

### Frontend
- ESLint + Prettier misma config.
- PropTypes o JSDoc para componentes públicos (V2 NO migra a TypeScript).
- No comentarios comentando obviedades; sí comentarios explicando el "porqué" de decisiones no obvias.

### Tests
- Cobertura mínima: funciones utilitarias 90%+, endpoints críticos 70%+.
- Tests unitarios en `*.test.js` junto al archivo.
- Tests de integración en `server/__tests__/`.
- E2E con Playwright en `e2e/`.

### CI
- GitHub Actions:
  - Lint + tests en cada PR.
  - Build docker images.
  - Smoke test post-deploy a staging (si existe).
- Branch protection: PR con al menos 1 revisión + tests verdes → merge a main.
- Deploy a producción: manual trigger (workflow_dispatch) o push a main (decisión Claude Code según repo actual).

---

## Despliegue

### Producción actual
- AWS EC2 + Docker Compose + Traefik.
- Dominio: `quoter.doublevpartners.com` (posiblemente se renombre — ver `00_README.md`).
- HTTPS via Let's Encrypt.

### V2 ajustes
- Mantener infra; no migrar a Kubernetes / ECS.
- Añadir volume persistente para `postgres_data`, para `uploads` (si aparecen archivos).
- Script `deploy.sh` idempotente que haga `git pull + docker compose build + docker compose up -d + migration`.
- Migraciones corren en step dedicado antes de levantar server (`npm run migrate` en contenedor efímero).

### Variables de entorno requeridas
```
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
JWT_SECRET, JWT_EXPIRES_IN
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://quoter.doublevpartners.com
TZ=America/Bogota
REACT_APP_API_BASE=/api
REACT_APP_GIT_SHA=<injected at build>
APP_VERSION=2.0.0
```

---

## Mantenibilidad

- Changelog humano (`CHANGELOG.md`) actualizado con cada release.
- Documentación viva: las specs de V2 (`/specs/v2`) se mantienen como fuente de verdad. Al cambiar una entidad, actualizar spec primero, luego código.
- Wiki interna accesible desde `/wiki` (ya en V1) con: onboarding, flujos comunes, troubleshooting.

---

## Legal y privacidad (básico)

- En V2 no hay términos y condiciones formales; es uso interno.
- Política de retención: preservar datos indefinidamente salvo petición explícita (employees soft-deleted aún contados para audit).
- Exportación de datos personales: implementable post-V2.

---

## Riesgos operacionales

- **Backup no automatizado si falta setup:** documentar en runbook y priorizar implementación.
- **Dependencia de un solo contenedor Postgres:** aceptable V2 con backups.
- **JWT con expiración larga:** mitigar con password reset accesible a admin.
- **Rate limit insuficiente:** mantener monitoreo; elevar si hay abuso.

---

## Resumen de compromiso

V2 es un producto **robusto pero pragmático**:
- Infraestructura simple, monolítica, reproducible.
- Seguridad sólida sin over-engineering.
- Observabilidad básica pero útil.
- Performance aceptable para equipo de 50–200 personas.
- Accesibilidad aspiracional WCAG AA.
- Sin SLAs formales; uso interno.

No se optimiza para escala masiva ni multi-región en V2. Eso se evalúa si el producto crece a tercera etapa.
