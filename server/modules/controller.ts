import { Spotter } from './spotter';
import { Planner } from './planner';
import { Evaluator } from './evaluator';
import { Sniper } from './sniper';
import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from '../core/memory';
import { Observer } from '../core/observation/observer';
import { Comparator } from '../core/evaluation/comparator';
import { logEvent } from '../utils/logger';

export class Controller {
  private spotter: Spotter;
  private planner: Planner;
  private evaluator: Evaluator;
  private sniper: Sniper;
  private observer: Observer;
  private comparator: Comparator;
  private llm: LLMInterface;
  private memory: MemorySystem;

  // Self-Modification Layer configuration
  private globalPromptModifiers: string[] = [
    "Prioritize capital preservation.",
    "Look for asymmetric bets."
  ];

  /** AUDIT-1: Deterministic self-modification schedule — trigger every N cycles. */
  private cycleCount: number = 0;
  private static readonly SELF_MODIFY_EVERY_N_CYCLES = 10;

  constructor(llm: LLMInterface, memory: MemorySystem) {
    this.llm = llm;
    this.memory = memory;
    this.spotter = new Spotter();
    this.planner = new Planner(this.llm, this.memory);
    this.evaluator = new Evaluator(this.llm);
    this.sniper = new Sniper();
    this.observer = new Observer();
    this.comparator = new Comparator();
  }

  async runCycle(objective: string, context: any[]) {
    this.cycleCount++;

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

    // 5. Observe & Compare — build the reality feedback loop
    const evaluations = results.map((result: any, index: number) => {
      const task = rankedTasks[index] ?? rankedTasks[0];
      const expected = task?.expected ?? task?.description ?? 'task completion';
      const observation = this.observer.observe(result);
      const evaluation = this.comparator.compare(expected, observation);
      logEvent('controller_evaluation', { taskId: task?.id, expected, observation, evaluation });
      return { taskId: task?.id, expected, observation, evaluation };
    });

    // 6. Persist evaluations into memory so the agent learns from outcomes
    for (const ev of evaluations) {
      this.memory.addEvent({
        type: 'evaluation',
        taskId: ev.taskId,
        expected: ev.expected,
        actual: ev.observation.actual_outcome,
        success: ev.evaluation.success,
        score: ev.evaluation.score,
        delta: ev.evaluation.delta,
      });
    }

    return { observations, plan: rankedTasks, results, evaluations };
  }

  /**
   * Self-Modification Layer
   * Allows the agent to adjust its own system prompts and operating parameters.
   * AUDIT-3: Requires ALLOW_SELF_MODIFICATION=true and DRY_RUN=false to take effect.
   *          All modifier changes are logged at CRITICAL level.
   */
  async selfModifyPrompts(recentContext: any[]) {
    if (!this.llm.healthCheck()) return;
    // AUDIT-1: Use deterministic cycle-based schedule instead of Math.random()
    if ((this.cycleCount % Controller.SELF_MODIFY_EVERY_N_CYCLES) !== 0) return;

    // AUDIT-3: Gate behind explicit opt-in flag (read dynamically to support test env overrides)
    const allowSelfMod = (process.env.ALLOW_SELF_MODIFICATION ?? '').toLowerCase() === 'true';
    if (!allowSelfMod) {
      logEvent('self_modification_skipped', { reason: 'ALLOW_SELF_MODIFICATION not set' });
      return;
    }

    const dryRun = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
    if (dryRun) {
      logEvent('self_modification_skipped', { reason: 'DRY_RUN=true; skipping self-modification' });
      return;
    }

    try {
      const updatedModifiers = await this.llm.generateModifiers(recentContext, this.globalPromptModifiers);
      if (updatedModifiers) {
        this.globalPromptModifiers = updatedModifiers;
        // AUDIT-3: Log every modifier change as CRITICAL for human review
        logEvent('self_modification_CRITICAL', { updatedModifiers: this.globalPromptModifiers });
      }
    } catch (e) {
      console.error("Self-mod failed", e);
    }
  }

  getModifiers() {
    return this.globalPromptModifiers;
  }
}
