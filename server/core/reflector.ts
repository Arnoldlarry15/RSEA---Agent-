import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from './memory';
import { GoalManager } from './goals';
import { logEvent } from '../utils/logger';
import type { StrategyConfig } from './strategy/config';

/** Callback invoked by the Reflector when it decides to adjust the active strategy. */
export type StrategyUpdateCallback = (
  updates: Partial<StrategyConfig>,
  change: string,
  impact: number,
) => void;

/** Returns a snapshot of the currently active StrategyConfig for bounded updates. */
export type GetStrategyCallback = () => Readonly<StrategyConfig>;

export class Reflector {
  private llm: LLMInterface;
  private memory: MemorySystem;
  private goals: GoalManager | null;
  /** AUDIT-1: Deterministic reflection schedule — reflect every N cycles instead of
   *  stochastically so execution is auditable and reproducible. */
  private cycleCount: number = 0;
  private static readonly REFLECT_EVERY_N_CYCLES = 3;

  // ── Phase 8: Reflection Authority ────────────────────────────────────────
  /**
   * Optional callback wired by the Agent so that the Reflector can push
   * authoritative strategy updates back to the Controller.
   */
  private readonly onStrategyUpdate?: StrategyUpdateCallback;

  /** Returns the current StrategyConfig so the Reflector can compute bounded deltas. */
  private readonly getStrategy?: GetStrategyCallback;

  /**
   * Number of consecutive reflection cycles in which the average evaluation
   * score was below POOR_SCORE_THRESHOLD.  Once this reaches
   * STRATEGY_UPDATE_STREAK, the Reflector penalises the active strategy.
   */
  private failureStreak: number = 0;

  /**
   * Number of consecutive reflection cycles in which the average evaluation
   * score was above STRONG_SCORE_THRESHOLD.  Once this reaches
   * STRATEGY_UPDATE_STREAK, the Reflector rewards the active strategy.
   */
  private successStreak: number = 0;

  /** Average cycle score below this is considered poor performance. */
  private static readonly POOR_SCORE_THRESHOLD = 30;

  /** Average cycle score above this is considered strong performance. */
  private static readonly STRONG_SCORE_THRESHOLD = 70;

  /**
   * Number of consecutive poor/strong reflection cycles required before the
   * Reflector fires a strategy update.  Requires at least 2 cycles of
   * consistent signal to filter out single-cycle noise.
   */
  private static readonly STRATEGY_UPDATE_STREAK = 2;

  constructor(
    llm: LLMInterface,
    memory: MemorySystem,
    goals: GoalManager | null = null,
    onStrategyUpdate?: StrategyUpdateCallback,
    getStrategy?: GetStrategyCallback,
  ) {
    this.llm = llm;
    this.memory = memory;
    this.goals = goals;
    this.onStrategyUpdate = onStrategyUpdate;
    this.getStrategy = getStrategy;
  }

  async reflect(
    observations: any,
    thoughts: any,
    actions: any,
    results: any,
    evaluations?: any[],
  ) {
    if (!results || results.length === 0) {
      logEvent('reflect', { status: 'idle', reason: 'no_actions_taken' });
      return;
    }

    this.cycleCount++;

    // Determine if reflection is necessary: always reflect on CRITICAL/Anomaly results,
    // otherwise reflect on a deterministic schedule (every N cycles).
    const requiresReflection = results.some((r: any) => r.priority === 'CRITICAL' || r.status === 'anomaly' || (typeof r.outcome === 'string' && r.outcome.includes('Anomaly')));
    const scheduledReflection = (this.cycleCount % Reflector.REFLECT_EVERY_N_CYCLES) === 0;
    if (!requiresReflection && !scheduledReflection) {
      logEvent('reflect', { status: 'skipped', reason: 'low_priority_results', cycle: this.cycleCount });
      // Still update streaks so they accumulate even on skipped insight cycles.
      this._updateStrategyStreaks(evaluations);
      return; 
    }

    logEvent('reflect', { status: 'analyzing_outcomes', count: results.length });

    try {
      const summary = await this.llm.summarizeExperience(observations, actions, results);
      if (summary && summary.insight) {
        const key = `INSIGHT_${Date.now()}`;
        
        // Memory Evolution: Create semantic vector for context window injection
        const embedding = await this.llm.embed(summary.insight);
        
        // Give higher importance to critical reflections
        const importance = requiresReflection ? 1.5 : 1.0;

        this.memory.remember(key, summary.insight, embedding, importance);
        logEvent('reflect_insight', { key, insight: summary.insight, importance });

        // Feed reflection back into goal planning when a GoalManager is wired in
        if (this.goals && Array.isArray(summary.suggested_subtasks) && summary.suggested_subtasks.length > 0) {
          this.goals.updateSubTasks(summary.suggested_subtasks);
          logEvent('reflect_goal_update', { suggested_subtasks: summary.suggested_subtasks });
        }

        // Phase 8: Apply authoritative strategy adjustments based on evaluations.
        this._updateStrategyStreaks(evaluations);
        
        return summary.insight;
      }
    } catch (e) {
      console.error("Reflection failed", e);
      logEvent('reflect', { status: 'error', detail: String(e) });
    }

    // Still update streaks on error so failures aren't silently swallowed.
    this._updateStrategyStreaks(evaluations);
    return null;
  }

  /**
   * Tracks consecutive poor/strong performance cycles and fires authoritative
   * strategy updates once a streak threshold is reached.
   *
   * This gives the Reflector real teeth: it does not merely observe outcomes —
   * after sustained failure it actively penalises the active strategy, and after
   * sustained success it opens up the exploration budget.
   */
  private _updateStrategyStreaks(evaluations: any[] | undefined): void {
    if (!evaluations || evaluations.length === 0 || !this.onStrategyUpdate || !this.getStrategy) {
      return;
    }

    const scores = evaluations
      .map((ev) => (typeof ev?.evaluation?.score === 'number' ? ev.evaluation.score : null))
      .filter((s): s is number => s !== null);

    if (scores.length === 0) return;

    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    if (avgScore < Reflector.POOR_SCORE_THRESHOLD) {
      this.failureStreak++;
      this.successStreak = 0;
      logEvent('reflect_performance', { avgScore, failureStreak: this.failureStreak, successStreak: 0 });

      if (this.failureStreak >= Reflector.STRATEGY_UPDATE_STREAK) {
        const current = this.getStrategy();
        const newRiskTolerance = Math.max(0.1, current.risk_tolerance - 0.1);
        this.onStrategyUpdate(
          { risk_tolerance: newRiskTolerance },
          `Reflection authority: consecutive poor performance (streak=${this.failureStreak}, avgScore=${avgScore.toFixed(1)})`,
          -avgScore,
        );
        logEvent('reflect_strategy_penalize', {
          failureStreak: this.failureStreak,
          avgScore,
          newRiskTolerance,
        });
        this.failureStreak = 0;
      }
    } else if (avgScore > Reflector.STRONG_SCORE_THRESHOLD) {
      this.successStreak++;
      this.failureStreak = 0;
      logEvent('reflect_performance', { avgScore, failureStreak: 0, successStreak: this.successStreak });

      if (this.successStreak >= Reflector.STRATEGY_UPDATE_STREAK) {
        const current = this.getStrategy();
        const newExplorationRate = Math.min(1.0, current.exploration_rate + 0.05);
        this.onStrategyUpdate(
          { exploration_rate: newExplorationRate },
          `Reflection authority: consecutive strong performance (streak=${this.successStreak}, avgScore=${avgScore.toFixed(1)})`,
          avgScore,
        );
        logEvent('reflect_strategy_reward', {
          successStreak: this.successStreak,
          avgScore,
          newExplorationRate,
        });
        this.successStreak = 0;
      }
    } else {
      // Neutral zone — reset both streaks.
      this.failureStreak = 0;
      this.successStreak = 0;
    }
  }
}
