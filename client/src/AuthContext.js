/**
 * AuthContext — shared auth context so modules outside App.js can
 * call useAuth() without importing from the monolithic App.js.
 *
 * App.js imports { AuthCtx, AuthProvider, useAuth } from here and
 * renders <AuthProvider>. Any module can import { useAuth }.
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import * as api from './utils/api';

export const AuthCtx = createContext();
export const useAuth = () => useContext(AuthCtx);

/**
 * Phase 10 UI refresh — apply the user's UI preferences to :root so every
 * DS token re-resolves (`--accent-hue` drives `--ds-accent*`, `--density`
 * drives `--ds-row-h`, `data-scheme="dark"` flips the dark palette).
 *
 * Called on mount with the hydrated user, and again every time the user
 * changes preferences via the Preferencias page — no reload needed.
 */
function applyPreferences(prefs) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const p = prefs || {};
  root.setAttribute('data-scheme', p.scheme === 'dark' ? 'dark' : 'light');
  if (Number.isFinite(p.accentHue)) root.style.setProperty('--accent-hue', String(p.accentHue));
  else root.style.removeProperty('--accent-hue');
  if (Number.isFinite(p.density)) root.style.setProperty('--density', String(p.density));
  else root.style.removeProperty('--density');
}

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [params, setParams]  = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('dvpnyx_token');
    if (token) {
      Promise.all([api.getMe(), api.getParams()])
        .then(([u, p]) => { setUser(u); setParams(p); applyPreferences(u?.preferences); })
        .catch(() => localStorage.removeItem('dvpnyx_token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const doLogin = async (email, pw) => {
    const { token, user: u } = await api.login(email, pw);
    localStorage.setItem('dvpnyx_token', token);
    const p = await api.getParams();
    return { user: u, params: p };
  };

  const commitLogin  = (u, p) => { setUser(u); setParams(p); applyPreferences(u?.preferences); };
  const doLogout     = () => {
    localStorage.removeItem('dvpnyx_token');
    setUser(null); setParams(null);
    applyPreferences(null);
  };
  const refreshParams = async () => { const p = await api.getParams(); setParams(p); };

  /**
   * Update UI prefs. Optimistically applies to :root so the UI repaints
   * instantly, then PUTs to the server and reconciles with whatever the
   * backend returns (sanitized/coerced values).
   */
  const updatePreferences = async (patch) => {
    const optimistic = { ...(user?.preferences || {}), ...patch };
    setUser((prev) => (prev ? { ...prev, preferences: optimistic } : prev));
    applyPreferences(optimistic);
    try {
      const { preferences } = await api.updatePreferences(patch);
      setUser((prev) => (prev ? { ...prev, preferences } : prev));
      applyPreferences(preferences);
      return preferences;
    } catch (e) {
      // roll back on failure so the UI reflects the real server state
      setUser((prev) => (prev ? { ...prev, preferences: user?.preferences || {} } : prev));
      applyPreferences(user?.preferences);
      throw e;
    }
  };

  const isAdmin       = user && ['admin', 'superadmin'].includes(user.role);
  const isLead        = user && user.role === 'lead';
  // Cualquier líder o admin puede ver dashboards de equipo (ej. plan-vs-real,
  // /time/team con picker de su equipo).
  const isLeadOrAdmin = isAdmin || isLead;

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--ds-text, var(--purple-dark))', fontSize: 18 }}>Cargando...</div>
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ user, params, doLogin, commitLogin, doLogout, refreshParams, updatePreferences, isAdmin, isLead, isLeadOrAdmin }}>
      {children}
    </AuthCtx.Provider>
  );
}
