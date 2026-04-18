import { MemorySystem } from '../core/memory';

export interface EpisodicEvent {
  type: string;
  timestamp?: string;
  [key: string]: any;
}

/**
 * EpisodicMemory wraps the short-term / session layer of MemorySystem.
 * It records time-ordered events (episodes) and exposes them for retrieval.
 */
export class EpisodicMemory {
  constructor(private memory: MemorySystem) {}

  /** Record a new episode in short-term storage. */
  addEpisode(event: EpisodicEvent): void {
    this.memory.addEvent(event);
  }

  /** Return the N most recent episodes, oldest first. */
  getRecent(limit: number = 10): EpisodicEvent[] {
    return this.memory.getRecentContext(limit);
  }
}
