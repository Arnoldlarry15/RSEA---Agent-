import { MemorySystem } from '../core/memory';

export interface StrategicPattern {
  key: string;
  pattern: any;
}

const STRATEGIC_PREFIX = 'strategic:';

/**
 * StrategicMemory wraps the long-term layer of MemorySystem and stores
 * high-level patterns and learned strategies under a `strategic:` key namespace.
 */
export class StrategicMemory {
  constructor(private memory: MemorySystem) {}

  /** Persist a named strategic pattern. */
  storePattern(key: string, pattern: any, importance: number = 1.0): void {
    this.memory.remember(`${STRATEGIC_PREFIX}${key}`, pattern, undefined, importance);
  }

  /** Retrieve a specific strategic pattern by name. */
  getPattern(key: string): any {
    return this.memory.recall(`${STRATEGIC_PREFIX}${key}`);
  }

  /** Return all stored strategic patterns. */
  getAllPatterns(): StrategicPattern[] {
    const snapshot = this.memory.getSnapshot();
    return Object.entries(snapshot.longTerm)
      .filter(([key]) => key.startsWith(STRATEGIC_PREFIX))
      .map(([key, pattern]) => ({
        key: key.slice(STRATEGIC_PREFIX.length),
        pattern,
      }));
  }
}
