import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiGet } from '../utils/apiV2';
import { loadRecents, pushRecent } from '../utils/recents';

/**
 * CommandPalette — global ⌘K / Ctrl+K spotlight.
 *
 * Lives at the top of <Layout /> in App.js. Listens globally for the
 * shortcut, opens a centered overlay, and queries `/api/search` with a
 * 200ms debounce as the user types. Results are grouped by domain and
 * fully keyboard-navigable (↑/↓ + Enter, Esc to close).
 *
 * Design intent:
 *   - Purely additive: mounts even when other parts of the UI are
 *     broken; it's a navigation shortcut, never a dependency.
 *   - Never blocks the page: if the fetch fails, we just show the
 *     error inline and keep the palette open.
 *   - All presentational styling uses the --ds-* design tokens; falls
 *     back gracefully on legacy color variables.
 */

const TYPE_LABELS = {
  client:           'Clientes',
  opportunity:      'Oportunidades',
  contract:         'Contratos',
  employee:         'Empleados',
  quotation:        'Cotizaciones',
  resource_request: 'Solicitudes de recursos',
};

// Stable section order — matches the canonical commercial funnel so the
// palette "reads" like the product flow (lead → deal → contract → …).
const TYPE_ORDER = ['client', 'opportunity', 'contract', 'resource_request', 'employee', 'quotation'];

// Quick actions shown when the query is empty. These are pure navigation
// shortcuts — they never hit the server and never enter the recents list
// (they already live here, and recents should be per-entity).
const QUICK_ACTIONS = [
  { id: 'new-staff-aug',  title: 'Nueva cotización Staff Augmentation', subtitle: 'Crear cotización nueva',   url: '/quotation/new/staff_aug' },
  { id: 'new-project',    title: 'Nueva cotización Alcance Fijo',       subtitle: 'Crear cotización nueva',   url: '/quotation/new/fixed_scope' },
  { id: 'go-assignments', title: 'Ver asignaciones',                     subtitle: 'Módulo de asignaciones',  url: '/assignments' },
  { id: 'go-planner',     title: 'Ver planner de capacidad',             subtitle: 'Planeador semanal',       url: '/capacity/planner' },
  { id: 'go-requests',    title: 'Ver solicitudes de recursos',          subtitle: 'Pipeline de delivery',    url: '/resource-requests' },
  { id: 'go-time-me',     title: 'Ver mis horas',                         subtitle: 'Registro de tiempo',     url: '/time/me' },
];

const DEBOUNCE_MS = 200;

const s = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 500,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    paddingTop: '10vh',
  },
  panel: {
    width: '100%', maxWidth: 560,
    background: 'var(--ds-surface, #fff)',
    border: '1px solid var(--ds-border, #e5e5e5)',
    borderRadius: 'var(--ds-radius-lg, 10px)',
    boxShadow: 'var(--ds-shadow-md, 0 10px 30px rgba(0,0,0,0.18))',
    overflow: 'hidden',
    fontFamily: 'var(--font-ui, inherit)',
  },
  searchRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 16px',
    borderBottom: '1px solid var(--ds-border, #e5e5e5)',
  },
  input: {
    flex: 1,
    border: 'none', outline: 'none', background: 'transparent',
    fontSize: 16, color: 'var(--ds-text, #222)',
  },
  hintKbd: {
    fontSize: 11, padding: '2px 6px',
    border: '1px solid var(--ds-border, #e5e5e5)',
    borderRadius: 4,
    color: 'var(--ds-text-muted, #666)',
  },
  list: { maxHeight: 420, overflowY: 'auto', padding: '6px 0' },
  sectionLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'var(--ds-text-dim, #888)',
    padding: '10px 16px 4px',
  },
  item: (active) => ({
    display: 'flex', flexDirection: 'column', gap: 2,
    padding: '8px 16px',
    cursor: 'pointer',
    background: active ? 'var(--ds-hover, #f2f2f2)' : 'transparent',
    borderLeft: active ? '2px solid var(--ds-accent, #7a3a8f)' : '2px solid transparent',
  }),
  itemTitle: { fontSize: 13, fontWeight: 600, color: 'var(--ds-text, #222)' },
  itemSub:   { fontSize: 11, color: 'var(--ds-text-muted, #666)' },
  empty: { padding: '24px 16px', textAlign: 'center', color: 'var(--ds-text-muted, #666)', fontSize: 13 },
  error: { padding: '12px 16px', color: 'var(--ds-bad, #c0392b)', fontSize: 12 },
};

export default function CommandPalette({ open, onClose }) {
  const [q, setQ]         = useState('');
  const [results, setR]   = useState([]);
  const [loading, setL]   = useState(false);
  const [err, setErr]     = useState(null);
  const [cursor, setCur]  = useState(0);
  const [recents, setRecents] = useState([]);
  const inputRef = useRef(null);
  const nav = useNavigate();

  // Reset + focus + reload recents on open. Recents are re-read from
  // localStorage each time the palette opens so another tab's picks
  // surface immediately (no cross-tab listener needed).
  useEffect(() => {
    if (!open) return;
    setQ(''); setR([]); setErr(null); setCur(0);
    setRecents(loadRecents());
    // defer to next tick so the input is mounted
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Debounced fetch while typing.
  useEffect(() => {
    if (!open) return undefined;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setR([]); setErr(null); setL(false); setCur(0);
      return undefined;
    }
    let cancelled = false;
    setL(true); setErr(null);
    const t = setTimeout(async () => {
      try {
        const data = await apiGet(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (cancelled) return;
        setR(Array.isArray(data?.results) ? data.results : []);
        setCur(0);
      } catch (ex) {
        if (!cancelled) setErr(ex.message || 'Error en la búsqueda');
      } finally {
        if (!cancelled) setL(false);
      }
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  // Group results by type in canonical order, preserving per-type arrival order.
  const grouped = useMemo(() => {
    const bucket = {};
    for (const r of results) {
      if (!bucket[r.type]) bucket[r.type] = [];
      bucket[r.type].push(r);
    }
    return TYPE_ORDER
      .filter((t) => bucket[t]?.length)
      .map((t) => ({ type: t, items: bucket[t] }));
  }, [results]);

  // Empty-query state: "Recientes" (from localStorage) + "Acciones rápidas"
  // (fixed nav shortcuts). These render as two synthetic sections in place
  // of search results when q.trim().length < 2.
  const emptyGroups = useMemo(() => {
    const out = [];
    if (recents.length) out.push({ kind: 'recent',  label: 'Recientes',       items: recents });
    out.push({ kind: 'action', label: 'Acciones rápidas', items: QUICK_ACTIONS });
    return out;
  }, [recents]);

  const showingEmptyState = q.trim().length < 2;

  // Flat list order — keyboard cursor indexes into this. In empty state
  // we iterate recents+actions; otherwise the fetched groups.
  const flat = useMemo(() => {
    if (showingEmptyState) return emptyGroups.flatMap((g) => g.items);
    return grouped.flatMap((g) => g.items);
  }, [showingEmptyState, emptyGroups, grouped]);

  const go = useCallback((item, opts = {}) => {
    onClose?.();
    // Only entity picks (search results / recents) bump the recents list.
    // Quick actions navigate but don't pollute MRU.
    if (opts.remember && item?.type && item.id != null && item.url) {
      pushRecent(item);
    }
    if (item?.url) nav(item.url);
  }, [nav, onClose]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, Math.max(flat.length - 1, 0))); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter')     {
      const item = flat[cursor];
      if (item) { e.preventDefault(); go(item, { remember: Boolean(item.type) }); }
    }
  }, [cursor, flat, go, onClose]);

  if (!open) return null;

  return (
    <div
      style={s.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Búsqueda global"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="command-palette"
    >
      <div style={s.panel} onMouseDown={(e) => e.stopPropagation()}>
        <div style={s.searchRow}>
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            style={s.input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar clientes, oportunidades, empleados…"
            aria-label="Consulta de búsqueda"
            data-testid="cmdp-input"
          />
          <span style={s.hintKbd}>Esc</span>
        </div>

        {err && <div style={s.error} role="alert" data-testid="cmdp-error">{err}</div>}

        <div style={s.list} data-testid="cmdp-list">
          {showingEmptyState ? (
            emptyGroups.map((group) => {
              const startIdx = flat.indexOf(group.items[0]);
              const testidPrefix = group.kind === 'recent' ? 'cmdp-recent' : 'cmdp-action';
              return (
                <div key={group.kind} data-testid={`cmdp-group-${group.kind}`}>
                  <div style={s.sectionLabel}>{group.label}</div>
                  {group.items.map((item, i) => {
                    const idx = startIdx + i;
                    const active = idx === cursor;
                    return (
                      <div
                        key={`${group.kind}:${item.id}`}
                        role="button"
                        tabIndex={-1}
                        aria-selected={active}
                        style={s.item(active)}
                        onMouseEnter={() => setCur(idx)}
                        onClick={() => go(item, { remember: Boolean(item.type) })}
                        data-testid={`${testidPrefix}-${item.id}`}
                      >
                        <span style={s.itemTitle}>{item.title}</span>
                        {item.subtitle && <span style={s.itemSub}>{item.subtitle}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })
          ) : loading ? (
            <div style={s.empty} data-testid="cmdp-loading">Buscando…</div>
          ) : flat.length === 0 ? (
            <div style={s.empty} data-testid="cmdp-empty">Sin resultados para "{q}".</div>
          ) : (
            grouped.map((group) => {
              // Figure out the absolute index each item occupies in the flat list.
              const startIdx = flat.indexOf(group.items[0]);
              return (
                <div key={group.type}>
                  <div style={s.sectionLabel}>{TYPE_LABELS[group.type] || group.type}</div>
                  {group.items.map((item, i) => {
                    const idx = startIdx + i;
                    const active = idx === cursor;
                    return (
                      <div
                        key={`${item.type}:${item.id}`}
                        role="button"
                        tabIndex={-1}
                        aria-selected={active}
                        style={s.item(active)}
                        onMouseEnter={() => setCur(idx)}
                        onClick={() => go(item, { remember: true })}
                        data-testid={`cmdp-item-${item.type}-${item.id}`}
                      >
                        <span style={s.itemTitle}>{item.title}</span>
                        {item.subtitle && <span style={s.itemSub}>{item.subtitle}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
