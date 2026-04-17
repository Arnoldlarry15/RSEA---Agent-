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

    it('skips reflection stochastically for low-priority results', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.9); // > 0.4 → skip

      const llm = makeMockLLM({ insight: 'skip me' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      await reflector.reflect([], [], [], [{ priority: 'STANDARD', outcome: 'ok', status: 'simulated' }]);

      expect(llm.summarizeExperience).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('always reflects on CRITICAL priority results regardless of random roll', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99); // Would skip without CRITICAL

      const llm = makeMockLLM({ insight: 'critical insight' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      const result = await reflector.reflect(
        [{ type: 'signal' }], [], [],
        [{ priority: 'CRITICAL', outcome: 'alert', status: 'executed' }]
      );

      expect(llm.summarizeExperience).toHaveBeenCalled();
      expect(memory.remember).toHaveBeenCalled();
      expect(result).toBe('critical insight');
      vi.restoreAllMocks();
    });

    it('always reflects when the outcome includes "Anomaly"', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99);

      const llm = makeMockLLM({ insight: 'anomaly insight' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      await reflector.reflect(
        [], [], [],
        [{ priority: 'STANDARD', outcome: 'Anomaly: something happened', status: 'simulated' }]
      );

      expect(llm.summarizeExperience).toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('reflects when random roll is ≤ 0.4 (stochastic sample)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.3);

      const llm = makeMockLLM({ insight: 'sampled insight' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      const result = await reflector.reflect(
        [], [], [],
        [{ priority: 'STANDARD', outcome: 'ok', status: 'simulated' }]
      );

      expect(result).toBe('sampled insight');
      vi.restoreAllMocks();
    });

    it('stores the insight in memory with higher importance for CRITICAL', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99); // skip stochastic; CRITICAL forces it

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
      vi.restoreAllMocks();
    });

    it('stores the insight with importance 1.0 for non-critical results', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.0); // always reflects

      const llm = makeMockLLM({ insight: 'normal rule' });
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      await reflector.reflect(
        [], [], [],
        [{ priority: 'STANDARD', outcome: 'ok', status: 'simulated' }]
      );

      const [, , , importance] = (memory.remember as any).mock.calls[0];
      expect(importance).toBe(1.0);
      vi.restoreAllMocks();
    });

    it('returns null and logs an error when summarizeExperience throws', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.0);

      const llm: Partial<LLMInterface> = {
        summarizeExperience: vi.fn().mockRejectedValue(new Error('LLM down')),
        embed: vi.fn(),
      };
      const memory = makeMockMemory();
      const reflector = new Reflector(llm as any, memory as any);

      const result = await reflector.reflect(
        [], [], [],
        [{ priority: 'STANDARD', outcome: 'ok', status: 'simulated' }]
      );

      expect(result).toBeNull();
      expect(memory.remember).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });
  });
});
