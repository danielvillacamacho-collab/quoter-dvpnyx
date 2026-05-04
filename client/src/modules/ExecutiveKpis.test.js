/**
 * Tests for the Executive Dashboard v2 KPI strip that lives above the
 * quotations section in App.js. We mount the full App so we exercise
 * the router + auth flow as real users do.
 *
 * Strategy: mock api.getDashboardOverview with a realistic payload,
 * assert each KPI tile renders the right value / label / subtitle and
 * that clicking navigates to the deep-linked module.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import * as api from '../utils/api';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/api');
jest.mock('../utils/apiV2');

const mockUser = {
  id: 'u1', name: 'Test', email: 't@dvpnyx.com',
  role: 'preventa', must_change_password: false,
};
const mockParams = {
  level: [], geo: [], bilingual: [], stack: [], tools: [], modality: [], margin: [], project: [],
};

const fullOverview = {
  generated_at: '2026-04-21T12:00:00Z',
  assignments:   { active_count: 7,  planned_count: 2, weekly_hours: 245.5 },
  requests:      { open_count: 3,    open_hours_weekly: 80 },
  employees:     { total: 22, bench: 4, utilized: 15 },
  contracts:     { active_count: 5, planned_count: 2, by_status: { active: 5, planned: 2 } },
  opportunities: { pipeline_count: 6, by_status: { open: 4, qualified: 2 } },
  quotations:    { total: 6, by_status: { draft: 3, sent: 2, approved: 1 } },
};

describe('ExecutiveKpis strip on /', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    localStorage.setItem('dvpnyx_token', 'valid-token');
    jest.resetAllMocks();
    api.getMe.mockResolvedValue(mockUser);
    api.getParams.mockResolvedValue(mockParams);
    api.getQuotations.mockResolvedValue([]);
    apiV2.apiGet && apiV2.apiGet.mockResolvedValue({ data: [], pagination: {} });
  });

  it('renders the 6 KPI tiles with values from the overview endpoint', async () => {
    api.getDashboardOverview.mockResolvedValue(fullOverview);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('exec-kpis')).toBeInTheDocument());

    // Spot-check each tile's primary value + subtitle.
    const assign = screen.getByTestId('kpi-assign');
    expect(assign).toHaveTextContent('Asignaciones activas');
    expect(assign).toHaveTextContent('7');
    expect(assign).toHaveTextContent('2 planificadas');

    expect(screen.getByTestId('kpi-hours')).toHaveTextContent('246h'); // rounded from 245.5
    expect(screen.getByTestId('kpi-requests')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-requests')).toHaveTextContent('80h por cubrir');
    expect(screen.getByTestId('kpi-bench')).toHaveTextContent('4');
    expect(screen.getByTestId('kpi-bench')).toHaveTextContent('22 empleados');
    expect(screen.getByTestId('kpi-pipeline')).toHaveTextContent('6');
    expect(screen.getByTestId('kpi-pipeline')).toHaveTextContent('5 contratos activos');
    expect(screen.getByTestId('kpi-quots')).toHaveTextContent('6');
    expect(screen.getByTestId('kpi-quots')).toHaveTextContent('2 enviadas');
  });

  it('clicking an actionable KPI navigates to its deep-link', async () => {
    api.getDashboardOverview.mockResolvedValue(fullOverview);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('kpi-assign')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('kpi-assign'));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/assignments');
    });
  });

  it('hides the strip when the endpoint fails (non-breaking)', async () => {
    api.getDashboardOverview.mockRejectedValue(new Error('boom'));
    render(<App />);
    // Quotations section still renders normally.
    await waitFor(() => expect(screen.getAllByText('Cotizaciones').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('exec-kpis')).toBeNull();
  });

  it('hides the strip while the endpoint is still pending', async () => {
    // Return an unresolved promise so the effect never settles.
    api.getDashboardOverview.mockReturnValue(new Promise(() => {}));
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('Cotizaciones').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('exec-kpis')).toBeNull();
  });
});
