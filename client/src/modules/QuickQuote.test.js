import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuickQuote from './QuickQuote';
import { AuthProvider } from '../AuthContext';
import * as api from '../utils/api';
import * as apiV2 from '../utils/apiV2';
import { changeSelect } from '../utils/testHelpers';

jest.mock('../utils/api');
jest.mock('../utils/apiV2');

const mockUser = {
  id: 'u1', name: 'Daniel', email: 'd@dvpnyx.com', role: 'admin',
  must_change_password: false, preferences: {},
};

const mockParams = {
  level: [], geo: [], bilingual: [], stack: [], modality: [], project: [],
  tools: [
    { id: 1, key: 'Básico',  value: 50,  label: 'Básico',  sort_order: 1 },
    { id: 2, key: 'Premium', value: 150, label: 'Premium', sort_order: 2 },
  ],
  margin: [
    { id: 10, key: 'talent', value: 0.35, label: 'Margen talento', sort_order: 1 },
    { id: 11, key: 'tools',  value: 0.20, label: 'Margen herramientas', sort_order: 2 },
  ],
};

const mockClients = {
  data: [
    { id: 'c1', name: 'Cliente Uno' },
    { id: 'c2', name: 'Cliente Dos' },
  ],
};

async function mountQuickQuote() {
  localStorage.setItem('dvpnyx_token', 'tok');
  api.getMe.mockResolvedValue(mockUser);
  api.getParams.mockResolvedValue(mockParams);
  apiV2.apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/clients')) return Promise.resolve(mockClients);
    return Promise.resolve(null);
  });
  let utils;
  await act(async () => {
    utils = render(
      <MemoryRouter>
        <AuthProvider>
          <QuickQuote />
        </AuthProvider>
      </MemoryRouter>,
    );
  });
  await waitFor(() => expect(screen.getByLabelText('Salario base')).toBeInTheDocument());
  return utils;
}

describe('QuickQuote', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.resetAllMocks();
  });

  it('renders title, inputs and the saved-list empty state', async () => {
    await mountQuickQuote();
    expect(screen.getByRole('heading', { level: 1, name: /Cotización Rápida/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Salario base')).toBeInTheDocument();
    expect(screen.getByLabelText(/Margen sobre salario/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Margen sobre herramientas/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tipo de herramientas')).toBeInTheDocument();
    expect(screen.getByText(/Aún no has guardado/i)).toBeInTheDocument();
  });

  it('seeds margin defaults from parameters (talent=35%, tools=20%)', async () => {
    await mountQuickQuote();
    expect(screen.getByLabelText(/Margen sobre salario/)).toHaveValue(35);
    expect(screen.getByLabelText(/Margen sobre herramientas/)).toHaveValue(20);
  });

  it('computes price = costo_empresa/(1-mP) + costo_herramientas/(1-mH)', async () => {
    await mountQuickQuote();
    // salary 1000, mP 0.35, mH 0.20, tools=Básico (value 50)
    fireEvent.change(screen.getByLabelText('Salario base'), { target: { value: '1000' } });
    // costo_empresa = 1000 * 1.5 = 1500
    // person price = 1500 / (1 - 0.35) = 2307.6923...
    // tools price = 50 / (1 - 0.20) = 62.5
    // total = 2370.19... → fmt USD without decimals: $2,370
    await waitFor(() => {
      const price = screen.getByText(/\$2,370/);
      expect(price).toBeInTheDocument();
    });
    expect(screen.getByText('$1,500')).toBeInTheDocument(); // costo empresa
  });

  it('Save button is disabled until cliente + perfil + salario are present', async () => {
    await mountQuickQuote();
    const saveBtn = screen.getByRole('button', { name: /^Guardar$/ });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Salario base'), { target: { value: '1000' } });
    expect(saveBtn).toBeDisabled(); // still missing client + profile

    await changeSelect('Cliente', 'c1');
    expect(saveBtn).toBeDisabled(); // still missing profile name

    fireEvent.change(screen.getByLabelText('Nombre del perfil *'), { target: { value: 'Dev Senior' } });
    expect(saveBtn).not.toBeDisabled();
  });

  it('persists saved quotes to localStorage and renders them in the table', async () => {
    await mountQuickQuote();
    fireEvent.change(screen.getByLabelText('Salario base'), { target: { value: '2000' } });
    await changeSelect('Cliente', 'c1');
    fireEvent.change(screen.getByLabelText('Nombre del perfil *'), { target: { value: 'Dev Senior' } });

    fireEvent.click(screen.getByRole('button', { name: /^Guardar$/ }));

    await waitFor(() => expect(screen.getByText(/Cotización rápida guardada/i)).toBeInTheDocument());

    expect(screen.getByText('Cliente Uno')).toBeInTheDocument();
    expect(screen.getByText('Dev Senior')).toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem('dvpnyx_quick_quotes_v1'));
    expect(stored).toHaveLength(1);
    expect(stored[0].client_name).toBe('Cliente Uno');
    expect(stored[0].profile_name).toBe('Dev Senior');
    expect(stored[0].salary).toBe(2000);
    // 2000*1.5/(1-0.35) + 50/(1-0.20) = 4615.384... + 62.5 = 4677.884...
    expect(stored[0].price).toBeCloseTo(4677.88, 1);
  });

  it('formats salary with thousand separators while typing (es-CO)', async () => {
    await mountQuickQuote();
    const input = screen.getByLabelText('Salario base');
    fireEvent.change(input, { target: { value: '5000000' } });
    expect(input).toHaveValue('5.000.000');

    // Pegar valor con separadores los strippea y reformatea.
    fireEvent.change(input, { target: { value: '12,345,678' } });
    expect(input).toHaveValue('12.345.678');
  });

  it('converts tools cost to salary currency using monthly USD rate', async () => {
    // mountQuickQuote setea su propio mock de apiGet, así que el mock
    // específico para exchange-rates va DESPUÉS del mount.
    await mountQuickQuote();

    const yyyymm = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/clients')) return Promise.resolve(mockClients);
      if (url.startsWith('/api/admin/exchange-rates')) {
        return Promise.resolve({
          months: [yyyymm],
          currencies: ['COP'],
          cells: { [`COP|${yyyymm}`]: { usd_rate: 4000 } },
        });
      }
      return Promise.resolve(null);
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'COP' } });
    });
    fireEvent.change(screen.getByLabelText('Salario base'), { target: { value: '5000000' } });

    // Costo herramientas en COP: 50 * 4000 = 200,000.
    // Intl puede usar espacio normal o no-breaking ( ) entre símbolo y monto.
    await waitFor(() => {
      const all = screen.getAllByText((content) => /COP/.test(content) && /200[.,]000/.test(content));
      expect(all.length).toBeGreaterThan(0);
    });
  });

  it('blocks save when no exchange rate is available for non-USD currency', async () => {
    await mountQuickQuote();

    apiV2.apiGet.mockImplementation((url) => {
      if (url.startsWith('/api/clients')) return Promise.resolve(mockClients);
      if (url.startsWith('/api/admin/exchange-rates')) {
        return Promise.resolve({ months: [], currencies: [], cells: {} });
      }
      return Promise.resolve(null);
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'COP' } });
    });
    fireEvent.change(screen.getByLabelText('Salario base'), { target: { value: '1000000' } });
    await changeSelect('Cliente', 'c1');
    fireEvent.change(screen.getByLabelText('Nombre del perfil *'), { target: { value: 'Dev' } });

    await waitFor(() => {
      expect(screen.getByText(/No hay tasa USD/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^Guardar$/ })).toBeDisabled();
  });
});
