const BASE = process.env.REACT_APP_API_URL || '/api';

const getToken = () => localStorage.getItem('dvpnyx_token');

export const api = async (path, opts = {}) => {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { localStorage.removeItem('dvpnyx_token'); window.location.href = '/login'; return; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
};

export const login = (email, password) => api('/auth/login', { method: 'POST', body: { email, password } });
export const getMe = () => api('/auth/me');
export const changePassword = (current_password, new_password) => api('/auth/change-password', { method: 'POST', body: { current_password, new_password } });
export const updatePreferences = (patch) => api('/auth/me/preferences', { method: 'PUT', body: patch });
export const getUsers = () => api('/users');
export const createUser = (data) => api('/users', { method: 'POST', body: data });
export const updateUser = (id, data) => api(`/users/${id}`, { method: 'PUT', body: data });
export const deleteUser = (id) => api(`/users/${id}`, { method: 'DELETE' });
export const resetUserPassword = (id) => api(`/users/${id}/reset-password`, { method: 'POST' });
export const getParams = () => api('/parameters');
export const updateParam = (id, data) => api(`/parameters/${id}`, { method: 'PUT', body: data });
export const getQuotations = () => api('/quotations');
export const getQuotation = (id) => api(`/quotations/${id}`);
export const createQuotation = (data) => api('/quotations', { method: 'POST', body: data });
export const updateQuotation = (id, data) => api(`/quotations/${id}`, { method: 'PUT', body: data });
export const duplicateQuotation = (id) => api(`/quotations/${id}/duplicate`, { method: 'POST' });
export const deleteQuotation = (id) => api(`/quotations/${id}`, { method: 'DELETE' });
export const getDashboardOverview = () => api('/dashboard/overview');
