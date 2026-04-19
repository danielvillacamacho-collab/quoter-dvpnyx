import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Opportunities from './Opportunities';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter initialEntries={['/opportunities']}><Opportunities /></MemoryRouter>);

const sampleOpp = {
  id: 'o1', name: 'Proyecto Atlas', client_id: 'c1', client_name: 'Acme Corp',
  status: 'proposal', quotations_count: 2,
  expected_close_date: '2026-05-30', created_at: '2026-04-10',
};

const sampleClient = { id: 'c1', name: 'Acme Corp', active: true };

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/clients')) {
      return Promise.resolve({ data: [sampleClient], pagination: { page: 1, total: 1, pages: 1 } });
    }
    if (url.startsWith('/api/opportunities?')) {
      return Promise.resolve({ data: [sampleOpp], pagination: { page: 1, limit: 25, total: 1, pages: 1 } });
    }
    if (url.startsWith('/api/opportunities/')) {
      // transition modal "won" flow loads quotations from this endpoint
      return Promise.resolve({
        ...sampleOpp,
        quotations: [{ id: 'q1', project_name: 'Q1', status: 'sent' }],
      });
    }
    return Promise.resolve({});
  });
});

describe('Opportunities module', () => {
  it('renders the header and "+ Nueva Oportunidad" button', async () => {
    mount();
    expect(await screen.findByText(/💼 Oportunidades/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nueva Oportunidad/i })).toBeInTheDocument();
  });

  it('loads opportunities on mount and renders a row', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    expect(await screen.findByText('Proyecto Atlas')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Propuesta')).toBeInTheDocument();
  });

  it('loads clients list into the client filter dropdown', async () => {
    mount();
    await screen.findByText('Proyecto Atlas');
    const clientFilter = screen.getByLabelText('Filtro por cliente');
    expect(clientFilter).toBeInTheDocument();
    // Client option from loadClients mock
    expect(clientFilter.querySelector('option[value="c1"]')).not.toBeNull();
  });

  it('filters by status and refetches', async () => {
    mount();
    await screen.findByText('Proyecto Atlas');
    apiV2.apiGet.mockClear();
    fireEvent.change(screen.getByLabelText('Filtro por estado'), { target: { value: 'won' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('status=won'))).toBe(true);
    });
  });

  it('opens the form modal on "+ Nueva Oportunidad" and cancels cleanly', async () => {
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Oportunidad/i }));
    expect(await screen.findByText('Nueva oportunidad')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    await waitFor(() => expect(screen.queryByText('Nueva oportunidad')).toBeNull());
  });

  it('creates an opportunity via POST and reloads', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'o-new' });
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Oportunidad/i }));
    await screen.findByText('Nueva oportunidad');
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'c1' } });
    const nameInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'Nuevo Deal' } });
    fireEvent.click(screen.getByRole('button', { name: /^Guardar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities',
        expect.objectContaining({ client_id: 'c1', name: 'Nuevo Deal' }),
      );
    });
  });

  it('shows validation error when the client is not selected', async () => {
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByRole('button', { name: /Nueva Oportunidad/i }));
    await screen.findByText('Nueva oportunidad');
    const form = document.querySelector('form');
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Cliente es requerido/i)).toBeInTheDocument());
  });

  it('opens edit modal with prefilled name and disables client change', async () => {
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Editar Proyecto Atlas'));
    expect(await screen.findByText('Editar oportunidad')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Proyecto Atlas')).toBeInTheDocument();
    expect(screen.getByLabelText('Cliente')).toBeDisabled();
  });

  it('calls apiDelete with confirmation', async () => {
    apiV2.apiDelete.mockResolvedValue({ message: 'ok' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Eliminar Proyecto Atlas'));
    await waitFor(() => expect(apiV2.apiDelete).toHaveBeenCalledWith('/api/opportunities/o1'));
    confirmSpy.mockRestore();
  });

  it('does NOT call apiDelete when confirm is cancelled', async () => {
    apiV2.apiDelete.mockResolvedValue({ message: 'ok' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Eliminar Proyecto Atlas'));
    expect(apiV2.apiDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('renders status transition buttons for the current state (proposal)', async () => {
    mount();
    await screen.findByText('Proyecto Atlas');
    // from proposal: Negotiation, Ganada, Perdida, Cancelada
    expect(screen.getByLabelText('Mover Proyecto Atlas a Negociación')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover Proyecto Atlas a Ganada')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover Proyecto Atlas a Perdida')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover Proyecto Atlas a Cancelada')).toBeInTheDocument();
  });

  it('transitions to lost: requires reason, then POSTs /status with outcome_reason', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'lost' });
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Mover Proyecto Atlas a Perdida'));
    await screen.findByText(/Mover a Perdida/);
    // submit without reason → validation error
    const form = document.querySelector('form');
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Selecciona una razón/i)).toBeInTheDocument());
    // pick reason and confirm
    fireEvent.change(screen.getByLabelText('Razón'), { target: { value: 'price' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({ new_status: 'lost', outcome_reason: 'price' }),
      );
    });
  });

  it('transitions to won: loads quotations and requires winning_quotation_id', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'won' });
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Mover Proyecto Atlas a Ganada'));
    await screen.findByText(/Mover a Ganada/);
    // wait for quotations to load
    await waitFor(() => expect(screen.getByLabelText('Cotización ganadora')).toBeInTheDocument());
    // submit without selection → validation error
    const form = document.querySelector('form');
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Selecciona cotización ganadora/i)).toBeInTheDocument());
    // pick and confirm
    fireEvent.change(screen.getByLabelText('Cotización ganadora'), { target: { value: 'q1' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({ new_status: 'won', winning_quotation_id: 'q1' }),
      );
    });
  });

  it('renders empty state when no opportunities match filters', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/clients')) return Promise.resolve({ data: [], pagination: {} });
      return Promise.resolve({ data: [], pagination: { page: 1, total: 0, pages: 1 } });
    });
    mount();
    await waitFor(() => expect(screen.getByText(/No hay oportunidades que coincidan/i)).toBeInTheDocument());
  });
});
