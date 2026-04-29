import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Novelties from './Novelties';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

const mount = () => render(<MemoryRouter><Novelties /></MemoryRouter>);

beforeEach(() => {
  jest.resetAllMocks();
  apiV2.apiGet.mockImplementation((url) => {
    if (url.includes('_meta/types')) {
      return Promise.resolve({ data: [
        { id: 'vacation', label_es: 'Vacaciones', is_paid_time: true, requires_attachment_recommended: false, counts_in_capacity: false },
        { id: 'sick_leave', label_es: 'Incapacidad médica', is_paid_time: true, requires_attachment_recommended: true, counts_in_capacity: false },
      ] });
    }
    return Promise.resolve({ data: [
      { id: 'n1', employee_id: 'e1', first_name: 'Diego', last_name: 'M', country: 'Colombia',
        novelty_type_id: 'vacation', novelty_type_label: 'Vacaciones',
        start_date: '2026-06-15', end_date: '2026-06-26', status: 'approved',
        approved_by_name: 'Andrés', approved_at: '2026-05-12T10:00:00Z' },
    ] });
  });
});

describe('Novelties', () => {
  it('renderiza header', async () => {
    mount();
    expect(await screen.findByText(/Novedades/i)).toBeInTheDocument();
  });

  it('lista novedades del API', async () => {
    mount();
    expect(await screen.findByText(/Vacaciones/)).toBeInTheDocument();
    expect(screen.getByText(/Diego M/)).toBeInTheDocument();
  });

  it('llama apiGet de _meta/types al montar', async () => {
    mount();
    await waitFor(() => {
      const urls = apiV2.apiGet.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u.includes('_meta/types'))).toBe(true);
    });
  });
});
