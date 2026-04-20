import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '../../../server/core/reflector';
import type { LLMInterface } from '../../../server/cognition/llm';
import type { MemorySystem } from '../../../server/core/memory';
import type { StrategyConfig } from '../../../server/core/strategy/config';

vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

function makeMockLLM(insightResponse: any, embedReturn: number[] = Array(768).fill(0.1)): Partial<LLMInterface> {
  return {
    healthCheck: vi.fn().mockReturnValue(true),
    summarizeExperience: vi.fn().mockResolvedValue(insightResponse),
    embed: vi.fn().mockResolvedValue(embedReturn),
  };
}

function makeMockMemory(): Partial<MemorySystem> {
  return {
    remember: vi.fn() as any,
    addEvent: vi.fn() as any,
    recall: vi.fn().mockReturnValue(null) as any,
  };
}

describe('Reflector', () => {
  describe('reflect', () => {
    it('does nothing and logs idle when results array is empty', async () => {
      const { logEvent } = await import('../../../server/utils/logger');
      const llm = makeMockLLM({ insight: 'some insight' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      await reflector.reflect([], [], [], []);

      expect(llm.summarizeExperience).not.toHaveBeenCalled();
      expect((logEvent as any)).toHaveBeenCalledWith('reflect', expect.objectContaining({ status: 'idle' }));
    });

    it('skips reflection on non-scheduled cycles for low-priority results', async () => {
      const llm = makeMockLLM({ insight: 'skip me' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      // Cycle 1 and 2 are not scheduled (scheduled every 3)
      await reflector.reflect([], [], [], [{ priority: 'STANDARD', outcome: 'ok', status: 'simulated' }]);
      await reflector.reflect([], [], [], [{ priority: 'STANDARD', outcome: 'ok', status: 'simulated' }]);

      expect(llm.summarizeExperience).not.toHaveBeenCalled();
    });

    it('always reflects on CRITICAL priority results regardless of cycle schedule', async () => {
      const llm = makeMockLLM({ insight: 'critical insight' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      // Cycle 1 — not a scheduled cycle, but CRITICAL forces it
      const result = await reflector.reflect(
        [{ type: 'signal' }], [], [],
        [{ priority: 'CRITICAL', outcome: 'alert', status: 'executed' }]
      );

      expect(llm.summarizeExperience).toHaveBeenCalled();
      expect(memory.remember).toHaveBeenCalled();
      expect(result).toBe('critical insight');
    });

    it('always reflects when the outcome includes "Anomaly"', async () => {
      const llm = makeMockLLM({ insight: 'anomaly insight' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      // Cycle 1 — not scheduled, but Anomaly forces it
      await reflector.reflect(
        [], [], [],
        [{ priority: 'STANDARD', outcome: 'Anomaly: something happened', status: 'simulated' }]
      );

      expect(llm.summarizeExperience).toHaveBeenCalled();
    });

    it('reflects on the scheduled cycle (every 3 cycles)', async () => {
      const llm = makeMockLLM({ insight: 'sampled insight' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      const lowPriResult = [{ priority: 'STANDARD', outcome: 'ok', status: 'simulated' }];

      // Cycles 1 and 2 should skip
      await reflector.reflect([], [], [], lowPriResult);
      await reflector.reflect([], [], [], lowPriResult);
      expect(llm.summarizeExperience).not.toHaveBeenCalled();

      // Cycle 3 should reflect
      const result = await reflector.reflect([], [], [], lowPriResult);
      expect(result).toBe('sampled insight');
    });

    it('stores the insight in memory with higher importance for CRITICAL', async () => {
      const llm = makeMockLLM({ insight: 'important rule' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      await reflector.reflect(
        [], [], [],
        [{ priority: 'CRITICAL', outcome: 'ok', status: 'executed' }]
      );

      const [key, value, _emb, importance] = (memory.remember as any).mock.calls[0];
      expect(key).toMatch(/^INSIGHT_\d+$/);
      expect(value).toBe('important rule');
      expect(importance).toBe(1.5);
    });

    it('stores the insight with importance 1.0 for non-critical scheduled cycles', async () => {
      const llm = makeMockLLM({ insight: 'normal rule' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      // Run 3 cycles to hit the scheduled cycle
      const lowPri = [{ priority: 'STANDARD', outcome: 'ok', status: 'simulated' }];
      await reflector.reflect([], [], [], lowPri);
      await reflector.reflect([], [], [], lowPri);
      await reflector.reflect([], [], [], lowPri); // 3rd — scheduled

      const [, , , importance] = (memory.remember as any).mock.calls[0];
      expect(importance).toBe(1.0);
    });

    it('returns null and logs an error when summarizeExperience throws', async () => {
      const llm: Partial<LLMInterface> = {
        summarizeExperience: vi.fn().mockRejectedValue(new Error('LLM down')),
        embed: vi.fn(),
      };
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      // Force reflection on cycle 1 using a CRITICAL result
      const result = await reflector.reflect(
        [], [], [],
        [{ priority: 'CRITICAL', outcome: 'ok', status: 'executed' }]
      );

      expect(result).toBeNull();
      expect(memory.remember).not.toHaveBeenCalled();
    });
  });

  // ── Phase 8: Reflection Authority ──────────────────────────────────────────

  describe('strategy authority', () => {
    const defaultStrategy: StrategyConfig = {
      exploration_rate: 0.2,
      risk_tolerance: 0.5,
      tool_preference: {},
    };

    function makeEvaluationsWithAvgScore(score: number) {
      return [{ evaluation: { score, success: score > 0 } }];
    }

    it('does not fire onStrategyUpdate when no callbacks are provided', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      const poorEvals = makeEvaluationsWithAvgScore(10);
      // Two cycles of poor performance — should be a no-op without callbacks
      await reflector.reflect([], [], [], [{ priority: 'CRITICAL', outcome: 'ok', status: 'executed' }], poorEvals);
      await reflector.reflect([], [], [], [{ priority: 'CRITICAL', outcome: 'ok', status: 'executed' }], poorEvals);
      // No assertion needed; just ensure no error is thrown
    });

    it('fires onStrategyUpdate to penalise after 2 consecutive poor cycles', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      const poorEvals = makeEvaluationsWithAvgScore(10); // below threshold (30)
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'bad', status: 'executed' }];

      // Cycle 1: streak starts
      await reflector.reflect([], [], [], criticalResult, poorEvals);
      expect(onStrategyUpdate).not.toHaveBeenCalled();

      // Cycle 2: streak reaches threshold → penalise
      await reflector.reflect([], [], [], criticalResult, poorEvals);
      expect(onStrategyUpdate).toHaveBeenCalledTimes(1);
      const [updates, change, impact] = onStrategyUpdate.mock.calls[0];
      expect(updates.risk_tolerance).toBeLessThan(defaultStrategy.risk_tolerance);
      expect(change).toContain('poor performance');
      expect(impact).toBeLessThan(0);
    });

    it('resets failure streak after penalising', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      const poorEvals = makeEvaluationsWithAvgScore(10);
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'bad', status: 'executed' }];

      // Trigger first penalisation
      await reflector.reflect([], [], [], criticalResult, poorEvals);
      await reflector.reflect([], [], [], criticalResult, poorEvals);
      expect(onStrategyUpdate).toHaveBeenCalledTimes(1);

      // Third cycle — streak was reset; should NOT fire again immediately
      await reflector.reflect([], [], [], criticalResult, poorEvals);
      expect(onStrategyUpdate).toHaveBeenCalledTimes(1);
    });

    it('fires onStrategyUpdate to reward after 2 consecutive strong cycles', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      const strongEvals = makeEvaluationsWithAvgScore(90); // above threshold (70)
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'great', status: 'executed' }];

      await reflector.reflect([], [], [], criticalResult, strongEvals);
      expect(onStrategyUpdate).not.toHaveBeenCalled();

      await reflector.reflect([], [], [], criticalResult, strongEvals);
      expect(onStrategyUpdate).toHaveBeenCalledTimes(1);
      const [updates, change, impact] = onStrategyUpdate.mock.calls[0];
      expect(updates.exploration_rate).toBeGreaterThan(defaultStrategy.exploration_rate);
      expect(change).toContain('strong performance');
      expect(impact).toBeGreaterThan(0);
    });

    it('does not fire onStrategyUpdate for neutral scores (between 30 and 70)', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      const neutralEvals = makeEvaluationsWithAvgScore(50);
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'ok', status: 'executed' }];

      for (let i = 0; i < 5; i++) {
        await reflector.reflect([], [], [], criticalResult, neutralEvals);
      }
      expect(onStrategyUpdate).not.toHaveBeenCalled();
    });

    it('clamps risk_tolerance to 0.1 minimum when penalising', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy, risk_tolerance: 0.05 });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      const poorEvals = makeEvaluationsWithAvgScore(10);
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'bad', status: 'executed' }];

      await reflector.reflect([], [], [], criticalResult, poorEvals);
      await reflector.reflect([], [], [], criticalResult, poorEvals);

      const [updates] = onStrategyUpdate.mock.calls[0];
      expect(updates.risk_tolerance).toBeGreaterThanOrEqual(0.1);
    });

    it('clamps exploration_rate to 1.0 maximum when rewarding', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy, exploration_rate: 0.99 });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      const strongEvals = makeEvaluationsWithAvgScore(90);
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'great', status: 'executed' }];

      await reflector.reflect([], [], [], criticalResult, strongEvals);
      await reflector.reflect([], [], [], criticalResult, strongEvals);

      const [updates] = onStrategyUpdate.mock.calls[0];
      expect(updates.exploration_rate).toBeLessThanOrEqual(1.0);
    });
  });

  // ── Phase 9: Reflection ban authority ──────────────────────────────────────

  describe('ban authority', () => {
    const defaultStrategy: StrategyConfig = {
      exploration_rate: 0.2,
      risk_tolerance: 0.5,
      tool_preference: {},
    };

    it('writes REFLECTOR_BANS to memory when failure streak fires', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      const poorEvals = [
        { evaluation: { score: 10, success: false }, action: { tool: 'simulate' }, observation: {} },
        { evaluation: { score: 5, success: false }, action: { tool: 'api_fetch' }, observation: {} },
      ];
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'bad', status: 'executed' }];

      // Two cycles of poor performance → streak fires → bans should be stored
      await reflector.reflect([], [], [], criticalResult, poorEvals);
      await reflector.reflect([], [], [], criticalResult, poorEvals);

      // memory.remember should have been called with REFLECTOR_BANS_KEY
      const rememberCalls = (memory.remember as any).mock.calls;
      const banCall = rememberCalls.find(([key]: [string]) => key === 'REFLECTOR_BANS');
      expect(banCall).toBeDefined();
      // The value should be an array containing the failing tools
      const bannedList = banCall[1];
      expect(Array.isArray(bannedList)).toBe(true);
    });

    it('fires an immediate strategy downgrade when all scores are 0', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      // All scores = 0 → immediate downgrade, no streak required
      const zeroEvals = [{ evaluation: { score: 0, success: false }, action: { tool: 'simulate' }, observation: {} }];
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'total failure', status: 'executed' }];

      await reflector.reflect([], [], [], criticalResult, zeroEvals);

      expect(onStrategyUpdate).toHaveBeenCalledTimes(1);
      const [updates, change, impact] = onStrategyUpdate.mock.calls[0];
      expect(updates.risk_tolerance).toBeLessThan(defaultStrategy.risk_tolerance);
      expect(change).toContain('total failure');
      expect(impact).toBe(-100);
    });

    it('does not fire immediate downgrade when scores are non-zero', async () => {
      const llm = makeMockLLM({ insight: 'insight' });
      const memory = makeMockMemory();
      const onStrategyUpdate = vi.fn();
      const getStrategy = vi.fn().mockReturnValue({ ...defaultStrategy });
      const reflector = new Reflector(llm as any, memory as any, null, onStrategyUpdate, getStrategy);

      // Scores = 10 (non-zero poor) → should NOT fire immediately, needs streak
      const poorEvals = [{ evaluation: { score: 10, success: false }, action: { tool: 'simulate' }, observation: {} }];
      const criticalResult = [{ priority: 'CRITICAL', outcome: 'bad', status: 'executed' }];

      await reflector.reflect([], [], [], criticalResult, poorEvals);

      expect(onStrategyUpdate).not.toHaveBeenCalled();
    });
  });
});
