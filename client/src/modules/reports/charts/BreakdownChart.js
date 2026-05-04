import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CHART_COLORS, CHART_DEFAULTS } from './chartTheme';

export default function BreakdownChart({
  data = [],
  height = 280,
  donut = true,
  colors = CHART_COLORS.series,
}) {
  const outerRadius = Math.min(height * 0.38, 120);
  const innerRadius = donut ? outerRadius * 0.6 : 0;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={2}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend
          wrapperStyle={{ fontSize: CHART_DEFAULTS.fontSize, fontFamily: CHART_DEFAULTS.fontFamily }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
