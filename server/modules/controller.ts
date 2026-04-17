import { Spotter } from './spotter';
import { Planner } from './planner';
import { Evaluator } from './evaluator';
import { Sniper } from './sniper';
import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from '../core/memory';
import { logEvent } from '../utils/logger';

export class Controller {
  private spotter: Spotter;
  private planner: Planner;
  private evaluator: Evaluator;
  private sniper: Sniper;
  private llm: LLMInterface;
  private memory: MemorySystem;

  // Self-Modification Layer configuration
  private globalPromptModifiers: string[] = [
    "Prioritize capital preservation.",
    "Look for asymmetric bets."
  ];

  constructor(llm: LLMInterface, memory: MemorySystem) {
    this.llm = llm;
    this.memory = memory;
    this.spotter = new Spotter();
    this.planner = new Planner(this.llm, this.memory);
    this.evaluator = new Evaluator(this.llm);
    this.sniper = new Sniper();
  }

  async runCycle(objective: string, context: any[]) {
    // 1. Observe
    const observations = await this.spotter.scan();
    
    // Self-Modification trigger check based on recent performance
    await this.selfModifyPrompts(context);

    // 2. Plan
    const plan = await this.planner.decomposeTask(objective, [...observations, ...context, ...this.globalPromptModifiers]);
    logEvent('controller_plan', plan);

    // 3. Evaluate Strategies (we treat tasks as potential separate strategies here for parallel attempts)
    const rankedTasks = await this.evaluator.rankStrategies(objective, plan.tasks);

    // 4. Act (Sniper targets the top ranked strategy)
    const results = [];
    if (rankedTasks.length > 0) {
      const topTask = rankedTasks[0];
      const strikeResult = await this.sniper.executeSurgicalStrike(topTask);
      results.push(...strikeResult);
    }

    return { observations, plan: rankedTasks, results };
  }

  /**
   * Self-Modification Layer
   * Allows the agent to adjust its own system prompts and operating parameters
   */
  async selfModifyPrompts(recentContext: any[]) {
    if (!this.llm.healthCheck() || Math.random() > 0.1) return; // Only process periodically

    try {
      const selfReflectPrompt = `
      Based on the recent context: ${JSON.stringify(recentContext).substring(0, 300)}
      Your current running modifiers are: ${JSON.stringify(this.globalPromptModifiers)}

      Should we adjust our strategic modifiers to improve future iterations? 
      Return the updated array of string modifiers. Limit to 3 rules.

      OUTPUT PROTOCOL (STRICT JSON):
      {
        "modifiers": ["rule 1", "rule 2"]
      }`;

      const res = await this.llm.analyze([], [selfReflectPrompt]);
      if (res && res.modifiers && Array.isArray(res.modifiers)) {
        this.globalPromptModifiers = res.modifiers;
        logEvent('self_modification', { updatedModifiers: this.globalPromptModifiers });
      }
    } catch (e) {
      console.error("Self-mod failed", e);
    }
  }

  getModifiers() {
    return this.globalPromptModifiers;
  }
}
