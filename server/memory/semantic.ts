import { MemorySystem } from '../core/memory';

export interface SemanticEntry {
  key: string;
  value: any;
  score?: number;
}

/**
 * SemanticMemory wraps the long-term / vector layer of MemorySystem.
 * It stores factual knowledge, insights, and embedding-indexed content.
 */
export class SemanticMemory {
  constructor(private memory: MemorySystem) {}

  /** Persist a semantic fact or insight under a key. */
  store(key: string, value: any, embedding?: number[], importance: number = 1.0): void {
    this.memory.remember(key, value, embedding, importance);
  }

  /** Retrieve a semantic entry by exact key. */
  retrieve(key: string): any {
    return this.memory.recall(key);
  }

  /** Find the most similar entries via vector distance (requires stored embeddings). */
  retrieveSimilar(queryEmbedding: number[], limit: number = 3): SemanticEntry[] {
    return this.memory.recallSemantic(queryEmbedding, limit);
  }

  /**
   * Return all stored insights (keys that start with `INSIGHT_`).
   * Insights are written by the Reflector after successful reflections.
   */
  getInsights(): SemanticEntry[] {
    const snapshot = this.memory.getSnapshot();
    return Object.entries(snapshot.longTerm)
      .filter(([key]) => key.startsWith('INSIGHT_'))
      .map(([key, value]) => ({ key, value }));
  }
}
