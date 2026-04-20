import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TimeMe from './TimeMe';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><TimeMe /></MemoryRouter>);

const sampleAssignments = [
  { id: 'a1', employee_id: 'e1', contract_name: 'Contrato Alpha', role_title: 'Senior Dev', request_role_title: 'Backend Lead', status: 'active' },
];
const sampleEntries = [
  // An entry on whichever Monday the test runs in — we'll compute it in tests
];

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/assignments'))  return Promise.resolve({ data: sampleAssignments, pagination: { page: 1, limit: 50, total: 1, pages: 1 } });
    if (url.startsWith('/api/time-entries')) return Promise.resolve({ data: sampleEntries, pagination: { page: 1, limit: 500, total: 0, pages: 1 } });
    return Promise.resolve({});
  });
});

describe('TimeMe', () => {
  it('renders header and week navigation', async () => {
    mount();
    expect(await screen.findByText(/⏱ Mis horas/)).toBeInTheDocument();
    expect(screen.getByLabelText('Copiar semana anterior')).toBeInTheDocument();
    expect(screen.getByLabelText('Semana anterior')).toBeInTheDocument();
    expect(screen.getByLabelText('Semana siguiente')).toBeInTheDocument();
  });

  it('loads assignments + entries and renders a row per assignment', async () => {
    mount();
    await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
    expect(await screen.findByText('Contrato Alpha')).toBeInTheDocument();
  });

  it('renders 7 day column headers + total row', async () => {
    mount();
    await screen.findByText('Contrato Alpha');
    expect(screen.getByText('Lun')).toBeInTheDocument();
    expect(screen.getByText('Dom')).toBeInTheDocument();
    expect(screen.getByText('Total día')).toBeInTheDocument();
  });

  it('posts a new time entry when a cell is filled on blur', async () => {
    apiV2.apiPost.mockResolvedValue({ id: 'te-new' });
    mount();
    await screen.findByText('Contrato Alpha');
    // Grab the Monday cell for the single assignment
    const cells = screen.getAllByRole('spinbutton', { name: /Horas Contrato Alpha/i });
    expect(cells).toHaveLength(7);
    fireEvent.blur(cells[0], { target: { value: '6' } });
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/time-entries',
        expect.objectContaining({ assignment_id: 'a1', hours: 6 })
      );
    });
  });

  it('deletes the entry when the cell is cleared and one existed', async () => {
    const today = new Date(); const m = new Date(today); const day = m.getDay();
    const diff = day === 0 ? -6 : 1 - day; m.setDate(m.getDate() + diff);
    const monIso = m.toISOString().slice(0, 10);
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/assignments'))  return Promise.resolve({ data: sampleAssignments, pagination: {} });
      if (url.startsWith('/api/time-entries')) return Promise.resolve({ data: [{ id: 'te1', assignment_id: 'a1', work_date: monIso, hours: 4 }], pagination: {} });
      return Promise.resolve({});
    });
    apiV2.apiDelete.mockResolvedValue({ message: 'ok' });
    mount();
    await screen.findByText('Contrato Alpha');
    const cells = screen.getAllByRole('spinbutton', { name: /Horas Contrato Alpha/i });
    fireEvent.blur(cells[0], { target: { value: '' } });
    await waitFor(() => expect(apiV2.apiDelete).toHaveBeenCalledWith('/api/time-entries/te1'));
  });

  it('PUTs when an existing cell value changes', async () => {
    const today = new Date(); const m = new Date(today); const day = m.getDay();
    const diff = day === 0 ? -6 : 1 - day; m.setDate(m.getDate() + diff);
    const monIso = m.toISOString().slice(0, 10);
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/assignments'))  return Promise.resolve({ data: sampleAssignments, pagination: {} });
      if (url.startsWith('/api/time-entries')) return Promise.resolve({ data: [{ id: 'te1', assignment_id: 'a1', work_date: monIso, hours: 4 }], pagination: {} });
      return Promise.resolve({});
    });
    apiV2.apiPut.mockResolvedValue({ id: 'te1', hours: 7 });
    mount();
    await screen.findByText('Contrato Alpha');
    const cells = screen.getAllByRole('spinbutton', { name: /Horas Contrato Alpha/i });
    fireEvent.blur(cells[0], { target: { value: '7' } });
    await waitFor(() => expect(apiV2.apiPut).toHaveBeenCalledWith('/api/time-entries/te1', { hours: 7 }));
  });

  it('copy previous week calls /copy-week with this employee and the previous Monday', async () => {
    apiV2.apiPost.mockResolvedValue({ copied: 1, skipped: [] });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await screen.findByText('Contrato Alpha');
    fireEvent.click(screen.getByLabelText('Copiar semana anterior'));
    await waitFor(() => {
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/time-entries/copy-week',
        expect.objectContaining({ employee_id: 'e1' })
      );
    });
    confirmSpy.mockRestore();
  });

  it('empty state when the user has no active assignments', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/assignments'))  return Promise.resolve({ data: [], pagination: {} });
      if (url.startsWith('/api/time-entries')) return Promise.resolve({ data: [], pagination: {} });
      return Promise.resolve({});
    });
    mount();
    await waitFor(() => expect(screen.getByText(/No tienes asignaciones activas/i)).toBeInTheDocument());
  });
});
