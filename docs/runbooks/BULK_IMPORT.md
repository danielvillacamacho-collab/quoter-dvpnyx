# Runbook: Carga masiva (Bulk Import)

> **Ruta UI:** `/admin/bulk-import` (sólo admin+)
> **API:** `POST /api/bulk-import/:entity/{preview|commit}` + `GET /api/bulk-import/templates/:entity`

## Entidades soportadas

| Entidad             | Clave en URL          | Usado para                                             |
|---------------------|-----------------------|--------------------------------------------------------|
| Catálogo de Áreas   | `areas`               | Alta/actualización masiva de áreas (upsert por `key`). |
| Catálogo de Skills  | `skills`              | Alta/actualización masiva de skills (upsert por `name`).|
| Clientes            | `clients`             | Alta de clientes con tier, país, moneda, notas.        |
| Empleados           | `employees`           | Onboarding masivo desde el Excel de Gente.             |
| Empleado ↔ Skill    | `employee-skills`     | Vincular empleados (por email) con skills + proficiency.|

## Flujo

1. Admin entra a **Configuración → Carga masiva** en el sidebar.
2. Elige la entidad. La UI muestra un botón **Descargar plantilla** con un CSV de ejemplo.
3. Arrastra/selecciona el CSV. La UI lo parsea localmente y llama `POST /preview` (dry-run).
4. La tabla de revisión muestra cada fila como `preview` o `error`. Si todas las filas son inválidas se destaca con warning.
5. Al dar **Confirmar carga** se llama `POST /commit` — todo dentro de una misma transacción en Postgres.
6. El paso 4 muestra el reporte final: creadas / actualizadas / omitidas / con error.

## Reglas de seguridad

- Ambos endpoints requieren **admin o superadmin**. El `auth` middleware + `adminOnly` lo validan.
- Todo `commit` corre en una única transacción (`BEGIN ... COMMIT`) — si algo explota, no se aplica nada.
- Cada fila exitosa emite un evento estructurado (`client.created`, `employee.created`, etc.) con `payload.source = 'bulk_import'` para poder auditar desde `/api/events` después.
- Límite: **5000 filas por request** (413 en payloads mayores).

## Columnas esperadas por entidad

### `areas`
```
key,name,description,sort_order,active
```
- `key`: slug único, se normaliza a lowercase_con_underscores.
- `sort_order`: entero, default 0.
- `active`: `true|false|1|0|si|no` — default `true`.

### `skills`
```
name,category,description,active
```
- `category` (opcional): `language|framework|cloud|data|ai|tool|methodology|soft`.
- Upsert por `LOWER(name)`.

### `clients`
```
name,legal_name,country,industry,tier,preferred_currency,notes,active
```
- `tier`: `enterprise|mid_market|smb` (opcional).
- `preferred_currency`: ISO (default `USD`).

### `employees`
```
first_name,last_name,corporate_email,personal_email,country,city,
area_key,level,seniority_label,employment_type,weekly_capacity_hours,
start_date,end_date,status,squad_name,notes
```
- `area_key` debe existir en el catálogo de áreas (se resuelve a `area_id`).
- `squad_name` opcional; si se pasa debe existir.
- `level`: `L1`..`L11` (acepta `5` → se normaliza a `L5`).
- `employment_type`: `fulltime|parttime|contractor` (default `fulltime`).
- `status`: `active|on_leave|bench|terminated` (default `active`).
- `weekly_capacity_hours`: 1–80 (default 40).
- **Duplicados:** si `corporate_email` ya existe el registro se omite (`skipped`). Sin email, se detecta duplicado por `first_name + last_name + country`.

### `employee-skills`
```
corporate_email,skill_name,proficiency,years_experience,notes
```
- `corporate_email` debe corresponder a un empleado existente.
- `skill_name` debe existir en el catálogo.
- `proficiency`: `beginner|intermediate|advanced|expert` (default `intermediate`).
- Idempotente: vuelve a correr y actualiza proficiency / años.

## Errores comunes

| Mensaje                                         | Causa                                                  |
|-------------------------------------------------|--------------------------------------------------------|
| `Área "xxx" no existe en el catálogo`           | Falta crear el área antes o hay typo en `area_key`.    |
| `Squad "xxx" no existe`                         | Falta crear el squad antes (o dejar la columna vacía). |
| `Skill "xxx" no existe en el catálogo`          | Primero carga `skills`, luego `employee-skills`.       |
| `Empleado con email "xxx@…" no encontrado`      | Primero carga `employees`, luego `employee-skills`.    |
| `Tier inválido`                                 | Usa `enterprise`, `mid_market`, `smb` o dejá vacío.    |

## Estrategia recomendada para un onboarding completo

1. Descargar plantilla `areas` → cargar las áreas propias (si faltan).
2. Descargar plantilla `skills` → cargar los skills relevantes.
3. Descargar plantilla `clients` → cargar los clientes.
4. Descargar plantilla `employees` → cargar los empleados (requiere áreas ya creadas).
5. Descargar plantilla `employee-skills` → asignar skills (requiere empleados + skills).

Cada paso es idempotente: puedes volver a correr el mismo CSV sin duplicar nada.
