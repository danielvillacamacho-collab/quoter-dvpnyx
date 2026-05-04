export const CHART_COLORS = {
  primary: '#7C3AED',
  secondary: '#00D8D4',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  neutral: '#9CA3AF',
  blue: '#3B82F6',
  purple: '#A855F7',
  series: [
    '#7C3AED',
    '#00D8D4',
    '#3B82F6',
    '#F59E0B',
    '#10B981',
    '#EF4444',
    '#A855F7',
    '#EC4899',
    '#6366F1',
  ],
};

export const CHART_DEFAULTS = {
  margin: { top: 5, right: 20, bottom: 5, left: 0 },
  fontSize: 11,
  fontFamily: "'Inter', sans-serif",
};

export const colorByIndex = (i) => CHART_COLORS.series[i % CHART_COLORS.series.length];
