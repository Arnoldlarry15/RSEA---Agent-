import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from './memory';
import { GoalManager } from './goals';
import { logEvent } from '../utils/logger';

export class Reflector {
  private llm: LLMInterface;
  private memory: MemorySystem;
  private goals: GoalManager | null;
  /** AUDIT-1: Deterministic reflection schedule — reflect every N cycles instead of
   *  stochastically so execution is auditable and reproducible. */
  private cycleCount: number = 0;
  private static readonly REFLECT_EVERY_N_CYCLES = 3;

  constructor(llm: LLMInterface, memory: MemorySystem, goals: GoalManager | null = null) {
    this.llm = llm;
    this.memory = memory;
    this.goals = goals;
  }

  async reflect(observations: any, thoughts: any, actions: any, results: any) {
    if (!results || results.length === 0) {
      logEvent('reflect', { status: 'idle', reason: 'no_actions_taken' });
      return;
    }

    this.cycleCount++;

    // Determine if reflection is necessary: always reflect on CRITICAL/Anomaly results,
    // otherwise reflect on a deterministic schedule (every N cycles).
    const requiresReflection = results.some((r: any) => r.priority === 'CRITICAL' || r.outcome.includes('Anomaly'));
    const scheduledReflection = (this.cycleCount % Reflector.REFLECT_EVERY_N_CYCLES) === 0;
    if (!requiresReflection && !scheduledReflection) {
      logEvent('reflect', { status: 'skipped', reason: 'low_priority_results', cycle: this.cycleCount });
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
        
        return summary.insight;
      }
    } catch (e) {
      console.error("Reflection failed", e);
      logEvent('reflect', { status: 'error', detail: String(e) });
    }
    return null;
  }
}
