# 04.01 — Módulo: Cotizador (Pulido)

## Contexto

V1 ya tiene el cotizador funcionando. Esta etapa lo pule sin romperlo y lo conecta a las nuevas entidades (Cliente, Oportunidad).

## Cambios funcionales

### 1. Linkage obligatorio a Cliente y Oportunidad

Toda cotización nueva DEBE pertenecer a una Oportunidad, que a su vez pertenece a un Cliente.

**Flujo de creación:**
1. Usuario hace click en `+ Staff Augmentation` o `+ Proyecto Alcance Fijo`.
2. Modal/pantalla previa pide seleccionar Cliente (combobox con búsqueda) y Oportunidad (filtrada por cliente). Si no existe, dos opciones:
   - "+ Nuevo Cliente" abre modal de creación de cliente.
   - "+ Nueva Oportunidad" abre modal de creación de oportunidad para el cliente seleccionado.
3. Una vez seleccionado cliente + oportunidad, se procede a la pantalla de cotización conocida.

**No se debe poder crear cotización sin oportunidad.**

Las cotizaciones legacy migradas tendrán cada una su propia oportunidad auto-creada (ver `08_migration_plan.md`). El usuario podrá re-asignarlas a otra oportunidad después.

### 2. Cálculo canónico en servidor

Hoy `client/src/utils/calc.js` corre en navegador y el backend "solo persiste". V2 cambia esto:

- El cliente sigue calculando en vivo para UX (feedback inmediato al editar celdas). Esto NO se quita.
- Al guardar, el backend recibe los inputs (no los outputs) y **recalcula todo**. Los valores calculados que envíe el cliente son ignorados — se sobreescriben con la versión del servidor.
- Si la diferencia entre cliente y servidor supera 0.01 USD, se loguea un evento `quotation.calc_drift` para investigación posterior. No se rechaza el save.
- Compartir lógica: `client/src/utils/calc.js` se duplica como `server/utils/calc.js` con la misma firma. Mantener en sync mediante test contrato (`server/utils/calc.test.js` ejecuta los mismos casos que `client/src/utils/calc.test.js`).

**Inputs que el server espera al guardar:**
- Cabecera (project_name, client_id, opportunity_id, type, status, validity_days, discount_pct, notes, etc.)
- Líneas (specialty, role_title, level, country, bilingual, tools, stack, modality, quantity, duration_months, hours_per_week)
- Para proyectos: phases, allocations (matriz), epics, milestones
- Parámetros aplicables: el server los lee en su propia BD, no los recibe del cliente.

**Outputs que el server calcula y persiste:**
- Por línea: cost_hour, rate_hour, rate_month, total
- Cabecera: totalContract, finalPrice (Capacity); costoBase, costoConBuffer, costoProtegido, precioVenta, precioFinal, blendRateCosto, blendRateVenta, margenReal (Proyectos)

### 3. Snapshot de parámetros al pasar a `sent` o `approved`

Cuando una cotización transiciona a `sent` o `approved` por primera vez:

1. Capturar el estado actual de TODOS los parámetros relevantes (level, geo, bilingual, tools, stack, modality, margin, project) y guardarlos en `quotations.parameters_snapshot` (JSONB).
2. Estructura del snapshot:

```json
{
  "captured_at": "2026-04-18T12:34:56Z",
  "captured_by": "<user_uuid>",
  "parameters": {
    "level": {"L1": 1500, "L2": 2000, ...},
    "geo": {"Colombia": 1.00, "Ecuador": 1.10, ...},
    "bilingual": {"Sí": 1.20, "No": 1.00},
    "tools": {"Básico": 185, "Premium": 350, ...},
    "stack": {"Estándar": 0.90, ...},
    "modality": {"Remoto": 0.95, ...},
    "margin": {"talent": 0.35, "tools": 0.00},
    "project": {"buffer": 0.10, "warranty": 0.05, "min_margin": 0.50, "hours_month": 160}
  }
}
```

3. **Una vez snapshoteada**, futuras ediciones de parámetros no afectan los cálculos al recargar esa cotización.
4. Al recargar una cotización con snapshot, los cálculos se hacen contra el snapshot, NO contra los parámetros vigentes.
5. Cotizaciones en estado `draft` siempre se calculan contra los parámetros vigentes (no tienen snapshot todavía).
6. Si una cotización vuelve de `approved/sent` a `draft` (por ejemplo para ajustar): el snapshot se conserva pero NO se aplica; cálculos usan parámetros vigentes. Si vuelve a pasar a `sent`, se RE-snapshotea.

### 4. Mover allocation a tabla propia

Hoy la matriz de asignación de proyectos vive en `quotations.metadata.allocation` como JSONB. Migrar a tabla `quotation_allocations` (ver `03_data_model.md`).

- En GET y POST/PUT, la API sigue exponiendo el formato `allocation: {[lineIdx]: {[phaseId]: hours}}` — el frontend no se entera del cambio.
- En el server, leer y escribir desde `quotation_allocations`.
- Migración: leer todos los `quotations.metadata.allocation` existentes y popular la tabla.

### 5. Versión + indicador de SHA en footer del editor

En el footer del editor (siempre visible), mostrar pequeño texto: `v2.0.x · build {gitsha}`. El SHA se inyecta en build time vía variable de entorno `REACT_APP_GIT_SHA`.

### 6. Vista de "Historial" por cotización (read-only)

Nueva pestaña en el editor: **Historial**. Lista cronológica de eventos de la tabla `events` filtrados por `entity_type='quotation' AND entity_id=<id>`.

**Columnas:**
- Fecha/hora (relativo: "hace 3 horas")
- Usuario
- Acción (legible: "Creada", "Marcada como enviada", "Líneas modificadas", "Parámetros snapshoteados", etc.)
- Detalle (botón ver: muestra el payload JSON formateado en modal)

Sin diff visual aún (eso es etapa 3 futura). Solo lista.

### 7. Cotización ganada → marca el winning_quotation

Nueva acción en el header de la cotización: `Marcar como ganadora`. Disponible solo si:
- Status de la cotización es `sent` o `approved`
- La oportunidad asociada está en estado distinto de `won` o `lost`

Al click:
- Confirmación modal: "¿Confirmar que esta cotización es la ganadora de la oportunidad? Esto cerrará la oportunidad como ganada."
- Si confirma: actualizar `opportunities.outcome='won'`, `opportunities.status='won'`, `opportunities.winning_quotation_id=<id>`, `opportunities.closed_at=NOW()`.
- Cotización pasa a `status='approved'` automáticamente si no estaba.
- Se sugiere crear un Contrato a partir de esta cotización (modal con flujo a `contracts/new?from_quotation=<id>`).

## Cambios visuales (UX)

- **Breadcrumb** en el editor: `Clientes > {Cliente} > Oportunidades > {Oportunidad} > Cotizaciones > {Cotización}`. Navegable.
- **Badge de oportunidad** al lado del nombre del proyecto en el header.
- **Tab bar** del editor: `Detalle`, `Historial`. (En proyectos: `Detalle` se sigue dividiendo en los 6 pasos del stepper.)
- **Pulir colores y espaciado** del status badge (consistencia con el resto del sistema).
- **Header sticky:** project name, client, opportunity, status, total siempre visibles al hacer scroll.

## Lo que NO cambia en V2

- Stepper de 6 pasos para Proyectos.
- Editor lineal para Capacity.
- Wiki, Parámetros, Usuarios.
- Lógica de cálculo (es la misma, solo se mueve al server).
- Layout general del editor.
- Export PDF (sigue placeholder).

## API afectada

Ver `05_api_spec.md` para el detalle. Cambios principales:

- `POST /api/quotations` ahora exige `client_id` y `opportunity_id`.
- `PUT /api/quotations/:id` recalcula en server.
- Nuevo `POST /api/quotations/:id/mark-winning` (atajo para cerrar opp como ganada).
- Nuevo `GET /api/quotations/:id/events` (historial).

## Tests requeridos

- `server/utils/calc.test.js` — espejo del cliente, mismos casos.
- Test de regresión: una cotización V1 cargada en V2 produce los mismos números (validar contra snapshot).
- Test de snapshot: una cotización aprobada conserva sus números aunque se editen los parámetros.
- Test de validación: no se puede crear cotización sin opportunity_id.
