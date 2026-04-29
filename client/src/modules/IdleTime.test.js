import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import IdleTime from './IdleTime';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><IdleTime /></MemoryRouter>);

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.includes('capacity-utilization')) {
      return Promise.resolve({
        period_yyyymm: '2026-04',
        total_capacity_hours: 1760,
        breakdown: {
          billable_assignments: { hours: 1200, pct: 0.6818 },
          internal_initiatives: { hours: 200, pct: 0.1136 },
          holidays: { hours: 160, pct: 0.0909 },
          novelties: { hours: 80, pct: 0.0454 },
          idle: { hours: 120, pct: 0.0681, cost_usd: 5400 },
        },
        indicators: {
          utilization_rate_billable_pct: 0.6818,
          internal_investment_pct: 0.1136,
          true_idle_pct: 0.0681,
        },
      });
    }
    if (url.includes('aggregate')) {
      return Promise.resolve({
        period_yyyymm: '2026-04', group_by: 'country',
        totals: { users_count: 10 },
        groups: [{ country_id: 'CO', users_count: 8, idle_pct: 0.05, idle_cost_usd: 3000 }],
      });
    }
    return Promise.resolve(null);
  });
});

describe('IdleTime dashboard', () => {
  it('renderiza el header', async () => {
    mount();
    expect(await screen.findByText(/Capacidad y Bench/i)).toBeInTheDocument();
  });

  it('muestra KPIs principales', async () => {
    mount();
    // Strings exactos: el subtitle del módulo menciona "costo del bench"
    // del CFO (entre comillas), por lo que un regex /Costo del Bench/i
    // matchea KPI + subtitle. getByText con string exacto matchea solo
    // el textContent literal del KPI label.
    await screen.findByText('Idle Total');
    expect(screen.getByText('Costo del Bench')).toBeInTheDocument();
    expect(screen.getByText('Utilización Facturable')).toBeInTheDocument();
    expect(screen.getByText('Inversión Interna')).toBeInTheDocument();
  });

  it('muestra tabla de idle por país', async () => {
    mount();
    await waitFor(() => expect(screen.getByText(/Idle por país/)).toBeInTheDocument());
    expect(screen.getByText('CO')).toBeInTheDocument();
  });
});
