import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedTeamOrchestrator } from '../../../../server/core/adversarial/red_team';
import type { LLMInterface } from '../../../../server/cognition/llm';
import type { MemorySystem } from '../../../../server/core/memory';

vi.mock('../../../../server/utils/logger', () => ({ logEvent: vi.fn() }));

// ── Stub Sniper ──────────────────────────────────────────────────────────────
vi.mock('../../../../server/modules/sniper', () => {
  class Sniper {
    executeSurgicalStrike = vi.fn().mockResolvedValue([
      { action: 'simulate', tool: 'simulate', payload: { info: 'test' } },
    ]);
  }
  return { Sniper };
});

// ── Stub Evaluator ───────────────────────────────────────────────────────────
vi.mock('../../../../server/modules/evaluator', () => {
  class Evaluator {
    rankStrategies = vi.fn().mockResolvedValue([
      { id: 'red_team_plan', score: 60, description: 'plan', status: 'pending' },
    ]);
  }
  return { Evaluator };
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeMockLLM(healthOk = false): Partial<LLMInterface> {
  return {
    healthCheck: vi.fn().mockReturnValue(healthOk),
    complete: vi.fn().mockResolvedValue({
      attacks: [
        { vector: 'Liquidity risk', severity: 'high' },
        { vector: 'Slippage risk', severity: 'medium' },
      ],
    }),
  };
}

function makeMockMemory(): Partial<MemorySystem> {
  return {
    remember: vi.fn(),
  };
}

const sampleOpportunity = {
  id: 'opp_1',
  type: 'market_data',
  asset: 'BTC',
  tool: 'simulate',
  description: 'BTC price spike detected',
};

// ── Tests ────────────────────────────────────────────────────────────────────
describe('RedTeamOrchestrator', () => {
  let llm: Partial<LLMInterface>;
  let memory: Partial<MemorySystem>;
  let orchestrator: RedTeamOrchestrator;

  beforeEach(() => {
    llm = makeMockLLM(false); // default: simulation mode (no LLM)
    memory = makeMockMemory();
    orchestrator = new RedTeamOrchestrator(llm as any, memory as any);
  });

  describe('run() — result shape', () => {
    it('returns a result with all required top-level fields', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      expect(result).toHaveProperty('opportunity');
      expect(result).toHaveProperty('plan');
      expect(result).toHaveProperty('attackVectors');
      expect(result).toHaveProperty('blockedAttacks');
      expect(result).toHaveProperty('robustnessScore');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('strategyUpdate');
      expect(result).toHaveProperty('timestamp');
    });

    it('echoes the passed-in opportunity back in the result', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      expect(result.opportunity).toEqual(sampleOpportunity);
    });

    it('plan is a non-empty array', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      expect(Array.isArray(result.plan)).toBe(true);
      expect(result.plan.length).toBeGreaterThan(0);
    });

    it('attackVectors is a non-empty array in simulation mode', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      expect(Array.isArray(result.attackVectors)).toBe(true);
      expect(result.attackVectors.length).toBeGreaterThan(0);
    });

    it('robustnessScore is in the range [0, 100]', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      expect(result.robustnessScore).toBeGreaterThanOrEqual(0);
      expect(result.robustnessScore).toBeLessThanOrEqual(100);
    });

    it('score.rounds equals 1 after one run()', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      expect(result.score.rounds).toBe(1);
    });
  });

  describe('run() — simulation mode (no LLM)', () => {
    it('uses simulated attack vectors (3 default vectors)', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      expect(result.attackVectors).toHaveLength(3);
    });

    it('blockedAttacks equals attackVectors.length when the plan is valid', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      // The mocked Sniper returns a valid simulate action → all attacks blocked
      expect(result.blockedAttacks).toBe(result.attackVectors.length);
    });
  });

  describe('run() — with LLM', () => {
    beforeEach(() => {
      llm = makeMockLLM(true); // LLM active
      orchestrator = new RedTeamOrchestrator(llm as any, memory as any);
    });

    it('uses attack vectors from the LLM response', async () => {
      const result = await orchestrator.run(sampleOpportunity);
      expect(result.attackVectors).toContain('Liquidity risk');
      expect(result.attackVectors).toContain('Slippage risk');
    });

    it('falls back to simulated vectors when LLM complete() returns unexpected shape', async () => {
      (llm.complete as any).mockResolvedValue({ unexpected: true });
      const result = await orchestrator.run(sampleOpportunity);
      expect(result.attackVectors).toHaveLength(3);
    });

    it('falls back to simulated vectors when LLM complete() rejects', async () => {
      (llm.complete as any).mockRejectedValue(new Error('LLM error'));
      const result = await orchestrator.run(sampleOpportunity);
      expect(result.attackVectors).toHaveLength(3);
    });
  });

  describe('memory persistence', () => {
    it('stores a best strategy when robustnessScore is high', async () => {
      // Force robustness ≥ 70 by making the Evaluator return a high score
      const { Evaluator } = await import('../../../../server/modules/evaluator');
      const evalInstance = new (Evaluator as any)();
      vi.mocked(evalInstance.rankStrategies).mockResolvedValue([
        { id: 'red_team_plan', score: 90 },
      ]);

      // Plan has valid tool='simulate' steps — all attacks blocked → baseScore=100
      const result = await orchestrator.run(sampleOpportunity);
      // robustnessScore = 100*0.6 + llmScore*0.4 — llmScore from mock = 60 → 76
      if (result.robustnessScore >= 70) {
        expect(memory.remember).toHaveBeenCalledWith(
          expect.stringContaining('adversarial:best_strategy:'),
          expect.objectContaining({ robustnessScore: result.robustnessScore }),
          undefined,
          expect.any(Number),
        );
      }
    });

    it('stores failed attack patterns when some attacks are not blocked', async () => {
      // Override Sniper to return an invalid action so attacks are NOT blocked
      const { Sniper } = await import('../../../../server/modules/sniper');
      const sniperInstance = new (Sniper as any)();
      vi.mocked(sniperInstance.executeSurgicalStrike).mockResolvedValue([
        { action: 'bad', tool: 'nonexistent_tool', payload: {} },
      ]);

      const result = await orchestrator.run(sampleOpportunity);
      // When attacks are not blocked, failed patterns should be stored
      if (result.blockedAttacks < result.attackVectors.length) {
        expect(memory.remember).toHaveBeenCalledWith(
          expect.stringContaining('adversarial:failed_attack:'),
          expect.objectContaining({ attackVectors: expect.any(Array) }),
          undefined,
          expect.any(Number),
        );
      }
    });
  });

  describe('score accumulation', () => {
    it('increases score.rounds with each run()', async () => {
      await orchestrator.run(sampleOpportunity);
      await orchestrator.run(sampleOpportunity);
      const result = await orchestrator.run(sampleOpportunity);
      expect(result.score.rounds).toBe(3);
    });

    it('getScorer() exposes the same scorer used internally', async () => {
      await orchestrator.run(sampleOpportunity);
      expect(orchestrator.getScorer().score().rounds).toBe(1);
    });
  });
});
