import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Reports from './Reports';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mountHub = () => render(
  <MemoryRouter initialEntries={['/reports']}>
    <Routes>
      <Route path="/reports" element={<Reports />} />
      <Route path="/reports/:type" element={<Reports />} />
    </Routes>
  </MemoryRouter>
);
const mountReport = (type) => render(
  <MemoryRouter initialEntries={[`/reports/${type}`]}>
    <Routes>
      <Route path="/reports" element={<Reports />} />
      <Route path="/reports/:type" element={<Reports />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => { jest.resetAllMocks(); });

describe('Reports hub (EI-1)', () => {
  it('renders a card for each report type', () => {
    mountHub();
    expect(screen.getByText('📊 Utilización')).toBeInTheDocument();
    expect(screen.getByText('🪑 Banca')).toBeInTheDocument();
    expect(screen.getByText('🧾 Solicitudes pendientes')).toBeInTheDocument();
    expect(screen.getByText('🎯 Necesidades de contratación')).toBeInTheDocument();
    expect(screen.getByText('🛡 Cobertura de contratos')).toBeInTheDocument();
    expect(screen.getByText('⏱ Cumplimiento time tracking')).toBeInTheDocument();
  });

  it('hub cards do not fire API calls on mount', () => {
    mountHub();
    expect(apiV2.apiGet).not.toHaveBeenCalled();
  });
});

describe('Reports — individual views', () => {
  it('utilization fetches and renders rows', async () => {
    apiV2.apiGet.mockResolvedValue({ data: [
      { id: 'e1', first_name: 'Ana', last_name: 'G', level: 'L4', country: 'Colombia', area_name: 'Desarrollo',
        weekly_capacity_hours: 40, assigned_weekly_hours: 38, utilization: 0.95 },
    ] });
    mountReport('utilization');
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalledWith(expect.stringContaining('/api/reports/utilization')));
    expect(await screen.findByText('Ana G')).toBeInTheDocument();
    expect(screen.getByText('95.0%')).toBeInTheDocument();
  });

  it('bench passes threshold query param and surfaces applied value', async () => {
    apiV2.apiGet.mockResolvedValue({ data: [], threshold: 0.20 });
    mountReport('bench');
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Umbral'), { target: { value: '0.2' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('threshold=0.2'))).toBe(true);
    });
  });

  it('time-compliance respects date range inputs', async () => {
    apiV2.apiGet.mockResolvedValue({ data: [], from: '2026-01-01', to: '2026-01-31' });
    mountReport('time-compliance');
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-02-28' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('from=2026-02-01') && u.includes('to=2026-02-28'))).toBe(true);
    });
  });

  it('export CSV button exists and is clickable', async () => {
    apiV2.apiGet.mockResolvedValue({ data: [
      { id: 'ct1', name: 'Alpha', client_name: 'Acme', type: 'project', status: 'active',
        requested_weekly_hours: 40, assigned_weekly_hours: 30, coverage_pct: 0.75, open_requests_count: 1 },
    ] });
    mountReport('coverage');
    await screen.findByText('Alpha');
    const btn = screen.getByLabelText('Exportar CSV');
    expect(btn).toBeInTheDocument();
    // JSDOM doesn't implement actual downloads but the handler must not throw.
    // Mock createObjectURL which JSDOM doesn't implement.
    const oldCOU = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:mock');
    URL.revokeObjectURL = jest.fn();
    fireEvent.click(btn);
    expect(URL.createObjectURL).toHaveBeenCalled();
    URL.createObjectURL = oldCOU;
  });

  it('renders empty-state cell when report has no data', async () => {
    apiV2.apiGet.mockResolvedValue({ data: [] });
    mountReport('pending-requests');
    await waitFor(() => expect(screen.getByText(/Sin datos para mostrar/i)).toBeInTheDocument());
  });
});
