import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { apiGet, apiPost } from '../utils/apiV2';

/**
 * NotificationsDrawer — right-side slide-over that lists the current
 * user's in-app notifications.
 *
 * Props:
 *   open     — boolean (parent controls visibility)
 *   onClose  — () => void
 *   onUpdateUnread — (count: number) => void  (bubbles up after mutations
 *                    so the bell badge stays in sync immediately)
 *
 * Fetch strategy:
 *   - On open: fetch /api/notifications (the full list).
 *   - After mark-one or mark-all: refetch + push unread count upstream.
 *
 * The drawer never throws: network errors render inline and the close
 * button always works.
 */

const s = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 400,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex', justifyContent: 'flex-end',
  },
  panel: {
    width: '100%', maxWidth: 420, height: '100vh',
    background: 'var(--ds-surface, #fff)',
    borderLeft: '1px solid var(--ds-border, #e5e5e5)',
    boxShadow: 'var(--ds-shadow-md, -6px 0 20px rgba(0,0,0,0.18))',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--font-ui, inherit)',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 16px',
    borderBottom: '1px solid var(--ds-border, #e5e5e5)',
  },
  title: { fontSize: 14, fontWeight: 700, color: 'var(--ds-text, #222)', flex: 1 },
  ghostBtn: {
    background: 'transparent', border: '1px solid var(--ds-border, #e5e5e5)',
    borderRadius: 6, padding: '4px 10px',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    color: 'var(--ds-text-muted, #666)',
  },
  closeBtn: {
    background: 'transparent', border: 0, cursor: 'pointer',
    fontSize: 18, color: 'var(--ds-text-muted, #666)',
    marginLeft: 4,
  },
  list: { flex: 1, overflowY: 'auto' },
  item: (unread) => ({
    display: 'flex', gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid var(--ds-border, #eee)',
    cursor: 'pointer',
    background: unread ? 'var(--ds-accent-soft, #f5eaff)' : 'transparent',
  }),
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 13, fontWeight: 600, color: 'var(--ds-text, #222)', marginBottom: 2 },
  itemSub:   { fontSize: 12, color: 'var(--ds-text-muted, #666)' },
  itemTime:  { fontSize: 11, color: 'var(--ds-text-dim, #888)', marginTop: 4 },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    background: 'var(--ds-accent, #7a3a8f)',
    flexShrink: 0, marginTop: 6,
  },
  empty: { padding: 24, textAlign: 'center', color: 'var(--ds-text-muted, #666)', fontSize: 13 },
  error: { padding: 16, color: 'var(--ds-bad, #c0392b)', fontSize: 12 },
};

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const s_ = Math.max(0, Math.floor(ms / 1000));
  if (s_ < 60) return 'hace segundos';
  const m = Math.floor(s_ / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString('es-CO');
}

export default function NotificationsDrawer({ open, onClose, onUpdateUnread }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const nav = useNavigate();

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const data = await apiGet('/api/notifications');
      const list = Array.isArray(data?.data) ? data.data : [];
      setItems(list);
      if (typeof onUpdateUnread === 'function') {
        onUpdateUnread(list.filter((n) => !n.read_at).length);
      }
    } catch (ex) {
      setErr(ex.message || 'Error al cargar notificaciones');
    } finally {
      setLoading(false);
    }
  }, [onUpdateUnread]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  const openItem = useCallback(async (n) => {
    // Optimistic mark-as-read so the UI feels instant.
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      try {
        await apiPost(`/api/notifications/${n.id}/read`, {});
        if (typeof onUpdateUnread === 'function') {
          onUpdateUnread(Math.max(0, unreadCount - 1));
        }
      } catch (_e) { /* non-fatal; list will reconcile on next refresh */ }
    }
    onClose?.();
    if (n.link) nav(n.link);
  }, [nav, onClose, onUpdateUnread, unreadCount]);

  const markAll = useCallback(async () => {
    try {
      await apiPost('/api/notifications/read-all', {});
      setItems((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })));
      if (typeof onUpdateUnread === 'function') onUpdateUnread(0);
    } catch (ex) {
      setErr(ex.message || 'No se pudo marcar todo como leído');
    }
  }, [onUpdateUnread]);

  if (!open) return null;

  return (
    <div
      style={s.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Notificaciones"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="notif-drawer"
    >
      <div style={s.panel} onMouseDown={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <Bell size={16} aria-hidden="true" />
          <div style={s.title}>Notificaciones</div>
          {unreadCount > 0 && (
            <button
              type="button"
              style={s.ghostBtn}
              onClick={markAll}
              data-testid="notif-mark-all"
            >
              Marcar todo como leído
            </button>
          )}
          <button
            type="button"
            style={s.closeBtn}
            onClick={onClose}
            aria-label="Cerrar"
            data-testid="notif-close"
          >×</button>
        </div>

        {err && <div style={s.error} role="alert" data-testid="notif-error">{err}</div>}

        <div style={s.list} data-testid="notif-list">
          {loading ? (
            <div style={s.empty} data-testid="notif-loading">Cargando…</div>
          ) : items.length === 0 ? (
            <div style={s.empty} data-testid="notif-empty">No tienes notificaciones.</div>
          ) : (
            items.map((n) => {
              const unread = !n.read_at;
              return (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  style={s.item(unread)}
                  onClick={() => openItem(n)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(n); } }}
                  data-testid={`notif-item-${n.id}`}
                >
                  {unread && <span style={s.dot} aria-label="No leída" />}
                  <div style={s.itemBody}>
                    <div style={s.itemTitle}>{n.title}</div>
                    {n.body && <div style={s.itemSub}>{n.body}</div>}
                    <div style={s.itemTime}>{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
