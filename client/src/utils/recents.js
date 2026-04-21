/**
 * Tiny localStorage-backed MRU list of items the user navigated to from
 * the Command Palette. Used to seed the empty-query state so ⌘K feels
 * useful before the user types anything.
 *
 * Design choices:
 *   - Bounded (MAX items) so the key never grows unbounded.
 *   - Schema is exactly the palette's search-result row so the render
 *     path is identical (type/id/title/subtitle/url).
 *   - Dedupes by (type, id) — re-selecting an item bumps it to the top.
 *   - Fail-soft: any I/O error returns the safe default. Users in
 *     Safari private mode etc. still get a working palette.
 */

const KEY = 'dvpnyx:palette-recents';
const MAX = 8;

export function loadRecents() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: only keep valid row shapes so a corrupted entry can't
    // crash the palette render.
    return parsed.filter(
      (r) => r && typeof r === 'object'
          && typeof r.type === 'string'
          && (typeof r.id === 'string' || typeof r.id === 'number')
          && typeof r.title === 'string'
          && typeof r.url === 'string'
    ).slice(0, MAX);
  } catch (_e) {
    return [];
  }
}

export function pushRecent(item) {
  if (!item || !item.type || item.id == null || !item.title || !item.url) return loadRecents();
  const slim = {
    type: item.type,
    id: item.id,
    title: item.title,
    subtitle: item.subtitle || null,
    url: item.url,
  };
  try {
    const current = loadRecents().filter((r) => !(r.type === slim.type && String(r.id) === String(slim.id)));
    const next = [slim, ...current].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch (_e) {
    return loadRecents();
  }
}

export function clearRecents() {
  try { window.localStorage.removeItem(KEY); } catch (_e) { /* noop */ }
}

export const RECENTS_MAX = MAX;
export const RECENTS_KEY = KEY;
