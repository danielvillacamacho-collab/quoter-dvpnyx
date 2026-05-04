import React, { useMemo } from 'react';
import ReportsLayout from './ReportsLayout';
import KpiCard from './components/KpiCard';
import KpiGrid from './components/KpiGrid';
import ChartCard from './components/ChartCard';
import ComparisonChart from './charts/ComparisonChart';
import DistributionChart from './charts/DistributionChart';
import BreakdownChart from './charts/BreakdownChart';
import FunnelChart from './charts/FunnelChart';
import useReportData from './hooks/useReportData';
import { CHART_COLORS } from './charts/chartTheme';

/* ── pipeline stage definitions ────────────────────────────────────── */
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
  const n = Number(v);
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + n.toLocaleString('en-US');
};
const fmtPct = (v) => (v * 100).toFixed(0) + '%';

/* ── date helpers ──────────────────────────────────────────────────── */
const year = new Date().getFullYear();
const revenueFrom = `${year}01`;
const revenueTo = `${year}12`;

const today = new Date();
const twentyEightDaysAgo = new Date(today);
twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
const peopleTo = today.toISOString().slice(0, 10);
const peopleFrom = twentyEightDaysAgo.toISOString().slice(0, 10);

/* ── chart grid style ──────────────────────────────────────────────── */
const chartGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 16,
  marginTop: 20,
};

/* ═══════════════════════════════════════════════════════════════════════
   ExecutiveReports — high-level KPI + chart overview
   ═══════════════════════════════════════════════════════════════════════ */
export default function ExecutiveReports() {
  /* ── data fetching ─────────────────────────────────────────────────── */
  const { data: delivery, loading: loadingDelivery, error: errorDelivery } =
    useReportData('/api/reports/v2/delivery');

  const { data: people, loading: loadingPeople, error: errorPeople } =
    useReportData(`/api/reports/v2/people?from=${peopleFrom}&to=${peopleTo}`);

  const { data: oppsRaw, loading: loadingOpps, error: errorOpps } =
    useReportData('/api/opportunities?limit=500');

  const { data: revenue, loading: loadingRevenue, error: errorRevenue } =
    useReportData(`/api/revenue?from=${revenueFrom}&to=${revenueTo}`);

  /* ── derived KPIs ──────────────────────────────────────────────────── */
  const deliveryKpis = delivery?.kpis ?? {};
  const peopleKpis = people?.kpis ?? {};
  const utilizationByArea = delivery?.utilization_by_area ?? [];
  const utilizationDistribution = delivery?.utilization_distribution ?? [];

  const opps = useMemo(() => {
    const list = oppsRaw?.data ?? [];
    return list;
  }, [oppsRaw]);

  const activeOpps = useMemo(
    () => opps.filter((o) => !TERMINAL.includes(o.status)),
    [opps],
  );

  const pipelineCount = activeOpps.length;
  const pipelineValue = useMemo(
    () => activeOpps.reduce((sum, o) => sum + (Number(o.estimated_value_usd) || 0), 0),
    [activeOpps],
  );

  /* ── pipeline funnel data ──────────────────────────────────────────── */
  const funnelData = useMemo(() => {
    const counts = {};
    activeOpps.forEach((o) => {
      const s = o.status;
      if (counts[s] == null) counts[s] = 0;
      counts[s]++;
    });
    return PIPELINE_STAGES.map((stage, i) => ({
      name: stage.label,
      value: counts[stage.key] || 0,
      fill: CHART_COLORS.series[i % CHART_COLORS.series.length],
    }));
  }, [activeOpps]);

  /* ── deal type breakdown ───────────────────────────────────────────── */
  const dealTypeData = useMemo(() => {
    const counts = {};
    activeOpps.forEach((o) => {
      const t = o.deal_type || 'Sin tipo';
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [activeOpps]);

  /* ── revenue display values ────────────────────────────────────────── */
  const revenueReal = revenue?.global_total?.real_amount_display ?? null;
  const revenueProjected = revenue?.global_total?.projected_amount_display ?? null;

  /* ── loading / error aggregation ───────────────────────────────────── */
  const anyLoading = loadingDelivery || loadingPeople || loadingOpps || loadingRevenue;

  /* ── render ────────────────────────────────────────────────────────── */
  return (
    <ReportsLayout
      area="ejecutivo"
      title="Reporte Ejecutivo"
      subtitle="Vista global de la operación"
    >
      {/* ── KPI row ─────────────────────────────────────────────────── */}
      <KpiGrid columns="repeat(auto-fit, minmax(160px, 1fr))">
        <KpiCard
          label="Revenue real (YTD)"
          value={revenueReal != null ? fmtCurrency(revenueReal) : '—'}
          color={CHART_COLORS.success}
        />
        <KpiCard
          label="Revenue proyectado"
          value={revenueProjected != null ? fmtCurrency(revenueProjected) : '—'}
          color={CHART_COLORS.blue}
        />
        <KpiCard
          label="Pipeline activo"
          value={loadingOpps ? '—' : pipelineCount}
          subtitle={`${year}`}
          color={CHART_COLORS.primary}
        />
        <KpiCard
          label="Valor pipeline"
          value={loadingOpps ? '—' : fmtCurrency(pipelineValue)}
          color={CHART_COLORS.secondary}
        />
        <KpiCard
          label="Utilización"
          value={deliveryKpis.avg_utilization != null ? fmtPct(deliveryKpis.avg_utilization) : '—'}
          color={CHART_COLORS.primary}
        />
        <KpiCard
          label="Bench"
          value={deliveryKpis.bench_count ?? '—'}
          color={deliveryKpis.bench_count > 0 ? CHART_COLORS.danger : undefined}
        />
        <KpiCard
          label="Compliance"
          value={peopleKpis.avg_compliance != null ? fmtPct(peopleKpis.avg_compliance) : '—'}
          color={CHART_COLORS.warning}
        />
        <KpiCard
          label="Solicitudes abiertas"
          value={deliveryKpis.open_requests ?? '—'}
          subtitle={
            deliveryKpis.critical_requests != null
              ? `${deliveryKpis.critical_requests} críticas`
              : undefined
          }
        />
      </KpiGrid>

      {/* ── 2x2 chart grid ──────────────────────────────────────────── */}
      <div style={chartGridStyle}>
        <ChartCard
          title="Pipeline Funnel"
          subtitle="Oportunidades activas por etapa"
          loading={loadingOpps}
          error={errorOpps}
        >
          <FunnelChart
            data={funnelData}
            height={280}
            valueFormatter={(v) => `${v} opps`}
          />
        </ChartCard>

        <ChartCard
          title="Utilización por área"
          subtitle="Promedio de utilización"
          loading={loadingDelivery}
          error={errorDelivery}
        >
          <ComparisonChart
            layout="vertical"
            data={utilizationByArea}
            bars={[
              { dataKey: 'avg_utilization', name: 'Promedio', color: CHART_COLORS.primary },
            ]}
            xKey="name"
            height={280}
            valueFormatter={(v) => fmtPct(v)}
          />
        </ChartCard>

        <ChartCard
          title="Distribución de utilización"
          subtitle="Personas por rango"
          loading={loadingDelivery}
          error={errorDelivery}
        >
          <DistributionChart
            data={utilizationDistribution}
            height={280}
            color={CHART_COLORS.secondary}
            valueFormatter={(v) => `${v} personas`}
          />
        </ChartCard>

        <ChartCard
          title="Oportunidades por tipo"
          subtitle="Deal type breakdown"
          loading={loadingOpps}
          error={errorOpps}
        >
          <BreakdownChart
            data={dealTypeData}
            height={280}
            donut
            colors={CHART_COLORS.series}
          />
        </ChartCard>
      </div>
    </ReportsLayout>
  );
}
