# Convención CSS — DVPNYX Quoter

> **Estado actual:** ~2,500 inline styles (`style={{ }}`) en 63 archivos.
> **Meta:** migrar a clases CSS usando el design system existente (`theme.css`).

## Por qué migrar

| Inline styles (`style={{ }}`)         | Clases CSS                                |
|---------------------------------------|-------------------------------------------|
| No soporta `:hover`, `:focus`, media queries | Pseudo-clases y responsive nativos   |
| Helmet CSP debe permitir `unsafe-inline` | CSP estricto sin excepciones            |
| Objetos recreados en cada render       | Clase estática, cero overhead             |
| Buscar "qué usa este color" = imposible | Grep por clase o variable CSS            |
| Duplicación masiva entre archivos      | Una clase reutilizable                    |

## Stack elegido

| Capa               | Archivo(s)                    | Propósito                        |
|---------------------|-------------------------------|----------------------------------|
| Design tokens       | `theme.css` (`:root`)         | Variables `--ds-*`, paleta, tipografía |
| Componentes globales | `theme.css` (`.ds-*`)        | Sidebar, topbar, chips, badges, tablas |
| Módulos             | `modules/<Nombre>.module.css` | Estilos locales con scope automático |
| Legacy              | `App.css`                     | Layout global, no tocar salvo para eliminar dead code |

**CSS Modules** es el patrón elegido para los módulos. CRA los soporta nativamente: cualquier archivo `*.module.css` genera clases con scope único sin configuración.

## Anatomía de un módulo migrado

### Antes (inline)

```jsx
// Clients.js
const s = {
  page:  { maxWidth: 1200, margin: '0 auto' },
  card:  { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20 },
  h1:    { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat' },
  btn:   { background: 'var(--purple-dark)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px' },
};

function Clients() {
  return (
    <div style={s.page}>
      <h1 style={s.h1}>Clientes</h1>
      <div style={s.card}>...</div>
      <button style={s.btn}>Nuevo</button>
    </div>
  );
}
```

### Después (CSS Module)

```css
/* Clients.module.css */
.page     { max-width: 1200px; margin: 0 auto; }
.card     { background: var(--ds-surface); border-radius: var(--ds-radius-lg); border: 1px solid var(--ds-border); padding: 20px; }
.title    { font-size: 24px; color: var(--ds-text); font-family: var(--font-ui); }
.btn      { background: var(--ds-accent); color: #fff; border: none; border-radius: var(--ds-radius); padding: 8px 16px; cursor: pointer; }
.btn:hover { filter: brightness(1.1); }
```

```jsx
// Clients.js
import cx from './Clients.module.css';

function Clients() {
  return (
    <div className={cx.page}>
      <h1 className={cx.title}>Clientes</h1>
      <div className={cx.card}>...</div>
      <button className={cx.btn}>Nuevo</button>
    </div>
  );
}
```

## Reglas

### 1. Tokens del design system

Siempre usar variables `--ds-*` de `theme.css`. Nunca valores hardcoded.

```css
/* MAL */
.card { background: #fff; border: 1px solid #e5e7eb; }

/* BIEN */
.card { background: var(--ds-surface); border: 1px solid var(--ds-border); }
```

Tokens disponibles (ver `theme.css` para la lista completa):

| Token               | Uso                          |
|----------------------|------------------------------|
| `--ds-bg`            | Fondo de página              |
| `--ds-surface`       | Fondo de cards/modales       |
| `--ds-border`        | Bordes sutiles               |
| `--ds-text`          | Texto principal              |
| `--ds-text-muted`    | Texto secundario             |
| `--ds-text-dim`      | Labels, placeholders         |
| `--ds-accent`        | Color de acento (botones, links) |
| `--ds-ok` / `--ds-ok-soft`     | Estado positivo  |
| `--ds-warn` / `--ds-warn-soft` | Estado advertencia |
| `--ds-bad` / `--ds-bad-soft`   | Estado error     |
| `--ds-radius`        | Border radius estándar (6px) |
| `--ds-radius-lg`     | Border radius grande (10px)  |
| `--ds-shadow-sm`     | Sombra sutil                 |
| `--ds-shadow-md`     | Sombra elevada               |
| `--font-ui`          | Tipografía UI (Inter)        |
| `--font-mono`        | Tipografía código (JetBrains Mono) |

### 2. Clases globales reutilizables (ya existen en `theme.css`)

No redefinir en módulos lo que ya existe:

| Clase         | Propósito                            |
|---------------|--------------------------------------|
| `.ds-table`   | Tabla con hover, sticky headers      |
| `.ds-chip`    | Pill/tag con variantes `.ok`, `.warn`, `.bad` |
| `.ds-badge`   | Badge inline en celdas               |
| `.ds-icon-btn`| Botón icónico (topbar, acciones)     |

### 3. Nombrado de clases en módulos

- `camelCase` para nombres en CSS Modules (`.filterBar`, `.modalOverlay`).
- Nombres descriptivos del **propósito**, no de la apariencia: `.filterBar` no `.flexRowGap8`.
- Si un estilo se repite en 3+ módulos, promoverlo a `theme.css` como clase `.ds-*`.

### 4. Tablas: eliminar `tableStyles.js`

El archivo `shell/tableStyles.js` exporta objetos `th`/`td` para usarse como inline styles. Migrar a clases CSS definidas en `.ds-table th` y `.ds-table td` en `theme.css`.

```jsx
/* ANTES — inline via tableStyles.js */
import { th as dsTh, td as dsTd, TABLE_CLASS } from '../shell/tableStyles';
<th style={{ ...dsTh, textAlign: 'right' }}>Monto</th>
<td style={dsTd}>{row.amount}</td>

/* DESPUÉS — clases CSS */
<table className="ds-table">
  <th className="text-right">Monto</th>
  <td>{row.amount}</td>
</table>
```

Esto requiere que las reglas de `th`/`td` en `theme.css` pasen de ser solo `:hover` y sticky a incluir padding, font-size, borders (lo que hoy está en `tableStyles.js`).

### 5. Modales: patrón estándar

Cada módulo define su propio `modalBg` y `modal`. Crear una clase `.ds-modal-overlay` y `.ds-modal` en `theme.css`.

### 6. Formularios: patrón estándar

`.ds-input`, `.ds-label`, `.ds-select`, `.ds-textarea` en `theme.css` para reemplazar los `s.input` / `s.label` repetidos en cada módulo.

### 7. Layout utilities

En vez de `style={{ display: 'flex', gap: 8, alignItems: 'center' }}` repetido cientos de veces, agregar utilities a `theme.css`:

```css
.ds-row     { display: flex; align-items: center; gap: 8px; }
.ds-col     { display: flex; flex-direction: column; gap: 8px; }
.ds-between { display: flex; justify-content: space-between; align-items: center; }
.ds-grid-2  { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ds-wrap    { flex-wrap: wrap; }
```

## Plan de migración

### Orden recomendado

1. **`theme.css`** — agregar las clases globales faltantes (`.ds-modal-*`, `.ds-input`, `.ds-label`, layout utilities, table cell defaults).
2. **`shell/`** (6 archivos, ~50 inline styles) — componentes compartidos, impacto alto.
3. **`modules/reports/`** (13 archivos, ~60 inline styles) — código nuevo, más fácil de migrar.
4. **Módulos de baja complejidad** — Areas, Skills, ExchangeRates, Users (~40 inline styles cada uno).
5. **Módulos de alta complejidad** — Employees, Opportunities, CapacityPlanner (100+ cada uno).
6. **Eliminar `tableStyles.js`** — una vez que todos los módulos usen `.ds-table` con clases.

### Proceso por archivo

1. Crear `<Modulo>.module.css` junto al `.js`.
2. Copiar cada objeto del `const s = { }` como una clase CSS.
3. Reemplazar `style={s.xxx}` por `className={cx.xxx}`.
4. Reemplazar `style={{ ...s.xxx, overrideKey: val }}` por `className={cx.xxx}` + clase modificadora o utility.
5. Eliminar el objeto `const s`.
6. Verificar visualmente.

### Cuánto toma

| Bloque                  | Archivos | Inline styles | Estimado  |
|-------------------------|----------|---------------|-----------|
| theme.css globales      | 1        | —             | 2–3 horas |
| shell/                  | 6        | ~50           | 2 horas   |
| reports/                | 13       | ~60           | 3 horas   |
| Módulos simples (10)    | 10       | ~400          | 6 horas   |
| Módulos complejos (10)  | 10       | ~1,000        | 12 horas  |
| Módulos medianos (20)   | 20       | ~900          | 12 horas  |
| Cleanup tableStyles.js  | 1        | —             | 1 hora    |
| **Total**               | **63**   | **~2,500**    | **~38 horas** |

## Inline style permitido (excepciones)

El único caso donde `style={{ }}` sigue siendo aceptable:

- **Valores dinámicos calculados en runtime**: `style={{ width: `${percent}%` }}`, `style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}`.
- **Posicionamiento absoluto contextual**: tooltips, dropdowns posicionados con coordenadas calculadas.

Todo lo demás va en clases.
