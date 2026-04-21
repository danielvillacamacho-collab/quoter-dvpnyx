/**
 * CommandPalette — UI + hotkey + navigation.
 *
 * We mount the palette standalone inside a MemoryRouter so we don't
 * need the full App. The apiV2.apiGet helper is mocked.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import CommandPalette from './CommandPalette';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-path">{loc.pathname}</div>;
}

function Harness({ open, onClose = () => {} }) {
  return (
    <MemoryRouter initialEntries={['/start']}>
      <LocationProbe />
      <Routes>
        <Route path="*" element={<CommandPalette open={open} onClose={onClose} />} />
      </Routes>
    </MemoryRouter>
  );
}

const sample = {
  query: 'acme',
  total: 3,
  results: [
    { type: 'client',      id: 'c1', title: 'Acme SA',       subtitle: 'CO · enterprise', url: '/clients/c1' },
    { type: 'opportunity', id: 'o1', title: 'Acme Deal',     subtitle: 'Acme SA · open',   url: '/opportunities/o1' },
    { type: 'employee',    id: 'e1', title: 'Ana García',    subtitle: 'Dev · L5',         url: '/employees/e1' },
  ],
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('CommandPalette', () => {
  it('returns null when open=false', () => {
    const { container } = render(<Harness open={false} />);
    expect(container.querySelector('[data-testid="command-palette"]')).toBeNull();
  });

  it('shows hint when query is shorter than 2 chars', () => {
    render(<Harness open />);
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    expect(screen.getByText(/al menos 2 caracteres/i)).toBeInTheDocument();
    expect(apiV2.apiGet).not.toHaveBeenCalled();
  });

  it('debounces then fetches and renders grouped results', async () => {
    apiV2.apiGet.mockResolvedValue(sample);
    render(<Harness open />);
    const input = screen.getByTestId('cmdp-input');

    fireEvent.change(input, { target: { value: 'acme' } });
    expect(apiV2.apiGet).not.toHaveBeenCalled(); // still debounced

    act(() => { jest.advanceTimersByTime(250); });
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalledTimes(1));
    expect(apiV2.apiGet).toHaveBeenCalledWith('/api/search?q=acme');

    await waitFor(() => expect(screen.getByText('Acme SA')).toBeInTheDocument());
    expect(screen.getByText('Acme Deal')).toBeInTheDocument();
    expect(screen.getByText('Ana García')).toBeInTheDocument();
    // Section labels
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Oportunidades')).toBeInTheDocument();
    expect(screen.getByText('Empleados')).toBeInTheDocument();
  });

  it('navigates on click and calls onClose', async () => {
    apiV2.apiGet.mockResolvedValue(sample);
    const onClose = jest.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.change(screen.getByTestId('cmdp-input'), { target: { value: 'acme' } });
    act(() => { jest.advanceTimersByTime(250); });
    await waitFor(() => screen.getByTestId('cmdp-item-client-c1'));

    fireEvent.click(screen.getByTestId('cmdp-item-client-c1'));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('probe-path').textContent).toBe('/clients/c1'));
  });

  it('navigates on Enter using the keyboard cursor', async () => {
    apiV2.apiGet.mockResolvedValue(sample);
    render(<Harness open />);
    fireEvent.change(screen.getByTestId('cmdp-input'), { target: { value: 'acme' } });
    act(() => { jest.advanceTimersByTime(250); });
    await waitFor(() => screen.getByTestId('cmdp-item-client-c1'));

    const input = screen.getByTestId('cmdp-input');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // idx 1 (Acme Deal)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // idx 2 (Ana García)
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('probe-path').textContent).toBe('/employees/e1'));
  });

  it('closes on Escape', async () => {
    const onClose = jest.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('cmdp-input'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when the endpoint returns no results', async () => {
    apiV2.apiGet.mockResolvedValue({ query: 'xyz', total: 0, results: [] });
    render(<Harness open />);
    fireEvent.change(screen.getByTestId('cmdp-input'), { target: { value: 'xyz' } });
    act(() => { jest.advanceTimersByTime(250); });
    await waitFor(() => expect(screen.getByTestId('cmdp-empty')).toBeInTheDocument());
  });

  it('shows error banner when the endpoint rejects', async () => {
    apiV2.apiGet.mockRejectedValue(new Error('boom'));
    render(<Harness open />);
    fireEvent.change(screen.getByTestId('cmdp-input'), { target: { value: 'acme' } });
    act(() => { jest.advanceTimersByTime(250); });
    await waitFor(() => expect(screen.getByTestId('cmdp-error')).toBeInTheDocument());
  });
});
