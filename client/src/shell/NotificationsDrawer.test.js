/**
 * NotificationsDrawer — UI + fetch + mark-as-read flows.
 *
 * Standalone mount inside a MemoryRouter so we can assert navigation
 * side effects. apiV2 is mocked so we can script responses.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import NotificationsDrawer from './NotificationsDrawer';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-path">{loc.pathname}</div>;
}

function Harness({ open, onClose = () => {}, onUpdateUnread = () => {} }) {
  return (
    <MemoryRouter initialEntries={['/start']}>
      <LocationProbe />
      <Routes>
        <Route path="*" element={
          <NotificationsDrawer open={open} onClose={onClose} onUpdateUnread={onUpdateUnread} />
        } />
      </Routes>
    </MemoryRouter>
  );
}

const sample = (overrides = []) => ({
  data: overrides.length ? overrides : [
    { id: 'n1', type: 'assignment.created', title: 'Te asignaron a Acme',
      body: '40h/sem', link: '/assignments', read_at: null, created_at: new Date().toISOString() },
    { id: 'n2', type: 'assignment.overridden', title: 'Override registrado',
      body: null, link: null, read_at: '2026-04-21T10:00:00Z', created_at: new Date().toISOString() },
  ],
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('NotificationsDrawer', () => {
  it('returns null when open=false', () => {
    const { container } = render(<Harness open={false} />);
    expect(container.querySelector('[data-testid="notif-drawer"]')).toBeNull();
  });

  it('fetches and renders notifications when opened', async () => {
    apiV2.apiGet.mockResolvedValueOnce(sample());
    render(<Harness open={true} />);
    await waitFor(() => {
      expect(screen.getByTestId('notif-item-n1')).toBeInTheDocument();
    });
    expect(apiV2.apiGet).toHaveBeenCalledWith('/api/notifications');
    expect(screen.getByText('Te asignaron a Acme')).toBeInTheDocument();
    expect(screen.getByText('Override registrado')).toBeInTheDocument();
  });

  it('shows empty state when list is empty', async () => {
    apiV2.apiGet.mockResolvedValueOnce({ data: [] });
    render(<Harness open={true} />);
    await waitFor(() => {
      expect(screen.getByTestId('notif-empty')).toBeInTheDocument();
    });
  });

  it('shows error message when fetch fails', async () => {
    apiV2.apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<Harness open={true} />);
    await waitFor(() => {
      expect(screen.getByTestId('notif-error')).toHaveTextContent('boom');
    });
  });

  it('clicking an unread item marks it read, navigates, and closes the drawer', async () => {
    apiV2.apiGet.mockResolvedValueOnce(sample());
    apiV2.apiPost.mockResolvedValueOnce({ id: 'n1', read_at: '2026-04-21T11:00:00Z' });
    const onClose = jest.fn();
    const onUpdateUnread = jest.fn();
    render(<Harness open={true} onClose={onClose} onUpdateUnread={onUpdateUnread} />);
    await waitFor(() => screen.getByTestId('notif-item-n1'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('notif-item-n1'));
    });

    expect(apiV2.apiPost).toHaveBeenCalledWith('/api/notifications/n1/read', {});
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('probe-path')).toHaveTextContent('/assignments');
    // onUpdateUnread fires twice: once on refresh (1 unread), once after mark (0).
    expect(onUpdateUnread).toHaveBeenCalledWith(1);
    expect(onUpdateUnread).toHaveBeenLastCalledWith(0);
  });

  it('mark-all-as-read posts bulk endpoint and zeroes unread count', async () => {
    apiV2.apiGet.mockResolvedValueOnce(sample());
    apiV2.apiPost.mockResolvedValueOnce({ updated: 1 });
    const onUpdateUnread = jest.fn();
    render(<Harness open={true} onUpdateUnread={onUpdateUnread} />);
    await waitFor(() => screen.getByTestId('notif-mark-all'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('notif-mark-all'));
    });

    expect(apiV2.apiPost).toHaveBeenCalledWith('/api/notifications/read-all', {});
    expect(onUpdateUnread).toHaveBeenLastCalledWith(0);
    // Mark-all button disappears when nothing is unread.
    await waitFor(() => {
      expect(screen.queryByTestId('notif-mark-all')).toBeNull();
    });
  });

  it('close button fires onClose', async () => {
    apiV2.apiGet.mockResolvedValueOnce(sample());
    const onClose = jest.fn();
    render(<Harness open={true} onClose={onClose} />);
    await waitFor(() => screen.getByTestId('notif-close'));
    fireEvent.click(screen.getByTestId('notif-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('backdrop click fires onClose', async () => {
    apiV2.apiGet.mockResolvedValueOnce(sample());
    const onClose = jest.fn();
    render(<Harness open={true} onClose={onClose} />);
    const drawer = await screen.findByTestId('notif-drawer');
    fireEvent.mouseDown(drawer);
    expect(onClose).toHaveBeenCalled();
  });
});
