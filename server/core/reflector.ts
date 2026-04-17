import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from './memory';
import { logEvent } from '../utils/logger';

export class Reflector {
  private llm: LLMInterface;
  private memory: MemorySystem;

  constructor(llm: LLMInterface, memory: MemorySystem) {
    this.llm = llm;
    this.memory = memory;
  }

  async reflect(observations: any, thoughts: any, actions: any, results: any) {
    if (!results || results.length === 0) {
      logEvent('reflect', { status: 'idle', reason: 'no_actions_taken' });
      return;
    }

    // Determine if reflection is necessary (Anomalies, Critical priorities, or stochastic sample)
    const requiresReflection = results.some((r: any) => r.priority === 'CRITICAL' || r.outcome.includes('Anomaly'));
    if (!requiresReflection && Math.random() > 0.4) {
      logEvent('reflect', { status: 'skipped', reason: 'low_priority_results' });
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
        
        return summary.insight;
      }
    } catch (e) {
      console.error("Reflection failed", e);
      logEvent('reflect', { status: 'error', detail: String(e) });
    }
    return null;
  }
}
