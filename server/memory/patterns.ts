import { EpisodicMemory } from './episodic';
import { SemanticMemory } from './semantic';
import { StrategicMemory } from './strategic';

export interface ExtractedPattern {
  type: 'failure' | 'success';
  description: string;
  count: number;
  taskDescription?: string;
}

/**
 * PatternExtractor analyses episodic (short-term) events to surface
 * repeated failure and successful strategy patterns, then persists them
 * to semantic and strategic memory for use by the planner.
 *
 * Designed to be called as a background process at regular intervals
 * (e.g. every N agent cycles) so the agent progressively learns from
 * its own history without blocking the main execution loop.
 */
export class PatternExtractor {
  constructor(
    private episodic: EpisodicMemory,
    private semantic: SemanticMemory,
    private strategic: StrategicMemory,
  ) {}

  /**
   * Scan recent episodic events for evaluation outcomes, aggregate
   * failure / success counts per task, and persist notable patterns.
   *
   * Returns the list of patterns detected in this extraction run.
   */
  extract(): ExtractedPattern[] {
    const events = this.episodic.getRecent(50);
    const evaluations = events.filter((e: any) => e.type === 'evaluation');

    const failureMap = new Map<string, number>();
    const successMap = new Map<string, number>();

    for (const ev of evaluations) {
      const key: string = ev.taskId ?? ev.description ?? 'unknown';
      if (ev.success === false) {
        failureMap.set(key, (failureMap.get(key) ?? 0) + 1);
      } else if (ev.success === true) {
        successMap.set(key, (successMap.get(key) ?? 0) + 1);
      }
    }

    const patterns: ExtractedPattern[] = [];

    // Repeated failures (≥2 occurrences) are stored with elevated importance
    // so the planner is warned to avoid these paths.
    for (const [key, count] of failureMap) {
      if (count >= 2) {
        const pattern: ExtractedPattern = {
          type: 'failure',
          description: `Repeated failure on task: ${key}`,
          count,
          taskDescription: key,
        };
        this.strategic.storePattern(`failure:${key}`, pattern, 1.5);
        this.semantic.store(`pattern:failure:${key}`, pattern.description, undefined, 1.5);
        patterns.push(pattern);
      }
    }

    // Successful strategies are stored so the planner can reference past wins.
    for (const [key, count] of successMap) {
      const pattern: ExtractedPattern = {
        type: 'success',
        description: `Successful strategy: ${key}`,
        count,
        taskDescription: key,
      };
      this.strategic.storePattern(`success:${key}`, pattern, 1.2);
      patterns.push(pattern);
    }

    return patterns;
  }
}
