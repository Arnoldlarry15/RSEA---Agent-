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

    // 4. Act — run parallel tasks concurrently, single-fire for the rest
    const results = [];
    if (rankedTasks.length > 0) {
      const parallelTasks = rankedTasks.filter((t: any) => t.parallelNode === true);
      if (parallelTasks.length > 1) {
        // Execute all parallel-flagged top tasks concurrently
        const parallelResults = await Promise.all(
          parallelTasks.map((t: any) => this.sniper.executeSurgicalStrike(t))
        );
        for (const r of parallelResults) results.push(...r);
      } else {
        // Single-fire: execute only the top-ranked task
        const topTask = rankedTasks[0];
        const strikeResult = await this.sniper.executeSurgicalStrike(topTask);
        results.push(...strikeResult);
      }
    }

    return { observations, plan: rankedTasks, results };
  }

  /**
   * Self-Modification Layer
   * Allows the agent to adjust its own system prompts and operating parameters.
   * Requires ALLOW_SELF_MODIFICATION=true to be enabled — without this flag the
   * method is a no-op, preventing unsupervised prompt drift in production.
   */
  async selfModifyPrompts(recentContext: any[]) {
    const allowSelfMod = (process.env.ALLOW_SELF_MODIFICATION ?? '').toLowerCase() === 'true';
    if (!allowSelfMod || !this.llm.healthCheck() || Math.random() > 0.1) return; // Only process periodically

    try {
      const updatedModifiers = await this.llm.generateModifiers(recentContext, this.globalPromptModifiers);
      if (updatedModifiers) {
        logEvent('self_modification', {
          severity: 'CRITICAL',
          previous: [...this.globalPromptModifiers],
          updated: updatedModifiers,
        });
        this.globalPromptModifiers = updatedModifiers;
      }
    } catch (e) {
      console.error("Self-mod failed", e);
    }
  }

  getModifiers() {
    return this.globalPromptModifiers;
  }
}
