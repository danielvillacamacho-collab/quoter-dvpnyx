import {
  REVENUE_TYPES, FUNDING_SOURCES, LOSS_REASONS, LOSS_REASON_DETAIL_MIN,
  computeBooking, validateRevenueModel, validateFunding, validateLossReason,
} from './booking';

describe('client/booking — SPEC-CRM-00 v1.1 PR2 (mirror server)', () => {
  describe('computeBooking', () => {
    it('one_time = one_time_amount_usd', () => {
      expect(computeBooking({ revenue_type: 'one_time', one_time_amount_usd: 12000 })).toBe(12000);
    });

    it('recurring = mrr × months', () => {
      expect(computeBooking({ revenue_type: 'recurring', mrr_usd: 5000, contract_length_months: 24 })).toBe(120000);
    });

    it('mixed = one_time + mrr × months', () => {
      expect(computeBooking({
        revenue_type: 'mixed', one_time_amount_usd: 20000, mrr_usd: 3000, contract_length_months: 12,
      })).toBe(56000);
    });

    it('strings numéricos se convierten (los inputs HTML llegan como strings)', () => {
      expect(computeBooking({
        revenue_type: 'recurring', mrr_usd: '5000', contract_length_months: '24',
      })).toBe(120000);
    });

    it('valores vacíos no crashean', () => {
      expect(computeBooking({ revenue_type: 'one_time', one_time_amount_usd: '' })).toBe(0);
      expect(computeBooking({ revenue_type: 'recurring', mrr_usd: '', contract_length_months: '' })).toBe(0);
    });
  });

  describe('validateRevenueModel', () => {
    it('valida one_time', () => {
      expect(validateRevenueModel({ revenue_type: 'one_time', one_time_amount_usd: 1000 })).toBeNull();
      expect(validateRevenueModel({ revenue_type: 'one_time' })).toMatch(/one-time es requerido/i);
    });

    it('valida recurring', () => {
      expect(validateRevenueModel({ revenue_type: 'recurring', mrr_usd: 5000, contract_length_months: 12 })).toBeNull();
      expect(validateRevenueModel({ revenue_type: 'recurring', mrr_usd: 5000 })).toMatch(/duración/i);
    });

    it('valida mixed exige los tres', () => {
      expect(validateRevenueModel({
        revenue_type: 'mixed', one_time_amount_usd: 1000, mrr_usd: 5000, contract_length_months: 12,
      })).toBeNull();
      expect(validateRevenueModel({ revenue_type: 'mixed', mrr_usd: 5000, contract_length_months: 12 })).toMatch(/one-time/i);
    });

    it('rechaza montos negativos', () => {
      expect(validateRevenueModel({ revenue_type: 'one_time', one_time_amount_usd: -10 })).toMatch(/negativo/i);
    });
  });

  describe('validateFunding', () => {
    it('client_direct no necesita monto', () => {
      expect(validateFunding({ funding_source: 'client_direct' })).toBeNull();
      expect(validateFunding({})).toBeNull(); // si no se especifica, asume client_direct
    });

    it('aws_mdf necesita monto', () => {
      expect(validateFunding({ funding_source: 'aws_mdf' })).toMatch(/monto/i);
      expect(validateFunding({ funding_source: 'aws_mdf', funding_amount_usd: 1000 })).toBeNull();
    });

    it('rechaza monto negativo', () => {
      expect(validateFunding({ funding_source: 'aws_mdf', funding_amount_usd: -1 })).toMatch(/negativo/i);
    });
  });

  describe('validateLossReason', () => {
    it(`exige detail >= ${LOSS_REASON_DETAIL_MIN} chars`, () => {
      expect(validateLossReason({ loss_reason: 'price', loss_reason_detail: 'corto' })).toMatch(/al menos/);
      expect(validateLossReason({ loss_reason: 'price', loss_reason_detail: 'x'.repeat(30) })).toBeNull();
    });

    it('rechaza razón inválida', () => {
      expect(validateLossReason({ loss_reason: 'made_up', loss_reason_detail: 'x'.repeat(40) })).toMatch(/válida/);
    });
  });

  it('los enums tienen labels human-readable en español (UX)', () => {
    REVENUE_TYPES.forEach((rt) => expect(rt.label).toBeTruthy());
    FUNDING_SOURCES.forEach((fs) => expect(fs.label).toBeTruthy());
    LOSS_REASONS.forEach((lr) => expect(lr.label).toBeTruthy());
  });
});
