import { LLMInterface } from '../cognition/llm';

export class Evaluator {
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
          const rankData = result.ranked.find((r: any) => r.strategyId === s.id);
          return { ...s, score: rankData ? rankData.score : 50 };
        }).sort((a: any, b: any) => b.score - a.score);
      }
      return strategies;
    } catch (_err) {
      return strategies;
    }
  }
}
