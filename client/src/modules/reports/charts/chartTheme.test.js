import { CHART_COLORS, CHART_DEFAULTS, colorByIndex } from './chartTheme';

describe('chartTheme', () => {
  describe('CHART_COLORS', () => {
    it('has required named colors', () => {
      expect(CHART_COLORS.primary).toBeDefined();
      expect(CHART_COLORS.secondary).toBeDefined();
      expect(CHART_COLORS.success).toBeDefined();
      expect(CHART_COLORS.warning).toBeDefined();
      expect(CHART_COLORS.danger).toBeDefined();
      expect(CHART_COLORS.neutral).toBeDefined();
    });

    it('has a series array with at least 5 colors', () => {
      expect(Array.isArray(CHART_COLORS.series)).toBe(true);
      expect(CHART_COLORS.series.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('CHART_DEFAULTS', () => {
    it('has margin config', () => {
      expect(CHART_DEFAULTS.margin).toEqual({ top: 5, right: 20, bottom: 5, left: 0 });
    });

    it('has fontSize', () => {
      expect(CHART_DEFAULTS.fontSize).toBe(11);
    });

    it('has fontFamily', () => {
      expect(CHART_DEFAULTS.fontFamily).toContain('Inter');
    });
  });

  describe('colorByIndex', () => {
    it('returns first color for index 0', () => {
      expect(colorByIndex(0)).toBe(CHART_COLORS.series[0]);
    });

    it('returns second color for index 1', () => {
      expect(colorByIndex(1)).toBe(CHART_COLORS.series[1]);
    });

    it('wraps around when index exceeds series length', () => {
      const len = CHART_COLORS.series.length;
      expect(colorByIndex(len)).toBe(CHART_COLORS.series[0]);
      expect(colorByIndex(len + 1)).toBe(CHART_COLORS.series[1]);
    });

    it('works for large indices', () => {
      expect(colorByIndex(100)).toBe(CHART_COLORS.series[100 % CHART_COLORS.series.length]);
    });
  });
});
