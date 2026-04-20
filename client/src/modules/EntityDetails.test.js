/**
 * Combined smoke tests for ContractDetail and EmployeeDetail. They
 * follow the same pattern as the individual ClientDetail /
 * OpportunityDetail suites — keep them together because the shapes are
 * small and asserting them once is enough.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ContractDetail from './ContractDetail';
import EmployeeDetail from './EmployeeDetail';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

beforeEach(() => { jest.resetAllMocks(); });

describe('ContractDetail', () => {
  it('renders contract summary + requests + assignments', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url === '/api/contracts/ct1') return Promise.resolve({
        id: 'ct1', name: 'Contrato Alpha', client_id: 'c1', client_name: 'Acme',
        type: 'project', status: 'active', start_date: '2026-03-01',
        active_assignments_count: 2, open_requests_count: 1,
      });
      if (url.startsWith('/api/resource-requests')) return Promise.resolve({ data: [
        { id: 'r1', role_title: 'Senior Dev', level: 'L4', quantity: 2, priority: 'high', status: 'open' },
      ] });
      if (url.startsWith('/api/assignments')) return Promise.resolve({ data: [
        { id: 'a1', employee_first_name: 'Ana', employee_last_name: 'G', weekly_hours: 20,
          start_date: '2026-04-01', status: 'active', role_title: 'Backend' },
      ] });
      return Promise.resolve({});
    });
    render(
      <MemoryRouter initialEntries={[`/contracts/ct1`]}>
        <Routes>
          <Route path="/contracts/:id" element={<ContractDetail />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText(/📑 Contrato Alpha/)).toBeInTheDocument();
    expect(screen.getByText('Senior Dev')).toBeInTheDocument();
    expect(screen.getByText(/Ana G/)).toBeInTheDocument();
    // Client link goes to /clients/:id
    expect(screen.getByText('Acme').closest('a')).toHaveAttribute('href', '/clients/c1');
  });
});

describe('EmployeeDetail', () => {
  it('renders employee summary + utilization + skills + assignments', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url === '/api/employees/e1') return Promise.resolve({
        id: 'e1', first_name: 'Ana', last_name: 'García', level: 'L4',
        country: 'Colombia', status: 'active', weekly_capacity_hours: 40, area_name: 'Desarrollo',
        employment_type: 'fulltime', start_date: '2024-02-01',
      });
      if (url === '/api/employees/e1/skills') return Promise.resolve({ data: [
        { skill_id: 1, skill_name: 'React', skill_category: 'framework', proficiency: 'expert', years_experience: 6 },
      ] });
      if (url.startsWith('/api/assignments')) return Promise.resolve({ data: [
        { id: 'a1', contract_name: 'Contrato Alpha', weekly_hours: 30, start_date: '2026-03-01', status: 'active' },
      ] });
      return Promise.resolve({});
    });
    render(
      <MemoryRouter initialEntries={[`/employees/e1`]}>
        <Routes>
          <Route path="/employees/:id" element={<EmployeeDetail />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText(/🧑‍💻 Ana García/)).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Contrato Alpha')).toBeInTheDocument();
    // 30h assigned / 40h capacity = 75%
    expect(screen.getByText('75%')).toBeInTheDocument();
  });
});
