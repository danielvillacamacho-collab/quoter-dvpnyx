import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import OpportunityDetail from './OpportunityDetail';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = (id = 'o1') => render(
  <MemoryRouter initialEntries={[`/opportunities/${id}`]}>
    <Routes>
      <Route path="/opportunities/:id" element={<OpportunityDetail />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => { jest.resetAllMocks(); });

describe('OpportunityDetail', () => {
  const baseOpp = {
    id: 'o1', name: 'Proyecto Atlas', status: 'proposal',
    client: { id: 'c1', name: 'Acme' },
    quotations: [{ id: 'q1', project_name: 'Atlas v1', type: 'fixed_scope', status: 'sent', total_usd: 12000 }],
    expected_close_date: '2026-05-30',
  };

  it('renders the opportunity summary with client link', async () => {
    apiV2.apiGet.mockResolvedValue(baseOpp);
    mount();
    expect(await screen.findByText(/💼 Proyecto Atlas/)).toBeInTheDocument();
    expect(screen.getByText('Acme').closest('a')).toHaveAttribute('href', '/clients/c1');
  });

  it('shows quotations table with link to each quotation', async () => {
    apiV2.apiGet.mockResolvedValue(baseOpp);
    mount();
    expect(await screen.findByText('Atlas v1')).toBeInTheDocument();
    expect(screen.getByText('Atlas v1').closest('a')).toHaveAttribute('href', '/quotation/q1');
  });

  it('renders transition buttons for the current state (proposal)', async () => {
    apiV2.apiGet.mockResolvedValue(baseOpp);
    mount();
    await screen.findByText(/💼 Proyecto Atlas/);
    // proposal → negotiation, won, lost, cancelled
    expect(screen.getByLabelText('Mover a Negociación')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover a Ganada')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover a Perdida')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover a Cancelada')).toBeInTheDocument();
  });

  it('shows the "won" banner + contract link when opportunity is won', async () => {
    apiV2.apiGet.mockResolvedValue({
      ...baseOpp, status: 'won', closed_at: '2026-04-10T00:00:00Z', winning_quotation_id: 'q1',
    });
    mount();
    expect(await screen.findByText(/🏆 Oportunidad ganada/)).toBeInTheDocument();
  });

  it('transition to won prompts for cotización and calls POST /status', async () => {
    apiV2.apiGet.mockResolvedValueOnce(baseOpp)    // initial load
                .mockResolvedValue(baseOpp);        // reload after post
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'won' });
    const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('1');
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    mount();
    await screen.findByText(/💼 Proyecto Atlas/);
    fireEvent.click(screen.getByLabelText('Mover a Ganada'));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({ new_status: 'won', winning_quotation_id: 'q1' })
      );
    });
    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });
});
