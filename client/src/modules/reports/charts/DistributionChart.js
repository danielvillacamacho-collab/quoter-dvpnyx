import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { CHART_COLORS, CHART_DEFAULTS } from './chartTheme';

const defaultFormatter = (v) => Number(v).toLocaleString();

export default function DistributionChart({
  data = [],
  height = 280,
  color = CHART_COLORS.primary,
  valueFormatter = defaultFormatter,
}) {
  const axisTick = { fontSize: CHART_DEFAULTS.fontSize, fontFamily: CHART_DEFAULTS.fontFamily };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={CHART_DEFAULTS.margin}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={axisTick} />
        <YAxis tick={axisTick} />
        <Tooltip formatter={(value) => valueFormatter(value)} />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
