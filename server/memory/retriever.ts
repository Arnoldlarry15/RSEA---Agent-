import { EpisodicMemory } from './episodic';
import { SemanticMemory } from './semantic';
import { StrategicMemory } from './strategic';

export interface RelevantMemory {
  type: 'episodic' | 'semantic' | 'strategic';
  content: any;
}

/**
 * MemoryRetriever aggregates context from all three memory tiers
 * (episodic, semantic, strategic) to inform planning.
 *
 * Usage:
 *   const memories = retriever.retrieve(goal, context);
 *   plan = planner(goal, context + memories);
 */
export class MemoryRetriever {
  constructor(
    private episodic: EpisodicMemory,
    private semantic: SemanticMemory,
    private strategic: StrategicMemory,
  ) {}

  /**
   * Retrieve memories relevant to a planning goal.
   * Returns a blend of recent episodic events, semantic insights,
   * and stored strategic patterns.
   */
  retrieve(goal: string, context: any[]): RelevantMemory[] {
    const memories: RelevantMemory[] = [];

    // Recent episodic events give the planner awareness of what just happened.
    const recentEpisodes = this.episodic.getRecent(5);
    for (const ep of recentEpisodes) {
      memories.push({ type: 'episodic', content: ep });
    }

    // Semantic insights are reflections distilled from past experiences.
    const insights = this.semantic.getInsights();
    for (const insight of insights.slice(0, 3)) {
      memories.push({ type: 'semantic', content: insight.value });
    }

    // Strategic patterns capture repeated failures and successful strategies
    // so the planner can explicitly avoid known failure paths.
    const patterns = this.strategic.getAllPatterns();
    for (const sp of patterns) {
      memories.push({ type: 'strategic', content: sp.pattern });
    }

    return memories;
  }
}
