/**
 * Architecture regression test — Governance Rule:
 *   "No evaluation module can trigger execution."
 *
 * DESIGN RULE:
 *   This agent is NOT a red-team system.
 *   Evaluation modules are observational only.
 *   They must never influence execution decisions directly.
 *
 * What this test enforces:
 *   Executor.execute() must NEVER be called as a result of running
 *   Evaluator.rankStrategies().  The only valid caller of Executor is
 *   the Sniper, invoked exclusively through Controller._executeWithRiskGate().
 *
 * If this test fails, an evaluation module has reached the Executor — that is
 * an architecture violation regardless of the path taken to get there.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Evaluator } from '../../../server/modules/evaluator';
import { Executor } from '../../../server/modules/executor';

vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

const sampleStrategies = [
  { id: 't1', description: 'Fast trade', status: 'pending' },
  { id: 't2', description: 'Safe hold', status: 'pending' },
];

describe('Architecture: evaluators cannot trigger execution (governance boundary)', () => {
  let executeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Intercept every call to Executor.execute — even indirectly through
    // any object chain an evaluator might inadvertently reach.
    executeSpy = vi.spyOn(Executor.prototype, 'execute');
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  it('Evaluator.rankStrategies does not call Executor.execute (LLM online)', async () => {
    const mockLLM = {
      healthCheck: vi.fn().mockReturnValue(true),
      complete: vi.fn().mockResolvedValue({
        ranked: [
          { strategyId: 't1', score: 80, reasoning: 'fast and safe' },
          { strategyId: 't2', score: 60, reasoning: 'conservative' },
        ],
      }),
    };

    const evaluator = new Evaluator(mockLLM as any);
    const ranked = await evaluator.rankStrategies('maximise profit', sampleStrategies);

    // The evaluator should return ranked strategies — purely observational.
    expect(ranked).toHaveLength(2);

    // GOVERNANCE ASSERTION: Executor must not have been touched.
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('Evaluator.rankStrategies does not call Executor.execute (LLM offline / simulation mode)', async () => {
    const mockLLM = {
      healthCheck: vi.fn().mockReturnValue(false),
      complete: vi.fn(),
    };

    const evaluator = new Evaluator(mockLLM as any);
    await evaluator.rankStrategies('maximise profit', sampleStrategies);

    // GOVERNANCE ASSERTION: even the simulation fallback path must not reach Executor.
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('Evaluator.rankStrategies does not call Executor.execute when LLM rejects', async () => {
    const mockLLM = {
      healthCheck: vi.fn().mockReturnValue(true),
      complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };

    const evaluator = new Evaluator(mockLLM as any);
    await evaluator.rankStrategies('maximise profit', sampleStrategies);

    // GOVERNANCE ASSERTION: error recovery path must also stay clear of Executor.
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('Evaluator.rankStrategies does not call Executor.execute for an empty strategy list', async () => {
    const mockLLM = {
      healthCheck: vi.fn().mockReturnValue(true),
      complete: vi.fn(),
    };

    const evaluator = new Evaluator(mockLLM as any);
    await evaluator.rankStrategies('maximise profit', []);

    // GOVERNANCE ASSERTION: edge-case (empty input) must not sneak through.
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
