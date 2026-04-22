import { LLMInterface } from '../cognition/llm';

// DESIGN RULE:
// This agent is NOT a red-team system.
// Evaluation modules are observational only.
// They must never influence execution decisions directly.
//
// Modules implementing IEvaluator:
//   MUST  — receive data and return scores/rankings.
//   MUST NOT — return executable actions.
//   MUST NOT — call tools or the Executor.
//   MUST NOT — mutate execution state directly.

/**
 * Strict contract for all evaluation modules.
 * Implementors are read-only observers: they score and rank inputs but
 * are forbidden from triggering any side-effecting execution path.
 */
export interface IEvaluator {
  rankStrategies(objective: string, strategies: unknown[]): Promise<unknown[]>;
}

export class Evaluator implements IEvaluator {
  private llm: LLMInterface;

  constructor(llm: LLMInterface) {
    this.llm = llm;
  }

  async rankStrategies(objective: string, strategies: any[]): Promise<any[]> {
    if (!this.llm.healthCheck() || strategies.length === 0) {
      return strategies.map((s, i) => ({ ...s, rank: i, score: 0.5 }));
    }

    const systemPrompt = `You are the 'Evaluator' agent of RSEA.
Rank the provided strategies before execution based on risk, value density, and speed.
Always respond with valid JSON matching the OUTPUT PROTOCOL exactly.

OUTPUT PROTOCOL (STRICT JSON):
{
  "ranked": [
    { "strategyId": "...", "score": 90, "reasoning": "..." }
  ]
}`;

    const userPrompt = `OBJECTIVE: ${objective}
STRATEGIES: ${JSON.stringify(strategies)}`;

    try {
      const result = await this.llm.complete(systemPrompt, userPrompt);

      if (result?.ranked && Array.isArray(result.ranked)) {
        return strategies.map(s => {
          const rankData = (result.ranked as Array<Record<string, unknown>>).find((r) => r.strategyId === s.id);
          return { ...s, score: rankData ? rankData.score : 50 };
        }).sort((a: any, b: any) => b.score - a.score);
      }
      return strategies;
    } catch (_err) {
      return strategies;
    }
  }
}
