# DVPNYX Cotizador — Manual de Usuario v2.0
### Guía para prueba piloto

**Sistema:** quoter.doublevpartners.com
**Fecha:** Mayo 2026
**Audiencia:** Practicante / Evaluadora del sistema

> **Nuevos flujos disponibles desde Mayo 2026** (ver [§Flujos nuevos](#flujos-nuevos-mayo-2026) al final):
> - Conversión cotización → contrato de un click
> - Kick-off del contrato (auto-genera solicitudes desde la cotización)
> - **Tiempo semanal** (`/time/team`) con bench automático
> - **Plan vs Real** semanal (`/reports/plan-vs-real`) para líderes
> - Asignación in-place desde Capacity Planner

---

## ¿Qué es el DVPNYX Cotizador?

Es la plataforma interna de DVPNYX (fusión de Double V Partners + NYX Technologies) para gestionar el ciclo completo desde que se identifica una oportunidad de venta hasta que los empleados registran sus horas en un proyecto activo.

Reemplaza cuatro herramientas independientes que se usaban antes:

- **Excel** → cotizaciones
- **runn.io** → planeación de recursos y asignaciones
- **Clockify** → registro de horas
- **Otro Excel** → inventario de empleados

Todo en un solo lugar, con datos conectados.

---

## 1. Acceso al sistema

### Cómo ingresar

1. Abre el navegador (Chrome, Firefox, Edge, Safari — versión reciente)
2. Ve a **quoter.doublevpartners.com**
3. Ingresa tu email y contraseña
4. Haz clic en **Ingresar**

**Credenciales de prueba:** Te las entregará tu supervisor antes de la prueba.

### Primer ingreso

Si es tu primera vez ingresando, el sistema te pedirá cambiar la contraseña (la inicial es `000000`). La nueva contraseña debe tener mínimo 8 caracteres.

### Roles del sistema

| Rol | Qué puede hacer |
|---|---|
| **Superadmin** | Todo, incluyendo cambiar roles y eliminar usuarios |
| **Admin** | Gestionar usuarios, parámetros, áreas, skills; ver todo |
| **Member** | Crear cotizaciones, clientes, oportunidades, registrar horas propias |
| **Viewer** | Solo lectura |

Para la prueba piloto, se te asignará el rol que mejor simule el trabajo real.

---

## 2. Navegación general

### Barra lateral (Sidebar)

En el lado izquierdo encontrarás el menú principal organizado en secciones:

| Sección | Qué contiene |
|---|---|
| *(raíz)* | Dashboard |
| **Comercial** | Nueva Staff Aug, Nuevo Proyecto, Clientes, Oportunidades |
| **Delivery** | Contratos, Solicitudes de Recurso, Asignaciones |
| **Gente** | Empleados, Áreas (admin), Skills (admin) |
| **Time Tracking** | Mis horas, Horas del equipo |
| *(raíz)* | Reportes, Wiki |
| **Configuración** *(admin)* | Parámetros, Usuarios, Carga masiva |

### En móvil

En pantalla pequeña el menú se oculta y aparece el botón ☰ (hamburguesa) en la esquina superior izquierda.

### Versión del sistema

En la esquina inferior derecha siempre verás `v2.0.0 · build XXXXXXX` — útil para reportar problemas.

---

## 3. Dashboard (Inicio)

Al ingresar ves tu dashboard personal con:

- **Mis asignaciones activas** — en qué contratos estás trabajando, con fechas y horas/semana
- **Mis horas esta semana** — cuántas horas has registrado vs. las esperadas
- **Mis notificaciones recientes** (campana en el header)

Si tienes rol admin/comercial, también verás métricas de portafolio.

---

## 4. Módulo Clientes

**Ruta:** Sidebar → Comercial → Clientes

Aquí están las empresas a las que DVPNYX presta servicios.

### Ver la lista de clientes

- Se muestran con nombre, país, industria, tier (Enterprise / Mid Market / SMB), conteos de oportunidades y contratos activos
- Puedes buscar por nombre, filtrar por país, tier o estado activo/inactivo
- Hay paginación (25 por página)

### Crear un cliente nuevo

1. Clic en **+ Nuevo Cliente**
2. Rellena los campos:
   - **Nombre** (obligatorio, único)
   - **Nombre legal** (opcional)
   - **País, Industria, Tier** (opcionales)
   - **Notas** (opcional)
3. Clic en **Guardar**

### Editar un cliente

- Clic en **Editar** en la fila del cliente → modifica los campos → **Guardar**

### Desactivar un cliente (admin)

- Clic en **Desactivar** — el cliente deja de aparecer en selectores pero su historial se preserva

---

## 5. Módulo Oportunidades

**Ruta:** Sidebar → Comercial → Oportunidades

Una oportunidad representa un intento de venta a un cliente específico.

### Estados de una oportunidad

```
open → qualified → proposal → negotiation → won / lost / cancelled
```

### Vista de lista y Kanban

- **Lista:** tabla con filtros por estado, cliente, owner, squad
- **Kanban:** columnas por estado, puedes arrastrar las tarjetas para cambiar el estado

### Crear una oportunidad

1. Clic en **+ Nueva Oportunidad**
2. Selecciona el **Cliente** (debe existir primero)
3. Escribe el **Nombre** de la oportunidad
4. Asigna el **Owner Comercial** y opcionalmente el **Preventa Lead**
5. Agrega fecha de cierre esperada si la conoces
6. Clic en **Guardar**

### Marcar una oportunidad como ganada

1. Abre la oportunidad (clic en el nombre)
2. Clic en **Marcar como ganada**
3. Selecciona cuál cotización fue la ganadora
4. El sistema cierra la oportunidad y te ofrece **crear un Contrato** desde ella

### Marcar como perdida

1. Clic en **Marcar como perdida**
2. Selecciona la razón (Precio / Timing / Competencia / Fit técnico / Interna del cliente / Otro)
3. Las cotizaciones en estado "enviada" pasan a "rechazada"

---

## 6. Módulo de Cotizaciones

**Ruta:** Sidebar → Comercial → Nueva Staff Aug / Nuevo Proyecto

Hay dos tipos de cotización:

### 6.1 Staff Augmentation (Capacity)

Modelo por recursos: el cliente contrata personas por cantidad × nivel × meses.

**Cómo crear una:**

1. Clic en **Nueva Staff Aug**
2. Selecciona el **Cliente** y la **Oportunidad** (obligatorio)
3. Si no existen, puedes crearlos desde el mismo modal
4. Llegas al editor con la tabla de recursos

**En el editor:**

- Rellena **Nombre del Proyecto** y **Cliente** en el encabezado
- Clic en **+ Agregar recurso** para cada perfil
- Por cada recurso define:
  - Especialidad (Desarrollo, Infra, Testing, etc.)
  - Rol/Título libre (ej: "Senior React Developer")
  - **Nivel L1–L11** (ver Wiki para la guía de qué significa cada nivel)
  - País, bilingüe, herramientas, stack tecnológico, modalidad
  - Cantidad y meses
- El sistema calcula **Tarifa/Mes** y **Total** en tiempo real
- Al pie ves: Valor mensual total, Valor total del contrato, Total con descuento

**Guardar:**

- **Guardar borrador** → queda en estado "Borrador"
- **Guardar como Enviada** → estado "Enviada" (congela los parámetros de cálculo)

### 6.2 Proyectos de Alcance Fijo

Modelo por entregable: precio fijo, el driver de costo es fase × perfil × horas/semana.

**El editor es un wizard de 6 pasos:**

| Paso | Qué se hace |
|---|---|
| 1 — Proyecto | Nombre, cliente, responsables, notas |
| 2 — Equipo | Hasta 15 perfiles con nivel, país, stack (sin cantidad ni meses) |
| 3 — Fases | 5 fases preloadeadas (Planeación, Desarrollo, QA, Transferencia, Garantía); editables |
| 4 — Asignación | Matriz perfil × fase con horas/semana (máx 40 h). Celdas amarillas son editables |
| 5 — Épicas | Opcional: desglose de horas por épica para trazabilidad (no afecta el cálculo) |
| 6 — Resumen | Cascada financiera + métricas + plan de pagos |

**Paso 4 — Asignación (el más importante):**

- Filas = perfiles del equipo; Columnas = fases
- Cada celda en amarillo: escribe las horas/semana que ese perfil trabaja en esa fase
- El sistema calcula automáticamente total de horas y costo
- Las dos primeras columnas quedan fijas al hacer scroll horizontal
- Abajo ves: Total Horas Proyecto, Costo Base, Blend Rate Costo

**Paso 6 — Resumen:**

- Cascada: Costo base → Buffer (10%) → Garantía (5%) → **Costo Total Protegido** → Margen → **Precio de Venta** → Descuento → **Precio Final**
- Semáforo del margen real: verde ≥ 50%, ámbar 40-50%, rojo < 40%
- Define hitos de pago (los % deben sumar 100%)

### Historial de cambios

En el editor, la pestaña **Historial** muestra todos los cambios hechos a la cotización con fecha, usuario y detalle.

### Duplicar una cotización

Desde el Dashboard, clic en **Duplicar** en la fila → crea una copia en borrador lista para editar.

---

## 7. Módulo Empleados

**Ruta:** Sidebar → Gente → Empleados

El inventario de personas que trabajan en DVPNYX. Distinto al usuario del sistema — un empleado puede o no tener cuenta de acceso.

### Ver la lista

- Filtra por área, nivel, país, status, squad, skills
- Vistas: tabla o tarjetas
- Columna "Utilización actual": qué porcentaje de su capacidad está ocupado esta semana

### Crear un empleado (admin)

1. Clic en **+ Nuevo Empleado**
2. Campos obligatorios:
   - Nombre y apellido
   - País
   - **Área** (Desarrollo, Infra, Testing, etc.)
   - **Nivel** (L1–L11)
   - Fecha de inicio
3. Opcionales: email corporativo, ciudad, capacidad semanal (default 40h), squad, manager
4. Guardar

### Ficha del empleado

Al hacer clic en un empleado, abre su ficha con pestañas:

- **Resumen** — datos generales + tarjeta de utilización actual (% con barra de color)
- **Skills** — tecnologías que sabe, con nivel de proficiencia (Beginner / Intermediate / Advanced / Expert)
- **Asignaciones** — en qué contratos está asignado (activos + histórico)
- **Horas** — calendario de time entries de los últimos 90 días
- **Actividad** — log de cambios

### Asignar skills a un empleado (admin)

1. En la ficha, pestaña **Skills**
2. Busca el skill en el buscador
3. Define proficiency y años de experiencia (opcionales)
4. Guardar

### Status del empleado

| Status | Significado |
|---|---|
| **Activo** | Trabajando normalmente |
| **On Leave** | En vacaciones o licencia |
| **Bench** | Sin asignación activa |
| **Terminado** | Salió de DVPNYX — cancela asignaciones futuras |

---

## 8. Módulo Contratos

**Ruta:** Sidebar → Delivery → Contratos

Un contrato es una unidad de entrega activa. Nace típicamente de una oportunidad ganada.

### Crear un contrato

1. Clic en **+ Nuevo Contrato**
2. Selecciona Cliente (obligatorio) y Oportunidad (opcional)
3. Si tienes una cotización ganada, puedes crearlo desde la ficha de la cotización con **"Crear contrato desde esta cotización"** — pre-rellena varios campos
4. Define tipo (Capacity o Proyecto), fechas, PM, Delivery Manager
5. Opcional: activa "Generar solicitudes desde la cotización" → el sistema pre-genera las Solicitudes de Recurso

### Estados del contrato

```
draft → active → on_hold / completed / cancelled
```

### Ficha del contrato

Pestañas:
- **Resumen** — datos, tarjetas de cobertura (horas solicitadas vs asignadas)
- **Solicitudes** — qué perfiles necesita el contrato
- **Asignaciones** — empleados asignados a las solicitudes
- **Horas** — time entries del contrato por semana o empleado
- **Actividad** — log

---

## 9. Módulo Solicitudes de Recurso

**Ruta:** Sidebar → Delivery → Solicitudes (o dentro de la ficha del contrato)

Una solicitud de recurso describe la necesidad de un perfil específico dentro de un contrato.

### Crear una solicitud (desde el contrato)

1. En la ficha del contrato, pestaña **Solicitudes** → **+ Nueva Solicitud**
2. Define:
   - Título del perfil (ej: "Backend Dev Senior Node.js")
   - Área y Nivel
   - País preferido, idioma requerido, skills
   - Horas/semana y fechas
   - Prioridad (Baja / Media / Alta / Crítica)
3. Guardar

### Estado de la solicitud (calculado automáticamente)

| Estado | Significado |
|---|---|
| **Open** | Sin cobertura |
| **Partially filled** | Hay asignaciones pero no cubren todo |
| **Filled** | Cobertura completa |
| **Cancelled** | Cancelada manualmente |

### Sugerencias de candidatos

En la ficha de la solicitud, el botón **Ver candidatos** muestra empleados que:

- Tienen el nivel y área requeridos
- Tienen la mayor disponibilidad (menor utilización primero)
- Tienen los skills requeridos (si se especificaron)

---

## 10. Módulo Asignaciones

**Ruta:** Sidebar → Delivery → Asignaciones

Una asignación vincula a un empleado con una solicitud de recurso.

### Crear una asignación

1. Desde la ficha de la solicitud, clic en **Asignar empleado**
2. Elige el empleado (el selector muestra utilización actual y skills que matchean)
3. Define fechas y horas/semana
4. El sistema valida que no haya **overbooking** (si el empleado supera el 110% de su capacidad, bloquea)
5. Guardar — el status de la solicitud se recalcula automáticamente

### Acciones sobre una asignación

- **Extender** — cambiar la fecha de fin a una fecha futura
- **Terminar anticipadamente** — setea fin en hoy y cambia a "Completada"
- **Reemplazar empleado** — termina la actual y crea una nueva con otro empleado

---

## 11. Time Tracking — Registro de Horas

> Esta es la sección clave para comparar con Clockify.

**Ruta:** Sidebar → Time Tracking → Mis horas

### Vista del calendario semanal

- **Filas** = tus asignaciones activas esta semana
- **Columnas** = días de la semana (L M X J V S D)
- **Celdas sin registro** = fondo rojizo pálido (días pasados sin horas)
- **Días futuros** = bloqueados (no se puede registrar adelantado)

**Para registrar horas:**

1. Haz clic en la celda correspondiente a (asignación × día)
2. Escribe el número de horas (ej: 8)
3. Presiona Tab o Enter → se **guarda automáticamente**
4. El panel derecho permite agregar una descripción al entry

**Totales visibles:**

- Al final de cada fila: total de horas de esa asignación en la semana
- Al final de cada columna: total de horas de ese día
- Esquina inferior derecha: **total semanal vs. tu capacidad** (ej: "38 / 40 h")

### Navegar entre semanas

- Usa las flechas ← → en el header para ir a la semana anterior o siguiente
- O el selector de fecha para ir a cualquier semana

### Retroactividad

- Puedes registrar horas de **hasta 30 días atrás** (configurable por admin)
- No se pueden registrar horas en fechas futuras

### Atajos de teclado

| Tecla | Acción |
|---|---|
| `Tab` | Siguiente celda del día |
| `↑ ↓ ← →` | Navegar entre celdas |
| `Enter` | Guardar y bajar una fila |

### Botón "Copiar semana anterior"

Copia todas las entradas de la semana pasada a la actual (con preview antes de confirmar). Solo copia asignaciones que sigan activas.

### Rellenar 8h/día

Botón que llena automáticamente los días L–V con 8h en una asignación específica. Útil para semanas estándar sin variaciones.

### Indicador de cumplimiento

Arriba de la matriz ves:

- **Cumplimiento últimos 30 días: XX%** — días hábiles con al menos 1 entry vs. días hábiles totales
- **Semanas pendientes de completar** — últimas 4 semanas con menos de 40h registradas

---

## 12. Horas del Equipo (para líderes)

**Ruta:** Sidebar → Time Tracking → Horas del equipo

Vista para supervisores y managers:

- Tabla con cumplimiento por empleado del equipo
- Filtra por squad, área, manager
- Orden por defecto: menor cumplimiento primero (para priorizar seguimiento)
- Clic en un empleado → abre su calendario en modo lectura

---

## 13. Módulo de Reportes

**Ruta:** Sidebar → Reportes

Hub con múltiples reportes agrupados por categoría.

### Reportes disponibles

**Capacidad y Utilización:**

- **Utilización por empleado** — tabla y heatmap semanal. Semáforo: verde 70-100%, ámbar fuera de ese rango, rojo < 50% o > 110%
- **Bench** — empleados con utilización baja (< 60% por defecto). Incluye botón "Sugerir matches" con solicitudes abiertas

**Demanda y Cobertura:**

- **Solicitudes pendientes** — con alertas de inicio próximo
- **Necesidades de contratación** — agrupado por área + nivel + país, con "personas equivalentes" faltantes
- **Cobertura por contrato** — qué % de las horas solicitadas tienen asignación

**Tiempo y Ejecución:**

- **Cumplimiento de time tracking** — quién llena sus horas y quién no. Rankings top 10

### Filtros y exportación

- Todos los reportes tienen filtros (squad, área, rango de fechas, etc.)
- Botón **Exportar** → CSV o Excel
- La URL refleja los filtros aplicados → puedes compartir un reporte con filtros preseleccionados

---

## 14. Wiki Informativa

**Ruta:** Sidebar → Wiki

Material de referencia para entender los criterios de cotización. No afecta los cálculos del sistema, es solo lectura.

### Sección: Stack tecnológico

Tabla de los 3 tiers:

| Tier | Multiplicador |
|---|---|
| Estándar | × 0.90 |
| Especializada | × 1.00 |
| Alta Demanda / Nicho | × 1.20 |

Incluye una grilla por especialidad que indica en qué tier cae cada tecnología.

### Sección: Niveles por especialidad

- Tabs por especialidad: Desarrollo, Infra, Testing, Product, Project, Data+AI, UX/UI, Análisis Funcional
- Para cada nivel L1–L11: Hard Skills, Soft Skills, Perfil típico
- Colores por grupo: Junior (teal), Semi Senior (naranja), Senior (púrpura), Líder/Crack (malva)

---

## 15. Carga Masiva (Bulk Import)

**Ruta:** Configuración → Carga masiva (solo admin)

Para cargar muchos registros de un Excel o CSV de una sola vez.

### Entidades que se pueden cargar

| Entidad | Para qué |
|---|---|
| **Áreas** | Alta de nuevas especialidades al catálogo |
| **Skills** | Alta de nuevas competencias al catálogo |
| **Clientes** | Onboarding masivo de cuentas |
| **Empleados** | Onboarding masivo del equipo desde el Excel de Gente |
| **Empleado ↔ Skill** | Asignar skills a empleados en bloque |

### Cómo usarlo (paso a paso)

1. Elige la entidad (ej: Empleados)
2. Clic en **Descargar plantilla** → el sistema te da un CSV de ejemplo con las columnas correctas
3. Abre la plantilla en Excel o Google Sheets, rellena con tus datos, guarda como CSV
4. Arrastra el CSV al área indicada o usa el botón para subir
5. El sistema muestra una **tabla de revisión previa** (preview): cada fila en verde (válida) o rojo (error con descripción)
6. Revisa los errores y corrígelos en el CSV si los hay
7. Clic en **Confirmar carga**
8. El reporte final muestra: Creadas / Actualizadas / Omitidas (duplicados) / Errores

> **Nota importante:** Si subes el mismo CSV dos veces, los registros que ya existen se omiten o actualizan — no se duplican.

### Orden recomendado para onboarding inicial

```
1. Áreas
2. Skills
3. Clientes
4. Empleados  (requiere que las áreas existan)
5. Empleado ↔ Skill  (requiere que los empleados y skills existan)
```

---

## 16. Gestión de Usuarios (admin)

**Ruta:** Configuración → Usuarios

### Crear un usuario

1. Clic en **+ Nuevo usuario**
2. Define nombre, email, rol y función
3. La contraseña inicial es `000000` → al primer login el sistema fuerza el cambio

### Cambiar el rol de un usuario (solo superadmin)

En la tabla de usuarios, la columna "Rol" es un dropdown editable para filas que no son superadmin ni el propio usuario.

### Eliminar un usuario (solo superadmin)

- Clic en **Eliminar** (botón rojo)
- Si el usuario tiene cotizaciones o contratos asociados, el sistema rechaza con un error y sugiere desactivar en su lugar

---

## 17. Parámetros del sistema (admin)

**Ruta:** Configuración → Parámetros

Aquí se administran los valores que alimentan los cálculos de cotización:

| Parámetro | Ejemplo |
|---|---|
| Costo empresa por nivel (L1–L11) | en USD/mes |
| Multiplicador geográfico | Colombia ×1.00, Ecuador ×1.10, USA ×3.00 |
| Prima de bilingüismo | Con inglés ×1.10–×1.20 |
| Herramientas | Básico $185/mes, Premium $350/mes |
| Stack tecnológico | Estándar ×0.90, Especializada ×1.00, Alta Demanda ×1.20 |
| Modalidad | Remoto ×0.95, Híbrido ×1.10, Presencial ×1.20 |
| Margen talento | 35% |
| Buffer proyecto | 10% |
| Garantía proyecto | 5% |
| Margen mínimo proyecto | 50% |
| Ventana retroactiva time tracking | 30 días |
| Máx horas/día | 16 |

**Para editar:** Clic en **Editar** en la fila → ingresa el nuevo valor → Enter o confirma. Cualquier cambio queda registrado en el audit log.

---

## 18. Notificaciones

La campana en el header muestra notificaciones in-app:

| Notificación | Cuándo aparece |
|---|---|
| "Te asignaron a {contrato}" | Cuando alguien te asigna a una solicitud |
| "Llena tus horas de la semana" | Recordatorio automático los viernes a las 5pm si tienes < 32h |
| "{contrato} fue pausado" | Si el contrato donde trabajas pasa a on_hold |
| "¡Ganamos {oportunidad}!" | Cuando una oportunidad se cierra como ganada |

Clic en la notificación lleva directamente a la entidad relacionada.

---

## 19. Flujo completo de punta a punta

```
1. Crear Cliente
2. Crear Oportunidad para ese cliente
3. Crear Cotización (Staff Aug o Proyecto) dentro de la oportunidad
4. Cuando se gana → Marcar oportunidad como ganada → Crear Contrato
5. Dentro del contrato → Crear Solicitudes de Recurso
6. Asignar Empleados a las Solicitudes
7. Los empleados registran horas en Time Tracking → Mis horas
8. Revisar utilización y cumplimiento en Reportes
```

---

## 20. Preguntas frecuentes

**¿Qué diferencia hay entre empleado y usuario?**
Un usuario puede hacer login. Un empleado es una persona real en DVPNYX. Puede existir un empleado sin usuario (aún no tiene acceso al sistema) o un usuario sin empleado (alguien administrativo).

**¿Puedo registrar horas de hace más de 30 días?**
No en condiciones normales. Un admin puede hacerlo y el sistema deja constancia en el audit log.

**¿Qué pasa si ingreso más de 40 horas en la matriz de asignación de proyectos?**
El sistema tiene un tope de 40h/semana por celda — no acepta más.

**¿Puedo registrar horas a futuro?**
No. El sistema bloquea cualquier fecha posterior a hoy.

**¿Qué pasa si asigno a alguien con demasiadas horas?**
El sistema lanza una advertencia de overbooking. Si la suma supera el 110% de la capacidad del empleado, bloquea la asignación. Un admin puede hacer override con confirmación explícita.

**¿Cómo sé si mis horas están bien registradas?**
El indicador de cumplimiento arriba del calendario muestra el % de días hábiles donde registraste al menos 1 hora.

---

## 21. Comparación con las herramientas del piloto

### DVPNYX Cotizador vs. runn.io

| Funcionalidad | runn.io | DVPNYX Cotizador |
|---|---|---|
| Planeación de recursos | Principal | Solicitudes + Asignaciones |
| Vista de capacidad / utilización | Sí | Sí — Reporte Utilización |
| Bench / disponibilidad | Sí | Sí — Reporte Bench |
| Sugerencia de candidatos | Sí | Sí (por nivel + área + skills) |
| Timeline / Gantt visual | Sí | Parcial (tab Asignaciones del contrato) |
| Asignación multi-cliente | Sí | Sí |
| Integración con cotizaciones | No | Sí — trazabilidad completa |

### DVPNYX Cotizador vs. Clockify

| Funcionalidad | Clockify | DVPNYX Cotizador |
|---|---|---|
| Registro retroactivo de horas | Sí | Sí (ventana 30 días) |
| Vista semanal por proyecto | Sí | Sí (por asignación) |
| Reporte de cumplimiento | Sí | Sí |
| Burn rate (planeado vs real) | Parcial | Sí — Reporte Horas por Contrato |
| Aprobación de horas | Sí | Reservado para V3 |
| Integración con facturación | Sí | No disponible en V2 |
| Registro libre sin asignación | Sí | No — solo contra asignaciones activas |

---

## Flujos nuevos (Mayo 2026)

### 1. Convertir una cotización ganada en contrato

Antes había que copiar datos a mano. Ahora:

1. Abre la **oportunidad** ganadora.
2. Selecciona la cotización ganadora.
3. Click en **🏆 Mover a Ganada** y elige la cotización.
4. El sistema te pregunta: **"¿Crear un contrato desde esta cotización ahora?"**.
5. Click en **Sí** → contrato `planned` creado, te lleva al detalle.
6. Si dismisses el confirm, hay un botón en el banner verde "**📄 Crear contrato desde cotización ganadora**" para hacerlo después.

### 2. Asignar Delivery Manager y hacer Kick-off

Una vez creado el contrato:

1. Si eres **admin**: en el detalle del contrato, sección "Delivery manager" con dropdown — selecciona quién va a liderar entrega.
2. Si eres **delivery manager** (o admin/account_owner/capacity_manager): aparece un panel morado **"🚀 Kick-off del proyecto"**.
3. Pon la **fecha de kick-off** y click en **Iniciar kick-off**.
4. El sistema lee la cotización ganadora y crea automáticamente las **solicitudes de recursos** con:
   - Rol, nivel, país, cantidad de cada línea
   - Horas/sem = `hours_per_week` de la cotización
   - Fecha inicio = kick-off
   - Fecha fin = kick-off + duración (meses) × 30
   - Área inferida del specialty
5. Puedes **editar** cada solicitud después si la cotización tenía algo aproximado.
6. Si necesitas regenerar todo: botón **🔄 Resembrar desde cotización** (borra las anteriores).

### 3. Tiempo semanal por % (`/time/team`)

Modelo nuevo paralelo al registro diario de horas (`/time/me`).

1. Ve a **Tiempo semanal** en el sidebar.
2. Selecciona la **semana** (siempre se ajusta al lunes).
3. Verás tus **asignaciones activas** y un input de % por cada una.
4. La **suma debe ser ≤ 100%**. Lo que falte para 100% se considera **bench** (tiempo no facturable).
5. Si guardas con < 100%, el sistema te pregunta confirmación: "¿Confirmas que el resto va a bench?".
6. Como **líder** o **admin**: si tu usuario no tiene fila en `employees`, ves un picker para elegir un empleado.
7. Como **líder de equipo**: solo ves a tus reportes directos.

### 4. Reporte Plan vs Real semanal

Compara qué se planeó vs qué se registró.

1. Ve a **Reportes** → **🎯 Plan vs Real (semanal)**.
2. Selecciona la **semana** (lunes).
3. Ves una tabla agrupada por empleado, con sub-líneas por contrato/asignación.
4. Cada línea muestra: **% Plan**, **% Real**, **Diff (pp)** y **Estado**:
   - ✓ **En plan** (diff ≤ ±10pp)
   - ↑ **Sobre-uso** (real > plan + 10pp)
   - ↓ **Sub-uso** (real < plan - 10pp)
   - · **Sin registro** (asignado pero no registró tiempo)
   - ⚠ **No planeado** (registró tiempo en una asignación que ya no está vigente)
5. Sub-total por empleado con **bench %**.
6. **Auto-scoping**:
   - **Líder**: ves solo a tus reportes directos.
   - **Member**: ves solo lo tuyo.
   - **Admin**: ves a todos.
7. **Exportar a CSV** disponible.

### 5. Asignar empleados in-place desde Capacity Planner

Antes había que ir a otra pantalla. Ahora:

1. En **Capacity Planner**, las solicitudes sin asignar aparecen como barras rayadas.
2. Click en una barra → modal de **candidatos sugeridos** (ranking por área + nivel + skills + disponibilidad).
3. Click en **Asignar →** al lado de un candidato → asignación creada inline.
4. Toast verde "✓ {Empleado} asignado a {Rol}" + planner refresca.
5. Si hay overbooking u otra validación que requiere override, te lleva al formulario manual con prefill.

### 6. Asignar líder directo a un empleado

Para que la visibilidad de equipo funcione:

1. Como **admin**, abre el detalle del empleado.
2. Sección **"Líder directo"** con dropdown de admins + leads disponibles.
3. Selecciona y guarda.
4. Ese líder ahora ve al empleado en `/time/team` y `/reports/plan-vs-real`.

---

*DVPNYX Cotizador v2.0 — quoter.doublevpartners.com — Mayo 2026*
