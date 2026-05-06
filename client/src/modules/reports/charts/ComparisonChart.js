import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { CHART_DEFAULTS, colorByIndex } from './chartTheme';

const defaultFormatter = (v) => Number(v).toLocaleString();

export default function ComparisonChart({
  data = [],
  bars = [],
  xKey = 'name',
  height = 280,
  layout = 'horizontal',
  valueFormatter = defaultFormatter,
}) {
  const axisTick = { fontSize: CHART_DEFAULTS.fontSize, fontFamily: CHART_DEFAULTS.fontFamily };
  const isVertical = layout === 'vertical';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={CHART_DEFAULTS.margin}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type={isVertical ? 'number' : 'category'}
          dataKey={isVertical ? undefined : xKey}
          tick={axisTick}
        />
        <YAxis
          type={isVertical ? 'category' : 'number'}
          dataKey={isVertical ? xKey : undefined}
          tick={axisTick}
          width={isVertical ? 120 : undefined}
        />
        <Tooltip formatter={(value) => valueFormatter(value)} />
        <Legend wrapperStyle={{ fontSize: CHART_DEFAULTS.fontSize, fontFamily: CHART_DEFAULTS.fontFamily }} />
        {bars.map((bar, i) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name || bar.dataKey}
            fill={bar.color || colorByIndex(i)}
            stackId={bar.stackId}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
