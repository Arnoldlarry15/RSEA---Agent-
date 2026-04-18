import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '../../../server/core/reflector';
import type { LLMInterface } from '../../../server/cognition/llm';
import type { MemorySystem } from '../../../server/core/memory';

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
});
