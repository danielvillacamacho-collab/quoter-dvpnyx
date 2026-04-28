import { STAGES, STAGE_BY_ID, probabilityFor, isTerminal, computeTransitionWarnings } from './pipeline';

describe('pipeline utils', () => {
  it('STAGES has 7 stages in stable order', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'open', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'cancelled',
    ]);
  });

  it('probability is consistent with hardcoded trigger in migrate.js', () => {
    expect(probabilityFor('open')).toBe(5);
    expect(probabilityFor('qualified')).toBe(20);
    expect(probabilityFor('proposal')).toBe(50);
    expect(probabilityFor('negotiation')).toBe(75);
    expect(probabilityFor('won')).toBe(100);
    expect(probabilityFor('lost')).toBe(0);
    expect(probabilityFor('cancelled')).toBe(0);
  });

  it('isTerminal flags won/lost/cancelled', () => {
    expect(isTerminal('open')).toBe(false);
    expect(isTerminal('won')).toBe(true);
    expect(isTerminal('lost')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('STAGE_BY_ID has every stage indexed', () => {
    expect(Object.keys(STAGE_BY_ID).length).toBe(7);
    expect(STAGE_BY_ID.qualified.label).toBe('Calificada');
  });

  describe('computeTransitionWarnings', () => {
    it('returns no warnings for natural forward move with valid amount', () => {
      const w = computeTransitionWarnings({
        fromStage: 'qualified',
        toStage: 'proposal',
        opportunity: { booking_amount_usd: 50000, expected_close_date: '2099-01-01' },
      });
      expect(w).toHaveLength(0);
    });

    it('warns on amount=0 entering proposal/negotiation/won', () => {
      const w = computeTransitionWarnings({
        fromStage: 'qualified', toStage: 'proposal',
        opportunity: { booking_amount_usd: 0 },
      });
      expect(w.some((x) => x.code === 'amount_zero')).toBe(true);
    });

    it('warns on backwards move between non-terminals', () => {
      const w = computeTransitionWarnings({
        fromStage: 'negotiation', toStage: 'qualified',
        opportunity: { booking_amount_usd: 50000 },
      });
      expect(w.some((x) => x.code === 'backwards')).toBe(true);
    });

    it('does NOT warn backwards when going to terminal (loss after negotiation is normal)', () => {
      const w = computeTransitionWarnings({
        fromStage: 'negotiation', toStage: 'lost',
        opportunity: { booking_amount_usd: 50000 },
      });
      expect(w.some((x) => x.code === 'backwards')).toBe(false);
    });

    it('warns on past close_date when staying open', () => {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const w = computeTransitionWarnings({
        fromStage: 'qualified', toStage: 'proposal',
        opportunity: { booking_amount_usd: 50000, expected_close_date: yesterday.toISOString().slice(0, 10) },
      });
      expect(w.some((x) => x.code === 'close_date_past')).toBe(true);
    });
  });
});
