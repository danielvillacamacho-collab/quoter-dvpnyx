import React from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { CHART_DEFAULTS, colorByIndex } from './chartTheme';

const defaultFormatter = (v) => Number(v).toLocaleString();

export default function TrendChart({
  data = [],
  lines = [],
  xKey = 'month',
  height = 280,
  area = false,
  valueFormatter = defaultFormatter,
}) {
  const axisTick = { fontSize: CHART_DEFAULTS.fontSize, fontFamily: CHART_DEFAULTS.fontFamily };
  const Chart = area ? AreaChart : LineChart;
  const Series = area ? Area : Line;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={CHART_DEFAULTS.margin}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tick={axisTick} />
        <YAxis tick={axisTick} />
        <Tooltip formatter={(value) => valueFormatter(value)} />
        <Legend wrapperStyle={{ fontSize: CHART_DEFAULTS.fontSize, fontFamily: CHART_DEFAULTS.fontFamily }} />
        {lines.map((line, i) => (
          <Series
            key={line.dataKey}
            type={line.type || 'monotone'}
            dataKey={line.dataKey}
            name={line.name || line.dataKey}
            stroke={line.color || colorByIndex(i)}
            fill={area ? (line.color || colorByIndex(i)) : undefined}
            fillOpacity={area ? 0.15 : undefined}
            strokeWidth={2}
            dot={!area}
          />
        ))}
      </Chart>
    </ResponsiveContainer>
  );
}
