# Registro de incidentes

Memoria institucional de los incidentes en producción y sus aprendizajes. No es un log exhaustivo de bugs — solo aquellos donde la causa raíz vale la pena recordar para no repetirla.

Formato: incident card + post-mortem. Estilo blameless: hablamos del sistema, no de personas.

---

## INC-001 — Login bloqueado para todos los usuarios (rate limiter mal calibrado)

**Severidad:** P0 — producción totalmente inutilizable.
**Fecha:** 2026-04-28.
**Duración:** ~30 minutos desde el reporte hasta el fix desplegado.
**Reportado por:** Daniel Villa Camacho (PO) tras intento de login fallido.

### Síntoma

Pantalla de login mostraba el error:

```
Unexpected token 'T', "Too many r"... is not valid JSON
```

al intentar autenticarse. **Todos** los usuarios de la oficina afectados simultáneamente.

### Causa raíz

3 problemas combinados en `server/index.js`:

1. **Rate limiter global subdimensionado**
   - Config: `max: 200 / 15min` por IP.
   - Realidad operativa: toda la oficina sale a internet por una **sola IP NAT corporativa**.
   - La SPA hace 5–10 calls al backend por navegación (sidebar params, dashboard data, listings).
   - 10 usuarios × 20 calls = 200 → cuota agotada en minutos. A partir de ahí, **todo el equipo bloqueado por 15 min** independientemente de quién intentaba qué.

2. **`app.set('trust proxy')` no activado**
   - Detrás de Traefik (1 proxy hop), `req.ip` era el IP del container Traefik para todos.
   - El `keyGenerator` por defecto del rate limiter usa `req.ip` → todos compartían el mismo bucket aunque vinieran de IPs reales distintas.
   - Aunque la oficina hubiera tenido IPs públicas distintas, el limiter no podía distinguirlas.

3. **Respuesta del 429 era plain text**
   - El limiter global no tenía `message` configurado → devolvía la respuesta default `text/plain "Too many requests, please try again later."`.
   - El cliente (SPA) hacía `await response.json()` ciegamente → `JSON.parse` lanzaba `SyntaxError: Unexpected token 'T'...`.
   - Consecuencia: en lugar de un mensaje útil ("intentá en unos minutos"), el usuario veía un error críptico que parecía un bug aleatorio del sistema, dificultando el diagnóstico inicial.

### Detección

PO reportó el síntoma. La causa raíz se identificó rápido grepeando `Too many` en el código (sólo 1 hit relevante) + leyendo `index.js` línea 13.

### Fix

Cambios en `server/index.js`:

| Item | Antes | Ahora |
|---|---|---|
| Trust proxy | desactivado | `app.set('trust proxy', 1)` |
| Global limit | 200/15min, key=IP | 2000/15min, key por user_id si autenticado, sino IP |
| Login limit | 10/15min, key=IP | 30/15min, key por (email + IP) |
| Health bypass | no | `skip` para `/health` |
| Respuesta 429 | text/plain default | JSON `{ error, code: 'rate_limited', retry_after_seconds }` |
| Headers | sin estándar | `RateLimit-*` draft-7 expuestos |

PR: `hotfix/rate-limit-login`. Commit: `d43c762`.

### Validación

- Tests server: 678/678 verde post-fix.
- Server module carga limpio sin throws.
- Bypass de `/health` confirmado (monitoring no consume cuota).
- Cherry-picked a `develop` el mismo día para evitar regresión cuando se mergee algo nuevo.

### Aprendizajes

1. **Rate limit por IP no funciona con NAT corporativo.** Si la app va a ser usada por una empresa, el bucket por IP penaliza a todos. La granularidad correcta es por `user_id` autenticado, con IP solo como fallback antes del login.

2. **Las respuestas 429 deben ser JSON.** Cualquier endpoint que el cliente consume con `.json()` debe responder JSON consistentemente. Esto se generaliza: errores middleware (helmet, cors, rate-limit) suelen tener defaults plain text que rompen clientes SPA modernos.

3. **`trust proxy` es mandatorio detrás de un load balancer.** Sin esto, `req.ip` miente y cualquier feature basado en IP (rate limit, audit log, geo) está roto silenciosamente. Debería ser parte del checklist inicial del proyecto.

4. **`/health` siempre debe estar exento de rate limit.** Monitoring (Better Stack, UptimeRobot) puede hacer 60+ checks/minuto. Si entra al bucket, agota la cuota antes que cualquier usuario real haga login.

5. **Los límites deben asumir uso normal × factor de seguridad.** 10 usuarios concurrentes × 20 calls/nav × 5 navs = 1000. Con factor 2x = 2000. Subdimensionar para "ahorrar" recursos termina costando más en downtime.

### Acciones derivadas

- [x] **Hotfix** desplegado.
- [x] **Documentar** este incidente.
- [ ] **Backlog**: migrar rate-limiter a backend Redis (`rate-limit-redis`) para que un restart no resetee contadores y para soportar escala horizontal cuando lleguen múltiples instancias.
- [ ] **Backlog**: agregar al onboarding/CONVENTIONS.md una sección sobre middleware patterns: trust proxy, JSON-only responses, health bypass.
- [ ] **Backlog**: monitor pasivo de tasa de 429 — si supera 1% de los requests, alerta al on-call. Hoy no tenemos APM.

### Cómo se podría haber prevenido

- Tests de integración con load simulation (10 usuarios × 100 requests). Habría disparado la alarma en CI.
- Code review más riguroso del PR original que introdujo el limiter — la combinación "IP-only key + low max" es un anti-patrón conocido en setups con NAT.
- Linting: una regla custom que prohíba rate limiters sin `handler` JSON explícito.

---

## Cómo agregar un incidente a este registro

Cuando ocurre algo que afecta usuarios reales (no un bug menor):

1. Crear nuevo card `## INC-NNN — Título corto del síntoma observado`.
2. Severidad: P0 (todo el sistema down) / P1 (módulo crítico down) / P2 (degradación) / P3 (bug visible pero recuperable).
3. Documentar **síntoma observado**, no la solución. La solución vive en el commit/PR.
4. **Causa raíz**: el "por qué" técnico. Si hay 3 cosas combinadas, listarlas todas.
5. **Aprendizajes**: 3-5 bullets accionables. No "tenemos que tener más cuidado" — algo concreto.
6. **Acciones derivadas**: checkboxes con backlog.
7. Cerrar siempre con un comentario sobre prevención (test que faltaba, lint que no atajó, etc.).

> Mantenelo blameless. Hablá del sistema, no de quién hizo el commit. Los incidentes son señales del proceso, no de personas.
