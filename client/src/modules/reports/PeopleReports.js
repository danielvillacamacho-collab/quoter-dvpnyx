import React, { useState, useMemo } from 'react';
import ReportsLayout from './ReportsLayout';
import KpiCard from './components/KpiCard';
import KpiGrid from './components/KpiGrid';
import ChartCard from './components/ChartCard';
import ComparisonChart from './charts/ComparisonChart';
import DistributionChart from './charts/DistributionChart';
import BreakdownChart from './charts/BreakdownChart';
import FunnelChart from './charts/FunnelChart';
import ReportTable from './components/ReportTable';
import FilterBar from './components/FilterBar';
import ExportMenu from './components/ExportMenu';
import useReportData from './hooks/useReportData';
import useExport from './hooks/useExport';
import { CHART_COLORS } from './charts/chartTheme';

/* ── formatting helpers ─────────────────────────────────────────────── */
const fmtPct = (v) => (v * 100).toFixed(0) + '%';
const fmtHrs = (v) => Number(v).toFixed(1) + 'h';

/* ── cell-color helpers ─────────────────────────────────────────────── */
const complianceColor = (row) =>
  row.compliance_pct >= 0.8 ? '#10B981' : row.compliance_pct < 0.5 ? '#EF4444' : '#F59E0B';
const benchUtilColor = () => '#EF4444';

/* ── tab bar styles (design-system vars) ────────────────────────────── */
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
const complianceColumns = [
  { key: 'first_name', label: 'Nombre', get: (r) => `${r.first_name} ${r.last_name}`, sortable: true },
  { key: 'area_name', label: 'Área', get: (r) => r.area_name || '—', sortable: true },
  { key: 'level', label: 'Nivel', get: (r) => r.level || '—', sortable: true },
  { key: 'weekly_capacity_hours', label: 'Capacidad (h)', get: (r) => fmtHrs(r.weekly_capacity_hours), align: 'right', sortable: true },
  { key: 'total_logged_hours', label: 'Registradas (h)', get: (r) => fmtHrs(r.total_logged_hours), align: 'right', sortable: true },
  { key: 'expected_hours', label: 'Esperadas (h)', get: (r) => fmtHrs(r.expected_hours), align: 'right', sortable: true },
  { key: 'compliance_pct', label: 'Compliance', get: (r) => fmtPct(r.compliance_pct), align: 'right', sortable: true, color: complianceColor },
];

const hiringColumns = [
  { key: 'area_name', label: 'Área', get: (r) => r.area_name || '—', sortable: true },
  { key: 'level', label: 'Nivel', get: (r) => r.level || '—', sortable: true },
  { key: 'country', label: 'País', get: (r) => r.country || '—', sortable: true },
  { key: 'open_slots', label: 'Posiciones', get: (r) => r.open_slots, align: 'right', sortable: true },
  { key: 'requests_count', label: 'Solicitudes', get: (r) => r.requests_count, align: 'right', sortable: true },
  { key: 'priorities', label: 'Prioridades', get: (r) => (r.priorities || []).join(', ') || '—', sortable: false },
];

const benchColumns = [
  { key: 'first_name', label: 'Nombre', get: (r) => `${r.first_name} ${r.last_name}`, sortable: true },
  { key: 'area_name', label: 'Área', get: (r) => r.area_name || '—', sortable: true },
  { key: 'level', label: 'Nivel', get: (r) => r.level || '—', sortable: true },
  { key: 'country', label: 'País', get: (r) => r.country || '—', sortable: true },
  { key: 'status', label: 'Status', get: (r) => r.status || '—', sortable: true },
  { key: 'weekly_capacity_hours', label: 'Capacidad (h)', get: (r) => fmtHrs(r.weekly_capacity_hours), align: 'right', sortable: true },
  { key: 'assigned_weekly_hours', label: 'Asignado (h)', get: (r) => fmtHrs(r.assigned_weekly_hours), align: 'right', sortable: true },
  { key: 'utilization', label: 'Utilización', get: (r) => fmtPct(r.utilization), align: 'right', sortable: true, color: benchUtilColor },
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

/* ── date helpers ───────────────────────────────────────────────────── */
const toISO = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };

/* ═══════════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════════ */
export default function PeopleReports() {
  /* ── date filter state ────────────────────────────────────────────── */
  const [from, setFrom] = useState(() => daysAgo(28));
  const [to, setTo] = useState(() => toISO(new Date()));

  const resetDates = () => { setFrom(daysAgo(28)); setTo(toISO(new Date())); };

  /* ── data fetching ─────────────────────────────────────────────────── */
  const { data: compRaw, loading: loadingComp, error: errorComp } =
    useReportData(`/api/reports/time-compliance?from=${from}&to=${to}`);
  const { data: hiringRaw, loading: loadingHiring } =
    useReportData('/api/reports/hiring-needs');
  const { data: benchRaw, loading: loadingBench } =
    useReportData('/api/reports/bench?threshold=0.30');

  const compData = compRaw?.data ?? [];
  const hiringData = hiringRaw?.data ?? [];
  const benchData = benchRaw?.data ?? [];

  /* ── KPI computed values ───────────────────────────────────────────── */
  const avgCompliance = useMemo(() => {
    if (!compData.length) return null;
    const sum = compData.reduce((acc, r) => acc + (r.compliance_pct || 0), 0);
    return sum / compData.length;
  }, [compData]);

  const lowComplianceCount = useMemo(
    () => compData.filter((r) => r.compliance_pct < 0.8).length,
    [compData],
  );

  const openSlots = useMemo(
    () => hiringData.reduce((acc, r) => acc + (r.open_slots || 0), 0),
    [hiringData],
  );

  /* ── tab state ─────────────────────────────────────────────────────── */
  const [tab, setTab] = useState('compliance');

  /* ── sort state (per tab) ──────────────────────────────────────────── */
  const [compSort, setCompSort] = useState({ field: 'compliance_pct', dir: 'asc' });
  const [hiringSort, setHiringSort] = useState({ field: 'open_slots', dir: 'desc' });
  const [benchSort, setBenchSort] = useState({ field: 'utilization', dir: 'asc' });

  const toggleSort = (setter) => (field) =>
    setter((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));

  /* ── sorted data ───────────────────────────────────────────────────── */
  const sortedComp = useMemo(() => sortRows(compData, compSort.field, compSort.dir), [compData, compSort]);
  const sortedHiring = useMemo(() => sortRows(hiringData, hiringSort.field, hiringSort.dir), [hiringData, hiringSort]);
  const sortedBench = useMemo(() => sortRows(benchData, benchSort.field, benchSort.dir), [benchData, benchSort]);

  /* ── chart data: compliance distribution ───────────────────────────── */
  const compDistribution = useMemo(() => {
    const bins = [
      { name: '0-25%', min: 0, max: 0.25, value: 0 },
      { name: '25-50%', min: 0.25, max: 0.50, value: 0 },
      { name: '50-75%', min: 0.50, max: 0.75, value: 0 },
      { name: '75-100%', min: 0.75, max: 1.00, value: 0 },
      { name: '>100%', min: 1.00, max: Infinity, value: 0 },
    ];
    compData.forEach((r) => {
      const pct = r.compliance_pct || 0;
      const bin = bins.find((b) => pct >= b.min && pct < b.max) || bins[bins.length - 1];
      bin.value += 1;
    });
    return bins.map(({ name, value }) => ({ name, value }));
  }, [compData]);

  /* ── chart data: compliance by area ────────────────────────────────── */
  const compByArea = useMemo(() => {
    const groups = {};
    compData.forEach((r) => {
      const area = r.area_name || 'Sin área';
      if (!groups[area]) groups[area] = { sum: 0, count: 0 };
      groups[area].sum += r.compliance_pct || 0;
      groups[area].count += 1;
    });
    return Object.entries(groups)
      .map(([name, g]) => ({ name, avg_compliance: g.sum / g.count }))
      .sort((a, b) => a.avg_compliance - b.avg_compliance);
  }, [compData]);

  /* ── chart data: hiring needs funnel ───────────────────────────────── */
  const hiringByArea = useMemo(() => {
    const groups = {};
    hiringData.forEach((r) => {
      const area = r.area_name || 'Sin área';
      groups[area] = (groups[area] || 0) + (r.open_slots || 0);
    });
    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [hiringData]);

  /* ── chart data: bench by area ─────────────────────────────────────── */
  const benchByArea = useMemo(() => {
    const groups = {};
    benchData.forEach((r) => {
      const area = r.area_name || 'Sin área';
      groups[area] = (groups[area] || 0) + 1;
    });
    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [benchData]);

  /* ── export ────────────────────────────────────────────────────────── */
  const { exportCSV } = useExport();

  const handleExport = () => {
    if (tab === 'compliance') {
      exportCSV('gente-compliance.csv', sortedComp, complianceColumns);
    } else if (tab === 'necesidades') {
      exportCSV('gente-hiring-needs.csv', sortedHiring, hiringColumns);
    } else {
      exportCSV('gente-bench.csv', sortedBench, benchColumns);
    }
  };

  /* ── render ────────────────────────────────────────────────────────── */
  return (
    <ReportsLayout
      area="gente"
      title="Reportes de Gente"
      subtitle="Time compliance, hiring needs y capacidad"
    >
      {/* Filter bar — date range */}
      <FilterBar
        filters={[
          { key: 'from', label: 'Desde', type: 'date', value: from, onChange: setFrom },
          { key: 'to', label: 'Hasta', type: 'date', value: to, onChange: setTo },
        ]}
        onReset={resetDates}
      />

      {/* KPI grid */}
      <KpiGrid>
        <KpiCard
          label="Compliance promedio"
          value={avgCompliance != null ? fmtPct(avgCompliance) : '—'}
        />
        <KpiCard
          label="Bajo compliance (<80%)"
          value={loadingComp ? '—' : lowComplianceCount}
          color={lowComplianceCount > 0 ? CHART_COLORS.danger : undefined}
        />
        <KpiCard
          label="Posiciones abiertas"
          value={loadingHiring ? '—' : openSlots}
        />
        <KpiCard
          label="En bench"
          value={loadingBench ? '—' : benchData.length}
          color={benchData.length > 0 ? CHART_COLORS.danger : undefined}
        />
      </KpiGrid>

      {/* Tab bar + export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 24 }}>
        <div style={tabBarStyle}>
          {[
            { key: 'compliance', label: 'Compliance' },
            { key: 'necesidades', label: 'Necesidades' },
            { key: 'bench', label: 'Bench' },
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

      {/* ── Tab: Compliance ─────────────────────────────────────────── */}
      {tab === 'compliance' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <ChartCard title="Distribución de compliance" loading={loadingComp} error={errorComp}>
              <DistributionChart
                data={compDistribution}
                valueFormatter={(v) => `${v} personas`}
              />
            </ChartCard>
            <ChartCard title="Compliance por área" loading={loadingComp} error={errorComp}>
              <ComparisonChart
                layout="vertical"
                data={compByArea}
                bars={[{ dataKey: 'avg_compliance', name: 'Compliance promedio', color: CHART_COLORS.primary }]}
                xKey="name"
                valueFormatter={(v) => fmtPct(v)}
              />
            </ChartCard>
          </div>
          <ReportTable
            columns={complianceColumns}
            data={sortedComp}
            loading={loadingComp}
            sort={compSort}
            onSort={toggleSort(setCompSort)}
            emptyMessage="No hay datos de compliance"
          />
        </>
      )}

      {/* ── Tab: Necesidades ────────────────────────────────────────── */}
      {tab === 'necesidades' && (
        <>
          <ChartCard title="Necesidades por área" loading={loadingHiring} style={{ marginBottom: 20 }}>
            <FunnelChart
              data={hiringByArea}
              valueFormatter={(v) => `${v} posiciones`}
            />
          </ChartCard>
          <ReportTable
            columns={hiringColumns}
            data={sortedHiring}
            loading={loadingHiring}
            sort={hiringSort}
            onSort={toggleSort(setHiringSort)}
            emptyMessage="No hay necesidades de contratación"
          />
        </>
      )}

      {/* ── Tab: Bench ──────────────────────────────────────────────── */}
      {tab === 'bench' && (
        <>
          <ChartCard title="Bench por área" loading={loadingBench} style={{ marginBottom: 20 }}>
            <BreakdownChart data={benchByArea} />
          </ChartCard>
          <ReportTable
            columns={benchColumns}
            data={sortedBench}
            loading={loadingBench}
            sort={benchSort}
            onSort={toggleSort(setBenchSort)}
            emptyMessage="No hay personas en bench"
          />
        </>
      )}
    </ReportsLayout>
  );
}
