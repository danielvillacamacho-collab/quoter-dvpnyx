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
  // SPEC-CRM-00 v1.1: pipeline de 9 estados. Sample en proposal_validated
  // → permite transitar a negotiation / closed_won / closed_lost / postponed.
  const baseOpp = {
    id: 'o1', name: 'Proyecto Atlas', status: 'proposal_validated',
    opportunity_number: 'OPP-CO-2026-00042',
    client: { id: 'c1', name: 'Acme' },
    quotations: [{ id: 'q1', project_name: 'Atlas v1', type: 'fixed_scope', status: 'sent', total_usd: 12000 }],
    expected_close_date: '2026-05-30',
  };

  it('renders the opportunity summary with client link + opportunity_number', async () => {
    apiV2.apiGet.mockResolvedValue(baseOpp);
    mount();
    expect(await screen.findByText(/💼 Proyecto Atlas/)).toBeInTheDocument();
    expect(screen.getByText('Acme').closest('a')).toHaveAttribute('href', '/clients/c1');
    expect(screen.getByText('OPP-CO-2026-00042')).toBeInTheDocument();
  });

  it('shows quotations table with link to each quotation', async () => {
    apiV2.apiGet.mockResolvedValue(baseOpp);
    mount();
    expect(await screen.findByText('Atlas v1')).toBeInTheDocument();
    expect(screen.getByText('Atlas v1').closest('a')).toHaveAttribute('href', '/quotation/q1');
  });

  it('renders transition buttons for the current state (proposal_validated)', async () => {
    apiV2.apiGet.mockResolvedValue(baseOpp);
    mount();
    await screen.findByText(/💼 Proyecto Atlas/);
    // proposal_validated → negotiation, closed_won, closed_lost, postponed
    expect(screen.getByLabelText('Mover a Negociación')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover a Ganada')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover a Perdida')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover a Postergada')).toBeInTheDocument();
    // Cancelada ya no existe.
    expect(screen.queryByLabelText('Mover a Cancelada')).toBeNull();
  });

  it('shows the "won" banner + contract link when opportunity is closed_won', async () => {
    apiV2.apiGet.mockResolvedValue({
      ...baseOpp, status: 'closed_won', closed_at: '2026-04-10T00:00:00Z', winning_quotation_id: 'q1',
    });
    mount();
    expect(await screen.findByText(/🏆 Oportunidad ganada/)).toBeInTheDocument();
  });

  it('shows the "postponed" banner with reactivation date + reason', async () => {
    apiV2.apiGet.mockResolvedValue({
      ...baseOpp, status: 'postponed',
      postponed_until_date: '2026-08-15',
      postponed_reason: 'Cliente postpuso por restructura',
    });
    mount();
    expect(await screen.findByText(/⏸ Oportunidad postergada/)).toBeInTheDocument();
    expect(screen.getByText('2026-08-15')).toBeInTheDocument();
    expect(screen.getByText(/restructura/i)).toBeInTheDocument();
  });

  it('transition to closed_won prompts for cotización and calls POST /status', async () => {
    apiV2.apiGet.mockResolvedValueOnce(baseOpp)    // initial load
                .mockResolvedValue(baseOpp);        // reload after post
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'closed_won' });
    const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('1');
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    mount();
    await screen.findByText(/💼 Proyecto Atlas/);
    fireEvent.click(screen.getByLabelText('Mover a Ganada'));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({ new_status: 'closed_won', winning_quotation_id: 'q1' })
      );
    });
    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  // SPEC-CRM-00 v1.1 — Postponed via prompt, validates future date, posts payload.
  it('transition to postponed validates date + posts postponed_until_date', async () => {
    apiV2.apiGet.mockResolvedValueOnce(baseOpp).mockResolvedValue(baseOpp);
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'postponed' });
    const future = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    // Primer prompt: fecha. Segundo prompt: razón opcional.
    const promptSpy = jest.spyOn(window, 'prompt')
      .mockImplementationOnce(() => future)
      .mockImplementationOnce(() => 'restructura');

    mount();
    await screen.findByText(/💼 Proyecto Atlas/);
    fireEvent.click(screen.getByLabelText('Mover a Postergada'));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({
          new_status: 'postponed',
          postponed_until_date: future,
          postponed_reason: 'restructura',
        })
      );
    });
    promptSpy.mockRestore();
  });
});
