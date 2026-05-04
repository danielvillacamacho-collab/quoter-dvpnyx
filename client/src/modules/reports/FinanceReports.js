import React, { useState, useMemo } from 'react';
import ReportsLayout from './ReportsLayout';
import KpiCard from './components/KpiCard';
import KpiGrid from './components/KpiGrid';
import ChartCard from './components/ChartCard';
import TrendChart from './charts/TrendChart';
import ComparisonChart from './charts/ComparisonChart';
import ReportTable from './components/ReportTable';
import FilterBar from './components/FilterBar';
import ExportMenu from './components/ExportMenu';
import useReportData from './hooks/useReportData';
import useExport from './hooks/useExport';
import { CHART_COLORS } from './charts/chartTheme';

/* ── formatting helpers ────────────────────────────────────────────── */
const fmtCurrency = (v) => {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'K';
  return '$' + Number(v).toLocaleString();
};
const fmtPct = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(0) + '%');

/* ── month-name helper ─────────────────────────────────────────────── */
const MONTH_NAMES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];
const monthLabel = (yyyymm) => {
  const y = yyyymm.slice(0, 4);
  const m = parseInt(yyyymm.slice(4), 10);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

/* ── gap color helper ──────────────────────────────────────────────── */
const gapColor = (row) => {
  const gap = (row._projected ?? 0) - (row._real ?? 0);
  if (gap <= 0) return '#10B981';
  if (gap < 10_000) return '#F59E0B';
  return '#EF4444';
};

/* ── tab bar styles (design-system vars) ───────────────────────────── */
const tabBarStyle = {
  display: 'flex',
  gap: 4,
  borderBottom: '2px solid var(--ds-border)',
  marginBottom: 20,
};
const tabBase = {
  padding: '8px 18px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  marginBottom: -2,
  color: 'var(--ds-text-soft)',
  transition: 'color .15s, border-color .15s',
};
const tabActive = {
  ...tabBase,
  color: 'var(--ds-accent)',
  borderBottomColor: 'var(--ds-accent)',
};

/* ── column definitions ────────────────────────────────────────────── */
const revenueColumns = [
  { key: 'contract', label: 'Contrato', get: (r) => r.contract, sortable: true },
  { key: 'client', label: 'Cliente', get: (r) => r.client, sortable: true },
  { key: 'type', label: 'Tipo', get: (r) => r.type || '—', sortable: true },
  { key: '_projected', label: 'Proyectado (USD)', get: (r) => fmtCurrency(r._projected), align: 'right', sortable: true },
  { key: '_real', label: 'Real (USD)', get: (r) => fmtCurrency(r._real), align: 'right', sortable: true },
  { key: '_gap', label: 'Gap', get: (r) => fmtCurrency(r._gap), align: 'right', sortable: true, color: gapColor },
];

const budgetColumns = [
  { key: 'period_year', label: 'Año', get: (r) => r.period_year, sortable: true },
  { key: 'period_quarter', label: 'Quarter', get: (r) => r.period_quarter || '—', sortable: true },
  { key: 'owner_name', label: 'Owner', get: (r) => r.owner_name || '—', sortable: true },
  { key: 'service_line', label: 'Línea de servicio', get: (r) => r.service_line || '—', sortable: true },
  { key: 'target_usd', label: 'Target (USD)', get: (r) => fmtCurrency(r.target_usd), align: 'right', sortable: true },
  { key: 'status', label: 'Status', get: (r) => r.status || '—', sortable: true },
];

/* ── generic sort helper ───────────────────────────────────────────── */
function sortRows(rows, field, dir) {
  if (!rows || !field) return rows || [];
  return [...rows].sort((a, b) => {
    let va = a[field];
    let vb = b[field];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

/* ── year options for filter ───────────────────────────────────────── */
const YEAR_OPTIONS = [
  { value: '2024', label: '2024' },
  { value: '2025', label: '2025' },
  { value: '2026', label: '2026' },
];

/* ═══════════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════════ */
export default function FinanceReports() {
  /* ── filter state ──────────────────────────────────────────────── */
  const currentYear = String(new Date().getFullYear());
  const [year, setYear] = useState(currentYear);

  const fromMonth = `${year}01`;
  const toMonth = `${year}12`;

  /* ── data fetching ─────────────────────────────────────────────── */
  const { data: revenueRaw, loading: loadingRev, error: errorRev } =
    useReportData(`/api/revenue?from=${fromMonth}&to=${toMonth}`, [year]);

  const { data: budgetSummary, loading: loadingBudSum } =
    useReportData(`/api/budgets/summary?period_year=${year}`, [year]);

  const { data: budgetsRaw, loading: loadingBud, error: errorBud } =
    useReportData(`/api/budgets?period_year=${year}&limit=100`, [year]);

  /* ── derived: revenue monthly chart data ───────────────────────── */
  const monthlyData = useMemo(() => {
    if (!revenueRaw?.months) return [];
    return revenueRaw.months.map((m) => {
      const totals = revenueRaw.col_totals?.[m] || {};
      return {
        name: monthLabel(m),
        real: Number(totals.real_usd) || 0,
        projected: Number(totals.projected_usd) || 0,
      };
    });
  }, [revenueRaw]);

  /* ── derived: revenue table rows ───────────────────────────────── */
  const revenueRows = useMemo(() => {
    if (!revenueRaw?.rows) return [];
    return revenueRaw.rows.map((r) => {
      const projected = Number(r.row_total?.projected_amount_display) || 0;
      const real = Number(r.row_total?.real_amount_display) || 0;
      return {
        contract: r.contract?.name || '—',
        client: r.contract?.client_name || '—',
        type: r.contract?.type || '—',
        _projected: projected,
        _real: real,
        _gap: projected - real,
      };
    });
  }, [revenueRaw]);

  /* ── derived: KPIs ─────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const realYTD = monthlyData.reduce((s, m) => s + m.real, 0);
    const projectedYTD = monthlyData.reduce((s, m) => s + m.projected, 0);
    const compliance = projectedYTD > 0 ? (realYTD / projectedYTD) * 100 : 0;

    const annualBudget = (budgetSummary?.targets || []).reduce(
      (s, t) => s + (Number(t.target_usd) || 0), 0,
    );

    return { realYTD, projectedYTD, compliance, annualBudget };
  }, [monthlyData, budgetSummary]);

  /* ── derived: budget rows ──────────────────────────────────────── */
  const budgetRows = useMemo(() => budgetsRaw?.data ?? [], [budgetsRaw]);

  /* ── derived: budget chart data (grouped by quarter/owner) ─────── */
  const budgetChartData = useMemo(() => {
    if (!budgetRows.length) return [];
    const groups = {};
    budgetRows.forEach((b) => {
      const key = b.period_quarter
        ? `Q${b.period_quarter}`
        : `${b.period_year}`;
      if (!groups[key]) groups[key] = { name: key, target: 0, actual: 0 };
      groups[key].target += Number(b.target_usd) || 0;
    });

    const actuals = budgetSummary?.actuals || [];
    actuals.forEach((a) => {
      const key = a.period_quarter ? `Q${a.period_quarter}` : `${a.period_year}`;
      if (groups[key]) groups[key].actual += Number(a.actual_usd) || 0;
    });

    return Object.values(groups).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [budgetRows, budgetSummary]);

  /* ── tab state ─────────────────────────────────────────────────── */
  const [tab, setTab] = useState('revenue');

  /* ── sort state (per tab) ──────────────────────────────────────── */
  const [revSort, setRevSort] = useState({ field: '_real', dir: 'desc' });
  const [budSort, setBudSort] = useState({ field: 'period_quarter', dir: 'asc' });

  const toggleSort = (setter) => (field) =>
    setter((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));

  /* ── sorted data ───────────────────────────────────────────────── */
  const sortedRevenue = useMemo(
    () => sortRows(revenueRows, revSort.field, revSort.dir),
    [revenueRows, revSort],
  );
  const sortedBudgets = useMemo(
    () => sortRows(budgetRows, budSort.field, budSort.dir),
    [budgetRows, budSort],
  );

  /* ── export ────────────────────────────────────────────────────── */
  const { exportCSV } = useExport();

  const handleExport = () => {
    if (tab === 'revenue') {
      exportCSV('finanzas-revenue.csv', sortedRevenue, revenueColumns);
    } else {
      exportCSV('finanzas-presupuestos.csv', sortedBudgets, budgetColumns);
    }
  };

  /* ── loading flag ──────────────────────────────────────────────── */
  const loading = loadingRev || loadingBudSum || loadingBud;

  /* ── trend chart line config ───────────────────────────────────── */
  const trendLines = [
    { dataKey: 'projected', name: 'Proyectado', color: CHART_COLORS.neutral, type: 'monotone' },
    { dataKey: 'real', name: 'Real', color: CHART_COLORS.primary, type: 'monotone' },
  ];

  /* ── budget comparison bars config ─────────────────────────────── */
  const budgetBars = [
    { dataKey: 'target', name: 'Target', color: CHART_COLORS.neutral },
    { dataKey: 'actual', name: 'Actual', color: CHART_COLORS.success },
  ];

  /* ── compliance KPI color ──────────────────────────────────────── */
  const complianceColor = kpis.compliance >= 90
    ? CHART_COLORS.success
    : kpis.compliance >= 70
      ? CHART_COLORS.warning
      : CHART_COLORS.danger;

  /* ── render ────────────────────────────────────────────────────── */
  return (
    <ReportsLayout
      area="finanzas"
      title="Reportes Financieros"
      subtitle="Revenue recognition y presupuestos"
    >
      {/* Filter bar */}
      <FilterBar
        filters={[
          {
            key: 'year',
            label: 'Año',
            type: 'select',
            value: year,
            onChange: setYear,
            options: YEAR_OPTIONS,
          },
        ]}
        onReset={() => setYear(currentYear)}
      />

      {/* KPI grid */}
      <KpiGrid>
        <KpiCard
          label="Revenue real (YTD)"
          value={loading ? '—' : fmtCurrency(kpis.realYTD)}
          color={CHART_COLORS.primary}
        />
        <KpiCard
          label="Revenue proyectado (YTD)"
          value={loading ? '—' : fmtCurrency(kpis.projectedYTD)}
          color={CHART_COLORS.neutral}
        />
        <KpiCard
          label="Cumplimiento"
          value={loading ? '—' : fmtPct(kpis.compliance)}
          color={complianceColor}
          trend={kpis.compliance >= 90 ? { direction: 'up', delta: fmtPct(kpis.compliance) } : undefined}
          invertTrend={kpis.compliance < 70}
        />
        <KpiCard
          label="Presupuesto anual"
          value={loading ? '—' : fmtCurrency(kpis.annualBudget)}
          color={CHART_COLORS.blue}
        />
      </KpiGrid>

      {/* Tab bar + export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 24 }}>
        <div style={tabBarStyle}>
          {[
            { key: 'revenue', label: 'Revenue' },
            { key: 'presupuestos', label: 'Presupuestos' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              style={tab === t.key ? tabActive : tabBase}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ExportMenu onExportCSV={handleExport} />
      </div>

      {/* ── Tab: Revenue ───────────────────────────────────────────── */}
      {tab === 'revenue' && (
        <>
          <ChartCard
            title="Revenue mensual — real vs proyectado"
            subtitle={`Año ${year}`}
            loading={loadingRev}
            error={errorRev}
          >
            <TrendChart
              data={monthlyData}
              lines={trendLines}
              xKey="name"
              height={320}
              valueFormatter={fmtCurrency}
            />
          </ChartCard>

          <div style={{ marginTop: 20 }}>
            <ReportTable
              columns={revenueColumns}
              data={sortedRevenue}
              loading={loadingRev}
              sort={revSort}
              onSort={toggleSort(setRevSort)}
              emptyMessage="No hay datos de revenue para este periodo"
            />
          </div>
        </>
      )}

      {/* ── Tab: Presupuestos ──────────────────────────────────────── */}
      {tab === 'presupuestos' && (
        <>
          <ChartCard
            title="Presupuesto por quarter"
            subtitle={`Target vs actual — ${year}`}
            loading={loadingBud}
            error={errorBud}
          >
            <ComparisonChart
              data={budgetChartData}
              bars={budgetBars}
              xKey="name"
              height={320}
              valueFormatter={fmtCurrency}
            />
          </ChartCard>

          <div style={{ marginTop: 20 }}>
            <ReportTable
              columns={budgetColumns}
              data={sortedBudgets}
              loading={loadingBud}
              sort={budSort}
              onSort={toggleSort(setBudSort)}
              emptyMessage="No hay presupuestos para este periodo"
            />
          </div>
        </>
      )}
    </ReportsLayout>
  );
}
