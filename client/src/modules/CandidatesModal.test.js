import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CandidatesModal from './CandidatesModal';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const fixture = {
  request: {
    id: 'rr1', contract_id: 'ct1', role_title: 'Backend Sr',
    area_id: 1, area_name: 'Desarrollo', level: 'L5',
    weekly_hours: 20, start_date: '2026-05-01', end_date: '2026-07-01',
    required_skills: [10, 20], nice_to_have_skills: [40],
  },
  candidates: [
    {
      employee_id: 'e1', full_name: 'Ana García', level: 'L5', area_id: 1,
      area_name: 'Desarrollo', weekly_capacity_hours: 40, status: 'active',
      score: 90,
      match: {
        area: { status: 'match', fraction: 1 },
        level: { status: 'perfect', employee_level: 5, fraction: 1 },
        required_skills: { matched_ids: [10, 20], missing_ids: [], matched: 2, required: 2, fraction: 1 },
        nice_skills: { matched_ids: [40], missing_ids: [], matched: 1, nice_to_have: 1, fraction: 1 },
        availability: { status: 'full', available_hours: 40, requested_hours: 20, has_full_capacity: true, fraction: 1 },
      },
      reasons: ['Mismo área', 'Nivel L5 (exacto)', '2/2 skills requeridas', 'Disponible 40h/sem'],
    },
    {
      employee_id: 'e2', full_name: 'Pedro Z', level: 'L3', area_id: 2,
      area_name: 'Testing', weekly_capacity_hours: 40, status: 'active',
      score: 35,
      match: {
        area: { status: 'mismatch', fraction: 0 },
        level: { status: 'underqualified', employee_level: 3, fraction: 0.5 },
        required_skills: { matched_ids: [10], missing_ids: [20], matched: 1, required: 2, fraction: 0.5 },
        nice_skills: { matched_ids: [], missing_ids: [40], matched: 0, nice_to_have: 1, fraction: 0 },
        availability: { status: 'full', available_hours: 40, requested_hours: 20, has_full_capacity: true, fraction: 1 },
      },
      reasons: ['Área distinta', '1/2 skills requeridas', 'Disponible 40h/sem'],
    },
  ],
  skills_lookup: { 10: 'React', 20: 'Node', 40: 'Docker' },
  meta: { employee_pool_size: 2, returned: 2, area_only: false, include_ineligible: true },
};

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockResolvedValue(fixture);
});

describe('CandidatesModal', () => {
  it('renders candidates with score and match chips', async () => {
    const onClose = jest.fn();
    render(<CandidatesModal requestId="rr1" onClose={onClose} onPick={jest.fn()} />);

    expect(await screen.findByRole('dialog', { name: /Candidatos/i })).toBeInTheDocument();
    expect(screen.getByText(/Backend Sr/)).toBeInTheDocument();

    const anaRow = await screen.findByTestId('candidate-e1');
    expect(within(anaRow).getByText('Ana García')).toBeInTheDocument();
    expect(within(anaRow).getByText('90')).toBeInTheDocument();
    expect(within(anaRow).getByText(/2\/2 skills/)).toBeInTheDocument();
    expect(within(anaRow).getByText(/Libre 40h/)).toBeInTheDocument();

    const pedroRow = screen.getByTestId('candidate-e2');
    expect(within(pedroRow).getByText('35')).toBeInTheDocument();
    expect(within(pedroRow).getByText(/Área distinta/)).toBeInTheDocument();
    // Missing-skills hint uses skills_lookup names.
    expect(within(pedroRow).getByText(/Faltan: Node/)).toBeInTheDocument();
  });

  it('"Asignar" invokes onPick with candidate + request', async () => {
    const onPick = jest.fn();
    render(<CandidatesModal requestId="rr1" onClose={jest.fn()} onPick={onPick} />);
    const btn = await screen.findByTestId('assign-e1');
    fireEvent.click(btn);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].employee_id).toBe('e1');
    expect(onPick.mock.calls[0][1].id).toBe('rr1');
  });

  it('toggling "Solo mi área" refetches with area_only=true', async () => {
    render(<CandidatesModal requestId="rr1" onClose={jest.fn()} onPick={jest.fn()} />);
    await screen.findByTestId('candidate-e1');

    fireEvent.click(screen.getByLabelText(/Solo mi área/i));
    await waitFor(() => {
      expect(apiV2.apiGet.mock.calls.some((c) => String(c[0]).includes('area_only=true'))).toBe(true);
    });
  });

  it('closes when backdrop or X is clicked', async () => {
    const onClose = jest.fn();
    render(<CandidatesModal requestId="rr1" onClose={onClose} onPick={jest.fn()} />);
    await screen.findByTestId('candidate-e1');
    fireEvent.click(screen.getByRole('button', { name: /Cerrar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('returns null when requestId is falsy', () => {
    const { container } = render(<CandidatesModal requestId={null} onClose={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows error banner when the API rejects', async () => {
    apiV2.apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<CandidatesModal requestId="rr1" onClose={jest.fn()} onPick={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
  });
});
