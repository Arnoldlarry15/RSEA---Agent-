import { describe, it, expect, vi } from 'vitest';
import { Evaluator } from '../../../server/modules/evaluator';
import type { LLMInterface } from '../../../server/cognition/llm';

function makeMockLLM(healthOk: boolean, completeResult: any): Partial<LLMInterface> {
  return {
    healthCheck: vi.fn().mockReturnValue(healthOk),
    complete: vi.fn().mockResolvedValue(completeResult),
  };
}

const sampleStrategies = [
  { id: 't1', description: 'Fast trade', status: 'pending' },
  { id: 't2', description: 'Slow research', status: 'pending' },
];

describe('Evaluator', () => {
  describe('rankStrategies — simulation mode (no LLM)', () => {
    it('returns strategies unchanged (with rank/score) when LLM is unavailable', async () => {
      const llm = makeMockLLM(false, null);
      const evaluator = new Evaluator(llm as any);

      const ranked = await evaluator.rankStrategies('goal', sampleStrategies);
      expect(ranked).toHaveLength(2);
      ranked.forEach((s: any) => {
        expect(s).toHaveProperty('score');
        expect(s).toHaveProperty('rank');
      });
    });

    it('returns an empty array for an empty strategy list', async () => {
      const llm = makeMockLLM(false, null);
      const evaluator = new Evaluator(llm as any);
      expect(await evaluator.rankStrategies('goal', [])).toEqual([]);
    });
  });

  describe('rankStrategies — with LLM', () => {
    it('ranks strategies using scores from the LLM response', async () => {
      const llmPayload = {
        ranked: [
          { strategyId: 't1', score: 40, reasoning: 'risky' },
          { strategyId: 't2', score: 80, reasoning: 'safe' },
        ]
      };
      const llm = makeMockLLM(true, llmPayload);
      const evaluator = new Evaluator(llm as any);

      const ranked = await evaluator.rankStrategies('goal', sampleStrategies);
      // Higher score should come first
      expect(ranked[0].id).toBe('t2');
      expect(ranked[0].score).toBe(80);
      expect(ranked[1].score).toBe(40);
    });

    it('assigns a default score of 50 when a strategy is missing from LLM ranked list', async () => {
      const llmPayload = {
        ranked: [
          { strategyId: 't1', score: 75, reasoning: 'ok' }
          // t2 is missing
        ]
      };
      const llm = makeMockLLM(true, llmPayload);
      const evaluator = new Evaluator(llm as any);

      const ranked = await evaluator.rankStrategies('goal', sampleStrategies);
      const t2 = ranked.find((s: any) => s.id === 't2');
      expect(t2?.score).toBe(50);
    });

    it('returns strategies unmodified when LLM returns null', async () => {
      const llm = makeMockLLM(true, null);
      const evaluator = new Evaluator(llm as any);

      const ranked = await evaluator.rankStrategies('goal', sampleStrategies);
      expect(ranked).toEqual(sampleStrategies);
    });

    it('returns strategies unmodified when LLM complete() rejects', async () => {
      const llm = makeMockLLM(true, null);
      (llm.complete as any).mockRejectedValue(new Error('boom'));
      const evaluator = new Evaluator(llm as any);

      const ranked = await evaluator.rankStrategies('goal', sampleStrategies);
      expect(ranked).toEqual(sampleStrategies);
    });
  });
});
