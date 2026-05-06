# 02 — Glosario, Roles, Funciones y Squads

## Glosario

| Término | Definición |
|---|---|
| **Cliente** | Empresa a la que DVPNYX le presta servicios. Entidad de primera clase. |
| **Oportunidad** | Intento de venta a un cliente específico. Puede tener varias cotizaciones. Tiene outcome. |
| **Cotización** | Versión de pricing/scope dentro de una oportunidad. Una oportunidad ganada tiene una cotización marcada como ganadora. |
| **Contrato** | Unidad de entrega activa. Nace de una oportunidad ganada o se crea manualmente. Aglutina solicitudes de recursos. |
| **Solicitud de Recurso** (Resource Request) | Necesidad de un perfil dentro de un contrato: nivel, área, país, idioma, horas/semana, fechas. Puede estar pendiente, parcialmente cubierta o cubierta. |
| **Empleado** | Persona que trabaja en DVPNYX. Tiene perfil, área, nivel, skills, capacidad semanal. |
| **Asignación** | Vínculo entre un Empleado y una Solicitud de Recurso, con dedicación semanal y rango de fechas. |
| **Time Entry** | Registro de horas trabajadas por un empleado en una asignación, en una fecha específica. |
| **Squad** | Agrupación de usuarios por línea de negocio o región. En V2 simple: un usuario pertenece a un squad. |
| **Bench** | Empleado activo sin asignaciones que cubran su capacidad. |
| **Utilización** | Horas asignadas / capacidad semanal. Expresado como porcentaje. |
| **Capacidad** | Horas semanales que un empleado puede trabajar. Default 40. |
| **Área** | Especialidad funcional: Desarrollo, Infra, Testing, Product Mgmt, Project Mgmt, Data+AI, UX/UI, Análisis Funcional, DevOps/SRE. |
| **Skill** | Tag técnico o de dominio: React, Python, AWS, Scrum, etc. |
| **Outcome** | Resultado final de una oportunidad: won, lost, cancelled, abandoned. |

---

## Modelo de Roles

V2 + SPEC-CRM-00 v1.1 mantiene **7 roles base** (`director` y `external` agregados por SPEC-CRM-00 PR 4 — `c8643d9`) más `preventa` por backward-compat (el middleware lo reescribe a `member`). Los permisos están **hardcodeados en código** — no hay UI para editarlos. Si hay que cambiar la matriz, se hace en código y se libera.

La fuente de verdad operativa son las macros exportadas en [`server/middleware/auth.js`](../../../server/middleware/auth.js):

```js
const ROLES = ['superadmin', 'admin', 'director', 'lead', 'member', 'viewer', 'external'];
const SEE_ALL_ROLES = new Set(['superadmin', 'admin', 'director']);
const WRITE_ROLES   = new Set(['superadmin', 'admin', 'director', 'lead', 'member']);
```

| Rol | Descripción |
|---|---|
| **Superadmin** | Poder total. Único que puede crear admins y cambiar roles. No puede ser eliminado. |
| **Admin** | Gestiona usuarios (excepto admins/superadmins), parámetros, áreas, skills, squads. Ve todo el sistema. |
| **Director** *(SPEC-CRM-00)* | Nivel VP / C-suite. Ve todo el pipeline, todas las oportunidades, todos los reportes — sin permisos administrativos sobre usuarios. Read-everything con write capability sobre opportunities/contracts. |
| **Lead** | Ve y aprueba en su squad. En V2 sin flujo de aprobación todavía, pero ve agregados de su squad. |
| **Member** | Crea entidades según su función. En oportunidades **ve solo las suyas** (account_owner_id o presales_lead_id). Edita lo que le pertenece. |
| **Viewer** | Solo lectura, según su función. |
| **External** *(SPEC-CRM-00)* | Acceso restringido — usuarios que no son DVP pero necesitan login (clientes en demo, partners). En oportunidades retorna **403**. Otras vistas según whitelist explícita. |
| `preventa` (legacy) | El middleware lo reescribe a `member` + `function='preventa'`. No usar para usuarios nuevos. |

### Superadmin existente

Mantener el superadmin actual (`migrate.js` seed). Las protecciones siguen iguales:
- No puede ser eliminado
- No puede cambiar su propio rol
- No se le puede cambiar el rol desde la UI

---

## Funciones (orthogonal a roles)

La función NO determina permisos por sí sola. Determina:
- **Dashboard por defecto** que se carga al login
- **Items del sidebar** visibles
- **Filtros default** en pantallas de listado

| Función | Descripción |
|---|---|
| **Comercial** | Equipo de ventas. Dueño de cuentas y oportunidades. |
| **Preventa** | Ingeniería de pre-venta. Arma cotizaciones técnicas. |
| **Capacity Manager** (CM) | Gestiona portafolio de empleados Capacity. |
| **Delivery Manager** (DM) | Gestiona portafolio de cuentas de proyectos. |
| **Project Manager** (PM) | Empleado FTE que actúa como PM de un cliente. |
| **FTE Técnico** | Empleado que ejecuta trabajo técnico (dev, QA, data, etc.). Registra horas. |
| **People** | Equipo de talento. Ve necesidades de contratación, skills, capacidad. |
| **Finance** | Equipo financiero. (En V2 limitado: sin tarifas no hay mucho que ver). |
| **PMO** | Operaciones de delivery. Lectura de contratos y métricas. |
| **Admin** | Función administrativa pura. |

Un usuario tiene **una función**. Si necesita más adelante tener varias, se evalúa.

---

## Matriz de Permisos por Rol

Las acciones se evalúan sobre el rol. La función no agrega permisos. La columna **Director** y **External** se agregaron en SPEC-CRM-00 PR 4 (`c8643d9`).

| Capacidad | Superadmin | Admin | Director | Lead | Member | Viewer | External |
|---|---|---|---|---|---|---|---|
| Iniciar sesión | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ver Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Limitado |
| Ver Wiki | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Ver cotizaciones (ámbito) | Todas | Todas | Todas | Squad | Propias + Squad (lectura) | Squad (lectura) | ❌ |
| Crear/editar cotización propia | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Editar cotización ajena | ✅ | ✅ | ✅ | Solo de su squad | ❌ | ❌ | ❌ |
| Ver Clientes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Crear/editar Cliente | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Ver Oportunidades (ámbito)** *(scoping inline en `GET /api/opportunities` post CRM-00)* | Todas | Todas | Todas | Squad | Propias (account_owner o presales_lead) | Squad | **403** |
| Crear/editar Oportunidad | ✅ | ✅ | ✅ | ✅ | ✅ (las propias) | ❌ | ❌ |
| Marcar Oportunidad como ganada/perdida/postponed | ✅ | ✅ | ✅ | ✅ | ✅ (las propias) | ❌ | ❌ |
| `POST /api/opportunities/:id/check-margin` | ✅ | ✅ | ✅ | ✅ | ✅ (propias) | ❌ | ❌ |
| `POST /api/opportunities/check-alerts` (cron) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ver Empleados | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Crear/editar Empleado | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Eliminar Empleado | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Ver Skills, Áreas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Editar catálogo Skills/Áreas | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Ver Contratos (ámbito) | Todos | Todos | Todos | Squad | Squad | Squad | ❌ |
| Crear/editar Contrato | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Crear/editar Solicitud de Recurso | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Crear/editar Asignación | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Eliminar Asignación | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Registrar horas propias | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Editar/borrar time entry propio (≤30 días) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Editar time entry ajeno | ✅ | ✅ | ❌ | Squad | ❌ | ❌ | ❌ |
| Ver reportes | ✅ | ✅ | ✅ (todos) | Squad | Limitado a su data | Squad | ❌ |
| Editar parámetros | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Crear usuarios preventa/comercial | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Crear usuarios admin | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cambiar rol de un usuario | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Eliminar usuario (hard delete) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Activar/desactivar usuario | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Resetear contraseña | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Ver event log (audit) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Crear/editar Squad | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Mover usuarios entre Squads | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Reglas de protección (heredadas de V1, mantener)

- Superadmin no puede eliminarse a sí mismo ni cambiarse rol.
- No se puede eliminar un superadmin.
- Usuario con cotizaciones, oportunidades, contratos, asignaciones o time entries asociadas no se puede hard-deletear → 409 sugerir desactivación.
- Empleado con asignaciones activas no se puede eliminar → 409 sugerir cambio de estado a `terminated`.

---

## Squads

V2 introduce squads como entidad simple.

- **Una organización tiene N squads.** En el seed inicial se crea uno: `"DVPNYX Global"`.
- **Cada usuario pertenece a un squad.** `users.squad_id` (NOT NULL después de migración).
- **Cada cotización, oportunidad, contrato pertenece a un squad** (el del owner).
- **Admin puede mover usuarios entre squads.**
- **No hay jerarquías de squads.** Lista plana.

### Sembrar squads iniciales

En la migración de V2:
1. Crear squad `DVPNYX Global` (default).
2. Asignar todos los usuarios existentes a ese squad.
3. Asignar todas las cotizaciones existentes a ese squad.

Squads adicionales (LATAM Nearshore, Enterprise USA, etc.) se crean por Admin desde la UI cuando los necesite.

---

## Mapeo función → dashboard default

| Función | Dashboard al login |
|---|---|
| Comercial | `/dashboard/commercial` (cotizaciones + oportunidades + pipeline) |
| Preventa | `/dashboard/presales` (cotizaciones por estado) |
| Capacity Manager | `/dashboard/capacity` (utilización portafolio + bench) |
| Delivery Manager | `/dashboard/delivery` (contratos activos + solicitudes pendientes) |
| Project Manager | `/dashboard/me` (mis asignaciones + horas) |
| FTE Técnico | `/dashboard/me` (mis asignaciones + horas) |
| People | `/dashboard/people` (necesidades de contratación + skills) |
| Finance | `/dashboard/general` (vista organizacional limitada) |
| PMO | `/dashboard/pmo` (contratos activos) |
| Admin | `/dashboard/general` |

En V2 todos los dashboards muestran el conjunto de widgets que aplica a esa función. No son configurables aún.
