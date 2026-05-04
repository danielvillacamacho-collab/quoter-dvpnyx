import React, { useState, useMemo } from 'react';
import ReportsLayout from './ReportsLayout';
import KpiCard from './components/KpiCard';
import KpiGrid from './components/KpiGrid';
import ChartCard from './components/ChartCard';
import FunnelChart from './charts/FunnelChart';
import BreakdownChart from './charts/BreakdownChart';
import ReportTable from './components/ReportTable';
import ExportMenu from './components/ExportMenu';
import useReportData from './hooks/useReportData';
import useExport from './hooks/useExport';
import { CHART_COLORS } from './charts/chartTheme';

/* ── pipeline constants ────────────────────────────────────────────── */
const PIPELINE_STAGES = [
  { key: 'prospecting', label: 'Prospecting' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal_sent', label: 'Proposal Sent' },
  { key: 'proposal_validated', label: 'Proposal Validated' },
  { key: 'negotiation', label: 'Negotiation' },
];
const TERMINAL = ['won', 'lost', 'postponed'];

/* ── formatting helpers ────────────────────────────────────────────── */
const fmtCurrency = (v) => {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'K';
  return '$' + Number(v).toLocaleString();
};
const fmtPct = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(0) + '%');
const fmtDate = (v) => v || '—';

/* ── cell‑color helpers ────────────────────────────────────────────── */
const marginColor = (row) => {
  const m = row.margin_pct;
  if (m == null) return undefined;
  if (m >= 30) return '#10B981';
  if (m >= 15) return '#F59E0B';
  return '#EF4444';
};
const actStatusColor = (row) => {
  const s = row.status;
  if (s === 'completed') return '#10B981';
  if (s === 'overdue') return '#EF4444';
  if (s === 'pending') return '#F59E0B';
  return undefined;
};

/* ── tab bar styles (design‑system vars) ───────────────────────────── */
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
const pipelineColumns = [
  { key: 'name', label: 'Oportunidad', get: (r) => r.name, sortable: true },
  { key: 'client_name', label: 'Cliente', get: (r) => r.client_name || '—', sortable: true },
  { key: 'status', label: 'Status', get: (r) => r.status, sortable: true },
  { key: 'deal_type', label: 'Tipo', get: (r) => r.deal_type || '—', sortable: true },
  { key: 'estimated_value_usd', label: 'Valor (USD)', get: (r) => fmtCurrency(r.estimated_value_usd), align: 'right', sortable: true },
  { key: 'margin_pct', label: 'Margen', get: (r) => fmtPct(r.margin_pct), align: 'right', sortable: true, color: marginColor },
  { key: 'expected_close_date', label: 'Cierre esperado', get: (r) => fmtDate(r.expected_close_date), sortable: true },
  { key: 'owner_name', label: 'Owner', get: (r) => r.owner_name || '—', sortable: true },
];

const activityColumns = [
  { key: 'type', label: 'Tipo', get: (r) => r.type, sortable: true },
  { key: 'status', label: 'Status', get: (r) => r.status, sortable: true, color: actStatusColor },
  { key: 'opportunity_name', label: 'Oportunidad', get: (r) => r.opportunity_name || '—', sortable: true },
  { key: 'contact_name', label: 'Contacto', get: (r) => r.contact_name || '—', sortable: true },
  { key: 'assigned_to_name', label: 'Asignado a', get: (r) => r.assigned_to_name || '—', sortable: true },
  { key: 'due_date', label: 'Fecha límite', get: (r) => fmtDate(r.due_date), sortable: true },
  { key: 'created_at', label: 'Creado', get: (r) => fmtDate(r.created_at), sortable: true },
];

const clientColumns = [
  { key: 'name', label: 'Cliente', get: (r) => r.name, sortable: true },
  { key: 'industry', label: 'Industria', get: (r) => r.industry || '—', sortable: true },
  { key: 'country', label: 'País', get: (r) => r.country || '—', sortable: true },
  { key: 'status', label: 'Status', get: (r) => r.status, sortable: true },
  { key: 'created_at', label: 'Creado', get: (r) => fmtDate(r.created_at), sortable: true },
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

/* ═══════════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════════ */
export default function ComercialReports() {
  /* ── data fetching ──────────────────────────────────────────────── */
  const { data: oppsRaw, loading: loadingOpps } =
    useReportData('/api/opportunities?limit=500');
  const { data: actsRaw, loading: loadingActs } =
    useReportData('/api/activities?limit=500');
  const { data: cliRaw, loading: loadingCli } =
    useReportData('/api/clients?limit=500');

  const opps = oppsRaw?.data ?? [];
  const acts = actsRaw?.data ?? [];
  const clients = cliRaw?.data ?? [];

  /* ── derived data ───────────────────────────────────────────────── */
  const activeOpps = useMemo(
    () => opps.filter((o) => !TERMINAL.includes(o.status)),
    [opps],
  );

  const kpis = useMemo(() => {
    const activeCount = activeOpps.length;
    const pipelineValue = activeOpps.reduce(
      (sum, o) => sum + (Number(o.estimated_value_usd) || 0), 0,
    );
    const avgMargin = activeCount > 0
      ? activeOpps.reduce((s, o) => s + (Number(o.margin_pct) || 0), 0) / activeCount
      : 0;
    const wonCount = opps.filter((o) => o.status === 'won').length;
    const lostCount = opps.filter((o) => o.status === 'lost').length;
    const closeRate = wonCount + lostCount > 0
      ? (wonCount / (wonCount + lostCount)) * 100
      : 0;
    const pendingActs = acts.filter((a) => a.status !== 'completed').length;
    const activeClients = clients.filter((c) => c.status === 'active').length;

    return { activeCount, pipelineValue, avgMargin, closeRate, pendingActs, activeClients };
  }, [activeOpps, opps, acts, clients]);

  /* ── funnel chart data ──────────────────────────────────────────── */
  const funnelData = useMemo(() => {
    const counts = {};
    activeOpps.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return PIPELINE_STAGES.map((s) => ({ name: s.label, value: counts[s.key] || 0 }));
  }, [activeOpps]);

  /* ── deal type breakdown ────────────────────────────────────────── */
  const dealTypeData = useMemo(() => {
    const counts = {};
    activeOpps.forEach((o) => {
      const t = o.deal_type || 'Sin tipo';
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [activeOpps]);

  /* ── activity type breakdown ────────────────────────────────────── */
  const actTypeData = useMemo(() => {
    const counts = {};
    acts.forEach((a) => {
      const t = a.type || 'Sin tipo';
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [acts]);

  /* ── client industry breakdown ──────────────────────────────────── */
  const industryData = useMemo(() => {
    const counts = {};
    clients.forEach((c) => {
      const ind = c.industry || 'Sin industria';
      counts[ind] = (counts[ind] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [clients]);

  /* ── client country top 10 ──────────────────────────────────────── */
  const countryData = useMemo(() => {
    const counts = {};
    clients.forEach((c) => {
      const co = c.country || 'Sin país';
      counts[co] = (counts[co] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [clients]);

  /* ── tab state ──────────────────────────────────────────────────── */
  const [tab, setTab] = useState('pipeline');

  /* ── sort state (per tab) ───────────────────────────────────────── */
  const [pipeSort, setPipeSort] = useState({ field: 'estimated_value_usd', dir: 'desc' });
  const [actSort, setActSort] = useState({ field: 'due_date', dir: 'asc' });
  const [cliSort, setCliSort] = useState({ field: 'name', dir: 'asc' });

  const toggleSort = (setter) => (field) =>
    setter((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));

  /* ── sorted data ────────────────────────────────────────────────── */
  const sortedPipe = useMemo(
    () => sortRows(activeOpps, pipeSort.field, pipeSort.dir),
    [activeOpps, pipeSort],
  );
  const pendingActs = useMemo(
    () => acts.filter((a) => a.status !== 'completed'),
    [acts],
  );
  const sortedActs = useMemo(
    () => sortRows(pendingActs, actSort.field, actSort.dir),
    [pendingActs, actSort],
  );
  const activeClients = useMemo(
    () => clients.filter((c) => c.status === 'active'),
    [clients],
  );
  const sortedCli = useMemo(
    () => sortRows(activeClients, cliSort.field, cliSort.dir),
    [activeClients, cliSort],
  );

  /* ── export ─────────────────────────────────────────────────────── */
  const { exportCSV } = useExport();

  const handleExport = () => {
    if (tab === 'pipeline') {
      exportCSV('comercial-pipeline.csv', sortedPipe, pipelineColumns);
    } else if (tab === 'actividades') {
      exportCSV('comercial-actividades.csv', sortedActs, activityColumns);
    } else {
      exportCSV('comercial-clientes.csv', sortedCli, clientColumns);
    }
  };

  /* ── loading flag ───────────────────────────────────────────────── */
  const loading = loadingOpps || loadingActs || loadingCli;

  /* ── render ─────────────────────────────────────────────────────── */
  return (
    <ReportsLayout
      area="comercial"
      title="Reportes Comerciales"
      subtitle="Pipeline, actividades y cartera de clientes"
    >
      {/* KPI grid */}
      <KpiGrid>
        <KpiCard label="Oportunidades activas" value={loading ? '—' : kpis.activeCount} />
        <KpiCard
          label="Valor pipeline"
          value={loading ? '—' : fmtCurrency(kpis.pipelineValue)}
          color={CHART_COLORS.primary}
        />
        <KpiCard
          label="Margen promedio"
          value={loading ? '—' : fmtPct(kpis.avgMargin)}
          color={kpis.avgMargin >= 30 ? CHART_COLORS.success : kpis.avgMargin >= 15 ? CHART_COLORS.warning : CHART_COLORS.danger}
        />
        <KpiCard
          label="Tasa de cierre"
          value={loading ? '—' : fmtPct(kpis.closeRate)}
          color={CHART_COLORS.success}
        />
        <KpiCard
          label="Actividades pendientes"
          value={loading ? '—' : kpis.pendingActs}
          color={kpis.pendingActs > 0 ? CHART_COLORS.warning : undefined}
        />
        <KpiCard label="Clientes activos" value={loading ? '—' : kpis.activeClients} />
      </KpiGrid>

      {/* Tab bar + export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 24 }}>
        <div style={tabBarStyle}>
          {[
            { key: 'pipeline', label: 'Pipeline' },
            { key: 'actividades', label: 'Actividades' },
            { key: 'clientes', label: 'Clientes' },
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

      {/* ── Tab: Pipeline ──────────────────────────────────────────── */}
      {tab === 'pipeline' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <ChartCard title="Funnel de Pipeline" loading={loadingOpps}>
              <FunnelChart data={funnelData} />
            </ChartCard>
            <ChartCard title="Por tipo de deal" loading={loadingOpps}>
              <BreakdownChart data={dealTypeData} colors={CHART_COLORS.series} />
            </ChartCard>
          </div>
          <ReportTable
            columns={pipelineColumns}
            data={sortedPipe}
            loading={loadingOpps}
            sort={pipeSort}
            onSort={toggleSort(setPipeSort)}
            emptyMessage="No hay oportunidades activas"
          />
        </>
      )}

      {/* ── Tab: Actividades ───────────────────────────────────────── */}
      {tab === 'actividades' && (
        <>
          <ChartCard title="Actividades por tipo" loading={loadingActs} style={{ marginBottom: 20 }}>
            <BreakdownChart data={actTypeData} donut colors={CHART_COLORS.series} />
          </ChartCard>
          <ReportTable
            columns={activityColumns}
            data={sortedActs}
            loading={loadingActs}
            sort={actSort}
            onSort={toggleSort(setActSort)}
            emptyMessage="No hay actividades pendientes"
          />
        </>
      )}

      {/* ── Tab: Clientes ──────────────────────────────────────────── */}
      {tab === 'clientes' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <ChartCard title="Clientes por industria" loading={loadingCli}>
              <BreakdownChart data={industryData} colors={CHART_COLORS.series} />
            </ChartCard>
            <ChartCard title="Clientes por país" loading={loadingCli}>
              <FunnelChart data={countryData} />
            </ChartCard>
          </div>
          <ReportTable
            columns={clientColumns}
            data={sortedCli}
            loading={loadingCli}
            sort={cliSort}
            onSort={toggleSort(setCliSort)}
            emptyMessage="No hay clientes activos"
          />
        </>
      )}
    </ReportsLayout>
  );
}
