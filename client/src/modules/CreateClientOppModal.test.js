/**
 * CreateClientOppModal — tests
 *
 * Key scenarios:
 *  - FIX-409: when POST /api/clients returns 409 with existing_id, show
 *    "Usar cliente existente" button that calls onCreated without creating.
 *  - FIX-409+opp: same but user also typed an opp name → creates opp first.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateClientOppModal from './CreateClientOppModal';
import { apiPost } from '../utils/apiV2';

jest.mock('../utils/apiV2');

const noop = () => {};

describe('CreateClientOppModal — client mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders client name input and Crear button', () => {
    render(<CreateClientOppModal mode="client" onCreated={noop} onCancel={noop} />);
    expect(screen.getByPlaceholderText(/Acme Corp/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear/i })).toBeInTheDocument();
  });

  it('shows validation error when submitting empty name', async () => {
    render(<CreateClientOppModal mode="client" onCreated={noop} onCancel={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear/i }));
    expect(await screen.findByText(/nombre del cliente es requerido/i)).toBeInTheDocument();
  });

  it('calls onCreated with new client when POST succeeds', async () => {
    apiPost.mockResolvedValueOnce({ id: 'c1', name: 'Acme' });
    const onCreated = jest.fn();
    render(<CreateClientOppModal mode="client" onCreated={onCreated} onCancel={noop} />);
    fireEvent.change(screen.getByPlaceholderText(/Acme Corp/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ client_id: 'c1', client_name: 'Acme' }));
  });

  // ── FIX-409 ──────────────────────────────────────────────────────────────
  it('FIX-409: shows "Usar cliente existente" button when server returns 409 with existing_id', async () => {
    const err = Object.assign(new Error('Ya existe un cliente con ese nombre'), {
      status: 409,
      body: { error: 'Ya existe un cliente con ese nombre', hint: 'Ágata Corp', existing_id: 'existing-uuid' },
    });
    apiPost.mockRejectedValueOnce(err);

    render(<CreateClientOppModal mode="client" onCreated={noop} onCancel={noop} />);
    fireEvent.change(screen.getByPlaceholderText(/Acme Corp/i), { target: { value: 'Ágata Corp' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear/i }));

    expect(await screen.findByText(/Ya existe un cliente con ese nombre/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Usar "Ágata Corp"/i })).toBeInTheDocument();
  });

  it('FIX-409: "Usar cliente existente" calls onCreated with existing_id without creating anything', async () => {
    const err = Object.assign(new Error('Ya existe'), {
      status: 409,
      body: { hint: 'Ágata Corp', existing_id: 'existing-uuid' },
    });
    apiPost.mockRejectedValueOnce(err); // for the original POST /clients
    const onCreated = jest.fn();

    render(<CreateClientOppModal mode="client" onCreated={onCreated} onCancel={noop} />);
    fireEvent.change(screen.getByPlaceholderText(/Acme Corp/i), { target: { value: 'Ágata Corp' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear/i }));

    const useExistingBtn = await screen.findByRole('button', { name: /Usar "Ágata Corp"/i });
    fireEvent.click(useExistingBtn);

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ client_id: 'existing-uuid', client_name: 'Ágata Corp' })
    );
    // Should NOT have made another apiPost call (only 1 total — the failed one)
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('FIX-409+opp: "Usar cliente existente" creates opportunity when opp name is filled', async () => {
    const err = Object.assign(new Error('Ya existe'), {
      status: 409,
      body: { hint: 'Ágata Corp', existing_id: 'existing-uuid' },
    });
    apiPost
      .mockRejectedValueOnce(err)                                    // POST /clients → 409
      .mockResolvedValueOnce({ id: 'opp-1', name: 'Proyecto GEB' }); // POST /opportunities

    const onCreated = jest.fn();
    render(<CreateClientOppModal mode="client" onCreated={onCreated} onCancel={noop} />);
    fireEvent.change(screen.getByPlaceholderText(/Acme Corp/i), { target: { value: 'Ágata Corp' } });
    fireEvent.change(screen.getByPlaceholderText(/Portal E-commerce/i), { target: { value: 'Proyecto GEB' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear/i }));

    const useExistingBtn = await screen.findByRole('button', { name: /Usar "Ágata Corp"/i });
    fireEvent.click(useExistingBtn);

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({
        client_id: 'existing-uuid',
        client_name: 'Ágata Corp',
        opportunity_id: 'opp-1',
        opportunity_name: 'Proyecto GEB',
      })
    );
    expect(apiPost).toHaveBeenCalledWith('/api/opportunities', {
      client_id: 'existing-uuid',
      name: 'Proyecto GEB',
    });
  });

  it('shows generic error for non-409 failures', async () => {
    const err = Object.assign(new Error('Error de red'), { status: 500 });
    apiPost.mockRejectedValueOnce(err);

    render(<CreateClientOppModal mode="client" onCreated={noop} onCancel={noop} />);
    fireEvent.change(screen.getByPlaceholderText(/Acme Corp/i), { target: { value: 'Nuevo cliente' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear/i }));

    expect(await screen.findByText(/Error de red/i)).toBeInTheDocument();
    // No "usar existente" button for non-409 errors
    expect(screen.queryByText(/Usar "/i)).not.toBeInTheDocument();
  });

  it('calls onCancel when Cancelar is clicked', () => {
    const onCancel = jest.fn();
    render(<CreateClientOppModal mode="client" onCreated={noop} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('CreateClientOppModal — opportunity mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders opp name input without client name field', () => {
    render(
      <CreateClientOppModal
        mode="opportunity"
        clientId="c1"
        clientName="Ágata Corp"
        onCreated={noop}
        onCancel={noop}
      />
    );
    expect(screen.queryByPlaceholderText(/Acme Corp/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Portal E-commerce/i)).toBeInTheDocument();
  });

  it('calls onCreated with new opportunity', async () => {
    apiPost.mockResolvedValueOnce({ id: 'opp-1', name: 'GEB 2026' });
    const onCreated = jest.fn();
    render(
      <CreateClientOppModal
        mode="opportunity"
        clientId="c1"
        clientName="Ágata Corp"
        onCreated={onCreated}
        onCancel={noop}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/Portal E-commerce/i), { target: { value: 'GEB 2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear/i }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({
        client_id: 'c1',
        client_name: 'Ágata Corp',
        opportunity_id: 'opp-1',
        opportunity_name: 'GEB 2026',
      })
    );
  });
});
