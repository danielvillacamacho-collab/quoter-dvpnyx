/**
 * Generic HTTP helpers for V2 modules.
 *
 * Reuses the same token from localStorage that the legacy api.js uses,
 * so both coexist. Unlike api.js (which hardcodes the /api prefix), these
 * helpers accept a full path including /api so tests can mock any URL.
 */

const getToken = () => localStorage.getItem('dvpnyx_token');

async function request(method, path, body) {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem('dvpnyx_token');
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    return null;
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const apiGet    = (path)       => request('GET',    path);
export const apiPost   = (path, body) => request('POST',   path, body);
export const apiPut    = (path, body) => request('PUT',    path, body);
export const apiDelete = (path)       => request('DELETE', path);

/**
 * Trigger a browser download of a binary/text response from the API
 * while still passing the bearer token. We intentionally don't use
 * a plain <a href> because the token lives in localStorage — the
 * server won't see it on a raw navigation. Instead we fetch with the
 * Authorization header, materialize the body as a Blob and synthesize
 * a one-shot anchor click.
 *
 * On non-2xx the returned promise rejects with a normal Error whose
 * `.status` mirrors the HTTP code (so callers can show a toast).
 */
export async function apiDownload(path, filename) {
  const token = getToken();
  const res = await fetch(path, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free the blob url on the next tick so Safari has a chance to read it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
