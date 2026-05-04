import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Opportunities from './Opportunities';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter initialEntries={['/opportunities']}><Opportunities /></MemoryRouter>);

const sampleOpp = {
  id: 'o1', name: 'Proyecto Atlas', client_id: 'c1', client_name: 'Acme Corp',
  status: 'proposal_validated', quotations_count: 2,
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
    // 'Acme Corp' also shows up in the client-filter <option>, so scope to the
    // row. Likewise 'Propuesta Validada' appears in the status-filter <option>.
    const row = screen.getByText('Proyecto Atlas').closest('tr');
    expect(within(row).getByText('Acme Corp')).toBeInTheDocument();
    expect(within(row).getByText('Propuesta Validada')).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Filtro por estado'), { target: { value: 'closed_won' } });
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('status=closed_won'))).toBe(true);
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
    // Wait for the clients dropdown to populate before opening the form,
    // otherwise setting the client_id select to 'c1' is a no-op (option missing).
    await waitFor(() => {
      const filter = screen.getByLabelText('Filtro por cliente');
      expect(filter.querySelector('option[value="c1"]')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: /Nueva Oportunidad/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Cliente'), { target: { value: 'c1' } });
    // Inside the dialog the first textbox is the name input; the second is the
    // description textarea. Scope to dialog so page-level filter inputs don't leak in.
    const nameInput = within(dialog).getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'Nuevo Deal' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
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
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(within(dialog).getByRole('button', { name: /^Guardar/i }).closest('form'));
    await waitFor(() => expect(within(dialog).getByText(/Cliente es requerido/i)).toBeInTheDocument());
  });

  it('opens edit modal with prefilled name and disables client change', async () => {
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Editar Proyecto Atlas'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Editar oportunidad')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Proyecto Atlas')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Cliente')).toBeDisabled();
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

  it('renders status transition buttons for the current state (proposal_validated)', async () => {
    mount();
    await screen.findByText('Proyecto Atlas');
    // SPEC-CRM-00 v1.1: from proposal_validated → Negociación, Ganada, Perdida, Postergada.
    // (Cancelada ya no existe en el pipeline de 9 estados.)
    expect(screen.getByLabelText('Mover Proyecto Atlas a Negociación')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover Proyecto Atlas a Ganada')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover Proyecto Atlas a Perdida')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover Proyecto Atlas a Postergada')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mover Proyecto Atlas a Cancelada')).toBeNull();
  });

  // SPEC-CRM-00 v1.1 PR2 — closed_lost ahora exige loss_reason del enum
  // extendido + loss_reason_detail con ≥30 chars. La UI reemplazó el
  // dropdown legacy de outcome_reason por un dropdown de 9 valores y un
  // textarea de detalle.
  it('transitions to closed_lost: requires loss_reason + 30-char detail, posts loss_reason + loss_reason_detail', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'closed_lost' });
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Mover Proyecto Atlas a Perdida'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Mover a Perdida/)).toBeInTheDocument();
    // submit without reason → validation error (mensaje del validator);
    // usamos role=alert para distinguirlo del label "Razón de pérdida".
    fireEvent.submit(within(dialog).getByRole('button', { name: /Confirmar/i }).closest('form'));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(/razón de pérdida/i),
    );
    // pick reason but submit with short detail → exige 30 chars
    fireEvent.change(within(dialog).getByLabelText('Razón de pérdida'), { target: { value: 'competitor_won' } });
    fireEvent.change(within(dialog).getByLabelText('Descripción detallada de la pérdida'), {
      target: { value: 'corto' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar/i }));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(/al menos 30/i),
    );
    expect(apiV2.apiPost).not.toHaveBeenCalled();
    // detail con suficientes chars → sí dispara el POST.
    const detail = 'Cliente eligió competidor por feature X. Plan: roadmap Q3.';
    fireEvent.change(within(dialog).getByLabelText('Descripción detallada de la pérdida'), {
      target: { value: detail },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({
          new_status: 'closed_lost',
          loss_reason: 'competitor_won',
          loss_reason_detail: detail,
          outcome_reason: 'competitor_won', // legacy compat también enviado
        }),
      );
    });
  });

  // SPEC-CRM-00 v1.1 — Postponed transitions UI.
  it('transitions to postponed: shows date picker, validates future date, POSTs with postponed_until_date', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'postponed' });
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Mover Proyecto Atlas a Postergada'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Mover a Postergada/)).toBeInTheDocument();
    // El date picker debe existir con el default (~30 días futuros).
    const dateInput = within(dialog).getByLabelText('Fecha de reactivación');
    expect(dateInput).toBeInTheDocument();
    expect(dateInput).toHaveAttribute('min'); // tiene min=today
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Mover a fecha pasada — debe bloquear el submit con mensaje claro.
    fireEvent.change(dateInput, { target: { value: '2020-01-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(within(dialog).getByText(/futura/i)).toBeInTheDocument());
    expect(apiV2.apiPost).not.toHaveBeenCalled();
    // Volver a una fecha válida y confirmar.
    const future = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    fireEvent.change(dateInput, { target: { value: future } });
    fireEvent.change(within(dialog).getByLabelText('Razón de postergación'), {
      target: { value: 'restructura organizacional' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({
          new_status: 'postponed',
          postponed_until_date: future,
          postponed_reason: 'restructura organizacional',
        }),
      );
    });
  });

  it('transitions to won: loads quotations and requires winning_quotation_id', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'o1', status: 'closed_won' });
    mount();
    await screen.findByText('Proyecto Atlas');
    fireEvent.click(screen.getByLabelText('Mover Proyecto Atlas a Ganada'));
    const dialog = await screen.findByRole('dialog');
    // wait for quotations to load — the q1 option only appears after the /api/opportunities/o1 fetch resolves
    await waitFor(() => {
      const select = within(dialog).getByLabelText('Cotización ganadora');
      expect(select.querySelector('option[value="q1"]')).not.toBeNull();
    });
    // submit without selection → validation error
    fireEvent.submit(within(dialog).getByRole('button', { name: /Confirmar/i }).closest('form'));
    await waitFor(() => expect(within(dialog).getByText(/Selecciona cotización ganadora/i)).toBeInTheDocument());
    // pick and confirm
    fireEvent.change(within(dialog).getByLabelText('Cotización ganadora'), { target: { value: 'q1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/opportunities/o1/status',
        expect.objectContaining({ new_status: 'closed_won', winning_quotation_id: 'q1' }),
      );
    });
  });

  // SPEC-CRM-00 v1.1 PR2 — Form de creación con revenue model + flags.
  describe('SPEC-CRM-00 v1.1 PR2: revenue selector', () => {
    const openCreateModal = async () => {
      mount();
      await screen.findByText('Proyecto Atlas');
      await waitFor(() => {
        const filter = screen.getByLabelText('Filtro por cliente');
        expect(filter.querySelector('option[value="c1"]')).not.toBeNull();
      });
      fireEvent.click(screen.getByRole('button', { name: /Nueva Oportunidad/i }));
      return await screen.findByRole('dialog');
    };

    // Los radios usan aria-label exacto (texto del enum) para evitar
    // que /Recurring/i matchee también "Mixed (...recurring)".
    const ARIA = {
      one_time: 'One-time (proyecto puntual)',
      recurring: 'Recurring (mensual con duración)',
      mixed: 'Mixed (one-time + recurring)',
    };

    it('por default es one_time y muestra el campo Monto one-time', async () => {
      const dialog = await openCreateModal();
      expect(within(dialog).getByLabelText(ARIA.one_time)).toBeChecked();
      expect(within(dialog).getByLabelText('Monto one-time USD')).toBeInTheDocument();
      // No exhibe los campos de recurring cuando estamos en one_time.
      expect(within(dialog).queryByLabelText('MRR USD')).toBeNull();
    });

    it('al elegir Recurring muestra MRR + Duración y calcula booking en vivo', async () => {
      const dialog = await openCreateModal();
      fireEvent.click(within(dialog).getByLabelText(ARIA.recurring));
      fireEvent.change(within(dialog).getByLabelText('MRR USD'), { target: { value: '5000' } });
      fireEvent.change(within(dialog).getByLabelText('Duración del contrato en meses'), { target: { value: '24' } });
      // Booking calculado: 5000 × 24 = 120,000.
      expect(within(dialog).getByText(/Booking calculado: USD 120,000/)).toBeInTheDocument();
    });

    it('Mixed muestra los tres campos y suma one-time + mrr×months', async () => {
      const dialog = await openCreateModal();
      fireEvent.click(within(dialog).getByLabelText(ARIA.mixed));
      fireEvent.change(within(dialog).getByLabelText('Monto one-time USD'), { target: { value: '20000' } });
      fireEvent.change(within(dialog).getByLabelText('MRR USD'), { target: { value: '3000' } });
      fireEvent.change(within(dialog).getByLabelText('Duración del contrato en meses'), { target: { value: '12' } });
      expect(within(dialog).getByText(/Booking calculado: USD 56,000/)).toBeInTheDocument();
    });

    it('rechaza submit en recurring sin mrr', async () => {
      const dialog = await openCreateModal();
      fireEvent.change(within(dialog).getByLabelText('Cliente'), { target: { value: 'c1' } });
      const nameInput = within(dialog).getAllByRole('textbox')[0];
      fireEvent.change(nameInput, { target: { value: 'Recurring Deal' } });
      fireEvent.click(within(dialog).getByLabelText(ARIA.recurring));
      // dejamos mrr y meses vacíos → validación bloquea
      fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
      await waitFor(() => expect(within(dialog).getByText(/MRR es requerido/i)).toBeInTheDocument());
      expect(apiV2.apiPost).not.toHaveBeenCalled();
    });

    it('opciones avanzadas: Champion / EB / funding aws_mdf con monto / drive_url', async () => {
      apiV2.apiPost.mockResolvedValue({ id: 'o-new' });
      const dialog = await openCreateModal();
      fireEvent.change(within(dialog).getByLabelText('Cliente'), { target: { value: 'c1' } });
      fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: 'Avanzado' } });
      fireEvent.change(within(dialog).getByLabelText('Monto one-time USD'), { target: { value: '15000' } });
      // toggle "Más opciones"
      fireEvent.click(within(dialog).getByLabelText('Mostrar opciones avanzadas'));
      fireEvent.click(within(dialog).getByLabelText('Champion identificado'));
      fireEvent.click(within(dialog).getByLabelText('Economic Buyer identificado'));
      fireEvent.change(within(dialog).getByLabelText('Funding source'), { target: { value: 'aws_mdf' } });
      fireEvent.change(within(dialog).getByLabelText('Monto de funding USD'), { target: { value: '5000' } });
      fireEvent.change(within(dialog).getByLabelText('Drive URL'), {
        target: { value: 'https://drive.google.com/folder/abc' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: /^Guardar/i }));
      await waitFor(() => {
        expect(apiV2.apiPost).toHaveBeenCalledWith(
          '/api/opportunities',
          expect.objectContaining({
            revenue_type: 'one_time',
            one_time_amount_usd: 15000,
            champion_identified: true,
            economic_buyer_identified: true,
            funding_source: 'aws_mdf',
            funding_amount_usd: 5000,
            drive_url: 'https://drive.google.com/folder/abc',
          }),
        );
      });
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

  it('Descargar CSV button calls apiDownload with the active filters', async () => {
    apiV2.apiDownload.mockResolvedValue();
    mount();
    await screen.findByText('Proyecto Atlas');

    // Apply a status filter so the CSV request should carry it.
    fireEvent.change(screen.getByLabelText('Filtro por estado'), { target: { value: 'proposal_validated' } });

    fireEvent.click(screen.getByTestId('opportunities-export-csv'));
    await waitFor(() => expect(apiV2.apiDownload).toHaveBeenCalledTimes(1));
    const [url, filename] = apiV2.apiDownload.mock.calls[0];
    expect(url).toMatch(/^\/api\/opportunities\/export\.csv\?/);
    expect(url).toContain('status=proposal');
    expect(filename).toBe('oportunidades.csv');
  });
});
