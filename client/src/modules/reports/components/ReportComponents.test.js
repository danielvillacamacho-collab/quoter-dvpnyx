import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EmptyState from './EmptyState';
import KpiGrid from './KpiGrid';
import LoadingState from './LoadingState';
import KpiCard from './KpiCard';
import ChartCard from './ChartCard';
import ReportTable from './ReportTable';
import FilterBar from './FilterBar';

/* ===== EmptyState ===== */
describe('EmptyState', () => {
  it('renders default message', () => {
    render(<EmptyState />);
    expect(screen.getByText('No hay datos para mostrar')).toBeInTheDocument();
  });

  it('renders custom message', () => {
    render(<EmptyState message="Sin resultados" />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<EmptyState icon="📊" />);
    expect(screen.getByText('📊')).toBeInTheDocument();
  });

  it('renders without icon div when not provided', () => {
    const { container } = render(<EmptyState />);
    // The wrapper div has text content only, no nested icon div
    const wrapper = container.firstChild;
    expect(wrapper.children).toHaveLength(0); // no child elements, just text
  });
});

/* ===== KpiGrid ===== */
describe('KpiGrid', () => {
  it('renders children in a grid container', () => {
    render(
      <KpiGrid>
        <div>Card 1</div>
        <div>Card 2</div>
      </KpiGrid>,
    );
    expect(screen.getByText('Card 1')).toBeInTheDocument();
    expect(screen.getByText('Card 2')).toBeInTheDocument();
  });

  it('applies default grid template columns', () => {
    const { container } = render(<KpiGrid><div>A</div></KpiGrid>);
    const grid = container.firstChild;
    expect(grid.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(180px, 1fr))');
  });

  it('accepts custom columns prop', () => {
    const { container } = render(<KpiGrid columns="1fr 1fr"><div>A</div></KpiGrid>);
    const grid = container.firstChild;
    expect(grid.style.gridTemplateColumns).toBe('1fr 1fr');
  });
});

/* ===== LoadingState ===== */
describe('LoadingState', () => {
  it('renders default message', () => {
    render(<LoadingState />);
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
  });

  it('renders custom message', () => {
    render(<LoadingState message="Procesando datos..." />);
    expect(screen.getByText('Procesando datos...')).toBeInTheDocument();
  });
});

/* ===== KpiCard ===== */
describe('KpiCard', () => {
  it('renders label and value', () => {
    render(<KpiCard label="Total Revenue" value="$50,000" />);
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('$50,000')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<KpiCard label="Revenue" value="$50k" subtitle="YTD" />);
    expect(screen.getByText('YTD')).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    render(<KpiCard label="Revenue" value="$50k" />);
    // subtitle is not rendered; only label + value visible
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('$50k')).toBeInTheDocument();
  });

  it('renders up trend with green color', () => {
    const { container } = render(<KpiCard label="Revenue" value="$50k" trend={{ direction: 'up', delta: '+10%' }} />);
    const trendEl = container.querySelector('[style*="inline-flex"]');
    expect(trendEl).toBeInTheDocument();
    expect(trendEl.textContent).toContain('▲');
    expect(trendEl.textContent).toContain('+10%');
    expect(trendEl.style.color).toBe('rgb(16, 185, 129)'); // #10B981
  });

  it('renders down trend with red color', () => {
    const { container } = render(<KpiCard label="Revenue" value="$50k" trend={{ direction: 'down', delta: '-5%' }} />);
    const trendEl = container.querySelector('[style*="inline-flex"]');
    expect(trendEl.textContent).toContain('▼');
    expect(trendEl.style.color).toBe('rgb(239, 68, 68)'); // #EF4444
  });

  it('renders inverted trend (up=bad, down=good)', () => {
    const { container } = render(<KpiCard label="Churn" value="15%" trend={{ direction: 'up', delta: '+3%' }} invertTrend />);
    const trendEl = container.querySelector('[style*="inline-flex"]');
    expect(trendEl.textContent).toContain('▲');
    expect(trendEl.style.color).toBe('rgb(239, 68, 68)'); // #EF4444 — up is bad when inverted
  });

  it('renders inverted trend down=good', () => {
    const { container } = render(<KpiCard label="Churn" value="5%" trend={{ direction: 'down', delta: '-2%' }} invertTrend />);
    const trendEl = container.querySelector('[style*="inline-flex"]');
    expect(trendEl.textContent).toContain('▼');
    expect(trendEl.style.color).toBe('rgb(16, 185, 129)'); // #10B981 — down is good when inverted
  });

  it('applies custom color to value', () => {
    const { container } = render(<KpiCard label="Revenue" value="$50k" color="red" />);
    const valueDiv = container.querySelector('div > div:nth-child(2)');
    expect(valueDiv.style.color).toBe('red');
  });

  it('does not render trend section when no trend prop', () => {
    const { container } = render(<KpiCard label="Revenue" value="$50k" />);
    expect(container.querySelector('[style*="inline-flex"]')).toBeNull();
  });
});

/* ===== ChartCard ===== */
describe('ChartCard', () => {
  it('renders title', () => {
    render(<ChartCard title="Revenue Chart">Chart content</ChartCard>);
    expect(screen.getByText('Revenue Chart')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<ChartCard title="Revenue" subtitle="Last 12 months">Content</ChartCard>);
    expect(screen.getByText('Last 12 months')).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    render(<ChartCard title="Revenue">Content</ChartCard>);
    expect(screen.queryByText('Last 12 months')).toBeNull();
  });

  it('renders children content when not loading and no error', () => {
    render(<ChartCard title="T">Visible chart</ChartCard>);
    expect(screen.getByText('Visible chart')).toBeInTheDocument();
  });

  it('shows loading state instead of children', () => {
    render(<ChartCard title="T" loading>Should not show</ChartCard>);
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
    expect(screen.queryByText('Should not show')).toBeNull();
  });

  it('shows error state instead of children', () => {
    render(<ChartCard title="T" error="Algo falló">Should not show</ChartCard>);
    expect(screen.getByText('Algo falló')).toBeInTheDocument();
    expect(screen.queryByText('Should not show')).toBeNull();
  });
});

/* ===== ReportTable ===== */
describe('ReportTable', () => {
  const cols = [
    { key: 'name', label: 'Nombre', get: (r) => r.name },
    { key: 'amount', label: 'Monto', get: (r) => r.amount, align: 'right' },
  ];

  it('renders column headers', () => {
    render(<ReportTable columns={cols} data={[]} />);
    expect(screen.getByText('Nombre')).toBeInTheDocument();
    expect(screen.getByText('Monto')).toBeInTheDocument();
  });

  it('renders data rows', () => {
    const data = [
      { id: 1, name: 'Acme', amount: '$1,000' },
      { id: 2, name: 'Beta', amount: '$2,000' },
    ];
    render(<ReportTable columns={cols} data={data} />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('$2,000')).toBeInTheDocument();
  });

  it('shows empty message when data is empty', () => {
    render(<ReportTable columns={cols} data={[]} />);
    expect(screen.getByText('Sin datos')).toBeInTheDocument();
  });

  it('shows custom empty message', () => {
    render(<ReportTable columns={cols} data={[]} emptyMessage="Nada" />);
    expect(screen.getByText('Nada')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<ReportTable columns={cols} data={[]} loading />);
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
  });

  it('renders sortable headers when sort + onSort provided', () => {
    const sort = { field: 'name', dir: 'asc' };
    const onSort = jest.fn();
    const sortCols = [
      { key: 'name', label: 'Nombre', get: (r) => r.name, sortable: true },
      { key: 'amount', label: 'Monto', get: (r) => r.amount },
    ];
    render(<ReportTable columns={sortCols} data={[]} sort={sort} onSort={onSort} />);
    const sortableTh = screen.getByRole('button', { name: /Ordenar por Nombre/ });
    expect(sortableTh).toBeInTheDocument();
    fireEvent.click(sortableTh);
    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('handles keyboard sort via Enter/Space on sortable header', () => {
    const sort = { field: 'amount', dir: 'desc' };
    const onSort = jest.fn();
    const sortCols = [
      { key: 'name', label: 'Nombre', get: (r) => r.name, sortable: true },
    ];
    render(<ReportTable columns={sortCols} data={[]} sort={sort} onSort={onSort} />);
    const th = screen.getByRole('button', { name: /Ordenar por Nombre/ });
    fireEvent.keyDown(th, { key: 'Enter' });
    expect(onSort).toHaveBeenCalledWith('name');
    fireEvent.keyDown(th, { key: ' ' });
    expect(onSort).toHaveBeenCalledTimes(2);
  });

  it('shows sort arrow on active column', () => {
    const sort = { field: 'name', dir: 'asc' };
    const sortCols = [{ key: 'name', label: 'Nombre', get: (r) => r.name, sortable: true }];
    render(<ReportTable columns={sortCols} data={[]} sort={sort} onSort={() => {}} />);
    expect(screen.getByText('▲')).toBeInTheDocument();
  });

  it('shows desc arrow when sort dir is desc', () => {
    const sort = { field: 'name', dir: 'desc' };
    const sortCols = [{ key: 'name', label: 'Nombre', get: (r) => r.name, sortable: true }];
    render(<ReportTable columns={sortCols} data={[]} sort={sort} onSort={() => {}} />);
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('applies cell color when column has color function', () => {
    const colorCols = [
      { key: 'name', label: 'N', get: (r) => r.name, color: (r) => (r.name === 'Bad' ? 'red' : 'green') },
    ];
    const data = [{ id: 1, name: 'Bad' }];
    render(<ReportTable columns={colorCols} data={data} />);
    const td = screen.getByText('Bad').closest('td');
    expect(td.style.color).toBe('red');
  });

  it('handles null data (shows empty message)', () => {
    render(<ReportTable columns={cols} data={null} />);
    expect(screen.getByText('Sin datos')).toBeInTheDocument();
  });
});

/* ===== FilterBar ===== */
describe('FilterBar', () => {
  it('renders select filter controls', () => {
    const filters = [
      { key: 'type', label: 'Tipo', type: 'select', value: '', onChange: jest.fn(), options: [{ value: 'a', label: 'Opción A' }] },
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.getByLabelText('Tipo')).toBeInTheDocument();
  });

  it('renders date filter controls', () => {
    const filters = [
      { key: 'from', label: 'Desde', type: 'date', value: '', onChange: jest.fn() },
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
  });

  it('renders month filter controls', () => {
    const filters = [
      { key: 'from', label: 'Mes', type: 'month', value: '', onChange: jest.fn() },
    ];
    render(<FilterBar filters={filters} />);
    const input = screen.getByLabelText('Mes');
    expect(input.type).toBe('month');
  });

  it('shows reset button when at least one filter has value', () => {
    const onReset = jest.fn();
    const filters = [
      { key: 'type', label: 'Tipo', type: 'select', value: 'a', onChange: jest.fn(), options: [] },
    ];
    render(<FilterBar filters={filters} onReset={onReset} />);
    const btn = screen.getByText('Limpiar filtros');
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('hides reset button when no filter has value', () => {
    const filters = [
      { key: 'type', label: 'Tipo', type: 'select', value: '', onChange: jest.fn(), options: [] },
    ];
    render(<FilterBar filters={filters} onReset={jest.fn()} />);
    expect(screen.queryByText('Limpiar filtros')).toBeNull();
  });

  it('hides reset button when onReset is not provided', () => {
    const filters = [
      { key: 'type', label: 'Tipo', type: 'select', value: 'a', onChange: jest.fn(), options: [] },
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.queryByText('Limpiar filtros')).toBeNull();
  });

  it('calls onChange when date input changes', () => {
    const onChange = jest.fn();
    const filters = [{ key: 'from', label: 'Desde', type: 'date', value: '', onChange }];
    render(<FilterBar filters={filters} />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-01-01');
  });
});
