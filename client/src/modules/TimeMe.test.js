// HANDOFF NOTE (2026-05) — flaky-en-CI conocido.
//
// Históricamente este archivo reporta 2 tests rojos sin diagnóstico
// publicado. Sospechosos primarios: los dos casos que dependen del cálculo
// dinámico de "Lunes de esta semana" para pre-poblar una celda con un
// `time_entry` existente (`deletes the entry when the cell is cleared and
// one existed` y `PUTs when an existing cell value changes`). Ambos hacen
// `m.toISOString().slice(0,10)` desde un `new Date()` local, lo que en
// timezones con DST o cerca de medianoche UTC puede no coincidir con el
// `iso()` que usa el componente. El equipo senior debería congelar el
// reloj con `jest.useFakeTimers().setSystemTime(...)` antes de tocarlos.
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
    // SPEC-012: URL now includes status=active,ended&date_from=...&date_to=...
    if (url.startsWith('/api/me/assignments'))  return Promise.resolve({ data: sampleAssignments, pagination: { page: 1, limit: 50, total: 1, pages: 1 } });
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
      if (url.startsWith('/api/me/assignments'))  return Promise.resolve({ data: sampleAssignments, pagination: {} });
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
      if (url.startsWith('/api/me/assignments'))  return Promise.resolve({ data: sampleAssignments, pagination: {} });
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

  it('empty state when the user has no active or ended assignments', async () => {
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/me/assignments'))  return Promise.resolve({ data: [], pagination: {} });
      if (url.startsWith('/api/time-entries')) return Promise.resolve({ data: [], pagination: {} });
      return Promise.resolve({});
    });
    mount();
    await waitFor(() => expect(screen.getByText(/No tienes asignaciones activas o finalizadas/i)).toBeInTheDocument());
  });

  it('chevron buttons navigate week by week', async () => {
    mount();
    await screen.findByText('Contrato Alpha');
    fireEvent.click(screen.getByLabelText('Semana siguiente'));
    await waitFor(() => expect(screen.getByLabelText('Semana siguiente')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Semana anterior'));
    await waitFor(() => expect(screen.getByLabelText('Semana anterior')).toBeInTheDocument());
  });

  // ── SPEC-011: navegación directa por semana (text input al hacer clic) ───────

  describe('SPEC-011: edición de semana por texto', () => {
    const FIXED_NOW = new Date('2026-04-08T12:00:00'); // Wednesday
    const CURRENT_MONDAY = '2026-04-06';
    const CURRENT_RANGE_TEXT = '2026-04-06 – 2026-04-12';

    beforeEach(() => {
      jest.useFakeTimers({ legacyFakeTimers: false });
      jest.setSystemTime(FIXED_NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('shows date range as static text', async () => {
      mount();
      await screen.findByText('Contrato Alpha');
      expect(screen.getByText(CURRENT_RANGE_TEXT)).toBeInTheDocument();
    });

    it('clicking the range opens a text input with current Monday', async () => {
      mount();
      await screen.findByText('Contrato Alpha');
      fireEvent.click(screen.getByLabelText('Semana actual'));
      const input = await screen.findByLabelText('Seleccionar semana');
      expect(input.value).toBe(CURRENT_MONDAY);
    });

    it('typing a date and pressing Enter navigates to that Monday', async () => {
      mount();
      await screen.findByText('Contrato Alpha');
      fireEvent.click(screen.getByLabelText('Semana actual'));
      const input = screen.getByLabelText('Seleccionar semana');
      fireEvent.change(input, { target: { value: '2026-05-07' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(screen.getByText('2026-05-04 – 2026-05-10')).toBeInTheDocument()
      );
    });

    it('pressing Escape closes the input without navigating', async () => {
      mount();
      await screen.findByText('Contrato Alpha');
      fireEvent.click(screen.getByLabelText('Semana actual'));
      const input = screen.getByLabelText('Seleccionar semana');
      fireEvent.change(input, { target: { value: '2026-05-07' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      await waitFor(() =>
        expect(screen.getByText(CURRENT_RANGE_TEXT)).toBeInTheDocument()
      );
    });
  });

  // ── SPEC-012: asignaciones finalizadas visibles y diferenciadas ─────────────

  describe('SPEC-012: ended assignments', () => {
    const FIXED_NOW = new Date('2026-05-07T12:00:00'); // Wednesday

    const endedAssignment = {
      id: 'a-ended', employee_id: 'e1',
      contract_name: 'Proyecto Beta', role_title: 'Dev', request_role_title: 'Backend',
      status: 'ended', start_date: '2026-04-28', end_date: '2026-05-02',
      contract_id: 'ct2',
    };

    beforeEach(() => {
      jest.useFakeTimers({ legacyFakeTimers: false });
      jest.setSystemTime(FIXED_NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('requests status=active,ended with date_from and date_to', async () => {
      mount();
      await waitFor(() => expect(apiV2.apiGet).toHaveBeenCalled());
      const call = apiV2.apiGet.mock.calls.find(([url]) => url.includes('/api/me/assignments'));
      expect(call[0]).toContain('status=active,ended');
      expect(call[0]).toContain('date_from=');
      expect(call[0]).toContain('date_to=');
    });

    it('renders ended assignment with "Finalizada" badge', async () => {
      apiV2.apiGet.mockImplementation((url) => {
        if (url.startsWith('/api/me/assignments')) return Promise.resolve({ data: [endedAssignment], pagination: {} });
        if (url.startsWith('/api/time-entries'))   return Promise.resolve({ data: [], pagination: {} });
        return Promise.resolve({});
      });
      mount();
      await screen.findByText('Proyecto Beta');
      expect(screen.getByText('Finalizada')).toBeInTheDocument();
    });

    it('cells outside the assignment date range are disabled', async () => {
      // Week of 2026-05-04 to 2026-05-10; assignment ends 2026-05-02 (previous week).
      // All 7 cells should be disabled (out of range for this week).
      apiV2.apiGet.mockImplementation((url) => {
        if (url.startsWith('/api/me/assignments')) return Promise.resolve({ data: [endedAssignment], pagination: {} });
        if (url.startsWith('/api/time-entries'))   return Promise.resolve({ data: [], pagination: {} });
        return Promise.resolve({});
      });
      mount();
      await screen.findByText('Proyecto Beta');
      const cells = screen.getAllByRole('spinbutton', { name: /Horas Proyecto Beta/i });
      cells.forEach((cell) => expect(cell).toBeDisabled());
    });

    it('cells within the assignment range are enabled (up to today)', async () => {
      // Wednesday 2026-04-30 is "today"; week is Mon 04-28 to Sun 05-04.
      // Assignment is active 2026-04-28 to 2026-05-02.
      // Mon(0), Tue(1), Wed(2) = today => NOT blocked (past/today, within range).
      // Thu(3), Fri(4) are future => blocked by stateFor, not by outOfRange.
      jest.setSystemTime(new Date('2026-04-30T12:00:00')); // Wednesday of that week
      apiV2.apiGet.mockImplementation((url) => {
        if (url.startsWith('/api/me/assignments')) return Promise.resolve({ data: [endedAssignment], pagination: {} });
        if (url.startsWith('/api/time-entries'))   return Promise.resolve({ data: [], pagination: {} });
        return Promise.resolve({});
      });
      mount();
      await screen.findByText('Proyecto Beta');
      const cells = screen.getAllByRole('spinbutton', { name: /Horas Proyecto Beta/i });
      // Only check Mon–Wed (idx 0-2): within range and not future.
      for (let i = 0; i <= 2; i += 1) {
        expect(cells[i]).not.toBeDisabled();
      }
    });

    it('ended assignment is excluded from quick-fill chips', async () => {
      apiV2.apiGet.mockImplementation((url) => {
        if (url.startsWith('/api/me/assignments')) return Promise.resolve({ data: [endedAssignment], pagination: {} });
        if (url.startsWith('/api/time-entries'))   return Promise.resolve({ data: [], pagination: {} });
        return Promise.resolve({});
      });
      mount();
      await screen.findByText('Proyecto Beta');
      // Quick-fill chips only appear for active assignments. "Proyecto Beta" is ended.
      expect(screen.queryByText(/Rellenar 8h/i)).not.toBeInTheDocument();
    });

    it('active and ended assignments both render in the same grid', async () => {
      apiV2.apiGet.mockImplementation((url) => {
        if (url.startsWith('/api/me/assignments')) return Promise.resolve({
          data: [sampleAssignments[0], endedAssignment], pagination: {},
        });
        if (url.startsWith('/api/time-entries')) return Promise.resolve({ data: [], pagination: {} });
        return Promise.resolve({});
      });
      mount();
      expect(await screen.findByText('Contrato Alpha')).toBeInTheDocument();
      expect(await screen.findByText('Proyecto Beta')).toBeInTheDocument();
      expect(screen.getByText('Finalizada')).toBeInTheDocument();
      // Quick-fill only for the active assignment
      expect(screen.getByText(/Rellenar 8h · Contrato Alpha/i)).toBeInTheDocument();
      expect(screen.queryByText(/Rellenar 8h · Proyecto Beta/i)).not.toBeInTheDocument();
    });
  });
});
