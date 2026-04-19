# 04.02 — Módulo: Clientes y Oportunidades

## Clientes

### Pantallas

**`/clients`** — Lista de clientes

Columnas: Nombre · País · Industria · Tier · # Oportunidades · # Contratos activos · Estado (activo/inactivo) · Acciones.

- Barra de búsqueda por nombre (debounce 300ms, LIKE case-insensitive sobre `name` y `legal_name`).
- Filtros: país, industria, tier, estado.
- Paginación: 25 por página.
- Acciones por fila: Ver, Editar, Desactivar (admin+).
- Botón header: `+ Nuevo Cliente`.

**`/clients/:id`** — Ficha del cliente

Tabs:
- **Resumen:** datos del cliente (nombre, país, industria, tier, moneda preferida, notas, tags).
- **Oportunidades:** lista de oportunidades del cliente con su estado y valor.
- **Contratos:** lista de contratos del cliente, activos primero.
- **Actividad:** event log filtrado por este cliente.

Botón header: `+ Nueva Oportunidad` (prefilled con este cliente).

### Formulario de Cliente

Campos:
- `name` (requerido, texto)
- `legal_name` (opcional, texto)
- `country` (combobox con sugerencias: Colombia, Ecuador, Guatemala, Panamá, México, USA, Costa Rica, otros)
- `industry` (texto libre con sugerencias de industrias comunes: Banca, Retail, Seguros, Gobierno, Salud, Logística, Educación, Manufactura, Tech, Otros)
- `tier` (dropdown: Enterprise, Mid Market, SMB)
- `preferred_currency` (dropdown USD por default)
- `notes` (textarea)
- `tags` (chip input, libre)

Validaciones:
- Nombre requerido, único (case-insensitive, entre no-borrados).
- Duplicado devuelve 409 con "Ya existe un cliente con ese nombre — ¿te referías a '<nombre_existente>'?".

### Reglas

- Solo admins pueden desactivar un cliente.
- Un cliente no se puede eliminar (hard delete) si tiene oportunidades o contratos → 409.
- Soft delete marca `deleted_at`; el cliente deja de aparecer en listas pero se preserva el histórico en oportunidades/cotizaciones.

---

## Oportunidades

### Estados (flujo)

```
open → qualified → proposal → negotiation → won | lost | cancelled
```

Transiciones válidas:
- `open` → `qualified`, `cancelled`
- `qualified` → `proposal`, `cancelled`
- `proposal` → `negotiation`, `won`, `lost`, `cancelled`
- `negotiation` → `won`, `lost`, `cancelled`
- `won/lost/cancelled` son terminales.

### Pantallas

**`/opportunities`** — Lista de oportunidades

Columnas: Nombre · Cliente · Owner (comercial) · Preventa · Squad · Status · Expected close · Valor estimado · Acciones.

- Filtros: status, cliente, owner, squad, rango de fecha esperada de cierre.
- Vista alternativa: **Kanban** por status (columnas: open, qualified, proposal, negotiation, won, lost). Cada tarjeta muestra cliente, owner, valor estimado. Drag-and-drop para cambiar status (respetando transiciones válidas).
- Botón header: `+ Nueva Oportunidad`.

**`/opportunities/:id`** — Ficha de la oportunidad

Tabs:
- **Resumen:** datos (cliente, responsables, expected close, descripción, notas, tags).
- **Cotizaciones:** lista de todas las cotizaciones de esta oportunidad, con su estado, versión, valor, botón "Abrir". Botón `+ Nueva cotización` (lleva al flujo de creación de quotation).
- **Actividad:** event log filtrado.

Si `status='won'`: tarjeta destacada "Ganada · {fecha} · Cotización ganadora: {link} · Contrato: {link o 'Crear contrato'}".

Botones de acción según estado:
- `Mover a Qualified` / `Mover a Proposal` / `Mover a Negotiation` según el actual
- `Marcar como ganada` (modal pide elegir cuál cotización ganó de entre las existentes)
- `Marcar como perdida` (modal pide razón)
- `Cancelar` (modal pide razón)

### Formulario de Oportunidad

Campos:
- `client_id` (selector, requerido, pre-filled si viene de cliente)
- `name` (requerido, texto)
- `description` (textarea)
- `account_owner_id` (selector de usuarios con función=Comercial, default = usuario actual si aplica)
- `presales_lead_id` (selector de usuarios con función=Preventa, opcional)
- `squad_id` (selector, default = squad del owner)
- `expected_close_date` (date picker, opcional)
- `tags` (chip input)

Validaciones:
- Todos los campos requeridos presentes.
- Owner debe ser usuario activo.
- Transiciones de status validadas en backend (ver flujo arriba).
- Al marcar `won` se requiere `winning_quotation_id` válido.
- Al marcar `lost/cancelled` se requiere `outcome_reason`.

### Reglas

- Una oportunidad sin cotizaciones puede eliminarse (soft delete).
- Una oportunidad con cotizaciones no se puede eliminar → 409.
- Cuando se marca `won`, la cotización ganadora pasa automáticamente a `approved` si estaba en `sent`.
- Cuando se marca `lost` o `cancelled`, las cotizaciones asociadas que estén en `draft` o `sent` pasan a `rejected` o `expired` según aplique:
  - `draft` → se conservan como `draft` (no se cambian)
  - `sent` → pasan a `rejected`
  - `approved` → se conservan (no se cambian, raro caso)

### Capturar outcome reason al perder/cancelar

Modal:
- Dropdown: Precio / Timing / Competencia / Fit técnico / Interna del cliente / Otro
- Textarea opcional: notas libres adicionales
- Al guardar: persistir en `opportunities.outcome`, `outcome_reason`, `outcome_notes`, `closed_at=NOW()`.

---

## Eventos generados

**Cliente:**
- `client.created`
- `client.updated` (payload con before/after/changed_fields)
- `client.deactivated` / `client.activated`
- `client.deleted` (soft)

**Oportunidad:**
- `opportunity.created`
- `opportunity.updated`
- `opportunity.status_changed` (payload: from, to)
- `opportunity.won` (payload: winning_quotation_id)
- `opportunity.lost` (payload: reason, notes)
- `opportunity.cancelled`
- `opportunity.deleted`

---

## Notificaciones

- **Cambio de owner:** cuando se cambia `account_owner_id`, notificar al nuevo y al anterior.
- **Nueva cotización en mi oportunidad:** notificar al owner de la oportunidad si la cotización la creó otra persona.
- **Oportunidad marcada como ganada:** notificar al equipo de la cotización y al squad lead.

---

## Historias relacionadas

Ver `09_user_stories_backlog.md` épica **EO — Clientes y Oportunidades**.
