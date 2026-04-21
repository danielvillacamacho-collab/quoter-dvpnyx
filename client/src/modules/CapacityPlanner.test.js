import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import CapacityPlanner from './CapacityPlanner';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

/* ── Fixtures ──────────────────────────────────────────────────────── */

const makeWeeks = (n = 12, startIso = '2026-04-20', startWeek = 17) => {
  const out = [];
  let cur = new Date(startIso + 'T00:00:00Z');
  for (let i = 0; i < n; i += 1) {
    const end = new Date(cur.getTime()); end.setUTCDate(end.getUTCDate() + 6);
    out.push({
      index: i,
      start_date: cur.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      iso_week: startWeek + i,
      label: `S${startWeek + i}`,
      short_label: `Abr ${cur.getUTCDate()}`,
    });
    cur = new Date(cur.getTime()); cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
};

const plannerResponse = () => ({
  window: { start_date: '2026-04-20', end_date: '2026-07-12', weeks: 12 },
  weeks: makeWeeks(12),
  employees: [
    {
      id: 'e1', first_name: 'Ana', last_name: 'García', full_name: 'Ana García',
      level: 'L5', area_id: 1, area_name: 'Desarrollo', status: 'active',
      weekly_capacity_hours: 40,
      assignments: [
        {
          id: 'a1', contract_id: 'ct1', contract_name: 'Contrato Alpha',
          client_name: 'Acme', resource_request_id: 'rr1',
          role_title: 'Backend Lead', weekly_hours: 20,
          start_date: '2026-04-20', end_date: '2026-06-14', status: 'active',
          color: '#6B5B95', week_range: [0, 7],
        },
      ],
      weekly: Array.from({ length: 12 }, (_, i) => ({
        week_index: i, start_date: '',
        hours: i <= 7 ? 20 : 0,
        utilization_pct: i <= 7 ? 50 : 0,
        bucket: i <= 7 ? 'light' : 'idle',
      })),
    },
    {
      id: 'e2', first_name: 'Pedro', last_name: 'Zúñiga', full_name: 'Pedro Zúñiga',
      level: 'L3', area_id: 2, area_name: 'Testing', status: 'active',
      weekly_capacity_hours: 40,
      assignments: [],
      weekly: Array.from({ length: 12 }, (_, i) => ({
        week_index: i, start_date: '', hours: 0, utilization_pct: 0, bucket: 'idle',
      })),
    },
  ],
  open_requests: [
    {
      id: 'rr9', contract_id: 'ct3', contract_name: 'Contrato Gamma', client_name: 'Initech',
      role_title: 'QA Sr', level: 'L6', area_id: 2, area_name: 'Testing',
      weekly_hours: 40, quantity: 2, filled_count: 0, missing: 2,
      start_date: '2026-05-04', end_date: '2026-06-14', status: 'open',
      color: '#E98B3F', week_range: [2, 7],
    },
  ],
  contracts: [
    { id: 'ct1', name: 'Contrato Alpha', client_name: 'Acme', color: '#6B5B95' },
    { id: 'ct3', name: 'Contrato Gamma', client_name: 'Initech', color: '#E98B3F' },
  ],
  meta: { total_employees: 2, active_employees: 1, avg_utilization_pct: 50, overbooked_count: 0, open_request_count: 1 },
  filters_applied: { contract_id: null, area_id: null, level_min: null, level_max: null, search: null },
});

// Helper used by some tests to read the current URL from the router.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc" data-pathname={loc.pathname} data-search={loc.search} />;
}

const mount = (initialEntry = '/capacity/planner') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/capacity/planner" element={<><CapacityPlanner /><LocationProbe /></>} />
        <Route path="/resource-requests" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/capacity/planner')) return Promise.resolve(plannerResponse());
    if (url.startsWith('/api/areas')) return Promise.resolve({ data: [{ id: 1, name: 'Desarrollo' }, { id: 2, name: 'Testing' }] });
    return Promise.resolve({});
  });
});

describe('CapacityPlanner module', () => {
  it('renders header and metric cards from meta', async () => {
    mount();
    expect(await screen.findByText(/Capacity Planner/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Personas activas')).toHaveTextContent('1');
    expect(screen.getByLabelText('Utilización promedio')).toHaveTextContent('50%');
    expect(screen.getByLabelText('Sobre-asignados')).toHaveTextContent('0');
    expect(screen.getByLabelText('Requests sin cubrir')).toHaveTextContent('1');
  });

  it('renders week header columns and employee rows', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/capacity\/planner\?/)));
    expect(await screen.findByTestId('week-17')).toBeInTheDocument();
    expect(screen.getByTestId('week-28')).toBeInTheDocument();
    expect(screen.getByTestId('emp-row-e1')).toBeInTheDocument();
    expect(screen.getByTestId('emp-row-e2')).toBeInTheDocument();

    const anaRow = screen.getByTestId('emp-row-e1');
    expect(within(anaRow).getByText('Ana García')).toBeInTheDocument();
    // Ana's first 8 weeks have Alpha assignment bar
    expect(within(anaRow).getAllByText(/Contrato Alpha/).length).toBeGreaterThanOrEqual(8);
    // Week 0 shows 50% chip
    expect(within(screen.getByTestId('cell-e1-0')).getByText('50%')).toBeInTheDocument();
  });

  it('renders unassigned request row', async () => {
    mount();
    const row = await screen.findByTestId('unassigned-row-rr9');
    // role_title appears in both the row title AND every bar (one per week in range),
    // so scope to the row-title span rather than a global getByText.
    expect(within(row).getByText(/faltan 2/)).toBeInTheDocument();
    expect(within(row).getAllByText(/QA Sr/).length).toBeGreaterThan(0);
  });

  it('sends contract_id and search filters to the API and syncs the URL', async () => {
    mount();
    await screen.findByTestId('emp-row-e1');

    fireEvent.change(screen.getByLabelText('Filtro contrato'), { target: { value: 'ct1' } });
    await waitFor(() => {
      expect(apiV2.apiGet.mock.calls.some((c) => String(c[0]).includes('contract_id=ct1'))).toBe(true);
    });
    expect(screen.getByTestId('loc').getAttribute('data-search')).toMatch(/contract_id=ct1/);

    fireEvent.change(screen.getByLabelText('Buscar empleado'), { target: { value: 'Ana' } });
    await waitFor(() => {
      expect(apiV2.apiGet.mock.calls.some((c) => String(c[0]).includes('search=Ana'))).toBe(true);
    });
    expect(screen.getByTestId('loc').getAttribute('data-search')).toMatch(/search=Ana/);
  });

  it('hydrates filters from the URL on first render', async () => {
    mount('/capacity/planner?start=2026-04-20&weeks=4&contract_id=ct1&search=Ana');
    await waitFor(() => {
      const lastPlannerCall = apiV2.apiGet.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.startsWith('/api/capacity/planner'))
        .pop();
      expect(lastPlannerCall).toMatch(/start=2026-04-20/);
      expect(lastPlannerCall).toMatch(/weeks=4/);
      expect(lastPlannerCall).toMatch(/contract_id=ct1/);
      expect(lastPlannerCall).toMatch(/search=Ana/);
    });
    // Controls reflect the URL
    expect(screen.getByLabelText('Filtro contrato')).toHaveValue('ct1');
    expect(screen.getByLabelText('Buscar empleado')).toHaveValue('Ana');
  });

  it('clicking an unassigned row opens the candidates modal (US-RR-3)', async () => {
    // Serve an empty candidates payload so the modal mounts but doesn't error.
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/capacity/planner')) return Promise.resolve(plannerResponse());
      if (url.startsWith('/api/resource-requests/rr9/candidates')) {
        return Promise.resolve({
          request: { id: 'rr9', role_title: 'QA Sr', level: 'L6', area_name: 'Testing', weekly_hours: 40, required_skills: [], nice_to_have_skills: [] },
          candidates: [],
          skills_lookup: {},
          meta: { employee_pool_size: 0, returned: 0, area_only: false, include_ineligible: true },
        });
      }
      if (url.startsWith('/api/areas')) return Promise.resolve({ data: [] });
      return Promise.resolve({});
    });

    mount();
    const row = await screen.findByTestId('unassigned-row-rr9');
    fireEvent.click(row);

    expect(await screen.findByRole('dialog', { name: /Candidatos/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(apiV2.apiGet.mock.calls.some((c) => String(c[0]).includes('/api/resource-requests/rr9/candidates'))).toBe(true);
    });
  });

  it('"Limpiar filtros" resets all filter params in the URL', async () => {
    mount('/capacity/planner?start=2026-04-20&contract_id=ct1&search=Ana');
    const clearBtn = await screen.findByRole('button', { name: /Limpiar filtros/i });
    fireEvent.click(clearBtn);
    await waitFor(() => {
      const search = screen.getByTestId('loc').getAttribute('data-search');
      expect(search).not.toMatch(/contract_id=/);
      expect(search).not.toMatch(/search=/);
    });
  });

  it('navigates by ±4 weeks and back to Hoy', async () => {
    mount();
    await screen.findByTestId('emp-row-e1');
    const initialCalls = apiV2.apiGet.mock.calls.filter((c) => String(c[0]).startsWith('/api/capacity/planner')).length;

    fireEvent.click(screen.getByRole('button', { name: /4 semanas adelante/i }));
    await waitFor(() => {
      const plannerCalls = apiV2.apiGet.mock.calls.filter((c) => String(c[0]).startsWith('/api/capacity/planner'));
      expect(plannerCalls.length).toBeGreaterThan(initialCalls);
    });

    fireEvent.click(screen.getByRole('button', { name: /^Hoy$/ }));
    await waitFor(() => {
      // Most recent call should still be a planner call with a start param
      const lastCall = apiV2.apiGet.mock.calls[apiV2.apiGet.mock.calls.length - 1][0];
      expect(String(lastCall)).toMatch(/start=\d{4}-\d{2}-\d{2}/);
    });
  });

  it('shows error banner when the API fails', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/capacity/planner')) return Promise.reject(new Error('boom'));
      return Promise.resolve({ data: [] });
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
  });
});
