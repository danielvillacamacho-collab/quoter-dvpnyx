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

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [params, setParams]  = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('dvpnyx_token');
    if (token) {
      Promise.all([api.getMe(), api.getParams()])
        .then(([u, p]) => { setUser(u); setParams(p); })
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

  const commitLogin  = (u, p) => { setUser(u); setParams(p); };
  const doLogout     = () => { localStorage.removeItem('dvpnyx_token'); setUser(null); setParams(null); };
  const refreshParams = async () => { const p = await api.getParams(); setParams(p); };
  const isAdmin      = user && ['admin', 'superadmin'].includes(user.role);

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--purple-dark)', fontSize: 18 }}>Cargando...</div>
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ user, params, doLogin, commitLogin, doLogout, refreshParams, isAdmin }}>
      {children}
    </AuthCtx.Provider>
  );
}
