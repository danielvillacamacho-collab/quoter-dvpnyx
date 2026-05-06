/**
 * Unit tests for server/utils/alerts.js — checkA3 + ALERT_DEFS.
 * Integration tests (createAlertNotification, runAlertScan) viven en
 * routes/opportunities.test.js porque necesitan el mock de pg.Pool.
 */
const { ALERT_DEFS, A3_STAGES, checkA3 } = require('./alerts');

describe('ALERT_DEFS', () => {
  it('defines A1, A2, A3, A5 with code, type, title fn, body fn', () => {
    for (const key of ['A1_STALE', 'A2_NEXT_STEP', 'A3_MEDDPICC', 'A5_CLOSE_SOON']) {
      const def = ALERT_DEFS[key];
      expect(def.code).toBeTruthy();
      expect(def.type).toBeTruthy();
      expect(typeof def.title).toBe('function');
      expect(typeof def.body).toBe('function');
    }
  });

  it('A1 title + body include opp name and days', () => {
    const t = ALERT_DEFS.A1_STALE.title('Deal X');
    const b = ALERT_DEFS.A1_STALE.body(45, 'qualified');
    expect(t).toMatch(/Deal X/);
    expect(b).toMatch(/45 días/);
    expect(b).toMatch(/qualified/);
  });

  it('A5 title + body include close date', () => {
    const t = ALERT_DEFS.A5_CLOSE_SOON.title('Deal Y');
    const b = ALERT_DEFS.A5_CLOSE_SOON.body('2026-06-01');
    expect(t).toMatch(/Deal Y/);
    expect(b).toMatch(/2026-06-01/);
  });
});

describe('A3_STAGES', () => {
  it('includes solution_design, proposal_validated, negotiation, verbal_commit', () => {
    expect(A3_STAGES.has('solution_design')).toBe(true);
    expect(A3_STAGES.has('proposal_validated')).toBe(true);
    expect(A3_STAGES.has('negotiation')).toBe(true);
    expect(A3_STAGES.has('verbal_commit')).toBe(true);
  });

  it('excludes lead, qualified, closed_won, closed_lost, postponed', () => {
    for (const s of ['lead', 'qualified', 'closed_won', 'closed_lost', 'postponed']) {
      expect(A3_STAGES.has(s)).toBe(false);
    }
  });
});

describe('checkA3', () => {
  it('returns null for stages outside A3_STAGES', () => {
    expect(checkA3({ status: 'qualified', champion_identified: false, economic_buyer_identified: false })).toBeNull();
    expect(checkA3({ status: 'lead', champion_identified: false, economic_buyer_identified: false })).toBeNull();
    expect(checkA3({ status: 'closed_won', champion_identified: false, economic_buyer_identified: false })).toBeNull();
  });

  it('returns null when both champion and EB are identified', () => {
    expect(checkA3({ status: 'solution_design', champion_identified: true, economic_buyer_identified: true })).toBeNull();
    expect(checkA3({ status: 'negotiation', champion_identified: true, economic_buyer_identified: true })).toBeNull();
  });

  it('returns ["Champion"] when only champion is missing', () => {
    const gaps = checkA3({ status: 'solution_design', champion_identified: false, economic_buyer_identified: true });
    expect(gaps).toEqual(['Champion']);
  });

  it('returns ["Economic Buyer"] when only EB is missing', () => {
    const gaps = checkA3({ status: 'proposal_validated', champion_identified: true, economic_buyer_identified: false });
    expect(gaps).toEqual(['Economic Buyer']);
  });

  it('returns both when both are missing', () => {
    const gaps = checkA3({ status: 'negotiation', champion_identified: false, economic_buyer_identified: false });
    expect(gaps).toEqual(['Champion', 'Economic Buyer']);
  });

  it('treats falsy values as "not identified"', () => {
    const gaps = checkA3({ status: 'verbal_commit', champion_identified: null, economic_buyer_identified: undefined });
    expect(gaps).toEqual(['Champion', 'Economic Buyer']);
  });
});
