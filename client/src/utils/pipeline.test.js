import {
  STAGES, STAGE_BY_ID, TRANSITIONS,
  probabilityFor, isTerminal, isPostponed, isWon, isLost,
  validNextStages, computeTransitionWarnings,
} from './pipeline';

describe('pipeline utils — SPEC-CRM-00 v1.1 (9 stages)', () => {
  it('STAGES has 9 stages in stable order matching the spec', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'lead', 'qualified', 'solution_design', 'proposal_validated',
      'negotiation', 'verbal_commit', 'closed_won', 'closed_lost', 'postponed',
    ]);
  });

  it('probability is consistent with the trigger in migrate.js', () => {
    // Si cambias estos números, cambia también opp_pipeline_recalc()
    // en server/database/migrate.js Y server/utils/pipeline.js.
    expect(probabilityFor('lead')).toBe(5);
    expect(probabilityFor('qualified')).toBe(15);
    expect(probabilityFor('solution_design')).toBe(30);
    expect(probabilityFor('proposal_validated')).toBe(50);
    expect(probabilityFor('negotiation')).toBe(75);
    expect(probabilityFor('verbal_commit')).toBe(90);
    expect(probabilityFor('closed_won')).toBe(100);
    expect(probabilityFor('closed_lost')).toBe(0);
    expect(probabilityFor('postponed')).toBe(0);
  });

  it('isTerminal flags only closed_won and closed_lost (postponed NO es terminal)', () => {
    expect(isTerminal('lead')).toBe(false);
    expect(isTerminal('closed_won')).toBe(true);
    expect(isTerminal('closed_lost')).toBe(true);
    expect(isTerminal('postponed')).toBe(false); // critical: spec dice postponed != terminal
    expect(isTerminal('qualified')).toBe(false);
  });

  it('isPostponed sólo flagea postponed', () => {
    expect(isPostponed('postponed')).toBe(true);
    expect(isPostponed('lead')).toBe(false);
    expect(isPostponed('closed_won')).toBe(false);
  });

  it('isWon / isLost reflejan los terminales correctos', () => {
    expect(isWon('closed_won')).toBe(true);
    expect(isWon('closed_lost')).toBe(false);
    expect(isLost('closed_lost')).toBe(true);
    expect(isLost('closed_won')).toBe(false);
    expect(isLost('postponed')).toBe(false);
  });

  it('STAGE_BY_ID indexa los 9 stages', () => {
    expect(Object.keys(STAGE_BY_ID).length).toBe(9);
    expect(STAGE_BY_ID.qualified.label).toBe('Calificada');
    expect(STAGE_BY_ID.proposal_validated.label).toBe('Propuesta Validada');
    expect(STAGE_BY_ID.postponed.label).toBe('Postergada');
  });

  describe('TRANSITIONS', () => {
    it('terminales (closed_won / closed_lost) son inmutables', () => {
      expect(validNextStages('closed_won')).toEqual([]);
      expect(validNextStages('closed_lost')).toEqual([]);
      expect(TRANSITIONS.closed_won).toEqual([]);
    });

    it('postponed solo sale a qualified o closed_lost', () => {
      expect(validNextStages('postponed').sort()).toEqual(['closed_lost', 'qualified']);
    });

    it('lead permite avanzar a qualified, perder o postergar', () => {
      const next = validNextStages('lead');
      expect(next).toContain('qualified');
      expect(next).toContain('closed_lost');
      expect(next).toContain('postponed');
    });

    it('verbal_commit puede cerrar (won/lost) o postergar pero NO retroceder a negotiation por la lista canónica', () => {
      const next = validNextStages('verbal_commit');
      expect(next).toEqual(expect.arrayContaining(['closed_won', 'closed_lost', 'postponed']));
      // El backend permite saltos hacia atrás libres con warning soft;
      // utils/pipeline.js mantiene la lista canónica que usa el frontend
      // para los botones, intencionalmente sin permitir backwards aquí.
      expect(next).not.toContain('negotiation');
    });
  });

  describe('computeTransitionWarnings', () => {
    it('no warnings para forward natural con monto válido', () => {
      const w = computeTransitionWarnings({
        fromStage: 'qualified',
        toStage: 'solution_design',
        opportunity: { booking_amount_usd: 50000, expected_close_date: '2099-01-01' },
      });
      expect(w).toHaveLength(0);
    });

    it('warning amount_zero al entrar a proposal_validated / negotiation / verbal_commit / closed_won', () => {
      for (const toStage of ['proposal_validated', 'negotiation', 'verbal_commit', 'closed_won']) {
        const w = computeTransitionWarnings({
          fromStage: 'qualified', toStage,
          opportunity: { booking_amount_usd: 0 },
        });
        expect(w.some((x) => x.code === 'amount_zero')).toBe(true);
      }
    });

    it('warning backwards entre stages no terminales', () => {
      const w = computeTransitionWarnings({
        fromStage: 'negotiation', toStage: 'qualified',
        opportunity: { booking_amount_usd: 50000 },
      });
      expect(w.some((x) => x.code === 'backwards')).toBe(true);
    });

    it('NO warning backwards al cerrar como perdida (es transición normal)', () => {
      const w = computeTransitionWarnings({
        fromStage: 'negotiation', toStage: 'closed_lost',
        opportunity: { booking_amount_usd: 50000 },
      });
      expect(w.some((x) => x.code === 'backwards')).toBe(false);
    });

    it('NO warning backwards al postergar (el flujo permite pause desde cualquier etapa activa)', () => {
      const w = computeTransitionWarnings({
        fromStage: 'negotiation', toStage: 'postponed',
        opportunity: { booking_amount_usd: 50000 },
      });
      expect(w.some((x) => x.code === 'backwards')).toBe(false);
    });

    it('NO warning backwards al reactivar (postponed → qualified) — es la salida válida del limbo', () => {
      const w = computeTransitionWarnings({
        fromStage: 'postponed', toStage: 'qualified',
        opportunity: { booking_amount_usd: 50000 },
      });
      expect(w.some((x) => x.code === 'backwards')).toBe(false);
    });

    it('warning close_date_past si la fecha estimada ya pasó y no es terminal', () => {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const w = computeTransitionWarnings({
        fromStage: 'qualified', toStage: 'solution_design',
        opportunity: { booking_amount_usd: 50000, expected_close_date: yesterday.toISOString().slice(0, 10) },
      });
      expect(w.some((x) => x.code === 'close_date_past')).toBe(true);
    });
  });
});
