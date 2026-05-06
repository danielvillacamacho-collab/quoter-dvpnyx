import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { CHART_DEFAULTS, colorByIndex } from './chartTheme';

const defaultFormatter = (v) => Number(v).toLocaleString();

export default function FunnelChart({
  data = [],
  height = 300,
  valueFormatter = defaultFormatter,
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={CHART_DEFAULTS.margin}
      >
        <XAxis
          type="number"
          tick={{ fontSize: CHART_DEFAULTS.fontSize, fontFamily: CHART_DEFAULTS.fontFamily }}
          hide
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fontSize: CHART_DEFAULTS.fontSize, fontFamily: CHART_DEFAULTS.fontFamily }}
        />
        <Tooltip formatter={(value) => valueFormatter(value)} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={entry.fill || colorByIndex(i)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
