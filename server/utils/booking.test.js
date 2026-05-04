/**
 * Tests for server/utils/booking.js — SPEC-CRM-00 v1.1 PR2.
 *
 * Estos tests reflejan la fórmula que también vive en el trigger DB
 * `opp_pipeline_recalc()` y en el mirror cliente. Si los actualizas
 * acá actualízalos en los tres puntos.
 */

const {
  REVENUE_TYPES, FUNDING_SOURCES, LOSS_REASONS, LOSS_REASON_DETAIL_MIN,
  computeBooking, validateRevenueModel, validateFunding, validateLossReason,
} = require('./booking');

describe('booking — SPEC-CRM-00 v1.1 PR2', () => {
  describe('computeBooking', () => {
    it('one_time: booking = one_time_amount_usd', () => {
      expect(computeBooking({ revenue_type: 'one_time', one_time_amount_usd: 12000 })).toBe(12000);
    });

    it('recurring: booking = mrr × months', () => {
      expect(computeBooking({ revenue_type: 'recurring', mrr_usd: 5000, contract_length_months: 24 })).toBe(120000);
    });

    it('mixed: booking = one_time + mrr × months', () => {
      expect(computeBooking({
        revenue_type: 'mixed', one_time_amount_usd: 20000, mrr_usd: 5000, contract_length_months: 24,
      })).toBe(140000);
    });

    it('redondea a centavos (2 decimales) para evitar drift float', () => {
      // 0.1 + 0.2 = 0.30000000000000004 en float; el redondeo lo deja en 0.3
      expect(computeBooking({ revenue_type: 'recurring', mrr_usd: 0.1, contract_length_months: 3 })).toBe(0.3);
    });

    it('valores nulos o no numéricos se tratan como 0 (no crashea)', () => {
      expect(computeBooking({ revenue_type: 'recurring', mrr_usd: null, contract_length_months: 12 })).toBe(0);
      expect(computeBooking({ revenue_type: 'mixed' })).toBe(0);
      expect(computeBooking({})).toBe(0);
    });

    it('revenue_type desconocido cae a one_time (defensa, no debería pasar por validación)', () => {
      expect(computeBooking({ revenue_type: 'foo', one_time_amount_usd: 100 })).toBe(100);
    });
  });

  describe('validateRevenueModel', () => {
    it('rechaza revenue_type inválido', () => {
      expect(validateRevenueModel({ revenue_type: 'foo' })).toMatch(/revenue_type/);
    });

    it('one_time requiere one_time_amount_usd', () => {
      expect(validateRevenueModel({ revenue_type: 'one_time' })).toMatch(/one_time_amount_usd/);
      expect(validateRevenueModel({ revenue_type: 'one_time', one_time_amount_usd: 5000 })).toBeNull();
    });

    it('recurring requiere mrr_usd y contract_length_months', () => {
      expect(validateRevenueModel({ revenue_type: 'recurring' })).toMatch(/mrr_usd/);
      expect(validateRevenueModel({ revenue_type: 'recurring', mrr_usd: 5000 })).toMatch(/contract_length_months/);
      expect(validateRevenueModel({ revenue_type: 'recurring', mrr_usd: 5000, contract_length_months: 12 })).toBeNull();
    });

    it('mixed requiere los tres campos', () => {
      expect(validateRevenueModel({ revenue_type: 'mixed', mrr_usd: 5000, contract_length_months: 12 })).toMatch(/one_time_amount_usd/);
      expect(validateRevenueModel({
        revenue_type: 'mixed', one_time_amount_usd: 1000, mrr_usd: 5000, contract_length_months: 12,
      })).toBeNull();
    });

    it('rechaza montos negativos', () => {
      expect(validateRevenueModel({ revenue_type: 'one_time', one_time_amount_usd: -1 })).toMatch(/negativo/);
      expect(validateRevenueModel({ revenue_type: 'recurring', mrr_usd: -1, contract_length_months: 12 })).toMatch(/mrr_usd/);
      expect(validateRevenueModel({ revenue_type: 'recurring', mrr_usd: 1000, contract_length_months: -1 })).toMatch(/contract_length/);
    });
  });

  describe('validateFunding', () => {
    it('client_direct no requiere monto', () => {
      expect(validateFunding({ funding_source: 'client_direct' })).toBeNull();
    });

    it('aws_mdf / vendor_mdf / mixed requieren funding_amount_usd', () => {
      expect(validateFunding({ funding_source: 'aws_mdf' })).toMatch(/funding_amount_usd/);
      expect(validateFunding({ funding_source: 'aws_mdf', funding_amount_usd: 25000 })).toBeNull();
      expect(validateFunding({ funding_source: 'vendor_mdf', funding_amount_usd: 10000 })).toBeNull();
      expect(validateFunding({ funding_source: 'mixed', funding_amount_usd: 5000 })).toBeNull();
    });

    it('rechaza funding_source desconocido', () => {
      expect(validateFunding({ funding_source: 'foo' })).toMatch(/funding_source/);
    });

    it('rechaza monto negativo', () => {
      expect(validateFunding({ funding_source: 'aws_mdf', funding_amount_usd: -10 })).toMatch(/negativo/);
    });
  });

  describe('validateLossReason', () => {
    it('rechaza razón fuera del enum', () => {
      expect(validateLossReason({ loss_reason: 'foo', loss_reason_detail: 'x'.repeat(40) })).toMatch(/loss_reason/);
    });

    it(`exige detail con al menos ${LOSS_REASON_DETAIL_MIN} chars`, () => {
      expect(validateLossReason({ loss_reason: 'price', loss_reason_detail: 'corto' })).toMatch(/30 caracteres/);
      expect(validateLossReason({ loss_reason: 'price', loss_reason_detail: 'a'.repeat(LOSS_REASON_DETAIL_MIN) })).toBeNull();
    });

    it('cubre los 9 valores del enum del spec', () => {
      expect(LOSS_REASONS).toEqual([
        'price','competitor_won','no_decision','budget_cut','champion_left',
        'wrong_fit','timing','incumbent_win','other',
      ]);
    });
  });

  it('exporta los enums esperados (sanity check para tabla de la UI)', () => {
    expect(REVENUE_TYPES).toEqual(['one_time', 'recurring', 'mixed']);
    expect(FUNDING_SOURCES).toEqual(['client_direct', 'aws_mdf', 'vendor_mdf', 'mixed']);
  });
});
