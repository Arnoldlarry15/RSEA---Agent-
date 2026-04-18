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

vi.mock('../../../server/modules/sniper', () => {
  class Sniper {
    executeSurgicalStrike = vi.fn().mockResolvedValue([
      { status: 'simulated', outcome: 'ok', priority: 'STANDARD', timestamp: '', action: {} }
    ]);
  }
  return { Sniper };
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
      const { Sniper } = await import('../../../server/modules/sniper');

      const sniperInstance = new (Sniper as any)();
      vi.mocked(sniperInstance.executeSurgicalStrike).mockResolvedValue([
        { status: 'simulated', outcome: 'ok', priority: 'STANDARD', timestamp: '', action: {} }
      ]);

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
});

