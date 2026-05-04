import React, { useState, useEffect, useMemo } from 'react';
import { apiGet } from '../../utils/apiV2';
import ReportsLayout from './ReportsLayout';
import KpiCard from './components/KpiCard';
import KpiGrid from './components/KpiGrid';
import ChartCard from './components/ChartCard';
import ComparisonChart from './charts/ComparisonChart';
import DistributionChart from './charts/DistributionChart';
import BreakdownChart from './charts/BreakdownChart';
import ReportTable from './components/ReportTable';
import FilterBar from './components/FilterBar';
import ExportMenu from './components/ExportMenu';
import useReportData from './hooks/useReportData';
import useReportFilters from './hooks/useReportFilters';
import useExport from './hooks/useExport';
import { CHART_COLORS } from './charts/chartTheme';

/* ── formatting helpers ─────────────────────────────────────────────── */
const fmtPct = (v) => (v * 100).toFixed(0) + '%';
const fmtDays = (v) => Math.round(v) + 'd';
const fmtHrs = (v) => Number(v).toFixed(1) + 'h';

/* ── cell‑color helpers ─────────────────────────────────────────────── */
const utilColor = (row) =>
  row.utilization >= 0.8 ? '#10B981' : row.utilization < 0.3 ? '#EF4444' : null;
const covColor = (row) =>
  row.coverage_pct >= 0.8 ? '#10B981' : row.coverage_pct < 0.5 ? '#EF4444' : '#F59E0B';

/* ── tab bar styles (design‑system vars) ────────────────────────────── */
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

/* ── column definitions ─────────────────────────────────────────────── */
const utilColumns = [
  { key: 'first_name', label: 'Nombre', get: (r) => `${r.first_name} ${r.last_name}`, sortable: true },
  { key: 'area_name', label: 'Área', get: (r) => r.area_name || '—', sortable: true },
  { key: 'level', label: 'Nivel', get: (r) => r.level || '—', sortable: true },
  { key: 'country', label: 'País', get: (r) => r.country || '—', sortable: true },
  { key: 'status', label: 'Status', get: (r) => r.status, sortable: true },
  { key: 'weekly_capacity_hours', label: 'Cap. (h/sem)', get: (r) => fmtHrs(r.weekly_capacity_hours), align: 'right', sortable: true },
  { key: 'assigned_weekly_hours', label: 'Asignado (h)', get: (r) => fmtHrs(r.assigned_weekly_hours), align: 'right', sortable: true },
  { key: 'utilization', label: 'Utilización', get: (r) => fmtPct(r.utilization), align: 'right', sortable: true, color: utilColor },
];

const coverageColumns = [
  { key: 'name', label: 'Contrato', get: (r) => r.name, sortable: true },
  { key: 'client_name', label: 'Cliente', get: (r) => r.client_name, sortable: true },
  { key: 'type', label: 'Tipo', get: (r) => r.type || '—', sortable: true },
  { key: 'status', label: 'Status', get: (r) => r.status, sortable: true },
  { key: 'requested_weekly_hours', label: 'Solicitado (h)', get: (r) => fmtHrs(r.requested_weekly_hours), align: 'right', sortable: true },
  { key: 'assigned_weekly_hours', label: 'Asignado (h)', get: (r) => fmtHrs(r.assigned_weekly_hours), align: 'right', sortable: true },
  { key: 'coverage_pct', label: 'Cobertura', get: (r) => fmtPct(r.coverage_pct), align: 'right', sortable: true, color: covColor },
  { key: 'open_requests_count', label: 'Solicitudes', get: (r) => r.open_requests_count, align: 'right', sortable: true },
];

const requestColumns = [
  { key: 'role_title', label: 'Rol', get: (r) => r.role_title, sortable: true },
  { key: 'level', label: 'Nivel', get: (r) => r.level || '—', sortable: true },
  { key: 'country', label: 'País', get: (r) => r.country || '—', sortable: true },
  { key: 'quantity', label: 'Qty', get: (r) => r.quantity, align: 'right', sortable: true },
  { key: 'priority', label: 'Prioridad', get: (r) => r.priority, sortable: true },
  { key: 'status', label: 'Status', get: (r) => r.status, sortable: true },
  { key: 'contract_name', label: 'Contrato', get: (r) => r.contract_name || '—', sortable: true },
  { key: 'client_name', label: 'Cliente', get: (r) => r.client_name || '—', sortable: true },
  { key: 'active_assignments', label: 'Asignados', get: (r) => r.active_assignments, align: 'right', sortable: true },
  { key: 'age_days', label: 'Antigüedad', get: (r) => fmtDays(r.age_days), align: 'right', sortable: true },
];

/* ── generic sort helper ────────────────────────────────────────────── */
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

/* ═══════════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════════ */
export default function DeliveryReports() {
  /* ── filter state ──────────────────────────────────────────────────── */
  const { filters, setFilter, resetFilters, toQueryString } = useReportFilters({
    area_id: '',
  });

  /* ── area lookup for filter dropdown ───────────────────────────────── */
  const [areas, setAreas] = useState([]);
  useEffect(() => {
    let cancelled = false;
    apiGet('/api/areas?active=true')
      .then((res) => {
        if (!cancelled) setAreas(Array.isArray(res) ? res : res?.data ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const areaOptions = useMemo(
    () => areas.map((a) => ({ value: String(a.id), label: a.name })),
    [areas],
  );

  /* ── data fetching ─────────────────────────────────────────────────── */
  const qs = toQueryString();
  const { data: summary, loading: loadingSummary, error: errorSummary } =
    useReportData(`/api/reports/v2/delivery${qs}`, [qs]);
  const { data: utilRaw, loading: loadingUtil } =
    useReportData(`/api/reports/utilization${qs}`, [qs]);
  const { data: covRaw, loading: loadingCov } =
    useReportData('/api/reports/coverage', []);
  const { data: reqRaw, loading: loadingReq } =
    useReportData('/api/reports/pending-requests', []);

  const kpis = summary?.kpis ?? {};
  const utilizationByArea = summary?.utilization_by_area ?? [];
  const utilizationDistribution = summary?.utilization_distribution ?? [];
  const utilData = utilRaw?.data ?? [];
  const covData = covRaw?.data ?? [];
  const reqData = reqRaw?.data ?? [];

  /* ── tab state ─────────────────────────────────────────────────────── */
  const [tab, setTab] = useState('utilization');

  /* ── sort state (per tab) ──────────────────────────────────────────── */
  const [utilSort, setUtilSort] = useState({ field: 'utilization', dir: 'desc' });
  const [covSort, setCovSort] = useState({ field: 'coverage_pct', dir: 'asc' });
  const [reqSort, setReqSort] = useState({ field: 'age_days', dir: 'desc' });

  const toggleSort = (setter) => (field) =>
    setter((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));

  /* ── sorted data ───────────────────────────────────────────────────── */
  const sortedUtil = useMemo(() => sortRows(utilData, utilSort.field, utilSort.dir), [utilData, utilSort]);
  const sortedCov = useMemo(() => sortRows(covData, covSort.field, covSort.dir), [covData, covSort]);
  const sortedReq = useMemo(() => sortRows(reqData, reqSort.field, reqSort.dir), [reqData, reqSort]);

  /* ── chart helpers ─────────────────────────────────────────────────── */
  const covChartData = useMemo(
    () =>
      [...covData]
        .sort((a, b) => a.coverage_pct - b.coverage_pct)
        .map((c) => ({
          name: c.name,
          requested: c.requested_weekly_hours,
          assigned: c.assigned_weekly_hours,
        })),
    [covData],
  );

  const priorityBreakdown = useMemo(() => {
    const counts = {};
    reqData.forEach((r) => {
      const p = r.priority || 'Sin prioridad';
      counts[p] = (counts[p] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [reqData]);

  /* ── export ────────────────────────────────────────────────────────── */
  const { exportCSV } = useExport();

  const handleExport = () => {
    if (tab === 'utilization') {
      exportCSV('delivery-utilization.csv', sortedUtil, utilColumns);
    } else if (tab === 'coverage') {
      exportCSV('delivery-coverage.csv', sortedCov, coverageColumns);
    } else {
      exportCSV('delivery-requests.csv', sortedReq, requestColumns);
    }
  };

  /* ── render ────────────────────────────────────────────────────────── */
  return (
    <ReportsLayout
      area="delivery"
      title="Reportes de Delivery"
      subtitle="Utilización, cobertura y solicitudes"
    >
      {/* Filter bar */}
      <FilterBar
        filters={[
          {
            key: 'area_id',
            label: 'Área',
            type: 'select',
            value: filters.area_id,
            onChange: (v) => setFilter('area_id', v),
            options: areaOptions,
          },
        ]}
        onReset={resetFilters}
      />

      {/* KPI grid */}
      <KpiGrid>
        <KpiCard label="Empleados activos" value={kpis.active_employees ?? '—'} />
        <KpiCard
          label="Utilización promedio"
          value={kpis.avg_utilization != null ? fmtPct(kpis.avg_utilization) : '—'}
        />
        <KpiCard
          label="En bench"
          value={kpis.bench_count ?? '—'}
          color={kpis.bench_count > 0 ? CHART_COLORS.danger : undefined}
        />
        <KpiCard label="Contratos activos" value={kpis.active_contracts ?? '—'} />
        <KpiCard
          label="Cobertura promedio"
          value={kpis.avg_coverage != null ? fmtPct(kpis.avg_coverage) : '—'}
        />
        <KpiCard
          label="Solicitudes abiertas"
          value={kpis.open_requests ?? '—'}
          subtitle={kpis.critical_requests != null ? `${kpis.critical_requests} críticas` : undefined}
        />
      </KpiGrid>

      {/* Tab bar + export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 24 }}>
        <div style={tabBarStyle}>
          {[
            { key: 'utilization', label: 'Utilización' },
            { key: 'coverage', label: 'Cobertura' },
            { key: 'requests', label: 'Solicitudes' },
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

      {/* ── Tab: Utilización ─────────────────────────────────────────── */}
      {tab === 'utilization' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <ChartCard title="Distribución de utilización" loading={loadingSummary} error={errorSummary}>
              <DistributionChart
                data={utilizationDistribution}
                valueFormatter={(v) => `${v} personas`}
              />
            </ChartCard>
            <ChartCard title="Utilización por área" loading={loadingSummary} error={errorSummary}>
              <ComparisonChart
                layout="vertical"
                data={utilizationByArea}
                bars={[{ dataKey: 'avg_utilization', name: 'Promedio', color: CHART_COLORS.primary }]}
                xKey="name"
                valueFormatter={(v) => fmtPct(v)}
              />
            </ChartCard>
          </div>
          <ReportTable
            columns={utilColumns}
            data={sortedUtil}
            loading={loadingUtil}
            sort={utilSort}
            onSort={toggleSort(setUtilSort)}
            emptyMessage="No hay datos de utilización"
          />
        </>
      )}

      {/* ── Tab: Cobertura ───────────────────────────────────────────── */}
      {tab === 'coverage' && (
        <>
          <ChartCard title="Cobertura por contrato" loading={loadingCov} style={{ marginBottom: 20 }}>
            <ComparisonChart
              layout="vertical"
              data={covChartData}
              bars={[
                { dataKey: 'requested', name: 'Solicitado', color: CHART_COLORS.neutral },
                { dataKey: 'assigned', name: 'Asignado', color: CHART_COLORS.success },
              ]}
              xKey="name"
              valueFormatter={(v) => fmtHrs(v)}
            />
          </ChartCard>
          <ReportTable
            columns={coverageColumns}
            data={sortedCov}
            loading={loadingCov}
            sort={covSort}
            onSort={toggleSort(setCovSort)}
            emptyMessage="No hay datos de cobertura"
          />
        </>
      )}

      {/* ── Tab: Solicitudes ─────────────────────────────────────────── */}
      {tab === 'requests' && (
        <>
          <ChartCard title="Solicitudes por prioridad" loading={loadingReq} style={{ marginBottom: 20 }}>
            <BreakdownChart data={priorityBreakdown} />
          </ChartCard>
          <ReportTable
            columns={requestColumns}
            data={sortedReq}
            loading={loadingReq}
            sort={reqSort}
            onSort={toggleSort(setReqSort)}
            emptyMessage="No hay solicitudes pendientes"
          />
        </>
      )}
    </ReportsLayout>
  );
}
