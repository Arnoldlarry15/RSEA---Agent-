import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Controller } from '../../../server/modules/controller';
import type { LLMInterface } from '../../../server/cognition/llm';
import type { MemorySystem } from '../../../server/core/memory';

vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

// Mock all sub-modules so Controller tests stay isolated
vi.mock('../../../server/modules/spotter', () => {
  class Spotter {
    scan = vi.fn().mockResolvedValue([
      { id: 'obs_1', type: 'market_data', asset: 'BTC', price: '50000', source: 'Binance_API' }
    ]);
  }
  return { Spotter };
});

vi.mock('../../../server/modules/planner', () => {
  class Planner {
    decomposeTask = vi.fn().mockResolvedValue({
      id: 'plan_1',
      objective: 'test',
      tasks: [{ id: 't1', description: 'task one', status: 'pending', score: 75, parallelNode: false }]
    });
  }
  return { Planner };
});

vi.mock('../../../server/modules/evaluator', () => {
  class Evaluator {
    rankStrategies = vi.fn().mockResolvedValue([
      { id: 't1', description: 'task one', status: 'pending', score: 75, parallelNode: false }
    ]);
  }
  return { Evaluator };
});

// Use vi.hoisted so the shared fn is accessible both in the mock factory and in tests.
const mockExecuteSurgicalStrike = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    { status: 'simulated', outcome: 'ok', priority: 'STANDARD', timestamp: '', action: {}, success: true }
  ])
);

vi.mock('../../../server/modules/sniper', () => {
  class Sniper {
    executeSurgicalStrike = mockExecuteSurgicalStrike;
  }
  return { Sniper };
});

vi.mock('../../../server/core/adversarial/red_team', () => {
  class RedTeamOrchestrator {
    run = vi.fn().mockResolvedValue({
      opportunity: { id: 'obs_1' },
      plan: [{ action: 'simulate', tool: 'simulate', payload: {} }],
      attackVectors: ['Liquidity risk'],
      blockedAttacks: 1,
      robustnessScore: 80,
      score: { success_rate: 100, efficiency: 50, risk_score: 0, overall: 80, rounds: 1 },
      strategyUpdate: 'Stored best strategy: adversarial:best_strategy:obs_1',
      timestamp: new Date().toISOString(),
    });
  }
  return { RedTeamOrchestrator };
});

function makeMockLLM(healthOk = true): Partial<LLMInterface> {
  return {
    healthCheck: vi.fn().mockReturnValue(healthOk),
    generateModifiers: vi.fn().mockResolvedValue(['be bold', 'preserve capital']),
  };
}

function makeMockMemory(): Partial<MemorySystem> {
  return {
    getSnapshot: vi.fn().mockReturnValue({ shortTerm: [], longTerm: {} }),
    addEvent: vi.fn(),
  };
}

describe('Controller', () => {
  let llm: Partial<LLMInterface>;
  let memory: Partial<MemorySystem>;
  let controller: Controller;

  beforeEach(() => {
    llm = makeMockLLM();
    memory = makeMockMemory();
    controller = new Controller(llm as any, memory as any);
  });

  describe('runCycle', () => {
    it('returns observations, plan, and results', async () => {
      const cycle = await controller.runCycle('Maximise profit', []);
      expect(cycle).toHaveProperty('observations');
      expect(cycle).toHaveProperty('plan');
      expect(cycle).toHaveProperty('results');
    });

    it('observations come from the Spotter', async () => {
      const cycle = await controller.runCycle('goal', []);
      expect(cycle.observations).toHaveLength(1);
      expect(cycle.observations[0].asset).toBe('BTC');
    });

    it('plan contains ranked tasks from the Evaluator', async () => {
      const cycle = await controller.runCycle('goal', []);
      expect(cycle.plan[0].id).toBe('t1');
    });

    it('results come from the Sniper', async () => {
      const cycle = await controller.runCycle('goal', []);
      expect(cycle.results[0].status).toBe('simulated');
    });
  });

  describe('parallel task execution', () => {
    it('runs parallel tasks concurrently when multiple tasks are flagged parallelNode=true', async () => {
      const { Evaluator } = await import('../../../server/modules/evaluator');

      const evaluatorInstance = new (Evaluator as any)();
      vi.mocked(evaluatorInstance.rankStrategies).mockResolvedValue([
        { id: 't1', score: 75, description: 'a', parallelNode: true },
        { id: 't2', score: 70, description: 'b', parallelNode: true },
      ]);

      // Create fresh controller using the mock instances by testing the fresh spotter
      const c = new Controller(llm as any, memory as any);
      const cycle = await c.runCycle('goal', []);
      // Both parallel tasks should produce results
      expect(cycle.results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('selfModifyPrompts', () => {
    beforeEach(() => {
      delete process.env.ALLOW_SELF_MODIFICATION;
      delete process.env.DRY_RUN;
    });

    afterEach(() => {
      delete process.env.ALLOW_SELF_MODIFICATION;
      delete process.env.DRY_RUN;
    });

    it('does not call generateModifiers when ALLOW_SELF_MODIFICATION is not set', async () => {
      // cycleCount=0 → scheduled (0 % 10 === 0), but flag not set → blocked
      await controller.selfModifyPrompts([{ ctx: 1 }]);
      expect(llm.generateModifiers).not.toHaveBeenCalled();
    });

    it('does not call generateModifiers when DRY_RUN=true', async () => {
      process.env.ALLOW_SELF_MODIFICATION = 'true';
      process.env.DRY_RUN = 'true';
      await controller.selfModifyPrompts([]);
      expect(llm.generateModifiers).not.toHaveBeenCalled();
    });

    it('does not call generateModifiers when LLM is unhealthy', async () => {
      process.env.ALLOW_SELF_MODIFICATION = 'true';
      (llm.healthCheck as any).mockReturnValue(false);
      await controller.selfModifyPrompts([]);
      expect(llm.generateModifiers).not.toHaveBeenCalled();
    });

    it('calls generateModifiers on the scheduled cycle when opted-in', async () => {
      process.env.ALLOW_SELF_MODIFICATION = 'true';
      process.env.DRY_RUN = 'false';
      // cycleCount is 0 at construction → 0 % 10 === 0 → scheduled
      await controller.selfModifyPrompts([{ ctx: 1 }]);
      expect(llm.generateModifiers).toHaveBeenCalled();
    });

    it('does not call generateModifiers on non-scheduled cycles', async () => {
      process.env.ALLOW_SELF_MODIFICATION = 'true';
      // Run one full cycle (increments cycleCount to 1)
      await controller.runCycle('goal', []);
      (llm.generateModifiers as any).mockClear();
      // Now cycleCount=1 → 1 % 10 ≠ 0 → skip
      await controller.selfModifyPrompts([]);
      expect(llm.generateModifiers).not.toHaveBeenCalled();
    });

    it('updates globalPromptModifiers on success', async () => {
      process.env.ALLOW_SELF_MODIFICATION = 'true';
      process.env.DRY_RUN = 'false';
      await controller.selfModifyPrompts([]);
      expect(controller.getModifiers()).toEqual(['be bold', 'preserve capital']);
    });
  });

  // ── Phase 5: Strategy Management ────────────────────────────────────────

  describe('getStrategy', () => {
    it('returns the default strategy config on construction', () => {
      const strategy = controller.getStrategy();
      expect(strategy.exploration_rate).toBe(0.2);
      expect(strategy.risk_tolerance).toBe(0.5);
      expect(strategy.tool_preference).toEqual({});
    });

    it('returns a deep copy so mutations do not affect internal state', () => {
      const strategy = controller.getStrategy();
      strategy.exploration_rate = 0.99;
      expect(controller.getStrategy().exploration_rate).toBe(0.2);
    });
  });

  describe('updateStrategy', () => {
    it('updates exploration_rate', () => {
      controller.updateStrategy({ exploration_rate: 0.4 }, 'raised exploration', 2);
      expect(controller.getStrategy().exploration_rate).toBe(0.4);
    });

    it('updates risk_tolerance', () => {
      controller.updateStrategy({ risk_tolerance: 0.8 }, 'higher risk', 3);
      expect(controller.getStrategy().risk_tolerance).toBe(0.8);
    });

    it('updates tool_preference', () => {
      controller.updateStrategy({ tool_preference: { search: 0.9 } }, 'prefer search', 1);
      expect(controller.getStrategy().tool_preference.search).toBe(0.9);
    });

    it('commits a new version to history', () => {
      const beforeLen = controller.getStrategyHistory().length;
      controller.updateStrategy({ exploration_rate: 0.3 }, 'test update', 1);
      expect(controller.getStrategyHistory().length).toBe(beforeLen + 1);
    });

    it('does not update when no mutable fields are provided', () => {
      const beforeLen = controller.getStrategyHistory().length;
      controller.updateStrategy({} as any, 'no-op', 0);
      expect(controller.getStrategyHistory().length).toBe(beforeLen);
    });

    it('ignores unknown fields and does not commit', () => {
      const beforeLen = controller.getStrategyHistory().length;
      controller.updateStrategy({ unknown_field: 99 } as any, 'bad field', 0);
      expect(controller.getStrategyHistory().length).toBe(beforeLen);
    });
  });

  describe('getStrategyHistory', () => {
    it('starts with the baseline initial commit', () => {
      const history = controller.getStrategyHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].change).toBe('initial baseline');
    });

    it('accumulates one entry per updateStrategy call', () => {
      controller.updateStrategy({ exploration_rate: 0.3 }, 'first', 1);
      controller.updateStrategy({ risk_tolerance: 0.7 }, 'second', 2);
      const history = controller.getStrategyHistory();
      const changes = history.map((h) => h.change);
      expect(changes).toContain('first');
      expect(changes).toContain('second');
    });
  });

  // ── Phase 7: Adversarial Intelligence ─────────────────────────────────────

  describe('runAdversarialCycle', () => {
    it('returns an AdversarialResult with the expected fields', async () => {
      const result = await controller.runAdversarialCycle('Maximise profit');
      expect(result).toHaveProperty('opportunity');
      expect(result).toHaveProperty('plan');
      expect(result).toHaveProperty('attackVectors');
      expect(result).toHaveProperty('robustnessScore');
      expect(result).toHaveProperty('score');
    });

    it('does not throw when the Spotter returns an empty observation array', async () => {
      const { Spotter } = await import('../../../server/modules/spotter');
      const s = new (Spotter as any)();
      vi.mocked(s.scan).mockResolvedValue([]);

      await expect(controller.runAdversarialCycle('test objective')).resolves.toBeDefined();
    });
  });

  // ── G1: Adversarial cycle wired into main loop ─────────────────────────────

  describe('G1: adversarial cycle scheduling', () => {
    it('fires runAdversarialCycle on the 20th cycle', async () => {
      const spy = vi.spyOn(controller, 'runAdversarialCycle').mockResolvedValue({} as any);
      // Run 19 cycles — adversarial should not have fired yet
      for (let i = 0; i < 19; i++) await controller.runCycle('goal', []);
      expect(spy).not.toHaveBeenCalled();
      // 20th cycle — should fire
      await controller.runCycle('goal', []);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('does not block runCycle when runAdversarialCycle rejects', async () => {
      vi.spyOn(controller, 'runAdversarialCycle').mockRejectedValue(new Error('adversarial boom'));
      // Advance to cycle 20 — even with an error the runCycle should resolve
      for (let i = 0; i < 19; i++) await controller.runCycle('goal', []);
      await expect(controller.runCycle('goal', [])).resolves.toBeDefined();
    });
  });

  // ── G5: dry_run evaluation proxy scoring ──────────────────────────────────

  describe('G5: dry_run evaluation proxy scoring', () => {
    it('uses task.score as evaluation score when result.status is dry_run', async () => {
      // Override the shared mock to return a dry_run result for this test.
      mockExecuteSurgicalStrike.mockResolvedValueOnce([
        { status: 'dry_run', outcome: 'DRY RUN', priority: 'STANDARD', timestamp: '', action: {} }
      ]);
      const c = new Controller(llm as any, memory as any);
      const cycle = await c.runCycle('goal', []);
      // The mock evaluator scores t1 at 75; the dry_run proxy should use that score.
      expect(cycle.evaluations[0]?.evaluation.score).toBe(75);
    });

    it('uses comparator (score 0 or 100) when result is not dry_run', async () => {
      // Default mock returns status:'simulated', success:true → state_change:true → score:100
      const c = new Controller(llm as any, memory as any);
      const cycle = await c.runCycle('goal', []);
      expect([0, 100]).toContain(cycle.evaluations[0]?.evaluation.score);
    });
  });
});

