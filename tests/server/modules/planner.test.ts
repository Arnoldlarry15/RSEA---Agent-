import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Planner } from '../../../server/modules/planner';
import type { LLMInterface } from '../../../server/cognition/llm';
import type { MemorySystem } from '../../../server/core/memory';

function makeMockLLM(healthOk: boolean, completeResult: any): Partial<LLMInterface> {
  return {
    healthCheck: vi.fn().mockReturnValue(healthOk),
    complete: vi.fn().mockResolvedValue(completeResult),
    analyze: vi.fn(),
  };
}

function makeMockMemory(): Partial<MemorySystem> {
  return {
    recall: vi.fn().mockReturnValue(undefined),
    remember: vi.fn(),
  };
}

describe('Planner', () => {
  describe('decomposeTask — simulation mode (no LLM)', () => {
    it('returns a single simulated task when LLM is unavailable', async () => {
      const llm = makeMockLLM(false, null);
      const memory = makeMockMemory();
      const planner = new Planner(llm as any, memory as any);

      const plan = await planner.decomposeTask('Maximise profit', []);
      expect(plan.objective).toBe('Maximise profit');
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].description).toContain('Simulated');
      expect(plan.tasks[0].status).toBe('pending');
    });
  });

  describe('decomposeTask — with LLM', () => {
    it('returns tasks from a successful LLM response', async () => {
      const llmPayload = {
        tasks: [
          { id: 't1', description: 'Research market', parallelNode: false },
          { id: 't2', description: 'Execute trade', parallelNode: false },
        ]
      };
      const llm = makeMockLLM(true, llmPayload);
      const memory = makeMockMemory();
      const planner = new Planner(llm as any, memory as any);

      const plan = await planner.decomposeTask('Buy low', []);
      expect(plan.tasks).toHaveLength(2);
      expect(plan.tasks[0].description).toBe('Research market');
      expect(plan.tasks[1].status).toBe('pending');
    });

    it('falls back to a single task when LLM returns null', async () => {
      const llm = makeMockLLM(true, null);
      const memory = makeMockMemory();
      const planner = new Planner(llm as any, memory as any);

      const plan = await planner.decomposeTask('Buy low', []);
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].description).toContain('Fallback');
    });

    it('falls back when LLM returns an empty tasks array', async () => {
      const llm = makeMockLLM(true, { tasks: [] });
      const memory = makeMockMemory();
      const planner = new Planner(llm as any, memory as any);

      const plan = await planner.decomposeTask('Buy low', []);
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].description).toContain('Fallback');
    });

    it('falls back when LLM complete() rejects', async () => {
      const llm = makeMockLLM(true, null);
      (llm.complete as any).mockRejectedValue(new Error('LLM error'));
      const memory = makeMockMemory();
      const planner = new Planner(llm as any, memory as any);

      const plan = await planner.decomposeTask('Sell high', []);
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].description).toContain('Fallback');
    });

    it('includes a unique plan id and the objective', async () => {
      const llm = makeMockLLM(true, { tasks: [{ id: 't1', description: 'task' }] });
      const memory = makeMockMemory();
      const planner = new Planner(llm as any, memory as any);

      const plan = await planner.decomposeTask('My objective', []);
      expect(plan.id).toMatch(/^plan_\d+$/);
      expect(plan.objective).toBe('My objective');
    });
  });
});
