import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardMe from './DashboardMe';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><DashboardMe /></MemoryRouter>);

beforeEach(() => { jest.resetAllMocks(); });

describe('DashboardMe (ED-1)', () => {
  it('renders the minimal payload when the user has no employee row', async () => {
    apiV2.apiGet.mockResolvedValue({ employee: null, active_assignments: [], week_hours: { logged: 0, expected: 0, capacity: null } });
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalledWith('/api/reports/my-dashboard'));
    expect(await screen.findByText(/👋 Hola/)).toBeInTheDocument();
    expect(screen.getByText(/vista limitada/i)).toBeInTheDocument();
  });

  it('renders metrics + assignments when the user is an employee', async () => {
    apiV2.apiGet.mockResolvedValue({
      employee: { id: 'e1', first_name: 'Ana', last_name: 'García', weekly_capacity_hours: 40 },
      active_assignments: [
        { id: 'a1', contract_name: 'Contrato Alpha', weekly_hours: 20, start_date: '2026-04-01', end_date: '2026-09-01', status: 'active' },
      ],
      week_hours: { logged: 28, expected: 40, capacity: 40, week_start: '2026-04-13', week_end: '2026-04-19' },
    });
    mount();
    expect(await screen.findByText(/Hola, Ana/)).toBeInTheDocument();
    expect(screen.getByText(/28\.0h/)).toBeInTheDocument();
    expect(screen.getByText(/40\.0h/)).toBeInTheDocument();
    expect(screen.getByText('Contrato Alpha')).toBeInTheDocument();
    // 28/40 = 70%
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('shows empty state for assignments when employee has none', async () => {
    apiV2.apiGet.mockResolvedValue({
      employee: { id: 'e1', first_name: 'Ana', last_name: 'G', weekly_capacity_hours: 40 },
      active_assignments: [],
      week_hours: { logged: 0, expected: 40, capacity: 40, week_start: '2026-04-13', week_end: '2026-04-19' },
    });
    mount();
    await screen.findByText(/Hola, Ana/);
    expect(screen.getByText(/No tienes asignaciones activas/i)).toBeInTheDocument();
  });
});
