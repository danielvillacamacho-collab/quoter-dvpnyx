# Runbooks — índice

Guías operativas para situaciones específicas. Si te enfrentás a una de estas, empezá por el runbook correspondiente.

---

## Runbooks disponibles

| # | Runbook | Cuándo usarlo |
|---|---|---|
| 1 | [`runbooks/DEPLOY.md`](runbooks/DEPLOY.md) | Para hacer un deploy nuevo a dev o prod |
| 2 | [`runbooks/ROLLBACK.md`](runbooks/ROLLBACK.md) | Cuando un deploy reciente está roto y hay que volver atrás |
| 3 | [`runbooks/DR.md`](runbooks/DR.md) | Disaster Recovery: DB perdida, EC2 caída, restaurar de backup |
| 4 | [`runbooks/BULK_IMPORT.md`](runbooks/BULK_IMPORT.md) | Para hacer un bulk import grande de clientes/empleados/etc. |
| 5 | [`runbooks/V2_MIGRATION.md`](runbooks/V2_MIGRATION.md) | Histórico — cómo se migró el schema V1→V2. Útil para entender data migration patterns |

---

## Situaciones comunes

### "El deploy a dev no funciona"
1. `docs/runbooks/DEPLOY.md` — verificar que el pipeline corrió.
2. Si la DB cambió, chequear que `migrate.js` corrió en el contenedor (idempotente, no debería romper).
3. Si pgvector falló, ver log del migrate — debería ser warning, no error.

### "Queda colgado en producción"
1. `docs/runbooks/ROLLBACK.md` — backup activado en cada deploy.
2. `GET /api/health` debe devolver `{ ok, db: 'up' }`. Si `db: 'down'`, no es problema del API.

### "Hay que restaurar la DB"
1. `docs/runbooks/DR.md` — pg_dump nightly a S3.
2. Verificar que el último backup es < 24h.
3. Después de restaurar: re-correr `migrate.js` para que cualquier ALTER reciente quede aplicado.

### "Quiero meter 200 empleados desde Excel"
1. `docs/runbooks/BULK_IMPORT.md` — endpoint admin con dry-run + commit.
2. Bajar template: `GET /api/bulk-import/templates/employees`.
3. Subir CSV con `?action=preview` primero. Validar resultado. Después `commit`.

### "Necesito poblar embeddings (AI)"
1. **No existe job nocturno todavía.** Ver [`AI_INTEGRATION_GUIDE.md §6`](AI_INTEGRATION_GUIDE.md#6-embeddings-con-pgvector) para script.
2. Verificar que pgvector está activo: `SELECT * FROM pg_extension WHERE extname = 'vector';`
3. Cuando se cree el job, agregarlo como `runbooks/REFRESH_EMBEDDINGS.md`.

### "Refrescar `delivery_facts`"
1. **No hay cron job todavía.** Ejecutar manualmente:
   ```sql
   SELECT refresh_delivery_facts(CURRENT_DATE - 30, CURRENT_DATE);
   ```
2. Para producción, configurar como cron job nocturno (pendiente).

---

## Cómo agregar un runbook nuevo

1. Crear `docs/runbooks/NOMBRE.md`.
2. Estructura sugerida:
   - **Contexto**: qué situación dispara este runbook
   - **Pre-requisitos**: acceso, herramientas, info necesaria
   - **Pasos**: numerados, exactos, con comandos copy-pasteables
   - **Verificación**: cómo saber que funcionó
   - **Si algo sale mal**: qué hacer si falla en el paso N
3. Linkear desde este índice.
4. Si el runbook reemplaza un proceso ad-hoc, documentar la decisión en [`DECISIONS.md`](DECISIONS.md).

---

*Si seguís un runbook y los pasos no aplican (algo cambió en infra o en código), actualizá el runbook en el mismo PR donde corregis el problema. La regla #1 de runbooks: si no son precisos, no sirven.*
