import { describe, it, expect, beforeEach } from 'vitest';
import { AdversarialScorer, AdversarialRound } from '../../../../server/core/adversarial/scorer';

function makeRound(overrides: Partial<AdversarialRound> = {}): AdversarialRound {
  return {
    roundId: `rt_${Date.now()}`,
    strategyId: 'strat_1',
    attacksAttempted: 3,
    attacksBlocked: 3,
    executionTimeMs: 100,
    value: 80,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('AdversarialScorer', () => {
  let scorer: AdversarialScorer;

  beforeEach(() => {
    scorer = new AdversarialScorer();
  });

  describe('score() — empty state', () => {
    it('returns zeroed defaults when no rounds have been recorded', () => {
      const s = scorer.score();
      expect(s.rounds).toBe(0);
      expect(s.success_rate).toBe(0);
      expect(s.efficiency).toBe(0);
      expect(s.overall).toBe(0);
      expect(s.risk_score).toBe(50);
    });
  });

  describe('record()', () => {
    it('increments the round count after each record call', () => {
      scorer.record(makeRound());
      expect(scorer.score().rounds).toBe(1);
      scorer.record(makeRound());
      expect(scorer.score().rounds).toBe(2);
    });

    it('caps the window at 100 rounds (oldest evicted)', () => {
      for (let i = 0; i < 105; i++) {
        scorer.record(makeRound({ roundId: `rt_${i}` }));
      }
      expect(scorer.score().rounds).toBe(100);
    });
  });

  describe('success_rate', () => {
    it('is 100 when all recorded rounds blocked all attacks', () => {
      scorer.record(makeRound({ attacksAttempted: 3, attacksBlocked: 3 }));
      scorer.record(makeRound({ attacksAttempted: 2, attacksBlocked: 2 }));
      expect(scorer.score().success_rate).toBe(100);
    });

    it('is 0 when no round blocked any attacks', () => {
      scorer.record(makeRound({ attacksAttempted: 3, attacksBlocked: 0 }));
      scorer.record(makeRound({ attacksAttempted: 2, attacksBlocked: 1 }));
      expect(scorer.score().success_rate).toBe(0);
    });

    it('is 50 when half of rounds were fully successful', () => {
      scorer.record(makeRound({ attacksAttempted: 2, attacksBlocked: 2 }));
      scorer.record(makeRound({ attacksAttempted: 2, attacksBlocked: 1 }));
      expect(scorer.score().success_rate).toBe(50);
    });

    it('counts a round with 0 attacksAttempted as successful', () => {
      scorer.record(makeRound({ attacksAttempted: 0, attacksBlocked: 0 }));
      expect(scorer.score().success_rate).toBe(100);
    });
  });

  describe('risk_score', () => {
    it('is 0 when all attacks in all rounds were blocked', () => {
      scorer.record(makeRound({ attacksAttempted: 4, attacksBlocked: 4 }));
      expect(scorer.score().risk_score).toBe(0);
    });

    it('is 100 when no attack in any round was blocked', () => {
      scorer.record(makeRound({ attacksAttempted: 4, attacksBlocked: 0 }));
      expect(scorer.score().risk_score).toBe(100);
    });

    it('is 0 when there are no attacks across all rounds', () => {
      scorer.record(makeRound({ attacksAttempted: 0, attacksBlocked: 0 }));
      expect(scorer.score().risk_score).toBe(0);
    });

    it('is 50 when half of all attacks got through', () => {
      scorer.record(makeRound({ attacksAttempted: 4, attacksBlocked: 2 }));
      expect(scorer.score().risk_score).toBe(50);
    });
  });

  describe('efficiency', () => {
    it('is greater than 0 when value and time are both positive', () => {
      scorer.record(makeRound({ value: 80, executionTimeMs: 200 }));
      expect(scorer.score().efficiency).toBeGreaterThan(0);
    });

    it('is clamped to a maximum of 100', () => {
      // Very high value / very short time should not exceed 100
      scorer.record(makeRound({ value: 10000, executionTimeMs: 1 }));
      expect(scorer.score().efficiency).toBeLessThanOrEqual(100);
    });

    it('is 0 when value is 0', () => {
      scorer.record(makeRound({ value: 0, executionTimeMs: 500 }));
      expect(scorer.score().efficiency).toBe(0);
    });
  });

  describe('overall', () => {
    it('is in the range [0, 100]', () => {
      scorer.record(makeRound({ attacksAttempted: 3, attacksBlocked: 3, value: 75 }));
      const { overall } = scorer.score();
      expect(overall).toBeGreaterThanOrEqual(0);
      expect(overall).toBeLessThanOrEqual(100);
    });

    it('is higher for a fully successful, efficient, safe round', () => {
      scorer.record(makeRound({ attacksAttempted: 3, attacksBlocked: 3, value: 90, executionTimeMs: 50 }));
      const highScore = scorer.score().overall;

      const scorer2 = new AdversarialScorer();
      scorer2.record(makeRound({ attacksAttempted: 3, attacksBlocked: 0, value: 0, executionTimeMs: 5000 }));
      const lowScore = scorer2.score().overall;

      expect(highScore).toBeGreaterThan(lowScore);
    });
  });

  describe('getHistory()', () => {
    it('returns a copy of recorded rounds in insertion order', () => {
      const r1 = makeRound({ roundId: 'a' });
      const r2 = makeRound({ roundId: 'b' });
      scorer.record(r1);
      scorer.record(r2);
      const history = scorer.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].roundId).toBe('a');
      expect(history[1].roundId).toBe('b');
    });

    it('does not expose the internal array (mutations do not affect scorer)', () => {
      scorer.record(makeRound({ roundId: 'x' }));
      const history = scorer.getHistory();
      history.pop();
      expect(scorer.score().rounds).toBe(1);
    });
  });
});
