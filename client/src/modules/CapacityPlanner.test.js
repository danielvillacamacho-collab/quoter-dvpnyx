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
  alerts: [
    {
      type: 'overbooked', severity: 'red', employee_id: 'e1',
      week_indices: [0, 1], peak_pct: 130,
      message: 'Ana García sobre-asignada S17-S18 (130%).',
    },
    {
      type: 'open_request', severity: 'amber', request_id: 'rr9',
      message: 'Initech: QA Sr L6 sin cubrir desde S19 (2 vacantes).',
    },
  ],
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

  it('SPEC-006/Spec3 — range selector defaults to 4 weeks and updates URL on change', async () => {
    mount();
    await screen.findByTestId('emp-row-e1');

    const sel = screen.getByLabelText('Rango de semanas');
    // Default value
    expect(sel).toHaveValue('4');
    // All four options present
    expect(within(sel).getByRole('option', { name: '1 semana' })).toBeInTheDocument();
    expect(within(sel).getByRole('option', { name: '8 semanas' })).toBeInTheDocument();

    // Change to 8 weeks → URL and API call updated
    fireEvent.change(sel, { target: { value: '8' } });
    await waitFor(() => {
      expect(screen.getByTestId('loc').getAttribute('data-search')).toMatch(/weeks=8/);
    });
    await waitFor(() => {
      expect(apiV2.apiGet.mock.calls.some((c) => String(c[0]).includes('weeks=8'))).toBe(true);
    });
    // Arrow aria-labels update to reflect new range
    expect(screen.getByRole('button', { name: /8 semanas adelante/i })).toBeInTheDocument();
  });

  it('renders the alerts strip with severity counts (US-PLN-6)', async () => {
    mount();
    const strip = await screen.findByTestId('alerts-strip');
    expect(within(strip).getByText(/1 críticas/)).toBeInTheDocument();
    expect(within(strip).getByText(/1 advertencias/)).toBeInTheDocument();
    expect(within(strip).getByText(/Ana García sobre-asignada/)).toBeInTheDocument();
    expect(within(strip).getByText(/QA Sr L6 sin cubrir/)).toBeInTheDocument();
  });

  it('clicking an overbooked alert scrolls the employee row into view (US-PLN-6)', async () => {
    mount();
    await screen.findByTestId('alerts-strip');
    const empRow = screen.getByTestId('emp-row-e1');
    const scrollSpy = jest.fn();
    empRow.scrollIntoView = scrollSpy;

    fireEvent.click(screen.getByTestId('alert-overbooked-e1'));
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('clicking an open_request alert scrolls its unassigned row into view', async () => {
    mount();
    await screen.findByTestId('alerts-strip');
    const row = screen.getByTestId('unassigned-row-rr9');
    const scrollSpy = jest.fn();
    row.scrollIntoView = scrollSpy;

    fireEvent.click(screen.getByTestId('alert-open_request-rr9'));
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('the alerts strip can be collapsed', async () => {
    mount();
    const strip = await screen.findByTestId('alerts-strip');
    expect(within(strip).getByText(/Ana García sobre-asignada/)).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: /Ocultar/i }));
    expect(within(strip).queryByText(/Ana García sobre-asignada/)).not.toBeInTheDocument();
  });

  it('does not render the alerts strip when there are no alerts', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/capacity/planner')) return Promise.resolve({ ...plannerResponse(), alerts: [] });
      if (url.startsWith('/api/areas')) return Promise.resolve({ data: [] });
      return Promise.resolve({});
    });
    mount();
    await screen.findByTestId('emp-row-e1');
    expect(screen.queryByTestId('alerts-strip')).not.toBeInTheDocument();
  });

  it('toggles between Personas and Proyectos views and persists in URL (US-PLN-4)', async () => {
    mount();
    await screen.findByTestId('emp-row-e1');

    // Default view = employees
    expect(screen.getByTestId('view-toggle-employees')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-toggle-projects')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('view-toggle-projects'));
    await waitFor(() => {
      expect(screen.getByTestId('loc').getAttribute('data-search')).toMatch(/view=projects/);
    });
    // Employee rows disappear; contract rows appear.
    expect(screen.queryByTestId('emp-row-e1')).not.toBeInTheDocument();
    expect(screen.getByTestId('contract-row-ct1')).toBeInTheDocument();
    expect(screen.getByTestId('contract-row-ct3')).toBeInTheDocument();
    // Header label swaps to project/solicitud.
    expect(screen.getByText(/Proyecto \/ solicitud/)).toBeInTheDocument();

    // Toggle back.
    fireEvent.click(screen.getByTestId('view-toggle-employees'));
    await waitFor(() => {
      expect(screen.getByTestId('loc').getAttribute('data-search')).not.toMatch(/view=/);
    });
    expect(screen.getByTestId('emp-row-e1')).toBeInTheDocument();
  });

  it('projects view shows assignments under their contract with employee bars', async () => {
    mount('/capacity/planner?view=projects');
    const ct1Row = await screen.findByTestId('contract-row-ct1');
    expect(within(ct1Row).getByText('Contrato Alpha')).toBeInTheDocument();
    // Ana is assigned to ct1 via assignment a1 (rr1). Her name should appear
    // in contract cells for weeks 0..7.
    // Bars now include the % label ("Ana García · 50%"), so we use a regex.
    for (let i = 0; i <= 7; i += 1) {
      expect(within(screen.getByTestId(`contract-cell-ct1-${i}`)).getByText(/Ana García/)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId(`contract-cell-ct1-8`)).queryByText(/Ana García/)).not.toBeInTheDocument();
  });

  it('projects view renders unfilled requests with dashed "Sin asignar" bars', async () => {
    mount('/capacity/planner?view=projects');
    // ct3 starts collapsed — expand it first to reveal the sub-row.
    const ct3Row = await screen.findByTestId('contract-row-ct3');
    fireEvent.click(ct3Row);
    const row = await screen.findByTestId('project-request-row-rr9');
    // Unassigned bar in the request's week range.
    expect(within(row).getAllByText(/Sin asignar/).length).toBeGreaterThan(0);
    expect(within(row).getByText(/faltan 2/)).toBeInTheDocument();
  });

  it('clicking an unfilled request sub-row opens candidates modal', async () => {
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
    mount('/capacity/planner?view=projects');
    // ct3 starts collapsed — expand it first to reveal the sub-row.
    const ct3Row = await screen.findByTestId('contract-row-ct3');
    fireEvent.click(ct3Row);
    const row = await screen.findByTestId('project-request-row-rr9');
    fireEvent.click(row);
    expect(await screen.findByRole('dialog', { name: /Candidatos/i })).toBeInTheDocument();
  });

  describe('SPEC-008: tipografía — jerarquía visual', () => {
    it('empName tiene fontSize mayor que empMeta (jerarquía primario > secundario)', async () => {
      mount();
      await screen.findByTestId('emp-row-e1');
      const anaRow = screen.getByTestId('emp-row-e1');
      const nameEl = within(anaRow).getByTitle('Ana García');
      // Primary name must carry overflow/ellipsis to handle long names
      expect(nameEl.style.overflow).toBe('hidden');
      expect(nameEl.style.textOverflow).toBe('ellipsis');
      expect(nameEl.style.whiteSpace).toBe('nowrap');
      // fontSize must be strictly larger than the secondary (empMeta is 11px; empName ≥ 14px)
      expect(parseFloat(nameEl.style.fontSize)).toBeGreaterThanOrEqual(14);
    });

    it('empName muestra title con el nombre completo (tooltip para nombres truncados)', async () => {
      mount();
      await screen.findByTestId('emp-row-e1');
      const anaRow = screen.getByTestId('emp-row-e1');
      expect(within(anaRow).getByTitle('Ana García')).toBeInTheDocument();
      const pedroRow = screen.getByTestId('emp-row-e2');
      expect(within(pedroRow).getByTitle('Pedro Zúñiga')).toBeInTheDocument();
    });

    it('los bars de asignación tienen fontSize 11.5px fijo y title con nombre completo', async () => {
      mount();
      await screen.findByTestId('emp-row-e1');
      const cell = screen.getByTestId('cell-e1-0');
      // barName span tiene fontSize 11.5 sin reducción por longitud
      const barNameSpan = within(cell).getByText(/Contrato Alpha/);
      expect(parseFloat(barNameSpan.style.fontSize)).toBe(11.5);
      // El contenedor del bar tiene title para nombres truncados
      expect(barNameSpan.closest('[title]').title).toMatch(/Contrato Alpha/);
    });

    it('contractName en vista proyectos tiene title y overflow ellipsis', async () => {
      mount('/capacity/planner?view=projects');
      const ct1Row = await screen.findByTestId('contract-row-ct1');
      const nameEl = within(ct1Row).getByTitle('Contrato Alpha');
      expect(nameEl.style.overflow).toBe('hidden');
      expect(nameEl.style.textOverflow).toBe('ellipsis');
      expect(parseFloat(nameEl.style.fontSize)).toBeGreaterThanOrEqual(14);
    });

    it('requestTitle en sub-fila de proyecto tiene title y overflow ellipsis', async () => {
      mount('/capacity/planner?view=projects');
      // ct3 starts collapsed — expand it to reveal the sub-row.
      const ct3Row = await screen.findByTestId('contract-row-ct3');
      fireEvent.click(ct3Row);
      const row = await screen.findByTestId('project-request-row-rr9');
      const titleEl = within(row).getByTitle('QA Sr');
      expect(titleEl.style.overflow).toBe('hidden');
      expect(titleEl.style.textOverflow).toBe('ellipsis');
      expect(parseFloat(titleEl.style.fontSize)).toBeGreaterThanOrEqual(12);
    });

    it('unassignedTitle tiene title y overflow ellipsis (vista por persona)', async () => {
      mount();
      const row = await screen.findByTestId('unassigned-row-rr9');
      const titleEl = within(row).getByTitle('QA Sr');
      expect(titleEl.style.overflow).toBe('hidden');
      expect(titleEl.style.textOverflow).toBe('ellipsis');
    });

    it('el comportamiento funcional del planner no se ve afectado por los cambios de estilo', async () => {
      mount();
      await screen.findByTestId('emp-row-e1');
      // Filtros siguen funcionando
      fireEvent.change(screen.getByLabelText('Filtro contrato'), { target: { value: 'ct1' } });
      await waitFor(() => {
        expect(apiV2.apiGet.mock.calls.some((c) => String(c[0]).includes('contract_id=ct1'))).toBe(true);
      });
      // Toggle de vistas sigue funcionando
      fireEvent.click(screen.getByTestId('view-toggle-projects'));
      await waitFor(() => {
        expect(screen.getByTestId('contract-row-ct1')).toBeInTheDocument();
      });
    });
  });

  it('projects view preserves filters when toggling', async () => {
    mount('/capacity/planner?view=projects&contract_id=ct1&search=Ana');
    await screen.findByTestId('contract-row-ct1');
    // Filters still applied to the API call.
    const last = apiV2.apiGet.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.startsWith('/api/capacity/planner'))
      .pop();
    expect(last).toMatch(/contract_id=ct1/);
    expect(last).toMatch(/search=Ana/);
  });

  it('shows error banner when the API fails', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/capacity/planner')) return Promise.reject(new Error('boom'));
      return Promise.resolve({ data: [] });
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
  });

  describe('SPEC-009: acordeón expand/collapse en vista proyectos', () => {
    it('all projects start collapsed — sub-rows not in DOM', async () => {
      mount('/capacity/planner?view=projects');
      await screen.findByTestId('contract-row-ct1');
      // Sub-rows are hidden until the project is expanded.
      expect(screen.queryByTestId('project-request-row-rr9')).not.toBeInTheDocument();
    });

    it('employee bars in the contract header are always visible even when collapsed', async () => {
      mount('/capacity/planner?view=projects');
      await screen.findByTestId('contract-row-ct1');
      // ct1 is collapsed but Ana's bars should still appear in the header cells.
      for (let i = 0; i <= 7; i += 1) {
        expect(within(screen.getByTestId(`contract-cell-ct1-${i}`)).getByText(/Ana García/)).toBeInTheDocument();
      }
    });

    it('contract row shows collapsed chevron (▶) by default', async () => {
      mount('/capacity/planner?view=projects');
      const ct1Row = await screen.findByTestId('contract-row-ct1');
      expect(within(ct1Row).getByText('▶')).toBeInTheDocument();
      expect(ct1Row.getAttribute('aria-expanded')).toBe('false');
    });

    it('clicking a project expands it — sub-rows become visible and chevron changes to ▼', async () => {
      mount('/capacity/planner?view=projects');
      const ct3Row = await screen.findByTestId('contract-row-ct3');
      expect(ct3Row.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(ct3Row);
      expect(ct3Row.getAttribute('aria-expanded')).toBe('true');
      expect(within(ct3Row).getByText('▼')).toBeInTheDocument();
      expect(await screen.findByTestId('project-request-row-rr9')).toBeInTheDocument();
    });

    it('clicking an expanded project collapses it and hides sub-rows again', async () => {
      mount('/capacity/planner?view=projects');
      const ct3Row = await screen.findByTestId('contract-row-ct3');
      fireEvent.click(ct3Row); // expand
      await screen.findByTestId('project-request-row-rr9');
      fireEvent.click(ct3Row); // collapse
      await waitFor(() => {
        expect(screen.queryByTestId('project-request-row-rr9')).not.toBeInTheDocument();
      });
      expect(within(ct3Row).getByText('▶')).toBeInTheDocument();
    });

    it('multiple projects can be expanded simultaneously', async () => {
      mount('/capacity/planner?view=projects');
      const ct1Row = await screen.findByTestId('contract-row-ct1');
      const ct3Row = screen.getByTestId('contract-row-ct3');
      fireEvent.click(ct1Row);
      fireEvent.click(ct3Row);
      expect(ct1Row.getAttribute('aria-expanded')).toBe('true');
      expect(ct3Row.getAttribute('aria-expanded')).toBe('true');
      expect(await screen.findByTestId('project-request-row-rr9')).toBeInTheDocument();
    });

    it('keyboard Enter/Space toggles the project accordion', async () => {
      mount('/capacity/planner?view=projects');
      const ct3Row = await screen.findByTestId('contract-row-ct3');
      fireEvent.keyDown(ct3Row, { key: 'Enter' });
      expect(ct3Row.getAttribute('aria-expanded')).toBe('true');
      fireEvent.keyDown(ct3Row, { key: ' ' });
      expect(ct3Row.getAttribute('aria-expanded')).toBe('false');
    });

    it('when contract_id filter shows a single project it is expanded by default', async () => {
      mount('/capacity/planner?view=projects&contract_id=ct3');
      const ct3Row = await screen.findByTestId('contract-row-ct3');
      expect(ct3Row.getAttribute('aria-expanded')).toBe('true');
      expect(await screen.findByTestId('project-request-row-rr9')).toBeInTheDocument();
    });

    it('a project with no requests shows empty state when expanded', async () => {
      // Add a contract with no assignments/requests to the response.
      apiV2.apiGet.mockImplementation((url) => {
        if (url.startsWith('/api/capacity/planner')) {
          const base = plannerResponse();
          base.contracts.push({ id: 'ct_empty', name: 'Proyecto Vacío', client_name: 'DVPNYX', color: '#aaa' });
          // Give it one summary assignment so buildProjectsView keeps it.
          base.employees[0].assignments.push({
            id: 'a_empty', contract_id: 'ct_empty', contract_name: 'Proyecto Vacío',
            client_name: 'DVPNYX', resource_request_id: null,
            role_title: 'Dev', weekly_hours: 10,
            start_date: '2026-04-20', end_date: '2026-04-26', status: 'active',
            color: '#aaa', week_range: [0, 0],
          });
          return Promise.resolve(base);
        }
        if (url.startsWith('/api/areas')) return Promise.resolve({ data: [] });
        return Promise.resolve({});
      });
      mount('/capacity/planner?view=projects');
      const emptyRow = await screen.findByTestId('contract-row-ct_empty');
      fireEvent.click(emptyRow);
      expect(await screen.findByTestId('empty-requests-ct_empty')).toBeInTheDocument();
      expect(screen.getByTestId('empty-requests-ct_empty')).toHaveTextContent(/Sin cargos asignados/);
    });
  });
});
