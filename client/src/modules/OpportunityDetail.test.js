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
    // SPEC-CRM-00 v1.1 PR2 — modelo de revenue + flags + funding visibles
    // en cards nuevos del detalle.
    revenue_type: 'one_time', one_time_amount_usd: 50000, booking_amount_usd: 50000, weighted_amount_usd: 25000,
    champion_identified: true, economic_buyer_identified: false,
    funding_source: 'client_direct',
    // SPEC-CRM-00 v1.1 PR3 — margen calculado.
    estimated_cost_usd: 32500, margin_pct: 35,
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

  // SPEC-CRM-00 v1.1 PR2 — Revenue + Stakeholders + Funding cards.
  describe('SPEC-CRM-00 v1.1 PR2: Revenue / Stakeholders / Funding cards', () => {
    it('renders revenue card with one_time amount + booking + weighted', async () => {
      apiV2.apiGet.mockResolvedValue(baseOpp);
      mount();
      await screen.findByText(/💼 Proyecto Atlas/);
      const card = await screen.findByTestId('opportunity-revenue-card');
      // El label del enum + el label del campo "One-time USD" ambos contienen
      // "One-time"; chequeamos que aparece >=1 vez en lugar de exigir único.
      expect(within(card).getAllByText(/One-time/i).length).toBeGreaterThan(0);
      expect(within(card).getAllByText(/USD 50,000/).length).toBeGreaterThan(0); // one-time + booking
      expect(within(card).getByText(/USD 25,000/)).toBeInTheDocument();          // weighted
    });

    it('renders revenue card with MRR + duración cuando es recurring', async () => {
      apiV2.apiGet.mockResolvedValue({
        ...baseOpp,
        revenue_type: 'recurring', one_time_amount_usd: null,
        mrr_usd: 5000, contract_length_months: 24,
        booking_amount_usd: 120000, weighted_amount_usd: 60000,
      });
      mount();
      const card = await screen.findByTestId('opportunity-revenue-card');
      expect(within(card).getByText(/Recurring/i)).toBeInTheDocument();
      expect(within(card).getByText(/USD 5,000/)).toBeInTheDocument();   // MRR
      expect(within(card).getByText('24')).toBeInTheDocument();          // duración
      expect(within(card).getByText(/USD 120,000/)).toBeInTheDocument(); // booking
    });

    it('renders stakeholders card con flags + funding source', async () => {
      apiV2.apiGet.mockResolvedValue({
        ...baseOpp,
        champion_identified: true, economic_buyer_identified: false,
        funding_source: 'aws_mdf', funding_amount_usd: 25000,
      });
      mount();
      const card = await screen.findByTestId('opportunity-meddpicc-card');
      expect(within(card).getByText('✅ Sí')).toBeInTheDocument();   // Champion
      expect(within(card).getByText('❌ No')).toBeInTheDocument();   // EB
      expect(within(card).getByText(/AWS MDF/)).toBeInTheDocument();
      expect(within(card).getByText(/USD 25,000/)).toBeInTheDocument();
    });

    it('renders loss card con loss_reason + detail cuando status es closed_lost', async () => {
      apiV2.apiGet.mockResolvedValue({
        ...baseOpp, status: 'closed_lost',
        loss_reason: 'competitor_won',
        loss_reason_detail: 'Cliente eligió competidor X por feature Y. Plan: roadmap Q3.',
      });
      mount();
      const card = await screen.findByTestId('opportunity-loss-card');
      expect(within(card).getByText(/Ganó competidor/)).toBeInTheDocument();
      expect(within(card).getByText(/feature Y/)).toBeInTheDocument();
    });

    it('NO renderiza loss card cuando la opp está activa', async () => {
      apiV2.apiGet.mockResolvedValue(baseOpp);
      mount();
      await screen.findByText(/💼 Proyecto Atlas/);
      expect(screen.queryByTestId('opportunity-loss-card')).toBeNull();
    });

    it('drive_url renderiza como link cuando está poblado', async () => {
      apiV2.apiGet.mockResolvedValue({
        ...baseOpp, drive_url: 'https://drive.google.com/folder/abc',
      });
      mount();
      const link = await screen.findByLabelText('Abrir Drive de la oportunidad');
      expect(link).toHaveAttribute('href', 'https://drive.google.com/folder/abc');
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  // SPEC-CRM-00 v1.1 PR2 — closed_lost con loss_reason del enum extendido
  // + detail mín 30 chars. El detalle usa window.prompt (UI rápida).
  it('transition closed_lost: prompt loss_reason + detail, posts loss_reason + detail', async () => {
    apiV2.apiGet.mockResolvedValueOnce(baseOpp).mockResolvedValue(baseOpp);
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'closed_lost' });
    const detail = 'Cliente eligió competidor por feature X. Plan: incluir Y en Q3 y reabrir.';
    const promptSpy = jest.spyOn(window, 'prompt')
      .mockImplementationOnce(() => 'competitor_won')
      .mockImplementationOnce(() => detail);
    mount();
    await screen.findByText(/💼 Proyecto Atlas/);
    fireEvent.click(screen.getByLabelText('Mover a Perdida'));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({
          new_status: 'closed_lost',
          loss_reason: 'competitor_won',
          loss_reason_detail: detail,
        }),
      );
    });
    promptSpy.mockRestore();
  });

  // SPEC-CRM-00 v1.1 PR3 — Margin card + check-margin + Alerta A4.
  describe('SPEC-CRM-00 v1.1 PR3: Margin card', () => {
    it('renders margin card with margin_pct and estimated_cost_usd', async () => {
      apiV2.apiGet.mockResolvedValue(baseOpp);
      mount();
      const card = await screen.findByTestId('opportunity-margin-card');
      expect(within(card).getByText('35%')).toBeInTheDocument();
      expect(within(card).getAllByText(/USD 32,500/).length).toBeGreaterThan(0);
    });

    it('shows A4 badge when margin_pct is below threshold (< 20%)', async () => {
      apiV2.apiGet.mockResolvedValue({
        ...baseOpp, margin_pct: 12, estimated_cost_usd: 44000,
      });
      mount();
      const card = await screen.findByTestId('opportunity-margin-card');
      expect(within(card).getByLabelText('Alerta A4: margen bajo')).toBeInTheDocument();
      expect(within(card).getByText(/12%/)).toBeInTheDocument();
    });

    it('does NOT show A4 badge when margin_pct >= 20%', async () => {
      apiV2.apiGet.mockResolvedValue(baseOpp); // margin_pct = 35
      mount();
      await screen.findByTestId('opportunity-margin-card');
      expect(screen.queryByLabelText('Alerta A4: margen bajo')).toBeNull();
    });

    it('shows placeholder text when margin_pct is null (not yet computed)', async () => {
      apiV2.apiGet.mockResolvedValue({
        ...baseOpp, margin_pct: null, estimated_cost_usd: null,
      });
      mount();
      const card = await screen.findByTestId('opportunity-margin-card');
      expect(within(card).getByText(/Margen no calculado todavía/)).toBeInTheDocument();
    });

    it('"Calcular Margen" button calls POST check-margin with explicit cost and reloads', async () => {
      apiV2.apiGet
        .mockResolvedValueOnce(baseOpp)                // initial load
        .mockResolvedValue({ ...baseOpp, margin_pct: 25, estimated_cost_usd: 37500 }); // reload after POST
      apiV2.apiPost.mockResolvedValue({
        margin_pct: 25, estimated_cost_usd: 37500, booking_amount_usd: 50000, alert_fired: false,
      });
      const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('37500');
      mount();
      await screen.findByTestId('opportunity-margin-card');
      fireEvent.click(screen.getByLabelText('Calcular margen de la oportunidad'));
      await waitFor(() => {
        expect(apiV2.apiPost).toHaveBeenCalledWith(
          '/api/opportunities/o1/check-margin',
          expect.objectContaining({ estimated_cost_usd: 37500 }),
        );
      });
      promptSpy.mockRestore();
    });

    it('"Calcular Margen" sends empty body when prompt is blank (auto-compute)', async () => {
      apiV2.apiGet.mockResolvedValueOnce(baseOpp).mockResolvedValue(baseOpp);
      apiV2.apiPost.mockResolvedValue({
        margin_pct: 40, estimated_cost_usd: 30000, booking_amount_usd: 50000, alert_fired: false,
      });
      const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('');
      mount();
      await screen.findByTestId('opportunity-margin-card');
      fireEvent.click(screen.getByLabelText('Calcular margen de la oportunidad'));
      await waitFor(() => {
        expect(apiV2.apiPost).toHaveBeenCalledWith(
          '/api/opportunities/o1/check-margin',
          {}, // empty body → auto-compute
        );
      });
      promptSpy.mockRestore();
    });

    it('shows A4 alert dialog when check-margin returns alert_fired=true', async () => {
      apiV2.apiGet.mockResolvedValueOnce(baseOpp).mockResolvedValue({ ...baseOpp, margin_pct: 10 });
      apiV2.apiPost.mockResolvedValue({
        margin_pct: 10, estimated_cost_usd: 45000, booking_amount_usd: 50000, alert_fired: true,
      });
      const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('45000');
      const alertSpy  = jest.spyOn(window, 'alert').mockImplementation(() => {});
      mount();
      await screen.findByTestId('opportunity-margin-card');
      fireEvent.click(screen.getByLabelText('Calcular margen de la oportunidad'));
      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/A4/));
      });
      promptSpy.mockRestore();
      alertSpy.mockRestore();
    });
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
