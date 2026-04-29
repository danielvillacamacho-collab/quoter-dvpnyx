-- ============================================================
-- PRE-FLIGHT CHECK — Release develop → main (Abril 2026)
-- ============================================================
-- Correr ANTES del deploy a prod. Verifica que los datos existentes
-- no violan las nuevas CHECK constraints que se agregan en el migrate.
--
-- Si CUALQUIER query devuelve > 0 rows, hay un fix de datos pendiente
-- ANTES del deploy. Las constraints son ADD CONSTRAINT plain (no
-- NOT VALID), por lo que el migrate ABORTARÁ si hay violaciones.
--
-- Uso:
--   psql $DATABASE_URL -f server/database/preflight_check.sql
--
-- Exit:
--   Si todo está OK, salida final dice "✓ All preflight checks passed".
-- ============================================================

\echo ''
\echo '=== Pre-flight check: develop → main ==='
\echo ''

-- 1) employees.weekly_capacity_hours debe estar 0..80
\echo '[1/9] employees.weekly_capacity_hours fuera de [0..80]:'
SELECT id, first_name, last_name, weekly_capacity_hours
  FROM employees
 WHERE weekly_capacity_hours < 0 OR weekly_capacity_hours > 80;

-- 2) quotation_lines.hours_per_week debe estar 0..168 (o NULL)
\echo '[2/9] quotation_lines.hours_per_week fuera de [0..168]:'
SELECT id, quotation_id, role_title, hours_per_week
  FROM quotation_lines
 WHERE hours_per_week IS NOT NULL
   AND (hours_per_week < 0 OR hours_per_week > 168);

-- 3) quotation_lines.duration_months debe estar 0..120
\echo '[3/9] quotation_lines.duration_months fuera de [0..120]:'
SELECT id, quotation_id, role_title, duration_months
  FROM quotation_lines
 WHERE duration_months IS NOT NULL
   AND (duration_months < 0 OR duration_months > 120);

-- 4) quotation_lines.quantity debe ser >= 1
\echo '[4/9] quotation_lines.quantity < 1:'
SELECT id, quotation_id, role_title, quantity
  FROM quotation_lines
 WHERE quantity IS NOT NULL AND quantity < 1;

-- 5) resource_requests.quantity debe ser >= 1
\echo '[5/9] resource_requests.quantity < 1:'
SELECT id, contract_id, role_title, quantity
  FROM resource_requests
 WHERE quantity < 1
   AND deleted_at IS NULL;

-- 6) resource_requests.weekly_hours debe estar (0..80]
\echo '[6/9] resource_requests.weekly_hours fuera de (0..80]:'
SELECT id, contract_id, role_title, weekly_hours
  FROM resource_requests
 WHERE (weekly_hours <= 0 OR weekly_hours > 80)
   AND deleted_at IS NULL;

-- 7) assignments date order: end >= start
\echo '[7/9] assignments con end_date < start_date:'
SELECT id, employee_id, contract_id, start_date, end_date
  FROM assignments
 WHERE end_date IS NOT NULL
   AND end_date < start_date
   AND deleted_at IS NULL;

-- 8) contracts date order: end >= start
\echo '[8/9] contracts con end_date < start_date:'
SELECT id, name, start_date, end_date
  FROM contracts
 WHERE end_date IS NOT NULL
   AND end_date < start_date
   AND deleted_at IS NULL;

-- 9) resource_requests date order: end >= start
\echo '[9/9] resource_requests con end_date < start_date:'
SELECT id, contract_id, role_title, start_date, end_date
  FROM resource_requests
 WHERE end_date IS NOT NULL
   AND end_date < start_date
   AND deleted_at IS NULL;

\echo ''
\echo '=== Bonus: integridad de datos para nuevos features ==='
\echo ''

-- A) Contratos legacy sin subtype (informativo, no bloquea)
\echo '[INFO] Contratos capacity/project sin contract_subtype (van a aparecer "Sin especificar"):'
SELECT type, status, COUNT(*) AS contratos
  FROM contracts
 WHERE deleted_at IS NULL
   AND type IN ('capacity', 'project')
   AND contract_subtype IS NULL
 GROUP BY type, status
 ORDER BY type, status;

-- B) Contratos con metadata corrupta (informativo)
\echo '[INFO] Contracts.metadata que no es JSON object válido (debería ser raro):'
SELECT id, name, metadata
  FROM contracts
 WHERE deleted_at IS NULL
   AND metadata IS NOT NULL
   AND jsonb_typeof(metadata) <> 'object'
 LIMIT 5;

\echo ''
\echo '=== FIN del preflight ==='
\echo ''
\echo 'Si TODAS las queries [1..9] devolvieron 0 rows: ✓ migración segura.'
\echo 'Si alguna devolvió >0: corregir datos en prod ANTES del deploy.'
\echo 'Las queries [INFO] son sólo informativas, no bloquean.'
\echo ''
