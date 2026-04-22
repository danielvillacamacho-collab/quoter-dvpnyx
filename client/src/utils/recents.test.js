import { loadRecents, pushRecent, clearRecents, RECENTS_KEY, RECENTS_MAX } from './recents';

beforeEach(() => { window.localStorage.clear(); });

describe('recents', () => {
  it('returns [] when storage is empty', () => {
    expect(loadRecents()).toEqual([]);
  });

  it('returns [] when storage is malformed JSON', () => {
    window.localStorage.setItem(RECENTS_KEY, 'not-json');
    expect(loadRecents()).toEqual([]);
  });

  it('filters out rows with the wrong shape', () => {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify([
      { type: 'client', id: 'c1', title: 'ok', url: '/x' },
      { id: 'c2' },                 // missing type/title/url
      null,
      'garbage',
    ]));
    const rows = loadRecents();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c1');
  });

  it('pushRecent inserts at top and dedupes by (type,id)', () => {
    pushRecent({ type: 'client', id: 'c1', title: 'A', url: '/clients/c1' });
    pushRecent({ type: 'client', id: 'c2', title: 'B', url: '/clients/c2' });
    pushRecent({ type: 'client', id: 'c1', title: 'A updated', url: '/clients/c1' });
    const rows = loadRecents();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'c1', title: 'A updated' });
    expect(rows[1].id).toBe('c2');
  });

  it('pushRecent caps at RECENTS_MAX', () => {
    for (let i = 0; i < RECENTS_MAX + 5; i++) {
      pushRecent({ type: 'client', id: `c${i}`, title: `C${i}`, url: `/clients/c${i}` });
    }
    expect(loadRecents()).toHaveLength(RECENTS_MAX);
  });

  it('pushRecent ignores invalid items', () => {
    pushRecent(null);
    pushRecent({ type: 'client' }); // missing id/title/url
    expect(loadRecents()).toEqual([]);
  });

  it('clearRecents empties the store', () => {
    pushRecent({ type: 'client', id: 'c1', title: 'A', url: '/clients/c1' });
    clearRecents();
    expect(loadRecents()).toEqual([]);
  });
});
