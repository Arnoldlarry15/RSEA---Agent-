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

    try {
      const prompt = `
      You are the 'Evaluator' agent of RSEA.
      OBJECTIVE: ${objective}
      STRATEGIES: ${JSON.stringify(strategies)}

      Rank these strategies before execution based on risk, value density, and speed.

      OUTPUT PROTOCOL (STRICT JSON):
      {
        "ranked": [
          { "strategyId": "...", "score": 90, "reasoning": "..." }
        ]
      }
      `;

      // using analyze as a generic completion wrapper
      const result = await this.llm.analyze([], [prompt]);
      
      if (result.ranked) {
        return strategies.map(s => {
          const rankData = result.ranked.find((r: any) => r.strategyId === s.id);
          return { ...s, score: rankData ? rankData.score : 50 };
        }).sort((a, b) => b.score - a.score);
      }
      return strategies;
    } catch (err) {
      return strategies;
    }
  }
}
