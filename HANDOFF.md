# Entrega — DVPNYX Quoter + Capacity Planner

**Para:** equipo de ingeniería y producto que toma el proyecto.
**Fecha de snapshot:** 2026-05.
**Rama base:** `develop` (al día con `main`).
**Repo:** `git@github.com:danielvillacamacho-collab/quoter-dvpnyx.git`

Este es el **punto de entrada técnico**. Para la **carta de aterrizaje** del día 1 (decisiones abiertas, recomendaciones, "no tocar", día 1-7-30) leer primero [`STATE_OF_THE_UNION.md`](STATE_OF_THE_UNION.md) en raíz. Después seguís acá para la guía técnica. Todo lo demás está linkeado desde aquí.

---

## 1. ¿Qué es esto?

SaaS interno de **DVP (Double V Partners)** que integra en un solo producto el ciclo **quote → contract → staff → time tracking** (la facturación queda en Holded; ver §5):

- **Comercial**: clientes → oportunidades → cotizaciones (staff augmentation y proyecto de alcance fijo).
- **Delivery**: contratos → solicitudes de recursos → asignaciones → time tracking.
- **Plan-vs-Real**: comparación semanal de horas planeadas vs % real registrado.
- **Personas**: áreas, skills, empleados (con proficiency y manager_user_id).
- **Finanzas**: revenue mensual + tasas de cambio multi-currency.
- **Reportes**: pipeline, utilización, gap, dashboards personales y ejecutivo.
- **AI-readiness**: capa lista para integrar agentes (log, prompts versionados, embeddings).

Producción: **`quoter.doublevpartners.com`** · Dev: **`dev.quoter.doublevpartners.com`**.

---

## 2. Arranque rápido (5 minutos)

```bash
# Levantar todo local (DB + API + cliente) con datos demo
docker compose -f docker-compose.dev.yml up --build

# → cliente: http://localhost:3000
# → API:     http://localhost:4000
# → DB:      127.0.0.1:55432  (user/pass: postgres/postgres, db: dvpnyx)
```

Usuarios seed (`server/database/seed.js`):
- `admin@dvpnyx.com` / `admin123` — superadmin
- `user@dvpnyx.com`  / `user123`  — member

Pasos detallados, variables de entorno y troubleshooting: [`docs/ONBOARDING_DEV.md`](docs/ONBOARDING_DEV.md).

---

## 3. Lectura obligatoria (por orden)

| # | Documento | Qué contiene | Tiempo |
|---|---|---|---|
| 1 | Este archivo | Overview + orden de lectura | 15 min |
| 2 | [`docs/PROJECT_STATE_HANDOFF.md`](docs/PROJECT_STATE_HANDOFF.md) | **Fuente de verdad del estado actual**: módulos vivos, deudas, preguntas abiertas | 25 min |
| 3 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Diagramas, flujos, capa AI-readiness, convenciones | 20 min |
| 4 | [`docs/MODULES_OVERVIEW.md`](docs/MODULES_OVERVIEW.md) | Mapa módulo por módulo (qué hace, dónde vive) | 20 min |
| 5 | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | Patrones de código (server + client) | 15 min |
| 6 | [`docs/specs/v2/03_data_model.md`](docs/specs/v2/03_data_model.md) | Schema completo (28 tablas) | referencia |
| 7 | [`docs/MANUAL_DE_USUARIO.md`](docs/MANUAL_DE_USUARIO.md) | Vista funcional end-to-end | 30 min |
| 8 | [`docs/AI_INTEGRATION_GUIDE.md`](docs/AI_INTEGRATION_GUIDE.md) | Cómo conectar agentes IA — leer antes de tocar IA | 25 min |
| 9 | [`docs/ROADMAP.md`](docs/ROADMAP.md) | Qué está vivo, qué falta, qué se difiere | 15 min |
| 10 | [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisiones técnicas (ADR-style) | referencia |
| 11 | [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branching, commits, PRs, tests | 10 min |
| 12 | [`CHANGELOG.md`](CHANGELOG.md) | Historial por fases | referencia |
| 13 | [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | Catálogo de ~85 endpoints | referencia |
| 14 | [`SECURITY.md`](SECURITY.md) | Modelo de amenazas, secretos | 10 min |

Documentación complementaria (on demand):
- [`docs/RUNBOOKS_INDEX.md`](docs/RUNBOOKS_INDEX.md) — deploy, rollback, DR, bulk import, V2 migration.
- [`docs/specs/v2/`](docs/specs/v2/) — specs originales (pueden estar desfasadas; código gana).

---

## 4. Estado del sistema en 60 segundos

✅ **En producción, con tests (638), estable:**

- Comercial: clients, opportunities (Kanban con probability auto), quotations (staff_aug + fixed_scope).
- Conversión `quotation → contract` de un click.
- **Kick-off del contrato**: lee winning_quotation, crea resource_requests automáticos.
- Delivery: contracts, resource_requests, assignments con validation engine (overbooking, área, level, overlap).
- Capacity Planner timeline + asignación in-place desde modal de candidatos.
- Time tracking: `/time/me` (daily) + `/time/team` (% semanal con bench).
- **Plan-vs-Real semanal** con auto-scoping por rol (lead, member, admin).
- Reportes: utilization, bench, coverage, time-compliance, hiring-needs, plan-vs-real, my-dashboard.
- Roles + permisos: superadmin/admin/lead/member/viewer. `lead` ve sus reportes directos vía `manager_user_id`.
- Bulk import CSV con dry-run. Command Palette Cmd-K. Notifications drawer.
- Design system OKLCH con dark mode + 6 presets de acento.
- **AI-readiness layer (mayo 2026)**: `ai_interactions` log, prompt templates versionados, embeddings vector(1536) con HNSW (si pgvector activo), helpers `ai_logger`/`json_schema`/`level`/`slug`/`sanitize`, materialized view `mv_plan_vs_real_weekly`.

⚠️ **Con caveat (live pero limitado):**

- **Squads ocultos** del UI; auto-provisión "DVPNYX Global". Decisión pendiente.
- **Quotation editor dual**: Unified vs no-Unified coexisten.
- **Time tracking duplicado**: `time_entries` (daily) + `weekly_time_allocations` (weekly). Decisión consolidación pendiente.
- **Approvals aspirational** en `assignments` y `time_entries`: schemas existen, flow no.
- **Revenue periods sin trigger de inmutabilidad** (placeholder explícito, ver SPEC-RR-00).
- **pgvector best-effort**: si la imagen postgres no lo tiene, embeddings no se crean.

❌ **No existe todavía** (siguiente iteración):

- Billing / facturación / integración contable.
- Aprobación formal de assignments y time entries.
- Forecasting de capacidad.
- Calendario de vacaciones integrado con utilización.
- Integración CRM externa.
- Multi-tenant.
- Observabilidad real (Datadog/Sentry).
- Job nocturno populando embeddings.
- Cron job `refresh_delivery_facts` automático.

Detalle completo: [`docs/ROADMAP.md`](docs/ROADMAP.md) y [`docs/PROJECT_STATE_HANDOFF.md §8`](docs/PROJECT_STATE_HANDOFF.md).

---

## 5. Salud del código al momento de la entrega

| Métrica | Valor |
|---|---|
| Tests backend | **638 / 638** (Jest + supertest, 36 suites) |
| Tests frontend | 325 / 327 (2 TimeMe pre-existentes, no bloqueantes) |
| Build de producción cliente | Limpio, sin warnings |
| Secretos en repo | 0 (verificado) |
| TODOs / FIXMEs huérfanos | 0 |
| CI pipelines | 6 workflows activos |
| Versiones soportadas | Node ≥ 20, Postgres 16 |

Verifícalo:
```bash
cd server && ./node_modules/.bin/jest          # 638 ✅
cd client && CI=true node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false
cd client && CI=true node node_modules/react-scripts/bin/react-scripts.js build
```

---

## 6. Las 7 decisiones que más te ahorrarán tiempo

1. **El código gana a la spec.** Las specs en `docs/specs/v2/` fueron escritas antes del build y en varios puntos están desfasadas. Cuando haya conflicto, confía en el código + `PROJECT_STATE_HANDOFF.md`. Las decisiones formales viven en [`docs/DECISIONS.md`](docs/DECISIONS.md).

2. **`squad_id` sigue NOT NULL** en `contracts` y `opportunities`, pero squads están ocultos del UI. Backend auto-provisiona "DVPNYX Global". Ver [`DECISIONS.md :: SQUAD-HIDDEN`](docs/DECISIONS.md#squad-hidden).

3. **Modelo de cotizaciones dual-write**: legacy V1 + V2 relacional coexisten. Ambos editores (Unified vs no-Unified) viven en el código. Ver [`DECISIONS.md :: QUOTATION-DUAL`](docs/DECISIONS.md#quotation-dual).

4. **Time tracking duplicado**: dos modelos paralelos (`time_entries` daily + `weekly_time_allocations` weekly). Decisión de producto pendiente. Ver [`DECISIONS.md :: TIME-MODEL`](docs/DECISIONS.md#time-model).

5. **Estilos siempre con tokens DS**: nada hardcodeado fuera de `client/src/theme.css` (`--ds-*`). Ver [`CONVENTIONS.md §9`](docs/CONVENTIONS.md#9-client-estilos--design-system).

6. **Helpers obligatorios** en server: `parsePagination`, `serverError`, `safeRollback`, `emitEvent`, `ai_logger.run`. Cualquier ruta nueva los debe usar. Ver [`CONVENTIONS.md §3`](docs/CONVENTIONS.md#3-server-utilidades-obligatorias).

7. **Antes de conectar IA**: leer [`AI_INTEGRATION_GUIDE.md`](docs/AI_INTEGRATION_GUIDE.md) completo. Toda llamada a un agente debe pasar por `utils/ai_logger.run()` — sin excepciones.

---

## 7. Layout del repo en 30 segundos

```
dvpnyx-quoter/
├── HANDOFF.md                ← estás aquí
├── README.md                 ← entry point + índice de docs
├── ARCHITECTURE.md           ← diagramas + flujos + capa AI
├── CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, LICENSE
├── client/                   ← React 18 SPA
│   └── src/{App,AuthContext}.js, theme.css, modules/, shell/, utils/
├── server/                   ← Express + pg
│   ├── index.js, middleware/auth.js
│   ├── database/{migrate,pool,seed}.js
│   ├── routes/*.js           ← una por entidad
│   └── utils/                ← helpers compartidos (sanitize, http, events,
│                                ai_logger, json_schema, level, slug, calc, …)
├── docs/
│   ├── PROJECT_STATE_HANDOFF.md     ← estado actual
│   ├── MANUAL_DE_USUARIO.md         ← funcional
│   ├── ONBOARDING_DEV.md
│   ├── CONVENTIONS.md, MODULES_OVERVIEW.md
│   ├── API_REFERENCE.md, AI_INTEGRATION_GUIDE.md
│   ├── ROADMAP.md, DECISIONS.md, RUNBOOKS_INDEX.md
│   ├── runbooks/             ← DEPLOY / DR / ROLLBACK / BULK / V2_MIGRATION
│   └── specs/v2/             ← specs originales (código gana)
├── infra/                    ← AWS CDK (TS) — stack alterno, inactivo
├── .github/workflows/        ← 6 pipelines
├── Dockerfile
├── docker-compose.yml        ← prod-like
└── docker-compose.dev.yml    ← dev local
```

---

## 8. Primer día del equipo entrante — checklist

- [ ] Clonar el repo y levantar `docker-compose.dev.yml`. Verificar que todas las pantallas cargan con la seed.
- [ ] Leer este archivo + `PROJECT_STATE_HANDOFF.md` + `ARCHITECTURE.md` + `CONVENTIONS.md`.
- [ ] Correr ambas suites de tests y confirmar 638 server + 325 client (las 2 fallas TimeMe son pre-existentes).
- [ ] Hacer un PR trivial (typo en algún comentario) contra `develop` para probar el pipeline de CI.
- [ ] Abrir la app con credenciales seed y recorrer 4 flujos happy path:
  1. **Quote**: crear cliente → oportunidad → cotización staff_aug → revisar resumen.
  2. **Quote→Contract**: marcar opp como `won` → confirmar "crear contrato" → `kick-off` con fecha → ver resource_requests auto-creadas.
  3. **Stafffing**: desde el planner, click en barra "Sin asignar" → modal de candidatos → asignar.
  4. **Plan vs Real**: registrar % en `/time/team` → ver reporte `/reports/plan-vs-real`.
- [ ] Revisar [`docs/DECISIONS.md`](docs/DECISIONS.md) para entender el "por qué" detrás de los caveats.
- [ ] Conversar las preguntas abiertas en `PROJECT_STATE_HANDOFF.md §10` con Daniel antes de planear sprint 1.

---

## 9. Cambios recientes que necesitas saber (2026-04 → 2026-05)

Los últimos 7 PRs introdujeron features y deuda saneada importantes. Detalle en [`CHANGELOG.md`](CHANGELOG.md). Highlights:

1. **Capacity Planner asignación in-place** — ya no te saca a otra pantalla.
2. **Plan-vs-Real semanal** (`/reports/plan-vs-real`) con auto-scoping por rol.
3. **Conversión quotation→contract de un click** + **kick-off del contrato** que crea resource_requests desde la cotización.
4. **Manager / lead role** con visibilidad de equipo directo.
5. **Cleanup técnico** masivo: paginación parameterizada, `serverError()` en 40+ endpoints, `safeRollback`, helpers `sanitize`/`http`.
6. **Capa AI-readiness**: `ai_interactions`, `ai_prompt_templates`, `delivery_facts`, embeddings pgvector, materialized view `mv_plan_vs_real_weekly`, helpers `ai_logger`/`json_schema`/`slug`/`level`.
7. **Documentación refrescada** (este documento + 11 archivos más en `docs/`).

Ver [`docs/ROADMAP.md`](docs/ROADMAP.md) para el estado completo.

---

## 10. Contactos

| Rol | Persona | Contacto |
|---|---|---|
| Product Owner / origen | Daniel Villa Camacho | GitHub `@danielvillacamacho-collab` |
| Infra / AWS | TBD | TBD |
| On-call | TBD | Definir al arrancar |

Si algo no está documentado: preferir **preguntar en el primer sprint** que asumir. La documentación en `/docs` cubre ~95% del estado real, pero hay decisiones que sólo viven en la cabeza del PO.

---

*Este documento es la primera cosa que debe actualizar el equipo entrante cuando cambie una convención crítica (branching, owners, agregue/elimine docs). Si se queda desactualizado pierde su valor.*
