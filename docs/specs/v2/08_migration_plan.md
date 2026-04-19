# 08 — Plan de Migración de V1 a V2

## Contexto

V1 está en producción en `quoter.doublevpartners.com` con data real:
- ~N cotizaciones (capacity + projects) en distintos estados.
- ~M usuarios con rol (superadmin / admin / preventa).
- Parámetros editables (level, geo, bilingual, tools, stack, modality, margin, project).
- Wiki, audit_log.
- **No hay clientes, oportunidades, empleados, contratos, squads, ni time tracking en V1.**

V2 introduce estas entidades. La migración debe:
1. **No perder data.**
2. **No romper las cotizaciones existentes.**
3. **Poblar entidades nuevas con stubs consistentes** para que todo tenga FK válidas.
4. **Permitir re-asignación posterior** (re-linkear cotizaciones a clientes y oportunidades reales).

---

## Estrategia general

Migración en dos fases dentro de un mismo deploy:

**Fase A (automática, DDL + seed):**
1. Añadir tablas nuevas (`clients`, `opportunities`, `employees`, `areas`, `skills`, `contracts`, `resource_requests`, `assignments`, `time_entries`, `events`, `notifications`, `squads`, `employee_skills`, `quotation_allocations`).
2. Alterar tablas existentes (`users`, `quotations`, `parameters`, etc.) con nuevas columnas.
3. Seedear catálogos (áreas, skills, parámetros nuevos).

**Fase B (data migration scripts):**
1. Crear squad default `DVPNYX Global` y asignarlo a todos los users existentes.
2. Crear cliente "Legacy (por clasificar)" y asignarlo como cliente de todas las cotizaciones existentes.
3. Crear una oportunidad "Legacy — {project_name}" por cada cotización y vincularlas.
4. Migrar `quotations.metadata.allocation` → `quotation_allocations` (tabla).
5. Migrar `audit_log` → `events` (best-effort, sin perder información).
6. Setear `users.function` al default apropiado basado en el rol actual.

---

## Precondiciones

- Backup completo de la base de producción (`pg_dump`) antes de cualquier cambio.
- Deploy a staging y verificación manual.
- Ventana de mantenimiento anunciada (estimado 30 min).

---

## Fase A — DDL y seeds (automática)

Los scripts de migración viven en `server/migrations/` y corren en orden. V2 introduce una nueva serie `20260401_*` en adelante:

```
20260401_001_create_squads.sql
20260401_002_create_clients.sql
20260401_003_create_opportunities.sql
20260401_004_create_areas.sql
20260401_005_create_skills.sql
20260401_006_create_employees.sql
20260401_007_create_employee_skills.sql
20260401_008_create_contracts.sql
20260401_009_create_resource_requests.sql
20260401_010_create_assignments.sql
20260401_011_create_time_entries.sql
20260401_012_create_events.sql
20260401_013_create_notifications.sql
20260401_014_create_quotation_allocations.sql
20260401_020_alter_users_add_function_and_squad.sql
20260401_021_alter_quotations_add_client_opportunity_snapshot.sql
20260401_022_alter_parameters_add_time_tracking_and_reports.sql
20260401_030_seed_areas.sql
20260401_031_seed_skills.sql
20260401_032_seed_default_squad.sql
20260401_033_seed_new_parameters.sql
```

Cada script es idempotente (`CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`, etc.).

### Seeds requeridos

**Squad default:**
```sql
INSERT INTO squads (id, name, key, created_at) VALUES
  (gen_random_uuid(), 'DVPNYX Global', 'global', NOW())
ON CONFLICT DO NOTHING;
```

**Áreas (9 seedeadas):**
- Desarrollo (key: `development`)
- Infraestructura (key: `infra`)
- Testing (key: `testing`)
- Product Management (key: `product_mgmt`)
- Project Management (key: `project_mgmt`)
- Data + AI (key: `data_ai`)
- UX / UI (key: `uxui`)
- Análisis Funcional (key: `functional_analysis`)
- DevOps / SRE (key: `devops_sre`)

**Skills seed (~50):**
Categorías (language, framework, cloud, data, ai, tool, methodology, soft):
- Languages: JavaScript, TypeScript, Python, Java, C#, Go, PHP, Ruby, Kotlin, Swift
- Frameworks: React, Angular, Vue, Node.js, Express, NestJS, Spring Boot, .NET, Django, Flask, Rails, Laravel, Next.js
- Cloud: AWS, GCP, Azure, Firebase
- Data: PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch, Kafka, Spark, Snowflake, Airflow, dbt
- AI: TensorFlow, PyTorch, LangChain, OpenAI, Hugging Face, Anthropic
- Tools: Git, Docker, Kubernetes, Terraform, Jenkins, GitLab CI, GitHub Actions
- Methodology: Scrum, Kanban, SAFe, Design Thinking, DevOps
- Soft: Inglés, Liderazgo, Comunicación cliente, Mentoría

**Parámetros nuevos** (categorías time_tracking, reports):

| Category | Key | Default |
|---|---|---|
| time_tracking | backfill_window_days | 30 |
| time_tracking | edit_window_days | 30 |
| time_tracking | max_daily_hours | 16 |
| time_tracking | min_weekly_hours_reminder | 32 |
| time_tracking | default_entry_category | delivery |
| reports | bench_threshold_pct | 60 |
| reports | overbooking_threshold_pct | 100 |
| reports | hiring_needs_window_days | 90 |
| reports | materialized_view_refresh_minutes | 15 |
| reports | default_report_period_days | 30 |

---

## Fase B — Data migration (script runnable)

Un único script `server/scripts/migrate_v2_data.js` corre idempotente. Se ejecuta una vez post-DDL.

### Paso 1 — Default squad a usuarios

```sql
UPDATE users
SET squad_id = (SELECT id FROM squads WHERE key='global')
WHERE squad_id IS NULL;
```

### Paso 2 — Setear función default por rol

```sql
UPDATE users SET function = 'admin' WHERE role='superadmin' AND function IS NULL;
UPDATE users SET function = 'admin' WHERE role='admin' AND function IS NULL;
UPDATE users SET function = 'preventa' WHERE role='preventa' AND function IS NULL;
```

Daniel luego puede editar funciones individualmente post-migración.

### Paso 3 — Cliente legacy

```sql
INSERT INTO clients (id, name, country, tier, created_at)
VALUES (gen_random_uuid(), 'Legacy (por clasificar)', 'Colombia', 'SMB', NOW())
ON CONFLICT DO NOTHING
RETURNING id;
-- Guardar id en variable para el siguiente paso
```

### Paso 4 — Oportunidad por cada cotización

Para cada `quotation` en `quotations`:

```sql
-- Pseudocódigo: loop por quotations
FOR q IN SELECT * FROM quotations WHERE deleted_at IS NULL LOOP
  INSERT INTO opportunities (id, client_id, name, status, account_owner_id, squad_id, created_at)
  VALUES (
    gen_random_uuid(),
    legacy_client_id,
    'Legacy — ' || q.project_name,
    CASE q.status
      WHEN 'draft' THEN 'open'
      WHEN 'sent' THEN 'proposal'
      WHEN 'approved' THEN 'won'
      WHEN 'rejected' THEN 'lost'
      WHEN 'expired' THEN 'cancelled'
      ELSE 'open'
    END,
    q.created_by,
    (SELECT id FROM squads WHERE key='global'),
    q.created_at
  )
  RETURNING id INTO new_opp_id;
  
  UPDATE quotations SET client_id=legacy_client_id, opportunity_id=new_opp_id WHERE id=q.id;

  IF q.status = 'approved' THEN
    UPDATE opportunities SET winning_quotation_id=q.id, outcome='won', closed_at=q.updated_at WHERE id=new_opp_id;
  END IF;
END LOOP;
```

### Paso 5 — Allocation de JSONB a tabla

```sql
FOR q IN SELECT id, metadata FROM quotations WHERE metadata ? 'allocation' LOOP
  FOR line_idx, phase_map IN metadata->'allocation' LOOP
    FOR phase_id, hours IN phase_map LOOP
      IF hours > 0 THEN
        INSERT INTO quotation_allocations (id, quotation_id, line_index, phase_id, hours)
        VALUES (gen_random_uuid(), q.id, line_idx::int, phase_id, hours)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END LOOP;
```

(Implementación real en JS con pg client; SQL puro es complicado para JSON iteration.)

### Paso 6 — Migrar audit_log → events (best effort)

```sql
INSERT INTO events (id, entity_type, entity_id, event_type, actor_user_id, payload, created_at)
SELECT
  gen_random_uuid(),
  COALESCE(entity, 'unknown'),
  entity_id,
  action,
  user_id,
  jsonb_build_object('migrated_from_audit_log', true, 'original', to_jsonb(a)),
  created_at
FROM audit_log a
ON CONFLICT DO NOTHING;
```

`audit_log` se conserva en la BD (no se elimina) como referencia histórica.

### Paso 7 — Snapshot retroactivo de parámetros (opcional)

Para cotizaciones ya en estado `sent` o `approved` sin snapshot:

```js
for each quotation with status IN ('sent','approved') AND parameters_snapshot IS NULL:
  snapshot = capture_current_parameters()
  update quotation set parameters_snapshot = snapshot
```

Nota: esto snapshotea con los parámetros **actuales** (post-migración), no con los históricos reales. Dejar nota en evento:
```js
insert event { event_type: 'quotation.snapshot_migrated', payload: { note: 'Snapshot capturado retroactivamente con parámetros vigentes al migrar' } }
```

**Alternativa:** no snapshotear retroactivamente y dejar que la próxima edición dispare el snapshot. Decisión de Daniel.

---

## Verificación post-migración

Checks automáticos en script de migración que el script loguea y falla si no pasan:

1. `SELECT COUNT(*) FROM quotations WHERE client_id IS NULL;` → 0
2. `SELECT COUNT(*) FROM quotations WHERE opportunity_id IS NULL;` → 0
3. `SELECT COUNT(*) FROM users WHERE squad_id IS NULL;` → 0
4. `SELECT COUNT(*) FROM opportunities WHERE client_id IS NULL;` → 0
5. `SELECT COUNT(*) FROM quotations WHERE status='approved' AND opportunity_id IN (SELECT id FROM opportunities WHERE winning_quotation_id IS NULL);` → 0 (toda cotización aprobada tiene su opp con winning_quotation)
6. `SELECT EXISTS (SELECT 1 FROM areas);` → true (catálogo seedeado)
7. `SELECT EXISTS (SELECT 1 FROM skills);` → true
8. `SELECT EXISTS (SELECT 1 FROM squads WHERE key='global');` → true

---

## Plan de rollback

Si la migración falla a mitad de camino:

1. Detener el despliegue nuevo.
2. `docker compose` apunta a imagen anterior (V1).
3. Restaurar BD desde `pg_dump` previo:
   ```bash
   psql -h localhost -U dvpnyx dvpnyx < backup_pre_v2.sql
   ```
4. Reiniciar V1. Verificar.
5. Investigar error de migración en staging, corregir script, repetir.

---

## Deployment flow recomendado

```
1. Notificar a usuarios (email, 24h antes): ventana de 30 min
2. 00:00 — Backup: pg_dump → S3 (o volumen local + SCP a máquina aparte)
3. 00:05 — docker compose pull (imagen V2)
4. 00:10 — Levantar contenedor efímero de migration:
   docker compose run --rm server npm run migrate
5. 00:20 — Si migration OK: docker compose up -d
6. 00:25 — Verificación: /api/health + smoke test UI
7. 00:30 — Listo. Enviar confirmación.
```

Si el paso 4 falla:
```
docker compose run --rm server npm run migrate:rollback (si existe)
# o
psql < backup_pre_v2.sql
docker compose up -d  # con imagen V1
```

---

## Post-migración (trabajo manual opcional)

Post-V2 deploy, Daniel puede:
1. Crear clientes reales y re-asignar cotizaciones de "Legacy (por clasificar)" al cliente correcto.
2. Dividir oportunidades legacy si varias cotizaciones pertenecían a la misma oportunidad real.
3. Completar perfiles de empleados (importar CSV desde Excel actual via `/api/employees/bulk-import`).
4. Crear squads específicos (LATAM Nearshore, Enterprise USA, etc.) y mover usuarios.
5. Actualizar función de cada usuario según realidad operativa.
6. Crear contratos activos (desde oportunidades ganadas legacy).

---

## Archivos afectados

Backend:
- `server/migrations/20260401_*.sql` (nuevos)
- `server/scripts/migrate_v2_data.js` (nuevo)
- `server/scripts/validate_v2_migration.js` (nuevo, corre checks post-migración)
- `server/package.json`: nuevos scripts `migrate:v2`, `validate:v2`

Docs:
- `10_operations_runbook.md` (si se crea) con pasos exactos de migración.
- `CHANGELOG.md` con entrada V2.0.0.

---

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Migración JSONB → allocation falla en un dataset raro | Media | Test exhaustivo en staging con copia de prod; script tolerante con logs detallados |
| Snapshot retroactivo crea inconsistencia con números históricos | Baja | Documentar en evento; permitir no snapshotear |
| `ON CONFLICT` silenciosamente omite registros esperados | Baja | Validación post-migración verifica counts |
| Wiki legacy no existe o tiene formato custom | Baja | No se toca en V2; se mantiene |
| Audit_log → events deja eventos con `event_type` libre | Media | Validar en reportes que V2 sabe manejar event_types desconocidos (solo show raw) |

---

## Tiempo estimado

- Redacción de scripts: 1–2 días (Claude Code).
- Test en staging: 1 día.
- Migración en producción: 30 min ventana.
- Verificación post-deploy: 1 hora.
- Ajustes manuales post-deploy: 1–2 semanas background.
