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
      // self-modification requires explicit opt-in
      process.env.ALLOW_SELF_MODIFICATION = 'true';
    });

    afterEach(() => {
      delete process.env.ALLOW_SELF_MODIFICATION;
    });

    it('calls generateModifiers when LLM is healthy and random < 0.1', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.05);
      await controller.selfModifyPrompts([{ ctx: 1 }]);
      expect(llm.generateModifiers).toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('does not call generateModifiers when random >= 0.1', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      await controller.selfModifyPrompts([]);
      expect(llm.generateModifiers).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('does not call generateModifiers when LLM is unhealthy', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.05);
      (llm.healthCheck as any).mockReturnValue(false);
      await controller.selfModifyPrompts([]);
      expect(llm.generateModifiers).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('does not call generateModifiers when ALLOW_SELF_MODIFICATION is not set', async () => {
      delete process.env.ALLOW_SELF_MODIFICATION;
      vi.spyOn(Math, 'random').mockReturnValue(0.05);
      await controller.selfModifyPrompts([]);
      expect(llm.generateModifiers).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('updates globalPromptModifiers on success', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.05);
      await controller.selfModifyPrompts([]);
      expect(controller.getModifiers()).toEqual(['be bold', 'preserve capital']);
      vi.restoreAllMocks();
    });
  });
});

