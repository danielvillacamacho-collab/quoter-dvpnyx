/**
 * Tests for TimeAdmin — "Asignar Horas" page.
 * Covers core grid rendering, CRUD flow, and SPEC-012 (ended assignments).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TimeAdmin from './TimeAdmin';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ isAdmin: false }),
}));
jest.mock('../shell/FilterableSelect', () => {
  const React = require('react');
  return function FilterableSelect({ value, onChange, options, placeholder }) {
    return (
      <select
        data-testid="emp-select"
        value={value}
        onChange={onChange}
        aria-label={placeholder || 'Buscar empleado'}
      >
        <option value="">-- seleccionar --</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    );
  };
});

const sampleEmployees = [
  { id: 'e1', first_name: 'Ana', last_name: 'García', area_name: 'Eng', full_name: 'Ana García' },
];

const activeAssignment = {
  id: 'a1', employee_id: 'e1', contract_id: 'ct1',
  contract_name: 'Contrato Alpha', role_title: 'Senior Dev', request_role_title: 'Backend Lead',
  status: 'active', start_date: '2026-01-01', end_date: null,
};

const endedAssignment = {
  id: 'a-ended', employee_id: 'e1', contract_id: 'ct2',
  contract_name: 'Proyecto Beta', role_title: 'Dev', request_role_title: 'Backend',
  status: 'ended', start_date: '2026-04-28', end_date: '2026-05-02',
};

function mount() {
  return render(<MemoryRouter><TimeAdmin /></MemoryRouter>);
}

function setupDefaultMocks(assignments = [activeAssignment]) {
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/employees'))   return Promise.resolve({ data: sampleEmployees, pagination: {} });
    if (url.startsWith('/api/assignments')) return Promise.resolve({ data: assignments, pagination: {} });
    if (url.startsWith('/api/time-entries')) return Promise.resolve({ data: [], pagination: {} });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

async function selectEmployee() {
  const sel = await screen.findByTestId('emp-select');
  fireEvent.change(sel, { target: { value: 'e1' } });
}

describe('TimeAdmin — core rendering', () => {
  it('renders header and placeholder before employee is selected', async () => {
    setupDefaultMocks();
    mount();
    expect(await screen.findByText(/Asignar Horas/)).toBeInTheDocument();
    expect(screen.getByText(/Selecciona un empleado/i)).toBeInTheDocument();
  });

  it('loads assignments + entries after employee is selected', async () => {
    setupDefaultMocks();
    mount();
    await selectEmployee();
    expect(await screen.findByText('Contrato Alpha')).toBeInTheDocument();
    expect(apiV2.apiGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/assignments\?employee_id=e1/)
    );
  });

  it('renders 7 day column headers + Total día footer', async () => {
    setupDefaultMocks();
    mount();
    await selectEmployee();
    await screen.findByText('Contrato Alpha');
    expect(screen.getByText('Lun')).toBeInTheDocument();
    expect(screen.getByText('Dom')).toBeInTheDocument();
    expect(screen.getByText('Total día')).toBeInTheDocument();
  });

  it('posts a new time entry when a cell is filled on blur', async () => {
    setupDefaultMocks();
    apiV2.apiPost.mockResolvedValue({ id: 'te-new' });
    mount();
    await selectEmployee();
    await screen.findByText('Contrato Alpha');
    const cells = screen.getAllByRole('spinbutton', { name: /Horas Contrato Alpha/i });
    fireEvent.blur(cells[0], { target: { value: '6' } });
    await waitFor(() =>
      expect(apiV2.apiPost).toHaveBeenCalledWith(
        '/api/time-entries',
        expect.objectContaining({ assignment_id: 'a1', hours: 6 }),
      )
    );
  });

  it('shows empty state text when no assignments returned', async () => {
    setupDefaultMocks([]);
    mount();
    await selectEmployee();
    await waitFor(() =>
      expect(screen.getByText(/No hay asignaciones activas o finalizadas/i)).toBeInTheDocument()
    );
  });
});

// ── SPEC-012: asignaciones finalizadas visibles y diferenciadas ─────────────

describe('TimeAdmin — SPEC-012: ended assignments', () => {
  // Module-level "now" used by week boundary helpers in TimeAdmin.js. We mock
  // the global Date constructor so `new Date()` is deterministic — keeping
  // timers real so React Testing Library's `findByText`/`waitFor` polling
  // (and the controlled-select state propagation after `fireEvent.change`)
  // continues to work. Going with `useFakeTimers` here breaks both: the
  // SPEC-007 attempt that did so produced flaky CI runs that never settled.
  let fixedNow = new Date('2026-05-07T12:00:00').getTime(); // Thursday May 7, 2026
  const RealDate = Date;

  function mockDateNow(now) {
    fixedNow = now;
  }

  beforeEach(() => {
    fixedNow = new Date('2026-05-07T12:00:00').getTime();
    // eslint-disable-next-line no-global-assign
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) { super(fixedNow); return; }
        super(...args);
      }
      static now() { return fixedNow; }
    };
  });

  afterEach(() => {
    // eslint-disable-next-line no-global-assign
    global.Date = RealDate;
  });

  it('requests status=planned,active,ended with date_from and date_to', async () => {
    setupDefaultMocks();
    mount();
    await selectEmployee();
    await screen.findByText('Contrato Alpha');
    const call = apiV2.apiGet.mock.calls.find(([url]) => url.includes('/api/assignments?employee_id'));
    expect(call[0]).toContain('status=planned,active,ended');
    expect(call[0]).toContain('date_from=');
    expect(call[0]).toContain('date_to=');
  });

  it('renders ended assignment with "Finalizada" badge', async () => {
    setupDefaultMocks([endedAssignment]);
    mount();
    await selectEmployee();
    expect(await screen.findByText('Proyecto Beta')).toBeInTheDocument();
    expect(screen.getByText('Finalizada')).toBeInTheDocument();
  });

  it('cells outside the ended assignment range are disabled', async () => {
    // FIXED_NOW = 2026-05-07 (week 05-04 to 05-10). endedAssignment ends 2026-05-02.
    // All cells in this week are after end_date → disabled.
    setupDefaultMocks([endedAssignment]);
    mount();
    await selectEmployee();
    await screen.findByText('Proyecto Beta');
    const cells = screen.getAllByRole('spinbutton', { name: /Horas Proyecto Beta/i });
    cells.forEach((cell) => expect(cell).toBeDisabled());
  });

  it('cells within the ended assignment range are enabled (up to today)', async () => {
    // 2026-04-30 is Thursday (Apr 28 = Tue, Apr 30 = Thu).
    // Week: Mon 04-27 to Sun 05-03. Assignment active 04-28 to 05-02.
    // Mon (idx 0, Apr 27): BEFORE start_date → outOfRange → disabled.
    // Tue(1), Wed(2), Thu(3=today): within range, not future → enabled.
    // Fri(4): within range but future → disabled.
    mockDateNow(new RealDate('2026-04-30T12:00:00').getTime());
    setupDefaultMocks([endedAssignment]);
    mount();
    await selectEmployee();
    await screen.findByText('Proyecto Beta');
    const cells = screen.getAllByRole('spinbutton', { name: /Horas Proyecto Beta/i });
    // Tue–Thu (idx 1-3): within range and not future.
    for (let i = 1; i <= 3; i += 1) {
      expect(cells[i]).not.toBeDisabled();
    }
  });

  it('ended assignment is excluded from quick-fill chips', async () => {
    setupDefaultMocks([endedAssignment]);
    mount();
    await selectEmployee();
    await screen.findByText('Proyecto Beta');
    expect(screen.queryByText(/Rellenar 8h/i)).not.toBeInTheDocument();
  });

  it('only active assignments appear in quick-fill when mixed', async () => {
    setupDefaultMocks([activeAssignment, endedAssignment]);
    mount();
    await selectEmployee();
    expect(await screen.findByText('Contrato Alpha')).toBeInTheDocument();
    expect(await screen.findByText('Proyecto Beta')).toBeInTheDocument();
    expect(screen.getByText('Finalizada')).toBeInTheDocument();
    expect(screen.getByText(/Rellenar 8h · Contrato Alpha/i)).toBeInTheDocument();
    expect(screen.queryByText(/Rellenar 8h · Proyecto Beta/i)).not.toBeInTheDocument();
  });
});
